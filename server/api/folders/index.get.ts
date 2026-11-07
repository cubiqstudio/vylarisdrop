import { q } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { meineTeams } from '../../utils/teams'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const teams = await meineTeams(u.id)
  const ids = teams.map((t) => t.team_id)
  const leitung = teams.filter((t) => t.rolle === 'leitung').map((t) => t.team_id)
  const ordner = await q<any>(
    `SELECT o.id, o.name, o.parent_id, o.public, o.created_at, o.user_id, o.team_id, o.galerie_token, o.galerie,
      (SELECT count(*) FROM files f WHERE f.folder_id = o.id)::int AS anzahl
    FROM folders o WHERE o.user_id = $1 OR o.team_id = ANY($2::int[])
    ORDER BY lower(o.name)`,
    [u.id, ids]
  )
  return {
    ordner: ordner.map((o) => {
      const team = o.team_id && ids.includes(o.team_id) ? teams.find((t) => t.team_id === o.team_id)! : null
      return {
        id: o.id,
        name: o.name,
        parent_id: o.parent_id,
        public: o.public,
        created_at: o.created_at,
        anzahl: o.anzahl,
        eigen: o.user_id === u.id,
        team_id: team ? o.team_id : null,
        team: team ? { name: team.name, farbe: team.farbe } : null,
        verwalten: o.user_id === u.id || (!!team && leitung.includes(o.team_id)),
        ...(o.user_id === u.id || (!!team && leitung.includes(o.team_id))
          ? { galerie_token: o.galerie_token, galerie: o.galerie || {} }
          : {})
      }
    }),
    teams: teams.map((t) => ({ id: t.team_id, name: t.name, farbe: t.farbe, rolle: t.rolle }))
  }
})
