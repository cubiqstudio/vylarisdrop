import { q, q1, ereignis } from '../../../utils/db'
import { clientIp, limit, requireAdmin } from '../../../utils/auth'
import { ablageRegelnLaden, ablageVerwerfen, positionenNeu, regelPruefen, RegelAenderung, RegelEingabe, MAX_REGELN } from '../../../utils/ablageRegeln'

// Ablage-Regel ändern (auch Ein-/Ausschalten oder `position` = neue Stelle in der Reihenfolge, 1 = ganz oben)
export default defineEventHandler(async (event) => {
  const u = await requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(id) || id <= 0) throw fehler(404, 'Regel nicht gefunden.', 'Rule not found.')
  if (limit('ablage:' + u.id, 150, 60)) throw fehler(429, 'Zu viele Änderungen — bitte kurz warten.', 'Too many changes — please wait a moment.')
  const p = RegelAenderung.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Bitte prüfe die Angaben der Regel.', 'Please check the rule’s fields.')
  const alt = (await ablageRegelnLaden(true)).find((r) => r.id === id)
  if (!alt) throw fehler(404, 'Regel nicht gefunden.', 'Rule not found.')
  const { position, ...b } = p.data
  // zusammenführen und als Ganzes neu prüfen; nur bei geänderten Zielen/Aktion müssen die Boxen noch existieren
  const v = RegelEingabe.safeParse({
    name: b.name ?? alt.name,
    aktiv: b.aktiv ?? alt.aktiv,
    bedingung: b.bedingung ?? alt.bedingung,
    aktion: b.aktion ?? alt.aktion,
    ziele: b.ziele ?? alt.ziele,
    strategie: b.strategie ?? alt.strategie,
    fallback: b.fallback ?? alt.fallback,
    meldung: b.meldung ?? alt.meldung
  })
  if (!v.success) throw fehler(400, 'Bitte prüfe die Angaben der Regel.', 'Please check the rule’s fields.')
  const neu = v.data
  const g = await regelPruefen(neu, { zieleExistieren: b.ziele !== undefined || b.aktion !== undefined })
  await q(
    `UPDATE ablage_regeln SET name = $2, aktiv = $3, bedingung = $4::jsonb, aktion = $5, ziele = $6::text[], strategie = $7, fallback = $8, meldung = $9, geaendert_at = now() WHERE id = $1`,
    [id, neu.name, neu.aktiv, JSON.stringify(g.bedingung), neu.aktion, g.ziele, neu.strategie, neu.fallback, g.meldung]
  )
  if (position != null) {
    const n = Math.min(position, MAX_REGELN)
    await positionenNeu()
    const liste = (await q<{ id: number }>('SELECT id FROM ablage_regeln ORDER BY position, id')).map((r) => r.id).filter((x) => x !== id)
    liste.splice(Math.min(n - 1, liste.length), 0, id)
    await q('UPDATE ablage_regeln a SET position = x.pos FROM (SELECT unnest($1::int[]) AS id, generate_series(1, $2::int) AS pos) x WHERE a.id = x.id', [liste, liste.length])
  }
  await ablageVerwerfen()
  const felder = Object.keys(b)
  if (position != null) felder.push('position')
  await ereignis('ablage_regel_geaendert', u.id, { id, name: neu.name.slice(0, 60), felder, aktiv: neu.aktiv }, clientIp(event))
  return { ok: true, regel: await q1('SELECT id, position, aktiv FROM ablage_regeln WHERE id = $1', [id]) }
})
