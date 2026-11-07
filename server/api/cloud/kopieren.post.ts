import { limit, requireUser } from '../../utils/auth'
import { eingabe } from '../../utils/cloudListe'
import { kopieren, ZielBody } from '../../utils/cloudAktionen'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (limit('cloud-kopieren:' + u.id, 30, 60)) throw fehler(429, 'Zu viele Aktionen — bitte kurz warten.', 'Too many actions — please wait a moment.')
  return kopieren(u, eingabe(ZielBody, await readBody(event)), event)
})
