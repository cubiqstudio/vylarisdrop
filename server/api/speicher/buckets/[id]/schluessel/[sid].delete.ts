import { ereignis } from '../../../../../utils/db'
import { clientIp, requireUser } from '../../../../../utils/auth'
import { bucketLaden, schluesselLoeschen } from '../../../../../utils/buckets'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const b = await bucketLaden(getRouterParam(event, 'id'), u)
  speicherRate(u.id, 'aendern')
  const s = await schluesselLoeschen(b, getRouterParam(event, 'sid'))
  await ereignis('schluessel_geloescht', u.id, { bucket: b.name, name: s.name }, clientIp(event))
  return { ok: true }
})
