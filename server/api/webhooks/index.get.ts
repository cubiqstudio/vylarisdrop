import { q } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { EREIGNISSE, webhookEinst } from '../../utils/webhooks'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const hooks = await q(
    `SELECT w.id, w.name, w.url, w.geheimnis, w.ereignisse, w.aktiv, w.fehler_in_folge, w.zuletzt_at, w.zuletzt_status, w.created_at,
      (SELECT count(*) FROM webhook_lieferungen l WHERE l.webhook_id = w.id AND l.status = 'ok')::int AS ok,
      (SELECT count(*) FROM webhook_lieferungen l WHERE l.webhook_id = w.id AND l.status = 'fehler')::int AS fehler,
      (SELECT count(*) FROM webhook_lieferungen l WHERE l.webhook_id = w.id AND l.status = 'offen')::int AS offen
    FROM webhooks w WHERE w.user_id = $1 ORDER BY w.created_at`,
    [u.id]
  )
  return { webhooks: hooks, ereignisse: EREIGNISSE, intern: (await webhookEinst()).intern }
})
