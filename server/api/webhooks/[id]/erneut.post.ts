import { q } from '../../../utils/db'
import { requireUser } from '../../../utils/auth'
import { zustellen } from '../../../utils/webhooks'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = Number(getRouterParam(event, 'id')) || 0
  const lid = String((await readBody(event))?.lieferung || '')
  if (!/^\d{1,18}$/.test(lid)) throw fehler(400, 'Ungültige ID.', 'Invalid ID.')
  const r = await q(
    `UPDATE webhook_lieferungen l SET status = 'offen', versuche = 0, naechster_at = now(), erledigt_at = NULL FROM webhooks w
    WHERE l.id = $1 AND l.webhook_id = $2 AND w.id = l.webhook_id AND w.user_id = $3 RETURNING l.id`,
    [lid, id, u.id]
  )
  if (!r.length) throw fehler(404, 'Nicht gefunden.', 'Not found.')
  void zustellen()
  return { ok: true }
})
