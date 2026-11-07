import { limit, requireUser } from '../../utils/auth'
import { zipAusliefern } from '../../utils/cloudZip'

// Wie GET /api/cloud/zip, aber mit den Schlüsseln im Anfragekörper (Formular) — für sehr große Auswahlen
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (limit('cloud-zip:' + u.id, 30, 60))
    throw fehler(429, 'Zu viele Downloads — bitte kurz warten.', 'Too many downloads — please wait a moment.')
  const b = (await readBody(event)) || {}
  return zipAusliefern(event, u, { dateien: b.dateien, ordner: b.ordner, name: b.name })
})
