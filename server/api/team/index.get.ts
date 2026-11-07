import { requireUser } from '../../utils/auth'
import { q1 } from '../../utils/db'
import { istPro } from '../../utils/lizenz'
import { teamsAnsicht } from '../../utils/teamAnsicht'

// "Mein Team": Teams des angemeldeten Nutzers mit Speicher und Mitgliederliste. Ohne Pro "Teams" kein Fehler, sondern eine leere Liste.
// ?kurz=1 liefert nur {pro, admin, anzahl} (für die Navigation: "Mein Team" zeigen, wenn anzahl > 0 oder admin).
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const admin = u.role === 'owner' || u.role === 'admin'
  if (!(await istPro('teams'))) return { pro: false, admin, teams: [] }
  if (String(getQuery(event).kurz || '') === '1') {
    const r = await q1<{ n: number }>('SELECT count(*)::int AS n FROM team_mitglieder WHERE user_id = $1', [u.id])
    return { pro: true, admin, anzahl: r?.n || 0 }
  }
  return { pro: true, admin, teams: await teamsAnsicht(u) }
})
