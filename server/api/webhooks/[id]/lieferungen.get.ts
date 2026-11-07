import { q, q1 } from '../../../utils/db'
import { requireUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = Number(getRouterParam(event, 'id')) || 0
  if (!(await q1('SELECT 1 FROM webhooks WHERE id = $1 AND user_id = $2', [id, u.id])))
    throw fehler(404, 'Webhook nicht gefunden.', 'Webhook not found.')
  return {
    lieferungen: await q(
      `SELECT id, ereignis, status, versuche, antwort_code, antwort, dauer_ms, created_at, erledigt_at, naechster_at, nutzlast
    FROM webhook_lieferungen WHERE webhook_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [id]
    )
  }
})
