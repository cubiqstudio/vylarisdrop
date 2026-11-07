import { limit, requireUser } from '../../utils/auth'
import { zipAusliefern } from '../../utils/cloudZip'

// Mehrere Dateien und/oder Ordner als ZIP (streamend, Ordnerstruktur bleibt erhalten)
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (limit('cloud-zip:' + u.id, 30, 60))
    throw fehler(429, 'Zu viele Downloads — bitte kurz warten.', 'Too many downloads — please wait a moment.')
  return zipAusliefern(event, u, getQuery(event))
})
