import { q, ereignis } from '../../utils/db'
import { clientIp, requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const r = await q('DELETE FROM upload_tokens WHERE id = $1 AND user_id = $2 RETURNING name', [
    Number(getRouterParam(event, 'id')),
    u.id
  ])
  if (r.length) await ereignis('token_deleted', u.id, { name: r[0].name }, clientIp(event))
  return { ok: true }
})
