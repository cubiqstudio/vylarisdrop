import { q1 } from '../../../../utils/db'
import { anfrageFreigegeben, anfrageOffen, anfragePerToken } from '../../../../utils/anfragen'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const a = await anfragePerToken(String(getRouterParam(event, 'token') || ''))
  if (!a) throw fehler(404, 'Diese Anfrage gibt es nicht.', 'This request does not exist.')
  const von = await q1<{ username: string }>('SELECT username FROM users WHERE id = $1', [a.user_id])
  const o = anfrageOffen(a)
  return {
    titel: a.titel,
    von: von?.username || '',
    ...o,
    gesperrt: !(await anfrageFreigegeben(event, a)),
    nachricht: a.nachricht,
    max_bytes: a.max_bytes != null ? Number(a.max_bytes) : null,
    laeuft_ab: a.laeuft_ab,
    rest: a.max_dateien != null ? Math.max(0, a.max_dateien - a.anzahl) : null,
    aufnahme: a.aufnahme !== false,
    aufnahme_min: a.aufnahme_min || 5
  }
})
