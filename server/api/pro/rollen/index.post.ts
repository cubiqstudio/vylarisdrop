import { z } from 'zod'
import { q, q1, ereignis } from '../../../utils/db'
import { clientIp, requireAdmin } from '../../../utils/auth'
import { requirePro } from '../../../utils/lizenz'
import { rechteNorm } from '../../../utils/teams'

const Farbe = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const Rechte = z.object({
  hochladen: z.boolean().optional(),
  anfragen: z.boolean().optional(),
  import: z.boolean().optional(),
  maxDateiMb: z.number().min(0).max(10_000_000).nullable().optional(),
  kontingentGb: z.number().min(0).max(1_000_000).nullable().optional(),
  ablaufMaxTage: z.number().min(0).max(36_500).nullable().optional(),
  trafficGb: z.number().min(0).max(1_000_000).nullable().optional()
})
const Body = z.discriminatedUnion('aktion', [
  z.object({
    aktion: z.literal('anlegen'),
    name: z.string().trim().min(1).max(40),
    farbe: Farbe.optional(),
    rechte: Rechte
  }),
  z.object({
    aktion: z.literal('aendern'),
    id: z.number().int().positive(),
    name: z.string().trim().min(1).max(40).optional(),
    farbe: Farbe.optional(),
    rechte: Rechte.optional()
  }),
  z.object({ aktion: z.literal('loeschen'), id: z.number().int().positive() }),
  z.object({
    aktion: z.literal('zuweisen'),
    id: z.number().int().positive().nullable(),
    user_id: z.number().int().positive()
  })
])

export default defineEventHandler(async (event) => {
  const ich = await requireAdmin(event)
  await requirePro('teams')
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Bitte prüfe die Angaben.', 'Please check your input.')
  const b = p.data
  try {
    if (b.aktion === 'anlegen') {
      const r = await q1<{ id: number }>(
        'INSERT INTO rollen (name, farbe, rechte) VALUES ($1, $2, $3::jsonb) RETURNING id',
        [b.name, (b.farbe || '#3b82f6').toLowerCase(), JSON.stringify(rechteNorm(b.rechte))]
      )
      await ereignis('rolle_angelegt', ich.id, { name: b.name }, clientIp(event))
      return { ok: true, id: r!.id }
    }
    if (b.aktion === 'zuweisen') {
      const z2 = await q1<{ role: string }>('SELECT role FROM users WHERE id = $1', [b.user_id])
      if (!z2) throw fehler(404, 'Konto nicht gefunden.', 'Account not found.')
      if (z2.role !== 'user' && b.id != null)
        throw fehler(
          400,
          'Admins haben immer alle Rechte — Rollen gelten nur für normale Konten.',
          'Admins always have all rights — roles only apply to regular accounts.'
        )
      if (b.id != null && !(await q1('SELECT 1 FROM rollen WHERE id = $1', [b.id])))
        throw fehler(404, 'Rolle nicht gefunden.', 'Role not found.')
      await q('UPDATE users SET rolle_id = $1 WHERE id = $2', [b.id, b.user_id])
      return { ok: true }
    }
    if (!(await q1('SELECT 1 FROM rollen WHERE id = $1', [b.id])))
      throw fehler(404, 'Rolle nicht gefunden.', 'Role not found.')
    if (b.aktion === 'aendern') {
      await q(
        'UPDATE rollen SET name = coalesce($2, name), farbe = coalesce($3, farbe), rechte = coalesce($4::jsonb, rechte) WHERE id = $1',
        [b.id, b.name ?? null, b.farbe?.toLowerCase() ?? null, b.rechte ? JSON.stringify(rechteNorm(b.rechte)) : null]
      )
    } else {
      await q('DELETE FROM rollen WHERE id = $1', [b.id])
      await ereignis('rolle_geloescht', ich.id, { id: b.id }, clientIp(event))
    }
  } catch (e: any) {
    if (e?.code === '23505')
      throw fehler(409, 'Eine Rolle mit diesem Namen gibt es schon.', 'A role with this name already exists.')
    throw e
  }
  return { ok: true }
})
