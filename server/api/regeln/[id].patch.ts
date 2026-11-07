import { z } from 'zod'
import { q, q1 } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { archivMoeglich, bedingungNorm } from '../../utils/regeln'

const Body = z.object({
  name: z.string().trim().max(80).optional(),
  aktiv: z.boolean().optional(),
  bedingung: z.record(z.string(), z.any()).optional(),
  aktion: z.enum(['papierkorb', 'loeschen', 'archiv']).optional(),
  favoriten_schonen: z.boolean().optional()
})
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = Number(getRouterParam(event, 'id')) || 0
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Ungültige Regel.', 'Invalid rule.')
  const r = await q1<{ user_id: number | null; geltung: string }>('SELECT user_id, geltung FROM regeln WHERE id = $1', [
    id
  ])
  if (!r || (r.user_id !== u.id && !(r.geltung === 'alle' && u.role !== 'user')))
    throw fehler(404, 'Regel nicht gefunden.', 'Rule not found.')
  const b = p.data
  if (b.aktion === 'archiv' && !(await archivMoeglich()))
    throw fehler(
      400,
      'Auslagern braucht einen eingerichteten S3-Speicher (Pro).',
      'Archiving needs configured S3 storage (Pro).'
    )
  await q(
    `UPDATE regeln SET name = coalesce($2, name), aktiv = coalesce($3, aktiv), bedingung = coalesce($4::jsonb, bedingung), aktion = coalesce($5, aktion),
      favoriten_schonen = coalesce($6, favoriten_schonen) WHERE id = $1`,
    [
      id,
      b.name ?? null,
      b.aktiv ?? null,
      b.bedingung ? JSON.stringify(bedingungNorm(b.bedingung)) : null,
      b.aktion ?? null,
      b.favoriten_schonen ?? null
    ]
  )
  return { ok: true }
})
