import { q } from '../../utils/db'
import { requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = Number(getRouterParam(event, 'id')) || 0
  const r = await q(`DELETE FROM regeln WHERE id = $1 AND (user_id = $2 OR (geltung = 'alle' AND $3)) RETURNING id`, [
    id,
    u.id,
    u.role !== 'user'
  ])
  if (!r.length) throw fehler(404, 'Regel nicht gefunden.', 'Rule not found.')
  return { ok: true }
})
