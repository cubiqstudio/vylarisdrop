import { q } from '../../../utils/db'
import { requireUser } from '../../../utils/auth'
import { importAnstossen, meinImport } from '../../../utils/importKern'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const imp = await meinImport(event, u)
  const aktion = String((await readBody(event))?.aktion || '')
  if (aktion === 'pausieren') {
    const r = await q(`UPDATE importe SET status = 'pausiert' WHERE id = $1 AND status = 'laeuft' RETURNING id`, [
      imp.id
    ])
    if (!r.length) throw fehler(409, 'Der Import läuft gerade nicht.', 'The import is not running.')
    return { ok: true }
  }
  if (aktion === 'abbrechen') {
    const r = await q(
      `UPDATE importe SET status = 'abgebrochen', fertig_at = now(), zugang = '{}' WHERE id = $1 AND status IN ('laeuft', 'pausiert', 'bereit') RETURNING id`,
      [imp.id]
    )
    if (!r.length) throw fehler(409, 'Dieser Import lässt sich nicht abbrechen.', 'This import cannot be cancelled.')
    return { ok: true }
  }
  if (aktion === 'wiederholen') {
    if (imp.status !== 'fertig' && imp.status !== 'pausiert')
      throw fehler(409, 'Erst wenn der Import fertig oder pausiert ist.', 'Only once the import is done or paused.')
    if (imp.weg === 'live' && !Object.keys(imp.zugang || {}).length)
      throw fehler(
        409,
        'Der Zugang zur Quelle wurde nach dem Abschluss gelöscht — bitte einen neuen Import anlegen.',
        'The source access was deleted after completion — please create a new import.'
      )
    const r = await q<{ n: string }>(
      `WITH x AS (UPDATE import_posten SET status = 'offen', meldung = '' WHERE import_id = $1 AND status = 'fehler' RETURNING 1) SELECT count(*) AS n FROM x`,
      [imp.id]
    )
    const n = Number(r[0]?.n || 0)
    if (!n) throw fehler(409, 'Es gibt keine fehlgeschlagenen Dateien.', 'There are no failed files.')
    await q(
      `UPDATE importe SET status = 'laeuft', fertig_at = NULL, fehlgeschlagen = greatest(0, fehlgeschlagen - $2) WHERE id = $1`,
      [imp.id, n]
    )
    importAnstossen(imp.id)
    return { ok: true, wiederholt: n }
  }
  throw fehler(400, 'Unbekannte Aktion.', 'Unknown action.')
})
