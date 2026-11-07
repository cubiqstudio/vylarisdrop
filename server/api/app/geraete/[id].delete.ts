import { q, ereignis } from '../../../utils/db'
import { clientIp, requireUser } from '../../../utils/auth'

// Widerruft ein App-Geraet (nur eigene). Token und Sitzungen des Geraets sind sofort ungueltig.
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(id) || id <= 0) throw fehler(400, 'Ungültige ID.', 'Invalid ID.')
  const r = await q("DELETE FROM upload_tokens WHERE id = $1 AND user_id = $2 AND art = 'app' RETURNING name", [id, u.id])
  if (!r.length) throw fehler(404, 'Gerät nicht gefunden.', 'Device not found.')
  await ereignis('app_geraet_widerrufen', u.id, { name: r[0].name, id }, clientIp(event))
  return { ok: true }
})
