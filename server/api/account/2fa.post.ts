import QRCode from 'qrcode'
import { q, q1, ereignis } from '../../utils/db'
import { checkPw, clientIp, limit, requireUser } from '../../utils/auth'
import { backupCodesNeu, totpSecret, totpUri, totpVerify } from '../../utils/totp'
import { getDesign } from '../../utils/settings'

export default defineEventHandler(async (event) => {
  const a = await requireUser(event)
  const b = await readBody(event)
  const aktion = String(b?.action || '')
  const z = await q1<{ password: string; totp_pending: string; totp_enabled: boolean }>(
    'SELECT password, totp_pending, totp_enabled FROM users WHERE id = $1',
    [a.id]
  )
  if (!z) throw fehler(404, 'Konto nicht gefunden.', 'Account not found.')

  if (aktion === 'begin') {
    if (z.totp_enabled)
      throw fehler(400, 'Die Zwei-Faktor-Anmeldung ist bereits aktiv.', 'Two-factor sign-in is already active.')
    const secret = totpSecret()
    await q('UPDATE users SET totp_pending = $1 WHERE id = $2', [secret, a.id])
    const uri = totpUri(secret, a.username, (await getDesign()).name || 'VylarisCloud')
    const qr = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
    return { ok: true, secret, qr }
  }

  if (aktion === 'enable') {
    if (limit('2fa:' + a.id, 10, 600))
      throw fehler(429, 'Zu viele Versuche. Bitte warte 10 Minuten.', 'Too many attempts. Please wait 10 minutes.')
    if (!z.totp_pending) throw fehler(400, 'Bitte starte die Einrichtung neu.', 'Please restart the setup.')
    if (!totpVerify(z.totp_pending, String(b?.code || '')))
      throw fehler(
        400,
        'Der Code stimmt nicht. Prüfe die Uhrzeit deines Handys.',
        'The code is not correct. Check the time on your phone.'
      )
    const codes = backupCodesNeu()
    await q(
      `UPDATE users SET totp_secret = totp_pending, totp_pending = '', totp_enabled = true, backup_codes = $1::jsonb WHERE id = $2`,
      [JSON.stringify(codes.hashes), a.id]
    )
    await ereignis('2fa_enabled', a.id, {}, clientIp(event))
    return { ok: true, backupCodes: codes.klar }
  }

  if (aktion === 'disable') {
    if (limit('2fa:' + a.id, 10, 600))
      throw fehler(429, 'Zu viele Versuche. Bitte warte 10 Minuten.', 'Too many attempts. Please wait 10 minutes.')
    if (!(await checkPw(String(b?.password || ''), z.password)))
      throw fehler(403, 'Das Passwort stimmt nicht.', 'The password is not correct.')
    await q(
      `UPDATE users SET totp_secret = '', totp_pending = '', totp_enabled = false, backup_codes = '[]' WHERE id = $1`,
      [a.id]
    )
    await ereignis('2fa_disabled', a.id, {}, clientIp(event))
    return { ok: true }
  }
  throw fehler(400, 'Unbekannte Aktion.', 'Unknown action.')
})
