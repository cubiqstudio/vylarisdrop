import { ereignis } from '../../../../../utils/db'
import { clientIp, requireUser } from '../../../../../utils/auth'
import { boxLaden, unterkontoLaden, unterkontoLoeschen } from '../../../../../utils/boxen'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const b = await boxLaden(getRouterParam(event, 'id'), u)
  speicherRate(u.id, 'aendern')
  const k = await unterkontoLaden(b, getRouterParam(event, 'uid'))
  await unterkontoLoeschen(k)
  await ereignis('unterkonto_geloescht', u.id, { box: b.kennung, login: k.login }, clientIp(event))
  return { ok: true }
})
