import { ereignis } from '../../../../utils/db'
import { clientIp, requireUser } from '../../../../utils/auth'
import { boxLaden, boxLoeschen } from '../../../../utils/boxen'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const b = await boxLaden(getRouterParam(event, 'id'), u)
  speicherRate(u.id, 'aendern')
  await boxLoeschen(b)
  await ereignis('box_geloescht', u.id, { name: b.name, kennung: b.kennung }, clientIp(event))
  return { ok: true }
})
