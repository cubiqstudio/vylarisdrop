import { createWriteStream, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { requireOwner } from '../../../utils/auth'
import { requirePro } from '../../../utils/lizenz'
import { ablageOrdner, neueLaufId, sicherungPruefen } from '../../../utils/sicherung'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  await requirePro('sicherung')
  await fs.mkdir(ablageOrdner(), { recursive: true })
  const datei = `${neueLaufId()}.zip`
  const ziel = join(ablageOrdner(), datei)
  await pipeline(event.node.req, createWriteStream(ziel))
  try {
    return { datei, kopf: await sicherungPruefen(ziel) }
  } catch {
    await fs.rm(ziel, { force: true })
    throw fehler(400, 'Das ist keine VylarisCloud-Sicherung.', 'This is not a VylarisCloud backup.')
  }
})
