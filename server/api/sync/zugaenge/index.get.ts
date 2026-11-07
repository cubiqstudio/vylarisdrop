import { q } from '../../../utils/db'
import { requireUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return {
    zugaenge: await q(
      'SELECT id, name, prefix, schreiben, created_at, last_used_at FROM dav_zugaenge WHERE user_id = $1 ORDER BY created_at DESC',
      [u.id]
    )
  }
})
