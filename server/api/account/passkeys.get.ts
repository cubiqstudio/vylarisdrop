import { q } from '../../utils/db'
import { requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  return {
    passkeys: await q('SELECT id, name, created_at, zuletzt_at FROM passkeys WHERE user_id = $1 ORDER BY created_at', [
      u.id
    ])
  }
})
