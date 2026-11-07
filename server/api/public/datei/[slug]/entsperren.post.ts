import { clientIp, fehlversuch, gesperrt } from '../../../../utils/auth'
import { slugParam } from '../../../../utils/abruf'
import { abgelaufen, dateiPerSlug, freigeben } from '../../../../utils/dateien'

export default defineEventHandler(async (event) => {
  const ip = clientIp(event)
  if (gesperrt('dateipw:' + ip, 10))
    throw fehler(
      429,
      'Zu viele Fehlversuche. Bitte warte 10 Minuten.',
      'Too many failed attempts. Please wait 10 minutes.'
    )
  const f = await dateiPerSlug(slugParam(event))
  if (!f || abgelaufen(f)) throw fehler(404, 'Diese Datei gibt es nicht (mehr).', 'This file does not exist (anymore).')
  const b = await readBody(event).catch(() => ({}))
  if (!(await freigeben(event, f, String(b?.passwort || '')))) {
    fehlversuch('dateipw:' + ip, 600)
    throw fehler(403, 'Das Passwort stimmt nicht.', 'The password is not correct.')
  }
  return { ok: true }
})
