import { q } from '../../../utils/db'
import { requireUser } from '../../../utils/auth'
import { teileLoeschen } from '../../../utils/speicher'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = String(getRouterParam(event, 'id') || '')
  const r = await q<{ speicher: string }>('DELETE FROM uploads WHERE id = $1 AND user_id = $2 RETURNING speicher', [
    id,
    u.id
  ])
  if (r.length) await teileLoeschen(id, r[0]!.speicher === 's3' ? 's3' : 'lokal')
  return { ok: true }
})
