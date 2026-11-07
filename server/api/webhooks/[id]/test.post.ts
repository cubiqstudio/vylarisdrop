import { q, q1 } from '../../../utils/db'
import { limit, requireUser } from '../../../utils/auth'
import { zustellen } from '../../../utils/webhooks'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = Number(getRouterParam(event, 'id')) || 0
  if (limit('webhooktest:' + u.id, 10, 60)) throw fehler(429, 'Bitte kurz warten.', 'Please wait a moment.')
  const w = await q1('SELECT id FROM webhooks WHERE id = $1 AND user_id = $2', [id, u.id])
  if (!w) throw fehler(404, 'Webhook nicht gefunden.', 'Webhook not found.')
  const l = await q<{ id: string }>(
    `INSERT INTO webhook_lieferungen (webhook_id, ereignis, nutzlast) VALUES ($1, 'ping', $2::jsonb) RETURNING id`,
    [
      id,
      JSON.stringify({
        event: 'ping',
        created_at: new Date().toISOString(),
        data: { message: 'Hello from VylarisCloud', user: u.username }
      })
    ]
  )
  for (let i = 0; i < 24; i++) {
    await zustellen()
    const r = await q1<{
      status: string
      antwort_code: number | null
      antwort: string
      dauer_ms: number | null
      versuche: number
    }>('SELECT status, antwort_code, antwort, dauer_ms, versuche FROM webhook_lieferungen WHERE id = $1', [l[0]!.id])
    if (r && r.versuche > 0) return { ok: r.status === 'ok', code: r.antwort_code, antwort: r.antwort, ms: r.dauer_ms }
    await new Promise((res) => setTimeout(res, 500))
  }
  return { ok: false, code: null, antwort: 'Zeitüberschreitung', ms: null }
})
