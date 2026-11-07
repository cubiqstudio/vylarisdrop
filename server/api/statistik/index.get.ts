import { requireUser } from '../../utils/auth'
import { auswertung } from '../../utils/statistik'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const tage = [7, 30, 90].includes(Number(getQuery(event).tage)) ? Number(getQuery(event).tage) : 30
  return auswertung({ userId: u.id }, tage)
})
