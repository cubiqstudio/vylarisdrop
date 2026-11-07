import { promises as fs } from 'node:fs'
import { q } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { importAblage, importAnsicht, meinImport } from '../../utils/importKern'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const imp = await meinImport(event, u)
  const fehlerListe = imp.fehlgeschlagen
    ? await q(
        `SELECT daten->>'name' AS name, meldung FROM import_posten WHERE import_id = $1 AND status = 'fehler' ORDER BY id LIMIT 50`,
        [imp.id]
      )
    : []
  const hochgeladen: Array<{ name: string; groesse: number; fertig: boolean }> = []
  for (const d of await fs.readdir(importAblage(imp.id), { withFileTypes: true }).catch(() => [])) {
    if (!d.isFile()) continue
    const s = await fs.stat(`${importAblage(imp.id)}/${d.name}`).catch(() => null)
    hochgeladen.push({
      name: d.name.replace(/\.rdteil$/, ''),
      groesse: s?.size || 0,
      fertig: !d.name.endsWith('.rdteil')
    })
  }
  return { import: importAnsicht(imp), fehler: fehlerListe, hochgeladen }
})
