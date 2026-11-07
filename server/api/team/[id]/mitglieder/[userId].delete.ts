import { clientIp, requireUser } from '../../../../utils/auth'
import { ereignis } from '../../../../utils/db'
import { idParam, imTeamSchreiben, tempo, teamZugang } from '../../../../utils/teamAnsicht'

// Mitglied entfernen: die Leitung (oder ein Admin) jedes Mitglied, jedes Mitglied sich selbst ("Team verlassen").
// Die letzte Leitung bleibt (409). Dateien des Entfernten bleiben im Team-Ordner (Besitz wie bisher, siehe ordnerRecht).
export default defineEventHandler(async (event) => {
  const ich = await requireUser(event)
  const teamId = idParam(event, 'id')
  const ziel = idParam(event, 'userId')
  const z = await teamZugang(ich, teamId)
  const selbst = ziel === ich.id && z.rolle !== null
  if (!z.verwalten && !selbst) throw fehler(403, 'Das darf nur die Team-Leitung.', 'Only the team lead may do this.')
  tempo(`team-aend:${ich.id}`, 120, 3600)
  await imTeamSchreiben(teamId, async (c) => {
    const m = (
      await c.query(
        `SELECT m.rolle, u.role FROM team_mitglieder m JOIN users u ON u.id = m.user_id WHERE m.team_id = $1 AND m.user_id = $2`,
        [teamId, ziel]
      )
    ).rows[0]
    if (!m) throw fehler(404, 'Mitglied nicht gefunden.', 'Member not found.')
    if (!z.admin && !selbst && m.role !== 'user')
      throw fehler(403, 'Admin-Konten kann nur ein Admin ändern.', 'Only an admin can change admin accounts.')
    if (m.rolle === 'leitung') {
      const n = await c.query(
        `SELECT count(*)::int AS n FROM team_mitglieder WHERE team_id = $1 AND rolle = 'leitung' AND user_id <> $2`,
        [teamId, ziel]
      )
      if (!n.rows[0].n)
        throw fehler(
          409,
          selbst
            ? 'Du bist die einzige Leitung des Teams. Ernenne zuerst jemand anderen zur Leitung.'
            : 'Das ist die einzige Leitung des Teams. Ernenne zuerst jemand anderen zur Leitung.',
          selbst
            ? 'You are the only lead of the team. Promote someone else to lead first.'
            : 'This is the only lead of the team. Promote someone else to lead first.'
        )
    }
    await c.query('DELETE FROM team_mitglieder WHERE team_id = $1 AND user_id = $2', [teamId, ziel])
  })
  await ereignis(
    selbst ? 'team_verlassen' : 'team_mitglied_entfernt',
    ich.id,
    { team_id: teamId, konto_id: ziel },
    clientIp(event)
  )
  return { ok: true }
})
