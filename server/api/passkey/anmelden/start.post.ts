import { clientIp, limit } from '../../../utils/auth'
import { anmeldenStart } from '../../../utils/passkeys'

export default defineEventHandler(async (event) => {
  if (limit('pkstart:' + clientIp(event), 30, 600))
    throw fehler(429, 'Zu viele Versuche. Bitte warte kurz.', 'Too many attempts. Please wait a moment.')
  return anmeldenStart(event)
})
