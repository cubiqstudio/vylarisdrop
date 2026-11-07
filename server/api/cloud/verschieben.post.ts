import { limit, requireUser } from '../../utils/auth'
import { eingabe } from '../../utils/cloudListe'
import { verschieben, ZielBody } from '../../utils/cloudAktionen'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (limit('cloud-aktion:' + u.id, 300, 60)) throw fehler(429, 'Zu viele Aktionen — bitte kurz warten.', 'Too many actions — please wait a moment.')
  return verschieben(u, eingabe(ZielBody, await readBody(event)), event)
})
