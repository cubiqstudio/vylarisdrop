import { requireUser } from '../../../utils/auth'
import { dateiRecht } from '../../../utils/teams'
import { auswertung } from '../../../utils/statistik'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = String(getRouterParam(event, 'id') || '')
  if (!/^\d{1,18}$/.test(id)) throw fehler(400, 'Ungültige ID.', 'Invalid ID.')
  const f = await dateiRecht<{ id: string; views: number }>(u.id, id, 'lesen')
  if (!f) throw fehler(404, 'Datei nicht gefunden.', 'File not found.')
  const tage = [7, 30, 90].includes(Number(getQuery(event).tage)) ? Number(getQuery(event).tage) : 30
  return { ...(await auswertung({ fileId: id }, tage)), insgesamt: Number(f.views) }
})
