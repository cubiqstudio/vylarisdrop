import { nachUpload } from '../../../utils/benachrichtigen'
import { webhookAusloesen } from '../../../utils/webhooks'
import { alsApi } from '../../../utils/api'
import { PassThrough } from 'node:stream'
import { q, q1, ereignis } from '../../../utils/db'
import { clientIp, requireUser } from '../../../utils/auth'
import { schreiben, teileLoeschen, teilLesen, type Ort } from '../../../utils/speicher'
import { basisUrl, dateiAnlegen, fuerPanel } from '../../../utils/dateien'
import { dateiGroesseMax } from '../../../utils/hochladen'
import { dateinameEindeutig } from '../../../utils/dateiNamen'
import { grenzFehler, uploadGrenzen } from '../../../utils/quota'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = String(getRouterParam(event, 'id') || '')
  const up = await q1<{
    teile: number
    erhalten: string[]
    name: string
    size: string
    mime: string
    optionen: any
    speicher: Ort
  }>('SELECT teile, erhalten, name, size, mime, optionen, speicher FROM uploads WHERE id = $1 AND user_id = $2', [
    id,
    u.id
  ])
  if (!up) throw fehler(404, 'Upload nicht gefunden (abgelaufen?).', 'Upload not found (expired?).')
  const da = new Set((up.erhalten || []).map(Number))
  const fehlt = Array.from({ length: up.teile }, (_, i) => i).filter((i) => !da.has(i))
  if (fehlt.length)
    throw fehler(409, `Es fehlen noch ${fehlt.length} Stück(e).`, `${fehlt.length} chunk(s) still missing.`)

  const ort: Ort = up.speicher === 's3' ? 's3' : 'lokal'
  const strom = new PassThrough()
  void (async () => {
    try {
      for (let i = 0; i < up.teile; i++) {
        await new Promise<void>((res, rej) => {
          const r = teilLesen(id, i, ort)
          r.on('error', rej)
          r.on('end', () => res())
          r.pipe(strom, { end: false })
        })
      }
      strom.end()
    } catch (e: any) {
      strom.destroy(e)
    }
  })()
  // Grenze: Kontingent des Kontos/Teams (jetzt frisch gerechnet) und Datei-Höchstgröße; endgültig prüft dateiAnlegen()
  const ordner = Number(up.optionen?.ordner) > 0 ? Number(up.optionen.ordner) : null
  const grenzen = await uploadGrenzen(u, ordner, await dateiGroesseMax(u))
  let g
  try {
    g = await schreiben(strom, grenzen.max, ort)
  } catch (e: any) {
    strom.destroy()
    if (e?.code === 'ZU_GROSS') throw grenzFehler(grenzen, Number(up.size))
    throw e
  }
  if (g.size !== Number(up.size))
    throw fehler(400, 'Die Datei ist nicht vollständig angekommen.', 'The file did not arrive completely.')
  const o = up.optionen || {}
  const f = await dateiAnlegen(
    u.id,
    g,
    up.name,
    up.mime,
    {
      stil: o.stil || u.prefs?.stil,
      ordner: Number(o.ordner) || null,
      ablauf: o.ablauf || u.prefs?.ablauf || null,
      maxAufrufe: Number(o.maxAufrufe) || null,
      passwort: o.passwort || undefined,
      verschluesselt: o.verschluesselt === true
    },
    u.prefs?.lang === 'en' ? 'en' : 'de'
  )
  // Cloud-Dateimanager: im Ordner freien Namen wählen ("name (2).ext")
  if (o.eindeutig === true) f.name = await dateinameEindeutig(f)
  await q('DELETE FROM uploads WHERE id = $1', [id])
  await teileLoeschen(id, ort)
  await ereignis('upload', u.id, { anzahl: 1, teile: up.teile }, clientIp(event))
  const file = fuerPanel(await basisUrl(event), f)
  await nachUpload(u, f, file.links.seite).catch(() => {})
  webhookAusloesen(u.id, 'file.uploaded', { file: alsApi(file) })
  return { ok: true, file }
})
