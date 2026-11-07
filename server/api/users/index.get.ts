import { q } from '../../utils/db'
import { requireAdmin } from '../../utils/auth'
import { istPro } from '../../utils/lizenz'
import { trafficGrenze, trafficProKonto } from '../../utils/traffic'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const users = await q<any>(`SELECT u.id, u.username, u.email, u.role, u.quota_bytes, u.totp_enabled, u.created_at,
      coalesce((SELECT sum(size) FROM files f WHERE f.user_id = u.id), 0)::bigint AS belegt,
      (SELECT count(*) FROM files f WHERE f.user_id = u.id)::int AS dateien
      FROM users u ORDER BY u.created_at`)
  if (await istPro('traffic')) {
    const t = await trafficProKonto()
    for (const u of users) {
      u.traffic = t.get(u.id) || 0
      u.traffic_grenze = await trafficGrenze(u.id)
    }
  }
  return { users }
})
