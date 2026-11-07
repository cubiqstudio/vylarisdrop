import { q, q1 } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { meineTeams, ordnerRecht } from '../../utils/teams'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const b = await readBody(event)
  const name = String(b?.name || '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 80)
  if (!name) throw fehler(400, 'Bitte einen Namen eingeben.', 'Please enter a name.')
  const parent = b?.parent_id == null ? null : Number(b.parent_id)
  let team: number | null = null
  if (parent != null) {
    const r = await ordnerRecht(u.id, parent)
    if (!r?.hineinladen) throw fehler(404, 'Übergeordneter Ordner nicht gefunden.', 'Parent folder not found.')
    team = r.team_id
  } else if (b?.team_id != null) {
    const m = (await meineTeams(u.id)).find((t) => t.team_id === Number(b.team_id))
    if (!m || m.rolle !== 'leitung')
      throw fehler(403, 'Team-Ordner legt die Team-Leitung an.', 'Team folders are created by the team lead.')
    team = m.team_id
  }
  const n = await q1<{ n: string }>('SELECT count(*) AS n FROM folders WHERE user_id = $1', [u.id])
  if (Number(n?.n || 0) >= 1000) throw fehler(400, 'Höchstens 1.000 Ordner.', 'At most 1,000 folders.')
  const r = await q(
    'INSERT INTO folders (user_id, parent_id, name, team_id) VALUES ($1, $2, $3, $4) RETURNING id, name, parent_id, public, created_at, team_id',
    [u.id, parent, name, team]
  )
  return { ok: true, ordner: { ...r[0], anzahl: 0, eigen: true, verwalten: true } }
})
