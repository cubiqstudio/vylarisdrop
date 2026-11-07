import { apiNutzer, alsApi, ART_ZURUECK } from '../../../utils/api'
import { basisUrl } from '../../../utils/dateien'
import { dateienListe } from '../../../utils/liste'

const SORT: Record<string, string> = { newest: 'neu', oldest: 'alt', largest: 'gross', name: 'name', views: 'aufrufe' }
export default defineEventHandler(async (event) => {
  const u = await apiNutzer(event, 'lesen')
  const p = getQuery(event)
  const r = await dateienListe(
    u,
    {
      seite: p.page,
      pro: p.per_page || 50,
      art: ART_ZURUECK[String(p.type)],
      ordner: p.folder_id === 'none' ? 'ohne' : p.folder_id,
      tag: p.tag_id,
      suche: p.search,
      favoriten: p.favorite === 'true' ? '1' : undefined,
      sort: SORT[String(p.sort)]
    },
    await basisUrl(event)
  )
  return { total: r.gesamt, page: r.seite, per_page: r.pro, files: r.files.map(alsApi) }
})
