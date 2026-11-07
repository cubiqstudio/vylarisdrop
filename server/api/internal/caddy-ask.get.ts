import { getNet } from '../../utils/settings'
import { pendingDomain } from '../../utils/netz'

export default defineEventHandler(async (event) => {
  if (getRequestHeader(event, 'x-forwarded-for')) throw fehler(404, 'Nicht gefunden', 'Not found')
  const domain = String(getQuery(event).domain || '').toLowerCase()
  const net = await getNet()
  if (domain && (domain === net.domain || domain === pendingDomain())) return 'ok'
  throw fehler(403, 'Domain nicht freigegeben', 'Domain not approved')
})
