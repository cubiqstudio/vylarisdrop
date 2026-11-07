import { q } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { quotaStand, teamStand } from '../../utils/quota'
import { meineTeams } from '../../utils/teams'

// Eigene Belegung: Kontingent, Aufschlüsselung nach Art (Dateien) plus Papierkorb, Kontingente der eigenen Teams
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const stand = await quotaStand(u)
  const arten = await q<{ art: string; n: string; s: string }>(
    'SELECT art, count(*) AS n, coalesce(sum(size), 0) AS s FROM files WHERE user_id = $1 GROUP BY art',
    [u.id]
  )
  const teams = []
  for (const m of await meineTeams(u.id)) {
    const t = await teamStand(m.team_id)
    if (t && t.limit != null) teams.push({ ...t, farbe: m.farbe })
  }
  return {
    ...stand,
    proArt: Object.fromEntries(arten.map((r) => [r.art, { anzahl: Number(r.n), bytes: Number(r.s) }])),
    teams
  }
})
