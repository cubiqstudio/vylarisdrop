import { q1 } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { quotaStand } from '../../utils/quota'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const konto = await q1<any>(
    `SELECT id, username, email, role, quota_bytes, totp_enabled, jsonb_array_length(backup_codes) AS backup_codes, prefs, created_at,
    (SELECT count(*)::int FROM sessions s WHERE s.user_id = users.id AND s.expires_at > now()) AS sessions FROM users WHERE id = $1`,
    [u.id]
  )
  // additiv: wirksames Kontingent samt Belegung (quota_bytes bleibt der Rohwert am Konto)
  const s = await quotaStand(u)
  return { ...konto, quota: { limit: s.limit, used: s.used, free: s.free, source: s.source } }
})
