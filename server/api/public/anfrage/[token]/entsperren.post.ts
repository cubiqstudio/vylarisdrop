import { clientIp, fehlversuch, gesperrt } from '../../../../utils/auth'
import { anfrageFreigeben, anfragePerToken } from '../../../../utils/anfragen'

export default defineEventHandler(async (event) => {
  const ip = clientIp(event)
  if (gesperrt('anfragepw:' + ip, 10))
    throw fehler(
      429,
      'Zu viele Fehlversuche. Bitte warte 10 Minuten.',
      'Too many failed attempts. Please wait 10 minutes.'
    )
  const a = await anfragePerToken(String(getRouterParam(event, 'token') || ''))
  if (!a) throw fehler(404, 'Diese Anfrage gibt es nicht.', 'This request does not exist.')
  const b = await readBody(event).catch(() => ({}))
  if (!(await anfrageFreigeben(event, a, String(b?.passwort || '')))) {
    fehlversuch('anfragepw:' + ip, 600)
    throw fehler(403, 'Das Passwort stimmt nicht.', 'The password is not correct.')
  }
  return { ok: true }
})
