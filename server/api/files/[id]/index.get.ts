import { q } from '../../../utils/db'
import { requireUser } from '../../../utils/auth'
import { basisUrl, fuerPanel, type DateiZeile } from '../../../utils/dateien'
import { dateiRecht } from '../../../utils/teams'

// Eine einzelne Datei (für die geöffnete Detailansicht: Live-Abgleich, ob sie noch existiert und was sich geändert hat).
// Gleiche Berechtigung wie die Statistik einer Datei: eigene Dateien und Dateien aus Team-Ordnern, in denen man Mitglied ist.
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = String(getRouterParam(event, 'id') || '')
  if (!/^\d{1,18}$/.test(id)) throw fehler(400, 'Ungültige ID.', 'Invalid ID.')
  const f = await dateiRecht<DateiZeile>(u.id, id, 'lesen')
  if (!f) throw fehler(404, 'Datei nicht gefunden.', 'File not found.')
  const tags = await q<{ id: number; name: string; color: string }>(
    'SELECT t.id, t.name, t.color FROM file_tags ft JOIN tags t ON t.id = ft.tag_id WHERE ft.file_id = $1',
    [id]
  )
  return { file: fuerPanel(await basisUrl(event), f, tags) }
})
