import { z } from 'zod'
import { q, q1, ereignis } from '../../utils/db'
import { clientIp, requireUser } from '../../utils/auth'
import { EREIGNISSE, neuesGeheimnis, urlPruefen } from '../../utils/webhooks'

const Body = z.object({
  name: z.string().trim().max(60).default(''),
  url: z.string().max(500),
  ereignisse: z.array(z.enum(EREIGNISSE)).min(1).max(EREIGNISSE.length)
})
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const p = Body.safeParse(await readBody(event))
  if (!p.success)
    throw fehler(
      400,
      'Bitte Adresse und mindestens ein Ereignis angeben.',
      'Please enter a URL and at least one event.'
    )
  const url = urlPruefen(p.data.url)
  const n = await q1<{ n: string }>('SELECT count(*) AS n FROM webhooks WHERE user_id = $1', [u.id])
  if (Number(n?.n || 0) >= 10) throw fehler(400, 'Höchstens 10 Webhooks pro Konto.', 'At most 10 webhooks per account.')
  const r = await q(
    'INSERT INTO webhooks (user_id, name, url, geheimnis, ereignisse) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id',
    [u.id, p.data.name, url, neuesGeheimnis(), JSON.stringify([...new Set(p.data.ereignisse)])]
  )
  await ereignis('webhook_angelegt', u.id, { name: p.data.name, url: url.slice(0, 120) }, clientIp(event))
  return { ok: true, id: r[0].id }
})
