import { z } from 'zod'
import { clientIp, requireUser } from '../../../utils/auth'
import { ereignis, q1 } from '../../../utils/db'
import {
  Benutzername,
  MAX_MITGLIEDER,
  idParam,
  imTeamSchreiben,
  nurVerwalten,
  teamEingabe,
  tempo,
  teamZugang
} from '../../../utils/teamAnsicht'

// Mitglied per Benutzername hinzufügen (nur Leitung dieses Teams oder Admin). Immer als 'mitglied'.
const Body = z.object({ name: Benutzername })

export default defineEventHandler(async (event) => {
  const ich = await requireUser(event)
  const teamId = idParam(event, 'id')
  const z = await teamZugang(ich, teamId) // Nicht-Mitglieder: 404, noch vor jeder Konten-Abfrage
  nurVerwalten(z)
  tempo(`team-add:${ich.id}`, 30, 3600)
  const { name } = teamEingabe(Body, await readBody(event))
  const ziel = await q1<{ id: number; username: string; role: string }>(
    'SELECT id, username, role FROM users WHERE lower(username) = lower($1) ORDER BY (username = $1) DESC, id LIMIT 1',
    [name]
  )
  // gleiche Meldung für "gibt es nicht" und "nicht hinzufügbar" (Admin-/Inhaber-Konten verwaltet nur ein Admin)
  if (!ziel || (!z.admin && ziel.role !== 'user'))
    throw fehler(404, 'Dieses Konto wurde nicht gefunden.', 'This account was not found.')
  await imTeamSchreiben(teamId, async (c) => {
    if ((await c.query('SELECT 1 FROM team_mitglieder WHERE team_id = $1 AND user_id = $2', [teamId, ziel.id])).rowCount)
      throw fehler(409, `„${ziel.username}“ ist schon im Team.`, `“${ziel.username}” is already in the team.`)
    const n = await c.query('SELECT count(*)::int AS n FROM team_mitglieder WHERE team_id = $1', [teamId])
    if (n.rows[0].n >= MAX_MITGLIEDER)
      throw fehler(
        409,
        `Ein Team hat höchstens ${MAX_MITGLIEDER} Mitglieder.`,
        `A team can have at most ${MAX_MITGLIEDER} members.`
      )
    await c.query("INSERT INTO team_mitglieder (team_id, user_id, rolle) VALUES ($1, $2, 'mitglied')", [teamId, ziel.id])
  }, { zugang: z, leitung: true })
  await ereignis(
    'team_mitglied_hinzugefuegt',
    ich.id,
    { team_id: teamId, konto_id: ziel.id, konto: ziel.username, rolle: 'mitglied' },
    clientIp(event)
  )
  return { ok: true }
})
