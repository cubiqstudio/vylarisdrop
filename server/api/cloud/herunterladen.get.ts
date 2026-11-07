import { requireUser } from '../../utils/auth'
import { ausliefern, type DateiZeile } from '../../utils/dateien'
import { dateiRecht } from '../../utils/teams'
import { inQuarantaene } from '../../utils/virenscan'

// Einzelne Datei herunterladen — mit Rechteprüfung statt über den öffentlichen Link (zählt keine Aufrufe)
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = String(getQuery(event).id || '')
  if (!/^\d{1,18}$/.test(id)) throw fehler(400, 'Ungültige ID.', 'Invalid ID.')
  const f = await dateiRecht<DateiZeile>(u.id, id, 'lesen')
  if (!f) throw fehler(404, 'Datei nicht gefunden.', 'File not found.')
  if (inQuarantaene(f))
    throw fehler(451, 'Diese Datei wurde vom Virenscan gesperrt.', 'This file was blocked by the virus scan.')
  return ausliefern(event, f, getQuery(event).ansicht === '1' ? 'inline' : 'download')
})
