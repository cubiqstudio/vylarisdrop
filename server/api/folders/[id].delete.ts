import { q } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { ordnerRecht } from '../../utils/teams'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!(await ordnerRecht(u.id, id))?.verwalten) throw fehler(404, 'Ordner nicht gefunden.', 'Folder not found.')
  await q('DELETE FROM folders WHERE id = $1', [id])
  return { ok: true }
})
