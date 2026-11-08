import { q1, ereignis } from '../../../utils/db'
import { clientIp, limit, requireAdmin } from '../../../utils/auth'
import { ablageVerwerfen, MAX_REGELN, regelPruefen, RegelEingabe } from '../../../utils/ablageRegeln'

// Neue Ablage-Regel am Ende der Liste anlegen (nur Admin/Inhaber)
export default defineEventHandler(async (event) => {
  const u = await requireAdmin(event)
  if (limit('ablage:' + u.id, 150, 60)) throw fehler(429, 'Zu viele Änderungen — bitte kurz warten.', 'Too many changes — please wait a moment.')
  const p = RegelEingabe.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Bitte prüfe die Angaben der Regel.', 'Please check the rule’s fields.')
  const d = p.data
  const g = await regelPruefen(d)
  const r = await q1<{ id: number }>(
    `INSERT INTO ablage_regeln (position, name, aktiv, bedingung, aktion, ziele, strategie, fallback, meldung, created_by)
     SELECT coalesce(max(position), 0) + 1, $1, $2, $3::jsonb, $4, $5::text[], $6, $7, $8, $9 FROM ablage_regeln
      HAVING count(*) < $10 RETURNING id`,
    [d.name, d.aktiv, JSON.stringify(g.bedingung), d.aktion, g.ziele, d.strategie, d.fallback, g.meldung, u.id, MAX_REGELN]
  )
  if (!r) throw fehler(400, `Höchstens ${MAX_REGELN} Regeln.`, `At most ${MAX_REGELN} rules.`)
  await ablageVerwerfen()
  await ereignis('ablage_regel_angelegt', u.id, { id: r.id, name: d.name.slice(0, 60), aktion: d.aktion, ziele: g.ziele }, clientIp(event))
  return { ok: true, id: r.id }
})
