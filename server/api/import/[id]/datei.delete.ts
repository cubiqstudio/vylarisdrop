import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { requireUser } from '../../../utils/auth'
import { importAblage, meinImport } from '../../../utils/importKern'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const imp = await meinImport(event, u)
  if (imp.status !== 'entwurf')
    throw fehler(
      409,
      'Nach der Analyse lassen sich keine Dateien mehr entfernen.',
      'Files can no longer be removed after the analysis.'
    )
  const name = String(getQuery(event).name || '')
  const ordner = importAblage(imp.id)
  const da = (await fs.readdir(ordner).catch(() => [] as string[])).find((n) => n === name || n === name + '.rdteil')
  if (!da) throw fehler(404, 'Datei nicht gefunden.', 'File not found.')
  await fs.rm(join(ordner, da), { force: true })
  return { ok: true }
})
