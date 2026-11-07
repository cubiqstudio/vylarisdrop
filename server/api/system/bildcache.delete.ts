import { ereignis } from '../../utils/db'
import { clientIp, requireOwner } from '../../utils/auth'
import { cacheLeeren } from '../../utils/bildvarianten'

export default defineEventHandler(async (event) => {
  const ich = await requireOwner(event)
  await cacheLeeren()
  await ereignis('bildcache_geleert', ich.id, {}, clientIp(event))
  return { ok: true }
})
