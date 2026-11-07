import { q1 } from '../../utils/db'
import { apiNutzer } from '../../utils/api'
import { quotaStand } from '../../utils/quota'

export default defineEventHandler(async (event) => {
  const u = await apiNutzer(event, 'lesen')
  const r = await q1<{ n: string }>('SELECT count(*) AS n FROM files WHERE user_id = $1', [u.id])
  const s = await quotaStand(u)
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    // storage bleibt wie bisher (used jetzt inkl. Papierkorb, quota = wirksames Limit); quota ist die ausführliche Form
    storage: { used: s.used, quota: s.limit, files: Number(r?.n || 0) },
    quota: { limit: s.limit, used: s.used, free: s.free, source: s.source }
  }
})
