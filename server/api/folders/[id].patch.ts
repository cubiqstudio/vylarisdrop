import { q, q1 } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { meineTeams, ordnerRecht } from '../../utils/teams'
import { neuesGalerieToken } from '../../utils/galerie'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  const o = await ordnerRecht(u.id, id)
  if (!o?.verwalten) throw fehler(404, 'Ordner nicht gefunden.', 'Folder not found.')
  const b = await readBody(event)
  if (typeof b?.name === 'string') {
    const name = b.name
      .replace(/[\u0000-\u001f]/g, '')
      .trim()
      .slice(0, 80)
    if (!name) throw fehler(400, 'Bitte einen Namen eingeben.', 'Please enter a name.')
    await q('UPDATE folders SET name = $1 WHERE id = $2', [name, id])
  }
  if ('parent_id' in (b || {})) {
    const p = b.parent_id == null ? null : Number(b.parent_id)
    if (p != null) {
      const ziel = await ordnerRecht(u.id, p)
      if (!ziel?.hineinladen) throw fehler(404, 'Ordner nicht gefunden.', 'Folder not found.')
      const kreis = await q1(
        `WITH RECURSIVE unter(id) AS (SELECT $1::int UNION SELECT f.id FROM folders f JOIN unter ON f.parent_id = unter.id) SELECT 1 FROM unter WHERE id = $2`,
        [id, p]
      )
      if (kreis) throw fehler(400, 'Ein Ordner kann nicht in sich selbst liegen.', 'A folder cannot be inside itself.')
      await teamSetzen(id, ziel.team_id)
    } else if (o.team_id && !o.eigen)
      throw fehler(400, 'Ein Team-Ordner bleibt im Team.', 'A team folder stays in the team.')
    await q('UPDATE folders SET parent_id = $1 WHERE id = $2', [p, id])
  }
  if ('team_id' in (b || {})) {
    const t = b.team_id == null ? null : Number(b.team_id)
    if (t != null && !(await meineTeams(u.id)).some((m) => m.team_id === t))
      throw fehler(404, 'Team nicht gefunden.', 'Team not found.')
    if (!o.eigen && !o.leitung)
      throw fehler(
        403,
        'Das darf der Ersteller oder die Team-Leitung.',
        'Only the creator or the team lead may do this.'
      )
    await teamSetzen(id, t)
  }
  if (typeof b?.public === 'boolean') await q('UPDATE folders SET public = $1 WHERE id = $2', [b.public, id])
  let galerie: { token: string | null } | undefined
  if (b?.galerie && typeof b.galerie === 'object') {
    const g = b.galerie
    const einst = {
      titel: String(g.titel || '')
        .trim()
        .slice(0, 120),
      text: String(g.text || '')
        .trim()
        .slice(0, 1000),
      download: g.download !== false,
      sortierung: ['neu', 'alt', 'name'].includes(g.sortierung) ? g.sortierung : 'neu'
    }
    const r = await q1<{ galerie_token: string | null }>(
      `UPDATE folders SET galerie = $2::jsonb,
        galerie_token = CASE WHEN $3::boolean THEN coalesce(galerie_token, $4) ELSE NULL END WHERE id = $1 RETURNING galerie_token`,
      [id, JSON.stringify(einst), !!g.an, neuesGalerieToken()]
    )
    galerie = { token: r?.galerie_token ?? null }
  }
  return { ok: true, ...(galerie ? { galerie } : {}) }
})

async function teamSetzen(id: number, team: number | null) {
  await q(
    `WITH RECURSIVE unter(id) AS (SELECT $1::int UNION SELECT f.id FROM folders f JOIN unter ON f.parent_id = unter.id)
    UPDATE folders SET team_id = $2 WHERE id IN (SELECT id FROM unter)`,
    [id, team]
  )
}
