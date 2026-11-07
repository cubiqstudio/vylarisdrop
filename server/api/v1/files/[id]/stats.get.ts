import { apiNutzer } from '../../../../utils/api'
import { dateiRecht } from '../../../../utils/teams'
import { auswertung } from '../../../../utils/statistik'

export default defineEventHandler(async (event) => {
  const u = await apiNutzer(event, 'lesen')
  const id = String(getRouterParam(event, 'id') || '')
  if (!/^\d{1,18}$/.test(id)) throw fehler(400, 'Ungültige ID.', 'Invalid ID.')
  const f = await dateiRecht<{ views: number }>(u.id, id, 'lesen')
  if (!f) throw fehler(404, 'Datei nicht gefunden.', 'File not found.')
  const tage = [7, 30, 90].includes(Number(getQuery(event).days)) ? Number(getQuery(event).days) : 30
  const a = await auswertung({ fileId: id }, tage)
  return {
    days: a.tage.map((x) => ({ date: x.tag, views: x.n })),
    total: a.gesamt,
    all_time: Number(f.views),
    sources: a.quellen.map((x) => ({
      source: x.name === 'direkt' ? 'direct' : x.name === 'intern' ? 'internal' : x.name,
      views: x.n
    })),
    countries: a.laender.map((x) => ({ country: x.code || null, views: x.n }))
  }
})
