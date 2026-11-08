import { z } from 'zod'
import { q } from '../../../utils/db'
import { requireUser } from '../../../utils/auth'
import { idParam, nurVerwalten, teamEingabe, tempo, teamZugang } from '../../../utils/teamAnsicht'

// Namensvorschläge zum Hinzufügen (nur Leitung/Admin): Präfix- oder Teilstring-Treffer, mindestens 2 Zeichen, höchstens 8,
// nur der Benutzername, ohne bestehende Mitglieder, für die Leitung ohne Admin-/Inhaber-Konten (siehe mitglieder.post.ts).
const Frage = z.object({
  q: z
    .string()
    .trim()
    .min(2)
    .max(64)
    // eslint-disable-next-line no-control-regex
    .refine((s) => !/[\u0000-\u001f\u007f]/.test(s))
})

export default defineEventHandler(async (event) => {
  const ich = await requireUser(event)
  const teamId = idParam(event, 'id')
  const z = await teamZugang(ich, teamId)
  nurVerwalten(z)
  tempo(`team-kand:${ich.id}`, 60, 60)
  tempo(`team-kand-h:${ich.id}`, 400, 3600) // bremst systematisches Durchsuchen der Kontenliste
  const { q: suche } = teamEingabe(Frage, { q: getQuery(event).q })
  const muster = suche.toLowerCase().replace(/[\\%_]/g, '\\$&')
  const r = await q<{ username: string }>(
    `SELECT u.username FROM users u
     WHERE lower(u.username) LIKE $2 ESCAPE '\\'
       AND NOT EXISTS (SELECT 1 FROM team_mitglieder m WHERE m.team_id = $1 AND m.user_id = u.id)
       AND ($3::boolean OR u.role = 'user')
     ORDER BY (lower(u.username) LIKE $4 ESCAPE '\\') DESC, lower(u.username), u.id LIMIT 8`,
    [teamId, `%${muster}%`, z.admin, `${muster}%`]
  )
  return { kandidaten: r.map((x) => ({ name: x.username })) }
})
