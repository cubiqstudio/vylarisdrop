import { q1 } from '../../../utils/db'
import { limit, requireUser } from '../../../utils/auth'
import { ausfuehren, type Regel } from '../../../utils/regeln'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (limit('regel:' + u.id, 10, 60)) throw fehler(429, 'Bitte kurz warten.', 'Please wait a moment.')
  const r = await q1<Regel>('SELECT * FROM regeln WHERE id = $1', [Number(getRouterParam(event, 'id')) || 0])
  if (!r || (r.user_id !== u.id && !(r.geltung === 'alle' && u.role !== 'user')))
    throw fehler(404, 'Regel nicht gefunden.', 'Rule not found.')
  return ausfuehren(r)
})
