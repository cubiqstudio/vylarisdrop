import QRCode from 'qrcode'
import { q, ereignis } from '../../utils/db'
import { clientIp, limit, requireUser } from '../../utils/auth'
import { CODE_SEKUNDEN, MAX_OFFENE_CODES, appCodeHash, appCodeNormal, appKoppelLink, appNeuerCode } from '../../utils/app'

// Kopplungscode fuer ein neues App-Geraet: 8 Zeichen, einmal verwendbar, 5 Minuten gueltig, hoechstens 5 offene je Nutzer.
// Gespeichert wird nur der Hash. Der Klartext (und der QR-Code mit dem Link) steht nur in dieser Antwort.
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  if (limit('app-code:' + u.id, 20, 600)) {
    setResponseHeader(event, 'Retry-After', 600)
    throw fehler(
      429,
      'Zu viele Kopplungscodes in kurzer Zeit. Bitte warte ein paar Minuten.',
      'Too many pairing codes in a short time. Please wait a few minutes.'
    )
  }
  const code = appNeuerCode()
  const normal = appCodeNormal(code)!
  await q(
    "INSERT INTO app_koppelcodes (user_id, code_hash, ablauf_at) VALUES ($1, $2, now() + ($3 || ' seconds')::interval)",
    [u.id, appCodeHash(normal), String(CODE_SEKUNDEN)]
  )
  // Abgelaufene/benutzte Codes dieses Nutzers entfernen; offene auf die neuesten MAX_OFFENE_CODES begrenzen
  await q(
    `DELETE FROM app_koppelcodes WHERE user_id = $1 AND (
       ablauf_at < now() - interval '1 hour' OR benutzt_at IS NOT NULL
       OR id NOT IN (SELECT id FROM app_koppelcodes WHERE user_id = $1 AND benutzt_at IS NULL AND ablauf_at > now() ORDER BY id DESC LIMIT $2)
     )`,
    [u.id, MAX_OFFENE_CODES]
  )
  const link = await appKoppelLink(event, code)
  const qr = await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
  await ereignis('app_koppelcode', u.id, {}, clientIp(event))
  return { code, ablaufSek: CODE_SEKUNDEN, link, qr }
})
