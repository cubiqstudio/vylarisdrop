import { q, ereignis } from '../../utils/db'
import { clientIp, requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = String(getQuery(event).id || '').slice(0, 400)
  const r = await q<{ name: string }>('DELETE FROM passkeys WHERE id = $1 AND user_id = $2 RETURNING name', [id, u.id])
  if (!r.length) throw fehler(404, 'Passkey nicht gefunden.', 'Passkey not found.')
  await ereignis('passkey_geloescht', u.id, { name: r[0]!.name.slice(0, 60) }, clientIp(event))
  return { ok: true }
})
