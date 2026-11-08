import busboy from 'busboy'
import { ereignis } from '../../utils/db'
import { clientIp, limit, userAusSitzungOderToken } from '../../utils/auth'
import { schreiben } from '../../utils/speicher'
import { ablageKontextFuer } from '../../utils/ablageRegeln'
import { basisUrl, dateiAnlegen, fuerPanel, type DateiZeile } from '../../utils/dateien'
import { dateiGroesseMax, optionenAus } from '../../utils/hochladen'
import { grenzFehler, istQuotaFehler, nutzlastSchaetzen, uploadGrenzen } from '../../utils/quota'
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
  // engste Grenze (Kontingent von Konto/Team, Datei-Höchstgröße); verbindlich prüft dateiAnlegen() nach dem Schreiben
  const grenzen = await uploadGrenzen(u, optionenAus(event).ordner ?? null, await dateiGroesseMax(u))
  const max = grenzen.max
  const geschaetzt = nutzlastSchaetzen(Number(getRequestHeader(event, 'content-length')) || undefined, typ)
  let quotaFehler: any = null
  let verbot: any = null // eine Ablage-Regel verbietet die Datei (415/403)
  let ausfall: any = null // Speicher nicht erreichbar (503/502): dieser Status soll beim Client ankommen
  const felder: Record<string, string> = {}
  const erledigt: DateiZeile[] = []
  const fehlerListe: string[] = []
  const sprache = u.prefs?.lang === 'en' ? 'en' : 'de'

  await new Promise<void>((resolve, reject) => {
    const req = event.node.req
    const bb = busboy({ headers: req.headers as any, defParamCharset: 'utf8', limits: { files: 50, fields: 20, fieldSize: 4096 } })
    const laufend: Promise<void>[] = []
    let vorbei = false
    const abbrechen = (err: unknown) => {
      if (vorbei) return
      vorbei = true
      req.unpipe(bb)
      bb.removeAllListeners()
      req.resume()
      setResponseHeader(event, 'Connection', 'close')
      reject(err)
    }
    const zuGross = () => abbrechen(grenzFehler(grenzen, geschaetzt, true))
    bb.on('field', (n, v) => {
      if (n.length < 40) felder[n.toLowerCase()] = v
    })
    // Ablage-Regeln: Name/Typ aus dem Multipart-Kopf, Größe = Content-Length abzüglich Rahmen (bei mehreren Dateien der Rest)
    let verbraucht = 0
    bb.on('file', (_feld, strom, info) => {
      const ctx = ablageKontextFuer(u, {
        name: info.filename || 'datei',
        mime: info.mimeType,
        groesse: geschaetzt == null ? null : Math.max(0, geschaetzt - verbraucht),
        ordnerId: optionenAus(event, felder).ordner ?? null
      })
      laufend.push(
        (async () => {
          try {
            const g = await schreiben(strom, max, undefined, ctx)
            verbraucht += g.size
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
            // verboten und noch nichts gespeichert: sofort abbrechen, der Rest der Anfrage wird nicht mehr gelesen
            if (e?.ablage === 'verbot' && !erledigt.length) return abbrechen(e)
            strom.resume()
            if (e?.ablage === 'verbot') verbot ||= e
            else if (istQuotaFehler(e)) quotaFehler ||= e
            else if (e?.statusCode === 503 || e?.statusCode === 502) ausfall ||= e
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
    if (quotaFehler) throw quotaFehler
    if (verbot) throw verbot
    if (ausfall) throw ausfall
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
