import { q } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const teams = await q(`SELECT t.id, t.name, t.farbe, t.beschreibung, t.created_at,
      (SELECT count(*) FROM folders f WHERE f.team_id = t.id)::int AS ordner,
      coalesce((SELECT json_agg(json_build_object('id', u.id, 'username', u.username, 'rolle', m.rolle) ORDER BY m.rolle, lower(u.username))
        FROM team_mitglieder m JOIN users u ON u.id = m.user_id WHERE m.team_id = t.id), '[]') AS mitglieder
    FROM teams t ORDER BY lower(t.name)`)
  const rollen = await q(
    `SELECT r.id, r.name, r.farbe, r.rechte, (SELECT count(*) FROM users u WHERE u.rolle_id = r.id)::int AS konten FROM rollen r ORDER BY lower(r.name)`
  )
  const konten = await q(`SELECT id, username, role, rolle_id FROM users ORDER BY lower(username)`)
  return { teams, rollen, konten }
})
