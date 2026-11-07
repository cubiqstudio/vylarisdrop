import { limit, requireUser } from '../../utils/auth'
import { eingabe } from '../../utils/cloudListe'
import { ordnerAnlegen, OrdnerBody } from '../../utils/cloudAktionen'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (limit('cloud-ordner:' + u.id, 1200, 60)) throw fehler(429, 'Zu viele Aktionen — bitte kurz warten.', 'Too many actions — please wait a moment.')
  return ordnerAnlegen(u, eingabe(OrdnerBody, await readBody(event)), event)
})
