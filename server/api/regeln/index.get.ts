import { q } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { archivMoeglich } from '../../utils/regeln'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const admin = u.role !== 'user'
  const regeln = await q(
    `SELECT r.*, v.username AS von_name FROM regeln r JOIN users v ON v.id = r.von
    WHERE r.user_id = $1 ${admin ? "OR r.geltung = 'alle'" : ''} ORDER BY r.created_at`,
    [u.id]
  )
  return { regeln, archiv: await archivMoeglich(), admin }
})
