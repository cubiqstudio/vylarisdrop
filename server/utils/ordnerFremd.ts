import { q1 } from './db'
import { meineTeams } from './teams'

/**
 * Liegen im Teilbaum eines Ordners Ordner oder Dateien anderer Konten, über die der Nutzer nicht verfügen darf?
 * Verfügen darf er über fremde Inhalte nur als Leitung des Teams, zu dem der jeweilige Ordner gehört
 * (dieselbe Regel wie beim Löschen im Dateimanager, siehe loeschenAuswahl in cloudAktionen.ts).
 */
export async function fremdesImBaum(userId: number, ordnerId: number): Promise<boolean> {
  const leitung = (await meineTeams(userId)).filter((t) => t.rolle === 'leitung').map((t) => t.team_id)
  const r = await q1(
    `WITH RECURSIVE unter(id, user_id, team_id) AS (
      SELECT id, user_id, team_id FROM folders WHERE id = $1::int
      UNION SELECT f.id, f.user_id, f.team_id FROM folders f JOIN unter ON f.parent_id = unter.id)
    SELECT 1 FROM (
      SELECT 1 FROM unter WHERE user_id <> $2 AND NOT (team_id IS NOT NULL AND team_id = ANY($3::int[]))
      UNION ALL
      SELECT 1 FROM files fi JOIN unter ON fi.folder_id = unter.id
        WHERE fi.user_id <> $2 AND NOT (unter.team_id IS NOT NULL AND unter.team_id = ANY($3::int[]))
    ) x LIMIT 1`,
    [ordnerId, userId, leitung]
  )
  return !!r
}
