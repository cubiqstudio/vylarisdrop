import busboy from 'busboy'
import { ereignis } from '../../utils/db'
import { clientIp, limit, userAusSitzungOderToken } from '../../utils/auth'
import { schreiben } from '../../utils/speicher'
import { basisUrl, dateiAnlegen, fuerPanel, type DateiZeile } from '../../utils/dateien'
import { maxFuer, optionenAus } from '../../utils/hochladen'
import { requireRecht } from '../../utils/teams'
import { nachUpload } from '../../utils/benachrichtigen'
import { webhookAusloesen } from '../../utils/webhooks'
import { alsApi } from '../../utils/api'

export default defineEventHandler(async (event) => {
  const u = await userAusSitzungOderToken(event)
  await requireRecht(u, 'hochladen')
  if (limit('upload:' + u.id, 240, 60))
    throw fehler(429, 'Zu viele Uploads in kurzer Zeit.', 'Too many uploads in a short time.')
  const typ = String(getRequestHeader(event, 'content-type') || '')
  if (!typ.startsWith('multipart/form-data'))
    throw fehler(415, 'Bitte als multipart/form-data senden.', 'Please send as multipart/form-data.')
  const max = await maxFuer(u)
  const felder: Record<string, string> = {}
  const erledigt: DateiZeile[] = []
  const fehlerListe: string[] = []
  const sprache = u.prefs?.lang === 'en' ? 'en' : 'de'

  await new Promise<void>((resolve, reject) => {
    const req = event.node.req
    const bb = busboy({ headers: req.headers as any, limits: { files: 50, fields: 20, fieldSize: 4096 } })
    const laufend: Promise<void>[] = []
    let vorbei = false
    const zuGross = () => {
      if (vorbei) return
      vorbei = true
      req.unpipe(bb)
      bb.removeAllListeners()
      req.resume()
      setResponseHeader(event, 'Connection', 'close')
      reject(
        fehler(
          413,
          'Die Datei ist zu groß oder dein Speicher ist voll.',
          'The file is too large or your storage is full.'
        )
      )
    }
    bb.on('field', (n, v) => {
      if (n.length < 40) felder[n.toLowerCase()] = v
    })
    bb.on('file', (_feld, strom, info) => {
      laufend.push(
        (async () => {
          try {
            const g = await schreiben(strom, max)
            if (g.size === 0) {
              fehlerListe.push(`${info.filename}: leer`)
              return
            }
            const o = optionenAus(event, felder)
            o.stil ||= u.prefs?.stil
            o.ablauf ||= u.prefs?.ablauf || null
            erledigt.push(await dateiAnlegen(u.id, g, info.filename || 'datei', info.mimeType || '', o, sprache))
          } catch (e: any) {
            if (e?.code === 'ZU_GROSS') return zuGross()
            strom.resume()
            fehlerListe.push(String(e?.message || e))
          }
        })()
      )
    })
    bb.on('error', (e) => {
      if (!vorbei) {
        vorbei = true
        reject(e)
      }
    })
    bb.on('close', () => {
      Promise.all(laufend).then(() => {
        if (!vorbei) {
          vorbei = true
          resolve()
        }
      }, reject)
    })
    req.pipe(bb)
  })

  if (!erledigt.length) {
    if (fehlerListe.includes('ZU_GROSS'))
      throw fehler(
        413,
        'Die Datei ist zu groß oder dein Speicher ist voll.',
        'The file is too large or your storage is full.'
      )
    throw fehler(400, fehlerListe[0] || 'Keine Datei im Upload.', fehlerListe[0] || 'No file in the upload.')
  }
  await ereignis('upload', u.id, { anzahl: erledigt.length }, clientIp(event))
  const basis = await basisUrl(event)
  const files = erledigt.map((f) => fuerPanel(basis, f))
  for (const f of files) webhookAusloesen(u.id, 'file.uploaded', { file: alsApi(f) })
  await nachUpload(
    u,
    {
      name: erledigt.length > 1 ? `${erledigt[0]!.name} (+${erledigt.length - 1})` : erledigt[0]!.name,
      size: erledigt.reduce((a, f) => a + Number(f.size), 0)
    },
    files[0]!.links.seite
  ).catch(() => {})
  return {
    ok: true,
    url: files[0]!.links.seite,
    raw: files[0]!.links.direkt,
    download: files[0]!.links.download,
    files,
    fehler: fehlerListe.length ? fehlerListe : undefined
  }
})
