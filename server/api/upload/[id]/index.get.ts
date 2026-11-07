import { q1 } from '../../../utils/db'
import { requireUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const up = await q1<{ teile: number; teil_groesse: number; erhalten: string[]; name: string; size: string }>(
    'SELECT teile, teil_groesse, erhalten, name, size FROM uploads WHERE id = $1 AND user_id = $2',
    [String(getRouterParam(event, 'id') || ''), u.id]
  )
  if (!up) throw fehler(404, 'Upload nicht gefunden (abgelaufen?).', 'Upload not found (expired?).')
  return {
    teile: up.teile,
    teilGroesse: up.teil_groesse,
    erhalten: (up.erhalten || []).map(Number),
    name: up.name,
    size: Number(up.size)
  }
})
