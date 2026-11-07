import { q } from '../utils/db'
import { requireUser } from '../utils/auth'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const p = getQuery(event)
  const admin = u.role !== 'user'
  const seite = Math.max(1, Number(p.seite) || 1),
    pro = 60
  const wo: string[] = [],
    w: unknown[] = []
  const neu = (v: unknown) => {
    w.push(v)
    return `$${w.length}`
  }
  if (!admin) wo.push(`e.user_id = ${neu(u.id)}`)
  else if (Number(p.konto) > 0) wo.push(`e.user_id = ${neu(Number(p.konto))}`)
  if (/^[a-z0-9_]{2,40}$/.test(String(p.art || ''))) wo.push(`e.type = ${neu(String(p.art))}`)
  const suche = String(p.suche || '')
    .trim()
    .slice(0, 80)
  if (suche)
    wo.push(
      `(e.type ILIKE ${neu('%' + suche.replace(/[%_\\]/g, (m) => '\\' + m) + '%')} OR e.detail::text ILIKE $${w.length} OR e.ip = ${neu(suche)})`
    )
  const zeilen = await q<any>(
    `SELECT e.id, e.type, e.detail, e.ip, e.created_at, e.user_id, u.username, count(*) OVER () AS gesamt
    FROM events e LEFT JOIN users u ON u.id = e.user_id ${wo.length ? 'WHERE ' + wo.join(' AND ') : ''}
    ORDER BY e.created_at DESC, e.id DESC LIMIT ${pro} OFFSET ${(seite - 1) * pro}`,
    w
  )
  const arten = await q<{ type: string }>(
    `SELECT DISTINCT type FROM events ${admin ? '' : 'WHERE user_id = $1'} ORDER BY type`,
    admin ? [] : [u.id]
  )
  return {
    gesamt: Number(zeilen[0]?.gesamt || 0),
    seite,
    pro,
    arten: arten.map((a) => a.type),
    eintraege: zeilen.map((z) => ({
      id: z.id,
      art: z.type,
      detail: z.detail,
      ip: z.ip,
      zeit: z.created_at,
      konto: z.username || null,
      konto_id: z.user_id
    }))
  }
})
