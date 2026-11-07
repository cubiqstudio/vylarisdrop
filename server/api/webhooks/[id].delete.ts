import { q, ereignis } from '../../utils/db'
import { clientIp, requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const r = await q<{ name: string }>('DELETE FROM webhooks WHERE id = $1 AND user_id = $2 RETURNING name', [
    Number(getRouterParam(event, 'id')) || 0,
    u.id
  ])
  if (!r.length) throw fehler(404, 'Webhook nicht gefunden.', 'Webhook not found.')
  await ereignis('webhook_geloescht', u.id, { name: r[0]!.name }, clientIp(event))
  return { ok: true }
})
