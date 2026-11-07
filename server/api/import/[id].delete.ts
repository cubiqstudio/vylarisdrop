import { promises as fs } from 'node:fs'
import { q } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { importAblage, laeuftGerade, meinImport } from '../../utils/importKern'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const imp = await meinImport(event, u)
  if (imp.status === 'laeuft' || imp.status === 'analyse' || laeuftGerade(imp))
    throw fehler(
      409,
      'Der Import läuft noch — bitte zuerst pausieren oder abbrechen.',
      'The import is still running — please pause or cancel it first.'
    )
  await q('DELETE FROM importe WHERE id = $1', [imp.id])
  await fs.rm(importAblage(imp.id), { recursive: true, force: true }).catch(() => {})
  return { ok: true }
})
