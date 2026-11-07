import { q, ereignis } from '../../utils/db'
import { clientIp, requireOwner } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const u = await requireOwner(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id < 1 || id > 2_000_000_000) throw fehler(400, 'Ungültige ID.', 'Invalid ID.')
  await q('DELETE FROM lizenz_schluessel WHERE id = $1', [id])
  await ereignis('lizenz_geloescht', u.id, { id }, clientIp(event))
  return { ok: true }
})
