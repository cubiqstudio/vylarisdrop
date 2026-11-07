import { z } from 'zod'
import { clientIp, requireUser } from '../../../../utils/auth'
import { ereignis } from '../../../../utils/db'
import { idParam, imTeamSchreiben, nurVerwalten, teamEingabe, tempo, teamZugang } from '../../../../utils/teamAnsicht'

// Rolle eines Mitglieds ändern (nur Leitung/Admin). Die letzte Leitung eines Teams bleibt Leitung (409).
const Body = z.object({ rolle: z.enum(['leitung', 'mitglied']) })

export default defineEventHandler(async (event) => {
  const ich = await requireUser(event)
  const teamId = idParam(event, 'id')
  const ziel = idParam(event, 'userId')
  const z = await teamZugang(ich, teamId)
  nurVerwalten(z)
  tempo(`team-aend:${ich.id}`, 120, 3600)
  const { rolle } = teamEingabe(Body, await readBody(event))
  await imTeamSchreiben(teamId, async (c) => {
    const m = (
      await c.query(
        `SELECT m.rolle, u.role FROM team_mitglieder m JOIN users u ON u.id = m.user_id WHERE m.team_id = $1 AND m.user_id = $2`,
        [teamId, ziel]
      )
    ).rows[0]
    if (!m) throw fehler(404, 'Mitglied nicht gefunden.', 'Member not found.')
    // Admin-Konten (Rolle im System) bleiben unberührt: ihre Mitgliedschaft ändert nur ein Admin
    if (!z.admin && m.role !== 'user')
      throw fehler(403, 'Admin-Konten kann nur ein Admin ändern.', 'Only an admin can change admin accounts.')
    if (m.rolle === rolle) return
    if (m.rolle === 'leitung' && rolle === 'mitglied') {
      const n = await c.query(
        `SELECT count(*)::int AS n FROM team_mitglieder WHERE team_id = $1 AND rolle = 'leitung' AND user_id <> $2`,
        [teamId, ziel]
      )
      if (!n.rows[0].n)
        throw fehler(
          409,
          'Das ist die einzige Leitung des Teams. Ernenne zuerst jemand anderen zur Leitung.',
          'This is the only lead of the team. Promote someone else to lead first.'
        )
    }
    await c.query('UPDATE team_mitglieder SET rolle = $3 WHERE team_id = $1 AND user_id = $2', [teamId, ziel, rolle])
  })
  await ereignis('team_rolle_geaendert', ich.id, { team_id: teamId, konto_id: ziel, rolle }, clientIp(event))
  return { ok: true }
})
