import { q, q1 } from '../../../utils/db'
import { requireUser } from '../../../utils/auth'
import { basisUrl, fuerPanel, type DateiZeile } from '../../../utils/dateien'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!(await q1('SELECT 1 FROM anfragen WHERE id = $1 AND user_id = $2', [id, u.id])))
    throw fehler(404, 'Anfrage nicht gefunden.', 'Request not found.')
  const zeilen = await q<DateiZeile>(
    'SELECT * FROM files WHERE anfrage_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 100',
    [id, u.id]
  )
  const basis = await basisUrl(event)
  return { dateien: zeilen.map((f) => fuerPanel(basis, f)) }
})
