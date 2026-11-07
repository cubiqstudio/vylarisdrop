import { q } from '../../utils/db'
import { requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  return {
    tokens: await q(
      'SELECT id, name, prefix, rechte, created_at, last_used_at FROM upload_tokens WHERE user_id = $1 ORDER BY created_at DESC',
      [u.id]
    )
  }
})
