import { q } from '../../utils/db'
import { requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  await q('DELETE FROM tags WHERE id = $1 AND user_id = $2', [Number(getRouterParam(event, 'id')), u.id])
  return { ok: true }
})
