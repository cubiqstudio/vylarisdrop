import { requireUser } from '../utils/auth'
import { verbinden } from '../utils/live'

// Event-Stream für die Live-Aktualisierung der Oberfläche (Dateien, Ordner, Papierkorb, Anfragen)
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  return verbinden(event, u.id)
})
