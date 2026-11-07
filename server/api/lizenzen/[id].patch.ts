import { z } from 'zod'
import { q, q1, ereignis } from '../../utils/db'
import { clientIp, requireOwner } from '../../utils/auth'
import { FUNKTIONEN } from '../../utils/lizenz'

const Body = z.object({
  gesperrt: z.boolean().optional(),
  notiz: z.string().trim().max(120).optional(),
  maxGeraete: z.number().int().min(1).max(1000).optional(),
  tage: z.number().int().min(1).max(36500).nullable().optional(),
  verlaengernTage: z.number().int().min(1).max(36500).optional(),
  features: z.array(z.enum(FUNKTIONEN as [string, ...string[]])).max(20).optional(),
  geraeteZuruecksetzen: z.boolean().optional()
})

export default defineEventHandler(async (event) => {
  const u = await requireOwner(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id < 1 || id > 2_000_000_000) throw fehler(400, 'Ungültige ID.', 'Invalid ID.')
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Ungültige Angaben.', 'Invalid values.')
  const b = p.data
  if (!(await q1('SELECT 1 FROM lizenz_schluessel WHERE id = $1', [id])))
    throw fehler(404, 'Schlüssel nicht gefunden.', 'Key not found.')
  const set: string[] = []
  const w: unknown[] = [id]
  const neu = (sp: string, v: unknown, typ = '') => {
    w.push(v)
    set.push(`${sp} = $${w.length}${typ}`)
  }
  if (b.gesperrt !== undefined) neu('gesperrt', b.gesperrt)
  if (b.notiz !== undefined) neu('notiz', b.notiz)
  if (b.maxGeraete !== undefined) neu('max_geraete', b.maxGeraete)
  if (b.features !== undefined) neu('features', b.features, '::text[]')
  if (b.tage !== undefined) neu('laufzeit_tage', b.tage)
  else if (b.verlaengernTage !== undefined) {
    w.push(b.verlaengernTage)
    set.push(`laufzeit_tage = CASE WHEN laufzeit_tage IS NULL THEN NULL ELSE laufzeit_tage + $${w.length}::int END`)
  }
  if (set.length) await q(`UPDATE lizenz_schluessel SET ${set.join(', ')} WHERE id = $1`, w)
  if (b.geraeteZuruecksetzen) await q('DELETE FROM lizenz_geraete WHERE key_id = $1', [id])
  await ereignis('lizenz_geaendert', u.id, { id }, clientIp(event))
  return { ok: true }
})
