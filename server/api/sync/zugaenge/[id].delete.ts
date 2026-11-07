import { q, ereignis } from '../../../utils/db'
import { clientIp, requireUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(id) || id <= 0) throw fehler(400, 'Ungültige ID.', 'Invalid ID.')
  const r = await q('DELETE FROM dav_zugaenge WHERE id = $1 AND user_id = $2 RETURNING name', [id, u.id])
  if (!r.length) throw fehler(404, 'App-Passwort nicht gefunden.', 'App password not found.')
  await ereignis('dav_zugang_widerrufen', u.id, { name: r[0].name }, clientIp(event))
  return { ok: true }
})
