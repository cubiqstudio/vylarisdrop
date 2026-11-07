import { z } from 'zod'
import { q, q1, ereignis } from '../../../utils/db'
import { clientIp, requireUser } from '../../../utils/auth'
import { importAnstossen, meinImport } from '../../../utils/importKern'

const Optionen = z.object({
  konten: z.boolean().default(false),
  linknamen: z.boolean().default(true),
  weiterleiten: z.boolean().default(true),
  grenzen: z.boolean().default(true),
  aufrufe: z.boolean().default(true),
  ordnerName: z.string().trim().max(80).default(''),
  zielNutzer: z.number().int().positive().optional()
})

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const imp = await meinImport(event, u)
  if (imp.status === 'pausiert') {
    await q(`UPDATE importe SET status = 'laeuft' WHERE id = $1 AND status = 'pausiert'`, [imp.id])
    importAnstossen(imp.id)
    return { ok: true }
  }
  if (imp.status !== 'bereit')
    throw fehler(409, 'Dieser Import ist nicht bereit zum Starten.', 'This import is not ready to start.')
  const p = Optionen.safeParse((await readBody(event))?.optionen || {})
  if (!p.success) throw fehler(400, 'Bitte prüfe die Optionen.', 'Please check the options.')
  const o = p.data
  if (u.role === 'user') {
    o.konten = false
    o.zielNutzer = u.id
  }
  const ziel = o.zielNutzer || u.id
  if (!(await q1('SELECT 1 FROM users WHERE id = $1', [ziel])))
    throw fehler(400, 'Das Ziel-Konto gibt es nicht.', 'The target account does not exist.')
  const r = await q(
    `UPDATE importe SET status = 'laeuft', optionen = $2::jsonb, gestartet_at = now() WHERE id = $1 AND status = 'bereit' RETURNING id`,
    [imp.id, JSON.stringify({ ...o, zielNutzer: ziel })]
  )
  if (!r.length) throw fehler(409, 'Dieser Import wurde schon gestartet.', 'This import has already been started.')
  await ereignis('import_start', u.id, { quelle: imp.quelle, dateien: imp.gesamt }, clientIp(event))
  importAnstossen(imp.id)
  return { ok: true }
})
