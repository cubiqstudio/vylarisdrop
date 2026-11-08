import { z } from 'zod'
import { q, q1, ereignis } from '../../../utils/db'
import { clientIp, requireAdmin } from '../../../utils/auth'
import { requirePro } from '../../../utils/lizenz'
import { MAX_MITGLIEDER, imTeamSchreiben, teamOrdnerUebergeben } from '../../../utils/teamAnsicht'

const Farbe = z.string().regex(/^#[0-9a-fA-F]{6}$/)
// Team-Kontingent in Bytes (null = keins): begrenzt die Gesamtgröße aller Dateien in Ordnern des Teams, siehe utils/quota.ts
const TeamQuota = z
  .number()
  .int()
  .positive()
  .max(1_000_000 * 1024 ** 3)
  .nullable()
  .optional()
const Body = z.discriminatedUnion('aktion', [
  z.object({
    aktion: z.literal('anlegen'),
    name: z.string().trim().min(1).max(60),
    farbe: Farbe.optional(),
    beschreibung: z.string().max(300).optional(),
    quota_bytes: TeamQuota
  }),
  z.object({
    aktion: z.literal('aendern'),
    id: z.number().int().positive(),
    name: z.string().trim().min(1).max(60).optional(),
    farbe: Farbe.optional(),
    beschreibung: z.string().max(300).optional(),
    quota_bytes: TeamQuota
  }),
  z.object({ aktion: z.literal('loeschen'), id: z.number().int().positive() }),
  z.object({
    aktion: z.literal('mitglied'),
    id: z.number().int().positive(),
    user_id: z.number().int().positive(),
    rolle: z.enum(['leitung', 'mitglied']).nullable()
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
      const n = await q1<{ n: string }>('SELECT count(*) AS n FROM teams')
      if (Number(n?.n || 0) >= 500) throw fehler(400, 'Höchstens 500 Teams.', 'At most 500 teams.')
      const r = await q1<{ id: number }>(
        'INSERT INTO teams (name, farbe, beschreibung, quota_bytes) VALUES ($1, $2, $3, $4) RETURNING id',
        [b.name, (b.farbe || '#1e73be').toLowerCase(), b.beschreibung || '', b.quota_bytes ?? null]
      )
      await ereignis('team_angelegt', ich.id, { name: b.name }, clientIp(event))
      return { ok: true, id: r!.id }
    }
    if (!(await q1('SELECT 1 FROM teams WHERE id = $1', [b.id])))
      throw fehler(404, 'Team nicht gefunden.', 'Team not found.')
    if (b.aktion === 'aendern') {
      await q(
        `UPDATE teams SET name = coalesce($2, name), farbe = coalesce($3, farbe), beschreibung = coalesce($4, beschreibung),
          quota_bytes = CASE WHEN $5::boolean THEN $6::bigint ELSE quota_bytes END WHERE id = $1`,
        [b.id, b.name ?? null, b.farbe?.toLowerCase() ?? null, b.beschreibung ?? null, b.quota_bytes !== undefined, b.quota_bytes ?? null]
      )
    } else if (b.aktion === 'loeschen') {
      await q('DELETE FROM teams WHERE id = $1', [b.id])
      await ereignis('team_geloescht', ich.id, { id: b.id }, clientIp(event))
    } else {
      if (!(await q1('SELECT 1 FROM users WHERE id = $1', [b.user_id])))
        throw fehler(404, 'Konto nicht gefunden.', 'Account not found.')
      await imTeamSchreiben(b.id, async (c) => {
        if (b.rolle == null) {
          await c.query('DELETE FROM team_mitglieder WHERE team_id = $1 AND user_id = $2', [b.id, b.user_id])
          await teamOrdnerUebergeben(c, b.id, b.user_id, null)
          return
        }
        // 200er-Grenze wie bei der Team-Leitung: mehr Mitglieder wären für die Leitung unsichtbar
        const da = (await c.query('SELECT 1 FROM team_mitglieder WHERE team_id = $1 AND user_id = $2', [b.id, b.user_id])).rowCount
        if (!da && (await c.query('SELECT count(*)::int AS n FROM team_mitglieder WHERE team_id = $1', [b.id])).rows[0].n >= MAX_MITGLIEDER)
          throw fehler(409, `Ein Team hat höchstens ${MAX_MITGLIEDER} Mitglieder.`, `A team can have at most ${MAX_MITGLIEDER} members.`)
        await c.query(
          'INSERT INTO team_mitglieder (team_id, user_id, rolle) VALUES ($1, $2, $3) ON CONFLICT (team_id, user_id) DO UPDATE SET rolle = EXCLUDED.rolle',
          [b.id, b.user_id, b.rolle]
        )
      })
    }
  } catch (e: any) {
    if (e?.code === '23505')
      throw fehler(409, 'Ein Team mit diesem Namen gibt es schon.', 'A team with this name already exists.')
    throw e
  }
  return { ok: true }
})
