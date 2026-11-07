import { z } from 'zod'
import { q, q1, ereignis } from '../../utils/db'
import { clientIp, hashPw, requireUser } from '../../utils/auth'
import { ordnerRecht, requireRecht } from '../../utils/teams'
import { ablaufAus } from '../../utils/dateien'
import { neuesAnfrageToken } from '../../utils/anfragen'

const Body = z.object({
  titel: z.string().trim().min(1).max(100),
  nachricht: z.string().max(1000).optional().default(''),
  ordner: z.number().int().positive().nullable().optional(),
  max_mb: z.number().min(0).max(1_000_000).nullable().optional(),
  max_dateien: z.number().int().min(1).max(100_000).nullable().optional(),
  ablauf: z.string().max(40).nullable().optional(),
  passwort: z.string().max(200).optional(),
  aufnahme: z.boolean().optional().default(true),
  aufnahme_min: z
    .union([z.literal(1), z.literal(5), z.literal(15), z.literal(30)])
    .optional()
    .default(5)
})

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  await requireRecht(u, 'anfragen')
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Bitte gib mindestens einen Titel ein.', 'Please enter at least a title.')
  const b = p.data
  const n = await q1<{ n: string }>('SELECT count(*) AS n FROM anfragen WHERE user_id = $1', [u.id])
  if (Number(n?.n || 0) >= 200)
    throw fehler(400, 'Höchstens 200 Anfragen pro Konto.', 'At most 200 requests per account.')
  let ordner = b.ordner ?? null
  if (ordner != null && !(await ordnerRecht(u.id, ordner))?.hineinladen)
    throw fehler(404, 'Ordner nicht gefunden.', 'Folder not found.')
  if (ordner == null)
    ordner = (await q1<{ id: number }>('INSERT INTO folders (user_id, name) VALUES ($1, $2) RETURNING id', [
      u.id,
      b.titel.slice(0, 80)
    ]))!.id
  const r = await q(
    `INSERT INTO anfragen (user_id, token, titel, nachricht, folder_id, max_bytes, max_dateien, laeuft_ab, password_hash, aufnahme, aufnahme_min)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [
      u.id,
      neuesAnfrageToken(),
      b.titel,
      b.nachricht,
      ordner,
      b.max_mb ? Math.round(b.max_mb * 1024 ** 2) : null,
      b.max_dateien ?? null,
      b.ablauf ? ablaufAus(b.ablauf) : null,
      b.passwort ? await hashPw(b.passwort) : '',
      b.aufnahme,
      b.aufnahme_min
    ]
  )
  await ereignis('anfrage_created', u.id, { titel: b.titel }, clientIp(event))
  return { ok: true, id: r[0].id }
})
