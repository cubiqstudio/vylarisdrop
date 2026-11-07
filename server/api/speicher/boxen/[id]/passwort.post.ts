import { ereignis } from '../../../../utils/db'
import { clientIp, requireUser } from '../../../../utils/auth'
import { boxLaden, boxPasswortNeu } from '../../../../utils/boxen'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const b = await boxLaden(Number(getRouterParam(event, 'id')), u)
  const passwort = await boxPasswortNeu(b)
  await ereignis('box_passwort', u.id, { name: b.name, kennung: b.kennung }, clientIp(event))
  return { ok: true, passwort }
})
