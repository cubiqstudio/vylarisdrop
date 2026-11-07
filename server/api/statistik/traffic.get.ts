import { requireUser } from '../../utils/auth'
import { istPro } from '../../utils/lizenz'
import { trafficAuswertung } from '../../utils/traffic'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (!(await istPro('traffic'))) return { pro: false }
  const tage = [7, 30, 90].includes(Number(getQuery(event).tage)) ? Number(getQuery(event).tage) : 30
  return { pro: true, ...(await trafficAuswertung(u.id, tage)) }
})
