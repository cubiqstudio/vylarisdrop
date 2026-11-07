import { ereignis } from '../../utils/db'
import { clientIp, requireUser } from '../../utils/auth'
import { endgueltig, wiederherstellen } from '../../utils/papierkorb'
import { basisUrl, fuerPanel } from '../../utils/dateien'
import { webhookAusloesen } from '../../utils/webhooks'
import { alsApi } from '../../utils/api'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const b = await readBody(event)
  const admin = u.role !== 'user'
  const id = /^\d{1,18}$/.test(String(b?.id || '')) ? String(b.id) : ''
  if (b?.aktion === 'wiederherstellen') {
    if (!id) throw fehler(400, 'Ungültige ID.', 'Invalid ID.')
    const f = await wiederherstellen(id, u.id, admin)
    if (!f) throw fehler(404, 'Nicht im Papierkorb.', 'Not in the trash.')
    await ereignis('datei_wiederhergestellt', u.id, { name: f.name.slice(0, 80) }, clientIp(event))
    const file = fuerPanel(await basisUrl(event), f)
    webhookAusloesen(f.user_id, 'file.restored', { file: alsApi(file) })
    return { ok: true, file }
  }
  if (b?.aktion === 'loeschen') {
    if (!id) throw fehler(400, 'Ungültige ID.', 'Invalid ID.')
    const n = await endgueltig(admin ? { id } : { id, userId: u.id })
    if (!n) throw fehler(404, 'Nicht im Papierkorb.', 'Not in the trash.')
    await ereignis('datei_endgueltig', u.id, {}, clientIp(event))
    return { ok: true }
  }
  if (b?.aktion === 'leeren') {
    const n = await endgueltig({ userId: u.id })
    await ereignis('papierkorb_geleert', u.id, { anzahl: n }, clientIp(event))
    return { ok: true, anzahl: n }
  }
  throw fehler(400, 'Unbekannte Aktion.', 'Unknown action.')
})
