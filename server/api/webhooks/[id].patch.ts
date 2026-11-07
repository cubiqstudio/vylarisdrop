import { z } from 'zod'
import { q } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { EREIGNISSE, neuesGeheimnis, urlPruefen } from '../../utils/webhooks'

const Body = z.object({
  name: z.string().trim().max(60).optional(),
  url: z.string().max(500).optional(),
  ereignisse: z.array(z.enum(EREIGNISSE)).min(1).optional(),
  aktiv: z.boolean().optional(),
  geheimnis_neu: z.boolean().optional()
})
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  const p = Body.safeParse(await readBody(event))
  if (!p.success || !Number.isInteger(id)) throw fehler(400, 'Ungültige Eingabe.', 'Invalid input.')
  const b = p.data
  const r = await q(
    `UPDATE webhooks SET name = coalesce($3, name), url = coalesce($4, url), ereignisse = coalesce($5::jsonb, ereignisse),
      aktiv = coalesce($6, aktiv), fehler_in_folge = CASE WHEN $6 THEN 0 ELSE fehler_in_folge END, geheimnis = coalesce($7, geheimnis)
    WHERE id = $1 AND user_id = $2 RETURNING id`,
    [
      id,
      u.id,
      b.name ?? null,
      b.url !== undefined ? urlPruefen(b.url) : null,
      b.ereignisse ? JSON.stringify([...new Set(b.ereignisse)]) : null,
      b.aktiv ?? null,
      b.geheimnis_neu ? neuesGeheimnis() : null
    ]
  )
  if (!r.length) throw fehler(404, 'Webhook nicht gefunden.', 'Webhook not found.')
  return { ok: true }
})
