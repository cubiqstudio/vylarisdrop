import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { ereignis } from '../../../utils/db'
import { clientIp, requireOwner } from '../../../utils/auth'
import { requirePro } from '../../../utils/lizenz'
import { ablageOrdner, neueLaufId, sicherungPruefen, wiederherstellen } from '../../../utils/sicherung'
import { importWurzel } from '../../../utils/importKern'
import { arbeitsPfad } from '../../../utils/speicher'

const Body = z.object({
  datei: z
    .string()
    .regex(/^[0-9a-f]{32}\.zip$/)
    .optional(),
  server: z.string().max(200).optional(),
  aufraeumen: z.boolean().default(false),
  bestaetigung: z.literal('ERSETZEN')
})
export default defineEventHandler(async (event) => {
  const ich = await requireOwner(event)
  await requirePro('sicherung')
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Bitte die Bestätigung eintippen.', 'Please type the confirmation.')
  let pfad: string
  if (p.data.datei) pfad = join(ablageOrdner(), p.data.datei)
  else if (p.data.server) {
    const name = basename(p.data.server)
    if (name !== p.data.server || !/^vylariscloud-sicherung.*\.zip$/i.test(name))
      throw fehler(400, 'Ungültiger Dateiname.', 'Invalid file name.')
    pfad = await arbeitsPfad('.zip')
    await fs.copyFile(join(importWurzel(), name), pfad)
  } else throw fehler(400, 'Welche Sicherung?', 'Which backup?')
  try {
    await sicherungPruefen(pfad)
  } catch {
    await fs.rm(pfad, { force: true }).catch(() => {})
    throw fehler(400, 'Das ist keine VylarisCloud-Sicherung.', 'This is not a VylarisCloud backup.')
  }
  const lauf = neueLaufId()
  await ereignis('wiederherstellung', ich.id, { quelle: p.data.server || 'upload' }, clientIp(event))
  void wiederherstellen(pfad, lauf, p.data.aufraeumen)
  return { lauf }
})
