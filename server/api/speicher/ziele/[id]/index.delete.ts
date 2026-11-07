import { ereignis } from '../../../../utils/db'
import { clientIp, requireAdmin } from '../../../../utils/auth'
import { zielLaden, zielLoeschen } from '../../../../utils/sftpZiele'
import { poolVerwerfen } from '../../../../utils/sftpClient'
import { loeschHindernis } from '../../../../utils/sftpVerwaltung'

// Erweiterung entfernen — nur, wenn dort keine Dateien mehr liegen (zuerst umziehen)
export default defineEventHandler(async (event) => {
  const ich = await requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  const z = Number.isInteger(id) ? await zielLaden(id, true) : null
  if (!z) throw fehler(404, 'Diese Speicher-Erweiterung gibt es nicht.', 'This storage add-on does not exist.')
  const grund = await loeschHindernis(z)
  if (grund) throw fehler(409, grund)
  await zielLoeschen(id)
  poolVerwerfen(id)
  await ereignis('sftp_ziel_entfernt', ich.id, { id, name: z.name, host: z.host }, clientIp(event))
  return { ok: true }
})
