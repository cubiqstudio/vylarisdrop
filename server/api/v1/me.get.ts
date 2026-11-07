import { q1 } from '../../utils/db'
import { apiNutzer } from '../../utils/api'
import { kontingentVon } from '../../utils/hochladen'

export default defineEventHandler(async (event) => {
  const u = await apiNutzer(event, 'lesen')
  const r = await q1<{ s: string; n: string }>(
    'SELECT coalesce(sum(size), 0) AS s, count(*) AS n FROM files WHERE user_id = $1',
    [u.id]
  )
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    storage: { used: Number(r?.s || 0), quota: await kontingentVon(u), files: Number(r?.n || 0) }
  }
})
