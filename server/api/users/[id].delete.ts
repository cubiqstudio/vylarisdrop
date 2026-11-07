import { q, q1, ereignis } from '../../utils/db'
import { clientIp, requireAdmin } from '../../utils/auth'
import { loeschen } from '../../utils/speicher'
import { variantenLoeschen } from '../../utils/bildvarianten'
import { speicherVonKontoLoeschen } from '../../utils/speicherMessung'

export default defineEventHandler(async (event) => {
  const ich = await requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  const z = await q1<{ id: number; role: string; username: string }>(
    'SELECT id, role, username FROM users WHERE id = $1',
    [id]
  )
  if (!z) throw fehler(404, 'Konto nicht gefunden.', 'Account not found.')
  if (z.role === 'owner' || z.id === ich.id)
    throw fehler(403, 'Dieses Konto kann nicht gelöscht werden.', 'This account cannot be deleted.')
  if (z.role === 'admin' && ich.role !== 'owner')
    throw fehler(403, 'Admins kann nur der Inhaber löschen.', 'Only the owner can delete admins.')
  const ablagen = await q<{ ablage: string; fid: string }>(
    `SELECT ablage, id::text AS fid FROM files WHERE user_id = $1 UNION SELECT datei->>'ablage', datei->>'id' FROM papierkorb WHERE user_id = $1`,
    [id]
  )
  // Boxen/Buckets zuerst im Speicherdienst aufräumen; schlägt das fehl, bleibt das Konto bestehen (kein Waisen-Speicher).
  // Nur der Inhaber darf mit ?ohneSpeicher=1 bewusst ohne Dienst löschen (Reste im Dienst bleiben dann zurück).
  const ohneDienst = ich.role === 'owner' && String(getQuery(event).ohneSpeicher || '') === '1'
  await speicherVonKontoLoeschen(id, ohneDienst)
  await q('DELETE FROM users WHERE id = $1', [id])
  for (const a of ablagen) {
    await loeschen(a.ablage)
    if (a.fid) await variantenLoeschen(a.fid)
  }
  await ereignis('user_deleted', ich.id, { username: z.username, dateien: ablagen.length }, clientIp(event))
  return { ok: true }
})
