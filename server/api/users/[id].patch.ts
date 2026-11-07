import { q, q1, ereignis } from '../../utils/db'
import { clientIp, hashPw, requireAdmin } from '../../utils/auth'
import { UNBEGRENZT } from '../../utils/quota'
import { quotaWarnen } from '../../utils/benachrichtigen'

export default defineEventHandler(async (event) => {
  const ich = await requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  const z = await q1<{ id: number; role: string; username: string }>(
    'SELECT id, role, username FROM users WHERE id = $1',
    [id]
  )
  if (!z) throw fehler(404, 'Konto nicht gefunden.', 'Account not found.')
  if (z.role === 'owner')
    throw fehler(403, 'Das Inhaber-Konto lässt sich hier nicht ändern.', 'The owner account cannot be changed here.')
  if (z.role === 'admin' && ich.role !== 'owner')
    throw fehler(403, 'Admins kann nur der Inhaber ändern.', 'Only the owner can change admins.')
  const b = await readBody(event)
  if (b?.role !== undefined) {
    if (!['admin', 'user'].includes(b.role)) throw fehler(400, 'Ungültige Rolle.', 'Invalid role.')
    if (ich.role !== 'owner') throw fehler(403, 'Rollen vergibt nur der Inhaber.', 'Only the owner assigns roles.')
    await q('UPDATE users SET role = $1 WHERE id = $2', [b.role, id])
  }
  // Kontingent: quota_bytes (null = erbt von Rolle/Standard, -1 = unbegrenzt, > 0 = eigenes Limit) oder, wie bisher,
  // quota_gb (null/leer/0 = erbt). Siehe server/utils/quota.ts.
  if (b?.quota_bytes !== undefined || b?.quota_gb !== undefined) {
    let bytes: number | null
    if (b.quota_bytes !== undefined) {
      if (b.quota_bytes === null || b.quota_bytes === 0) bytes = null
      else if (b.quota_bytes === UNBEGRENZT) bytes = UNBEGRENZT
      else if (Number.isSafeInteger(b.quota_bytes) && b.quota_bytes > 0 && b.quota_bytes <= 1_000_000 * 1024 ** 3)
        bytes = b.quota_bytes
      else throw fehler(400, 'Ungültiges Kontingent.', 'Invalid quota.')
    } else {
      const g = b.quota_gb == null || b.quota_gb === '' ? null : Number(b.quota_gb)
      if (g != null && !(g >= 0 && g <= 1_000_000)) throw fehler(400, 'Ungültiges Kontingent.', 'Invalid quota.')
      bytes = g ? Math.round(g * 1024 ** 3) : null
    }
    await q('UPDATE users SET quota_bytes = $1 WHERE id = $2', [bytes, id])
    // Warnstufe neu bewerten (Limit geändert: Stufe fällt zurück oder wird beim nächsten Upload neu gesetzt)
    void quotaWarnen(id).catch(() => {})
  }
  if (typeof b?.password === 'string' && b.password) {
    if (b.password.length < 10 || b.password.length > 200)
      throw fehler(400, 'Das Passwort braucht mindestens 10 Zeichen.', 'The password needs at least 10 characters.')
    await q('UPDATE users SET password = $1 WHERE id = $2', [await hashPw(b.password), id])
    await q('DELETE FROM sessions WHERE user_id = $1', [id])
  }
  await ereignis('user_updated', ich.id, { username: z.username }, clientIp(event))
  return { ok: true }
})
