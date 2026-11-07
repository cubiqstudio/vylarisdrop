import { q, q1 } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { platte } from '../../utils/speicher'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const proArt = await q<{ art: string; n: string; s: string }>(
    'SELECT art, count(*) AS n, coalesce(sum(size),0) AS s FROM files WHERE user_id = $1 GROUP BY art',
    [u.id]
  )
  const ordner = await q1<{ n: string }>('SELECT count(*) AS n FROM folders WHERE user_id = $1', [u.id])
  const letzte = await q1<{ t: string }>('SELECT max(created_at) AS t FROM files WHERE user_id = $1', [u.id])
  const belegt = proArt.reduce((a, r) => a + Number(r.s), 0)
  const p = u.role === 'owner' ? await platte() : null
  return {
    dateien: proArt.reduce((a, r) => a + Number(r.n), 0),
    ordner: Number(ordner?.n || 0),
    zuletzt: letzte?.t || null,
    belegt,
    kontingent: u.quota_bytes != null ? Number(u.quota_bytes) : null,
    proArt: Object.fromEntries(proArt.map((r) => [r.art, { anzahl: Number(r.n), bytes: Number(r.s) }])),
    platte: p
  }
})
