import { q1, ereignis } from '../../../utils/db'
import { clientIp, limit, requireAdmin } from '../../../utils/auth'
import { ablageVerwerfen, positionenNeu } from '../../../utils/ablageRegeln'

// Ablage-Regel löschen. Dateien, die nach der Regel abgelegt wurden, bleiben, wo sie sind.
export default defineEventHandler(async (event) => {
  const u = await requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(id) || id <= 0) throw fehler(404, 'Regel nicht gefunden.', 'Rule not found.')
  if (limit('ablage:' + u.id, 150, 60)) throw fehler(429, 'Zu viele Änderungen — bitte kurz warten.', 'Too many changes — please wait a moment.')
  const r = await q1<{ name: string; aktion: string }>('DELETE FROM ablage_regeln WHERE id = $1 RETURNING name, aktion', [id])
  if (!r) throw fehler(404, 'Regel nicht gefunden.', 'Rule not found.')
  await positionenNeu()
  await ablageVerwerfen()
  await ereignis('ablage_regel_geloescht', u.id, { id, name: r.name.slice(0, 60), aktion: r.aktion }, clientIp(event))
  return { ok: true }
})
