import { z } from 'zod'
import { q, q1, ereignis } from '../../../utils/db'
import { clientIp, limit, requireUser } from '../../../utils/auth'
import { neuesAppPasswort } from '../../../utils/davKern'

const Body = z.object({
  name: z.string().trim().min(1).max(60),
  schreiben: z.boolean().default(true)
})

// Neues App-Passwort fuer WebDAV-Clients. Der Klartext wird nur hier einmal geliefert, gespeichert wird nur der Hash.
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (limit('dav-zugang:' + u.id, 30, 3600))
    throw fehler(429, 'Zu viele neue Zugänge in kurzer Zeit.', 'Too many new access entries in a short time.')
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Bitte gib einen Namen an (höchstens 60 Zeichen).', 'Please enter a name (at most 60 characters).')
  const n = await q1<{ n: string }>('SELECT count(*) AS n FROM dav_zugaenge WHERE user_id = $1', [u.id])
  if (Number(n?.n || 0) >= 25)
    throw fehler(400, 'Höchstens 25 App-Passwörter pro Konto.', 'At most 25 app passwords per account.')
  const t = neuesAppPasswort()
  const r = await q(
    'INSERT INTO dav_zugaenge (user_id, name, prefix, key_hash, schreiben) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, prefix, schreiben, created_at, last_used_at',
    [u.id, p.data.name, t.prefix, t.hash, p.data.schreiben]
  )
  await ereignis('dav_zugang_neu', u.id, { name: p.data.name, schreiben: p.data.schreiben }, clientIp(event))
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { ok: true, zugang: r[0], klar: t.klar }
})
