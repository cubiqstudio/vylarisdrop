import { limit, requireUser } from '../../utils/auth'
import { eingabe } from '../../utils/cloudListe'
import { AuswahlBody, loeschenAuswahl } from '../../utils/cloudAktionen'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (limit('cloud-aktion:' + u.id, 300, 60)) throw fehler(429, 'Zu viele Aktionen — bitte kurz warten.', 'Too many actions — please wait a moment.')
  return loeschenAuswahl(u, eingabe(AuswahlBody, await readBody(event)), event)
})
