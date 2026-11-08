import busboy from 'busboy'
import { q, q1, ereignis } from '../../../../utils/db'
import { clientIp, limit, type Nutzer } from '../../../../utils/auth'
import { loeschen, schreiben } from '../../../../utils/speicher'
import { basisUrl, dateiAnlegen, fuerPanel, links, type DateiZeile } from '../../../../utils/dateien'
import { dateiGroesseMax, freierPlatz } from '../../../../utils/hochladen'
import { istQuotaFehler, nutzlastSchaetzen } from '../../../../utils/quota'
import { ablageKontextFuer } from '../../../../utils/ablageRegeln'
import { getUploads } from '../../../../utils/settings'
import { imHintergrund, speicherPruefen } from '../../../../utils/benachrichtigen'
import { webhookAusloesen } from '../../../../utils/webhooks'
import { alsApi } from '../../../../utils/api'
import { rechteVon } from '../../../../utils/teams'
import { anfrageFreigegeben, anfrageOffen, anfragePerToken } from '../../../../utils/anfragen'

export default defineEventHandler(async (event) => {
  const ip = clientIp(event)
  if (limit('gast:' + ip, 120, 3600))
    throw fehler(429, 'Zu viele Uploads. Bitte später noch einmal.', 'Too many uploads. Please try again later.')
  const a = await anfragePerToken(String(getRouterParam(event, 'token') || ''))
  if (!a) throw fehler(404, 'Diese Anfrage gibt es nicht.', 'This request does not exist.')
  const o = anfrageOffen(a)
  if (!o.offen)
    throw fehler(
      410,
      o.grund === 'voll'
        ? 'Hier können keine weiteren Dateien mehr hochgeladen werden.'
        : 'Diese Anfrage ist geschlossen.',
      o.grund === 'voll' ? 'No more files can be uploaded here.' : 'This request is closed.'
    )
  if (!(await anfrageFreigegeben(event, a))) throw fehler(403, 'Passwort erforderlich.', 'Password required.')
  const besitzer = await q1<Nutzer>('SELECT id, username, email, role, rolle_id, quota_bytes, prefs FROM users WHERE id = $1', [
    a.user_id
  ])
  if (!besitzer) throw fehler(404, 'Diese Anfrage gibt es nicht.', 'This request does not exist.')
  // Verliert der Besitzer das Recht auf Datei-Anfragen, nimmt eine bestehende Anfrage keine Uploads mehr an
  if (!(await rechteVon(besitzer)).anfragen)
    throw fehler(410, 'Diese Anfrage ist geschlossen.', 'This request is closed.')
  const cfg = await getUploads()
  const frei = await freierPlatz(besitzer, a.folder_id)
  // Die Rollengrenze „Dateigröße“ des Empfängers gilt auch für Gast-Uploads (wie bei Web-Upload, API und WebDAV)
  const dateiMax = await dateiGroesseMax(besitzer)
  const grenzen = [a.max_bytes != null ? Number(a.max_bytes) : Infinity, cfg.maxBytes > 0 ? cfg.maxBytes : Infinity, dateiMax, frei]
  const max = Math.min(...grenzen)
  // Gäste sehen keine Zahlen zum Speicher des Empfängers, nur dass es nicht passt
  const speicherVoll = () =>
    fehler(507, 'Der Speicher des Empfängers ist voll.', 'The recipient’s storage is full.')
  if (max <= 0) throw speicherVoll()

  const felder: Record<string, string> = {}
  const ergebnis = await new Promise<{ name: string; slug: string; datei: DateiZeile } | null>((resolve, reject) => {
    const req = event.node.req
    const bb = busboy({ headers: req.headers as any, defParamCharset: 'utf8', limits: { files: 1, fields: 6, fieldSize: 1200 } })
    let fertig = false
    const ende = (fn: () => void) => {
      if (!fertig) {
        fertig = true
        fn()
      }
    }
    bb.on('field', (n, v) => {
      felder[n] = v
    })
    bb.on('file', (_f, strom, info) => {
      // Ablage-Regeln gelten für das Konto des Empfängers (der Besitzer der Anfrage), Größe = Content-Length abzüglich Rahmen
      const ctx = ablageKontextFuer(besitzer, {
        name: info.filename || 'datei',
        mime: info.mimeType,
        groesse: nutzlastSchaetzen(Number(getRequestHeader(event, 'content-length')) || undefined, String(getRequestHeader(event, 'content-type') || '')) ?? null,
        ordnerId: a.folder_id
      })
      schreiben(strom, max === Infinity ? 0 : max, undefined, ctx)
        .then(async (g) => {
          if (!g.size) return ende(() => resolve(null))
          const frei = await q(
            'UPDATE anfragen SET anzahl = anzahl + 1 WHERE id = $1 AND (max_dateien IS NULL OR anzahl < max_dateien) RETURNING anzahl',
            [a.id]
          )
          if (!frei.length) {
            await loeschen(g.schluessel)
            ende(() =>
              reject(
                fehler(
                  410,
                  'Hier können keine weiteren Dateien mehr hochgeladen werden.',
                  'No more files can be uploaded here.'
                )
              )
            )
            return
          }
          let f: DateiZeile
          try {
            f = await dateiAnlegen(
              a.user_id,
              g,
              info.filename || 'datei',
              info.mimeType || '',
              { ordner: a.folder_id },
              besitzer.prefs?.lang === 'en' ? 'en' : 'de'
            )
          } catch (e: any) {
            // die Datei zählt nicht, wenn sie nicht angelegt werden konnte
            await q('UPDATE anfragen SET anzahl = greatest(0, anzahl - 1) WHERE id = $1', [a.id]).catch(() => {})
            throw istQuotaFehler(e) ? speicherVoll() : e
          }
          const gast = String(felder.name || '')
            .replace(/[\u0000-\u001f]/g, '')
            .trim()
            .slice(0, 60)
          const notiz = String(felder.notiz || '')
            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
            .trim()
            .slice(0, 500)
          const dauer = Math.round(Number(felder.dauer_ms))
          await q(
            "UPDATE files SET anfrage_id = $2, von_gast = $3, notiz = $4, duration_ms = CASE WHEN $5::int > 0 AND art IN ('audio', 'video') AND duration_ms IS NULL THEN $5::int ELSE duration_ms END WHERE id = $1",
            [f.id, a.id, gast, notiz, Number.isFinite(dauer) && dauer > 0 && dauer < 7_200_000 ? dauer : 0]
          )
          ende(() => resolve({ name: f.name, slug: f.slug, datei: { ...f, anfrage_id: a.id, von_gast: gast, notiz } }))
        })
        .catch((e: any) => {
          // Ablage-Regel (Verbot/Ablehnung): vor dem Schreiben, der Rest der Anfrage wird nicht mehr gelesen
          if (e?.ablage) {
            req.unpipe(bb)
            bb.removeAllListeners()
            req.resume()
            setResponseHeader(event, 'Connection', 'close')
            return ende(() => reject(e))
          }
          if (e?.code === 'ZU_GROSS') {
            req.unpipe(bb)
            bb.removeAllListeners()
            req.resume()
            setResponseHeader(event, 'Connection', 'close')
            return ende(() =>
              reject(frei <= Math.min(grenzen[0]!, grenzen[1]!, dateiMax) ? speicherVoll() : fehler(413, 'Die Datei ist zu groß.', 'The file is too large.'))
            )
          }
          ende(() => reject(e))
        })
    })
    bb.on('error', (e) => ende(() => reject(e)))
    bb.on('close', () => setTimeout(() => ende(() => resolve(null)), 50))
    req.pipe(bb)
  })
  if (!ergebnis) throw fehler(400, 'Keine Datei im Upload.', 'No file in the upload.')
  await ereignis('anfrage_upload', a.user_id, { anfrage: a.id, gast: String(felder.name || '').slice(0, 60) }, ip)
  const gast = String(felder.name || '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 60)
  const basis = await basisUrl(event)
  const seite = links(basis, ergebnis).seite
  webhookAusloesen(a.user_id, 'request.uploaded', {
    request: { id: a.id, title: a.titel },
    uploader: gast || null,
    file: alsApi(fuerPanel(basis, ergebnis.datei))
  })
  const en = besitzer.prefs?.lang === 'en'
  const aufn = felder.aufnahme === 'audio' || felder.aufnahme === 'video' ? felder.aufnahme : ''
  const ms = Number(felder.dauer_ms) || 0
  const laenge = ms > 0 ? ` (${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')})` : ''
  const notizText = ergebnis.datei.notiz ? `\n\n„${ergebnis.datei.notiz}“` : ''
  const wer = gast || (en ? 'someone' : 'jemandem')
  imHintergrund(
    a.user_id,
    'anfrage',
    aufn
      ? en
        ? {
            titel: `New ${aufn === 'audio' ? 'voice' : 'video'} message for “${a.titel}”`,
            text: `New ${aufn === 'audio' ? 'voice' : 'video'} message from ${wer}${laenge}.${notizText}`,
            link: { url: seite, text: aufn === 'audio' ? 'Listen' : 'Watch' }
          }
        : {
            titel: `Neue ${aufn === 'audio' ? 'Sprachnachricht' : 'Videobotschaft'} für „${a.titel}“`,
            text: `Neue ${aufn === 'audio' ? 'Sprachnachricht' : 'Videobotschaft'} von ${wer}${laenge}.${notizText}`,
            link: { url: seite, text: aufn === 'audio' ? 'Anhören' : 'Ansehen' }
          }
      : en
        ? {
            titel: `New file for “${a.titel}”`,
            text: `${gast || 'Someone'} uploaded ${ergebnis.name}.${notizText}`,
            link: { url: seite, text: 'Open file' }
          }
        : {
            titel: `Neue Datei für „${a.titel}“`,
            text: `${gast || 'Jemand'} hat ${ergebnis.name} hochgeladen.${notizText}`,
            link: { url: seite, text: 'Datei öffnen' }
          }
  )
  await speicherPruefen(besitzer).catch(() => {})
  return { ok: true, name: ergebnis.name }
})
