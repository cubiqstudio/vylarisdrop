import { q } from '../../utils/db'
import { requireUser, sessionTokenHash } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const a = await requireUser(event)
  const weg = await q('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2 RETURNING token_hash', [
    a.id,
    sessionTokenHash(event)
  ])
  return { ok: true, beendet: weg.length }
})
