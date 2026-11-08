import { nachUpload } from '../../../utils/benachrichtigen'
import { webhookAusloesen } from '../../../utils/webhooks'
import { alsApi } from '../../../utils/api'
import { PassThrough } from 'node:stream'
import { q, q1, ereignis } from '../../../utils/db'
import { clientIp, requireUser } from '../../../utils/auth'
import { ortGueltig, schreiben, teileLoeschen, teilLesen, type Ort } from '../../../utils/speicher'
import { basisUrl, dateiAnlegen, fuerPanel } from '../../../utils/dateien'
import { ablageKontextFuer } from '../../../utils/ablageRegeln'
import { dateiGroesseMax } from '../../../utils/hochladen'
import { dateinameEindeutig } from '../../../utils/dateiNamen'
import { requireRecht } from '../../../utils/teams'
import { grenzFehler, uploadGrenzen } from '../../../utils/quota'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  // Das Recht kann nach dem Start des Uploads entzogen worden sein: auch das Abschließen prüft es
  await requireRecht(u, 'hochladen')
  const id = String(getRouterParam(event, 'id') || '')
  const upZeile = await q1<{
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
  const up = upZeile
  if (!up) throw fehler(404, 'Upload nicht gefunden (abgelaufen?).', 'Upload not found (expired?).')
  const da = new Set((up.erhalten || []).map(Number))
  const fehlt = Array.from({ length: up.teile }, (_, i) => i).filter((i) => !da.has(i))
  if (fehlt.length)
    throw fehler(409, `Es fehlen noch ${fehlt.length} Stück(e).`, `${fehlt.length} chunk(s) still missing.`)

  // Upload atomar beanspruchen: nur ein fertig-Aufruf legt die Datei an, parallele Aufrufe (Retry, Doppelklick) erhalten 409.
  // Ein hängengebliebener Anspruch (Absturz) verfällt nach 30 Minuten.
  const belegt = await q<{ id: string }>(
    `UPDATE uploads SET fertig_at = now() WHERE id = $1 AND user_id = $2
      AND (fertig_at IS NULL OR fertig_at < now() - interval '30 minutes') RETURNING id`,
    [id, u.id]
  )
  if (!belegt.length)
    throw fehler(
      409,
      'Dieser Upload wird bereits abgeschlossen.',
      'This upload is already being completed.'
    )
  try {
    return await abschliessen(up)
  } catch (e) {
    // Misslungen (z. B. Kontingent voll): Anspruch freigeben, damit ein neuer Versuch möglich bleibt
    await q('UPDATE uploads SET fertig_at = NULL WHERE id = $1', [id]).catch(() => {})
    throw e
  }

  async function abschliessen(up: NonNullable<typeof upZeile>) {
    // Teile liegen lokal bzw. bei S3; die fertige Datei kommt an den beim Start gewählten Ort (auch SFTP-Erweiterung)
    const ort: Ort = up.speicher === 's3' ? 's3' : 'lokal'
    const ziel: Ort = ortGueltig(up.speicher) || ort
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
      // am Startort; Ablage-Regeln dürfen den Ort nicht mehr ändern, ein inzwischen eingeführtes Verbot gilt aber
      g = await schreiben(strom, grenzen.max, ziel, ablageKontextFuer(u, { name: up.name, mime: up.mime, groesse: Number(up.size), ordnerId: ordner }))
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
  }
})
