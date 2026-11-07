import { q1, ereignis } from '../../../utils/db'
import { clientIp, fehlversuch, gesperrt, sessionStart } from '../../../utils/auth'
import { anmeldenEnde } from '../../../utils/passkeys'
import { ssoFuerLogin } from '../../../utils/sso'

export default defineEventHandler(async (event) => {
  const ip = clientIp(event)
  if (gesperrt('login:' + ip, 8))
    throw fehler(
      429,
      'Zu viele Fehlversuche. Bitte warte 10 Minuten.',
      'Too many failed attempts. Please wait 10 minutes.'
    )
  const b = await readBody(event)
  const r = await anmeldenEnde(event, b?.antwort)
  if (!r) {
    fehlversuch('login:' + ip, 600)
    await ereignis('login_failed', null, { grund: 'passkey' }, ip)
    throw fehler(
      401,
      'Dieser Passkey ist hier nicht (mehr) hinterlegt.',
      'This passkey is not (or no longer) registered here.'
    )
  }
  const a = await q1<{ role: string }>('SELECT role FROM users WHERE id = $1', [r.userId])
  if (!a)
    throw fehler(
      401,
      'Dieser Passkey ist hier nicht (mehr) hinterlegt.',
      'This passkey is not (or no longer) registered here.'
    )
  if (a.role !== 'owner' && (await ssoFuerLogin()).passwortAus)
    throw fehler(
      403,
      'Bitte melde dich über den Anmelde-Dienst deiner Organisation an.',
      "Please sign in via your organisation's sign-in service."
    )
  await sessionStart(event, r.userId)
  await ereignis('login', r.userId, { passkey: r.name.slice(0, 60) }, ip)
  return { ok: true }
})
