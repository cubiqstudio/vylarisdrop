import { q, q1, ereignis } from '../../utils/db'
import { clientIp, hashPw, requireAdmin } from '../../utils/auth'

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
  if (b?.quota_gb !== undefined) {
    const g = b.quota_gb == null || b.quota_gb === '' ? null : Number(b.quota_gb)
    if (g != null && !(g >= 0 && g <= 1_000_000)) throw fehler(400, 'Ungültiges Kontingent.', 'Invalid quota.')
    await q('UPDATE users SET quota_bytes = $1 WHERE id = $2', [g ? Math.round(g * 1024 ** 3) : null, id])
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
