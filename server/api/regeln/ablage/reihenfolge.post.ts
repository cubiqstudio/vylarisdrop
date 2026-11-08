import { z } from 'zod'
import { q, ereignis } from '../../../utils/db'
import { clientIp, limit, requireAdmin } from '../../../utils/auth'
import { ablageRegelnLaden, ablageVerwerfen, MAX_REGELN } from '../../../utils/ablageRegeln'

const Body = z.object({ ids: z.array(z.number().int().positive()).min(1).max(MAX_REGELN) })

// Neue Reihenfolge aller Regeln: `ids` muss jede vorhandene Regel genau einmal enthalten (erste = wichtigste)
export default defineEventHandler(async (event) => {
  const u = await requireAdmin(event)
  if (limit('ablage:' + u.id, 150, 60)) throw fehler(429, 'Zu viele Änderungen — bitte kurz warten.', 'Too many changes — please wait a moment.')
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Ungültige Reihenfolge.', 'Invalid order.')
  const vorhanden = (await ablageRegelnLaden(true)).map((r) => r.id).sort((a, b) => a - b)
  const neu = [...p.data.ids].sort((a, b) => a - b)
  if (vorhanden.length !== neu.length || vorhanden.some((x, i) => x !== neu[i]))
    throw fehler(
      409,
      'Die Liste hat sich inzwischen geändert. Bitte neu laden.',
      'The list has changed in the meantime. Please reload.'
    )
  await q(
    'UPDATE ablage_regeln a SET position = x.pos, geaendert_at = now() FROM (SELECT unnest($1::int[]) AS id, generate_series(1, $2::int) AS pos) x WHERE a.id = x.id',
    [p.data.ids, p.data.ids.length]
  )
  await ablageVerwerfen()
  await ereignis('ablage_reihenfolge', u.id, { anzahl: p.data.ids.length }, clientIp(event))
  return { ok: true }
})
