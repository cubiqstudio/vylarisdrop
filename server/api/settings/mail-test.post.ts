import { limit, requireOwner } from '../../utils/auth'
import { mailSenden } from '../../utils/benachrichtigen'

export default defineEventHandler(async (event) => {
  const ich = await requireOwner(event)
  if (limit('mailtest:' + ich.id, 5, 300)) throw fehler(429, 'Bitte kurz warten.', 'Please wait a moment.')
  if (!ich.email) throw fehler(400, 'Dein Konto hat keine E-Mail-Adresse.', 'Your account has no e-mail address.')
  try {
    await mailSenden(
      ich.email,
      ich.prefs?.lang === 'en' ? 'Test e-mail' : 'Test-E-Mail',
      ich.prefs?.lang === 'en' ? 'The mail settings work.' : 'Der E-Mail-Versand funktioniert.',
      undefined,
      ich.prefs?.lang === 'en' ? 'en' : 'de'
    )
  } catch (e: any) {
    console.warn('[vylariscloud] Test-E-Mail:', e?.code, e?.message)
    if (e?.message === 'kein-smtp')
      throw fehler(400, 'Trage zuerst Server und Absender ein.', 'Enter a server and sender first.')
    if (e?.code === 'EAUTH')
      throw fehler(
        400,
        'Der Mailserver hat die Anmeldung abgelehnt — Benutzer oder Passwort prüfen.',
        'The mail server rejected the login — check user and password.'
      )
    if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS'].includes(e?.code))
      throw fehler(
        400,
        'Mailserver nicht erreichbar — Adresse, Port und Verschlüsselung prüfen.',
        'Mail server unreachable — check address, port and encryption.'
      )
    if (e?.code === 'EENVELOPE')
      throw fehler(400, 'Absender oder Empfänger wurde abgelehnt.', 'Sender or recipient was rejected.')
    throw fehler(400, 'Die E-Mail konnte nicht gesendet werden.', 'The e-mail could not be sent.')
  }
  return { ok: true, an: ich.email }
})
