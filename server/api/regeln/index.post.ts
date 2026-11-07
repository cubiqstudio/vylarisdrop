import { z } from 'zod'
import { q, q1, ereignis } from '../../utils/db'
import { clientIp, requireUser } from '../../utils/auth'
import { archivMoeglich, bedingungNorm } from '../../utils/regeln'
import { ordnerRecht } from '../../utils/teams'

const Body = z.object({
  name: z.string().trim().max(80).default(''),
  aktiv: z.boolean().default(true),
  geltung: z.enum(['eigen', 'alle']).default('eigen'),
  bedingung: z.record(z.string(), z.any()),
  aktion: z.enum(['papierkorb', 'loeschen', 'archiv']),
  favoriten_schonen: z.boolean().default(true)
})
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Ungültige Regel.', 'Invalid rule.')
  const b = p.data
  if (b.geltung === 'alle' && u.role === 'user')
    throw fehler(
      403,
      'Regeln für alle Konten dürfen nur Admins anlegen.',
      'Only admins may create rules for all accounts.'
    )
  if (b.aktion === 'archiv' && !(await archivMoeglich()))
    throw fehler(
      400,
      'Auslagern braucht einen eingerichteten S3-Speicher (Pro).',
      'Archiving needs configured S3 storage (Pro).'
    )
  const bed = bedingungNorm(b.bedingung)
  if (bed.ordner_id && b.geltung === 'eigen' && !(await ordnerRecht(u.id, bed.ordner_id)))
    throw fehler(404, 'Ordner nicht gefunden.', 'Folder not found.')
  const n = await q1<{ n: string }>('SELECT count(*) AS n FROM regeln WHERE von = $1', [u.id])
  if (Number(n?.n || 0) >= 20) throw fehler(400, 'Höchstens 20 Regeln.', 'At most 20 rules.')
  const r = await q(
    `INSERT INTO regeln (user_id, von, name, aktiv, geltung, bedingung, aktion, favoriten_schonen) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING id`,
    [
      b.geltung === 'alle' ? null : u.id,
      u.id,
      b.name,
      b.aktiv,
      b.geltung,
      JSON.stringify(bed),
      b.aktion,
      b.favoriten_schonen
    ]
  )
  await ereignis('regel_angelegt', u.id, { name: b.name.slice(0, 60), aktion: b.aktion }, clientIp(event))
  return { ok: true, id: r[0].id }
})
