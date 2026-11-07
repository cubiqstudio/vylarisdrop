import { q, ereignis } from '../../utils/db'
import { clientIp, requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const a = String(getQuery(event).anbieter || '').slice(0, 30)
  const r = await q('DELETE FROM user_identitaeten WHERE user_id = $1 AND anbieter = $2 RETURNING anbieter', [u.id, a])
  if (r.length) await ereignis('sso_geloest', u.id, { anbieter: a }, clientIp(event))
  return { ok: true, geloest: r.length }
})
