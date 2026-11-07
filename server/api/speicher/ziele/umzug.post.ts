import { z } from 'zod'
import { ereignis } from '../../../utils/db'
import { clientIp, requireAdmin } from '../../../utils/auth'
import { requirePro } from '../../../utils/lizenz'
import { getSpeicher } from '../../../utils/s3'
import { sftpId, type Ort } from '../../../utils/speicher'
import { umzugStand, umzugStarten, umzugSteuern } from '../../../utils/umzug'

const Body = z.discriminatedUnion('aktion', [
  z.object({ aktion: z.literal('starten'), ziel: z.string().regex(/^(lokal|s3|sftp[1-9][0-9]{0,8})$/) }),
  z.object({ aktion: z.literal('steuern'), was: z.enum(['pausieren', 'fortsetzen', 'verwerfen', 'abbrechen']) })
])

// Dateien umziehen (lokal/S3/SFTP-Erweiterung) und den laufenden Umzug steuern (Pausieren, Fortsetzen, Abbrechen)
export default defineEventHandler(async (event) => {
  const ich = await requireAdmin(event)
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Bitte prüfe die Angaben.', 'Please check your input.')
  const b = p.data
  if (b.aktion === 'steuern') {
    await umzugSteuern(b.was)
    await ereignis('speicher_umzug', ich.id, { aktion: b.was }, clientIp(event))
    return { ok: true, umzug: await umzugStand() }
  }
  const lauf = await umzugStand()
  if (lauf && lauf.status === 'laeuft')
    throw fehler(409, 'Es läuft bereits ein Umzug.', 'A move is already running.')
  const ziel = b.ziel as Ort
  if (ziel === 's3') {
    await requirePro('s3')
    if (!(await getSpeicher()).s3?.bucket)
      throw fehler(400, 'Bitte zuerst S3 einrichten.', 'Please set up S3 first.')
  }
  const neu = await umzugStarten(ziel)
  await ereignis('speicher_umzug', ich.id, { ziel, anzahl: neu.gesamt, sftp: sftpId(ziel) }, clientIp(event))
  return { ok: true, umzug: neu }
})
