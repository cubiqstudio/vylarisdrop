import { ereignis } from '../../../utils/db'
import { clientIp, requireUser } from '../../../utils/auth'
import { dateiRecht } from '../../../utils/teams'
import { inPapierkorb } from '../../../utils/papierkorb'
import { webhookAusloesen } from '../../../utils/webhooks'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = String(getRouterParam(event, 'id') || '')
  if (!/^\d{1,18}$/.test(id)) throw fehler(400, 'Ungültige ID.', 'Invalid ID.')
  const f = await dateiRecht<{ id: string; ablage: string; name: string; slug: string; user_id: number }>(
    u.id,
    id,
    'aendern'
  )
  if (!f) throw fehler(404, 'Datei nicht gefunden.', 'File not found.')
  await inPapierkorb(f, u.id)
  await ereignis('file_deleted', u.id, { name: f.name.slice(0, 80) }, clientIp(event))
  webhookAusloesen(f.user_id, 'file.deleted', {
    file: { id: String(f.id), slug: f.slug, name: f.name },
    trashed: true,
    by: u.username
  })
  return { ok: true }
})
