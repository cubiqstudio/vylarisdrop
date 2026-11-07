import { q } from '../../../utils/db'
import { apiNutzer, alsApi } from '../../../utils/api'
import { basisUrl, fuerPanel, type DateiZeile } from '../../../utils/dateien'
import { dateiRecht } from '../../../utils/teams'

export default defineEventHandler(async (event) => {
  const u = await apiNutzer(event, 'lesen')
  const id = String(getRouterParam(event, 'id') || '')
  if (!/^\d{1,18}$/.test(id)) throw fehler(400, 'Ungültige ID.', 'Invalid ID.')
  const f = await dateiRecht<DateiZeile>(u.id, id, 'lesen')
  if (!f) throw fehler(404, 'Datei nicht gefunden.', 'File not found.')
  const tags = await q(
    'SELECT t.id, t.name, t.color FROM file_tags ft JOIN tags t ON t.id = ft.tag_id WHERE ft.file_id = $1',
    [id]
  )
  return alsApi(fuerPanel(await basisUrl(event), f, tags))
})
