import { q1 } from '../../utils/db'
import { requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  return await q1<any>(
    `SELECT id, username, email, role, quota_bytes, totp_enabled, jsonb_array_length(backup_codes) AS backup_codes, prefs, created_at,
    (SELECT count(*)::int FROM sessions s WHERE s.user_id = users.id AND s.expires_at > now()) AS sessions FROM users WHERE id = $1`,
    [u.id]
  )
})
