import { ereignis } from '../../../../utils/db'
import { clientIp, requireUser } from '../../../../utils/auth'
import { bucketLaden, bucketLoeschen } from '../../../../utils/buckets'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const b = await bucketLaden(getRouterParam(event, 'id'), u)
  speicherRate(u.id, 'aendern')
  await bucketLoeschen(b)
  await ereignis('bucket_geloescht', u.id, { name: b.name }, clientIp(event))
  return { ok: true }
})
