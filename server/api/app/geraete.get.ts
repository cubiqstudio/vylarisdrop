import { q } from '../../utils/db'
import { requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return {
    geraete: await q(
      `SELECT id, name, created_at AS erstellt, last_used_at AS zuletzt_benutzt FROM upload_tokens
       WHERE user_id = $1 AND art = 'app' ORDER BY coalesce(last_used_at, created_at) DESC, id DESC`,
      [u.id]
    )
  }
})
