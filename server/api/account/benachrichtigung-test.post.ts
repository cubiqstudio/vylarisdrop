import { requireUser, limit } from '../../utils/auth'
import { benachrichtigen } from '../../utils/benachrichtigen'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (limit('benachtest:' + u.id, 5, 300)) throw fehler(429, 'Bitte kurz warten.', 'Please wait a moment.')
  const en = u.prefs?.lang === 'en'
  const r = await benachrichtigen(
    u.id,
    'test',
    en
      ? { titel: 'Test notification', text: 'If you can read this, notifications work.' }
      : { titel: 'Test-Benachrichtigung', text: 'Wenn du das liest, kommen Benachrichtigungen an.' },
    true
  )
  if (!r.discord && !r.email)
    throw fehler(400, 'Richte zuerst Discord oder E-Mail ein.', 'Set up Discord or e-mail first.')
  return r
})
