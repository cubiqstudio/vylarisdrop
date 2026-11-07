import { ereignis } from '../../../../utils/db'
import { clientIp, requireAdmin } from '../../../../utils/auth'
import { getSpeicher, setSpeicher } from '../../../../utils/s3'
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
  // Pool-Mitglied: Ziel aus dem Pool nehmen (mindestens „lokal“ bleibt)
  const w = await getSpeicher()
  if (w.art === 'pool' && w.mitglieder?.includes(`sftp${id}`)) {
    const rest = w.mitglieder.filter((m) => m !== `sftp${id}`)
    await setSpeicher({ ...w, mitglieder: rest.length ? rest : ['lokal'] })
  }
  await zielLoeschen(id)
  poolVerwerfen(id)
  await ereignis('sftp_ziel_entfernt', ich.id, { id, name: z.name, host: z.host }, clientIp(event))
  return { ok: true }
})
