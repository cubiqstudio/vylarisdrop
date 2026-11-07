import { q, ereignis } from '../../../utils/db'
import { clientIp, requireUser } from '../../../utils/auth'
import { dateiRecht } from '../../../utils/teams'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = String(getRouterParam(event, 'id') || '')
  if (!/^\d{1,18}$/.test(id)) throw fehler(400, 'Ungültige ID.', 'Invalid ID.')
  const f = await dateiRecht<{ id: string; name: string; scan: string; scan_info: string }>(u.id, id, 'aendern')
  if (!f) throw fehler(404, 'Datei nicht gefunden.', 'File not found.')
  const aktion = String((await readBody(event))?.aktion || '')
  if (aktion === 'neu') {
    await q("UPDATE files SET scan = '', scan_info = '' WHERE id = $1 AND scan <> 'laeuft'", [id])
    return { ok: true }
  }
  if (aktion === 'freigeben') {
    if (u.role !== 'owner' && u.role !== 'admin')
      throw fehler(403, 'Freigeben dürfen nur Admins.', 'Only admins can release files.')
    if (f.scan !== 'fund') throw fehler(400, 'Die Datei ist nicht in Quarantäne.', 'The file is not quarantined.')
    await q("UPDATE files SET scan = 'frei' WHERE id = $1", [id])
    await ereignis(
      'virus_freigegeben',
      u.id,
      { name: f.name.slice(0, 80), virus: f.scan_info.slice(0, 120) },
      clientIp(event)
    )
    return { ok: true }
  }
  throw fehler(400, 'Unbekannte Aktion.', 'Unknown action.')
})
