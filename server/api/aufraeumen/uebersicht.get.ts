import { q, q1 } from '../../utils/db'
import { limit, requireUser } from '../../utils/auth'
import { eingabe } from '../../utils/cloudListe'
import { quotaStand } from '../../utils/quota'
import { aufBereichLaden, aufDuplikatSumme, AUF_KATEGORIE_SQL, AUF_KATEGORIEN, AufTageFrage, aufNaechster } from '../../utils/aufraeumen'

/**
 * Übersicht: belegt gesamt (Dateien + Papierkorb wie utils/quota.ts), Verteilung nach Art (nur eigene Dateien, so wie die Belegung zählt),
 * Zusammenfassung der Duplikate und der lange nicht genutzten Dateien (je nach Team-Filter auch Team-Dateien).
 */
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (limit('aufraeumen:' + u.id, 90, 60)) throw fehler(429, 'Zu viele Anfragen — bitte kurz warten.', 'Too many requests — please wait a moment.')
  const f = eingabe(AufTageFrage, getQuery(event))
  const b = await aufBereichLaden(u, f.team === '1')

  const [stand, art, dup, alt, korb] = await Promise.all([
    quotaStand(u),
    q<{ k: string; n: string; s: string }>(
      `SELECT ${AUF_KATEGORIE_SQL} AS k, count(*) AS n, coalesce(sum(f.size), 0) AS s FROM files f WHERE f.user_id = $1 GROUP BY 1`,
      [u.id]
    ),
    aufDuplikatSumme(b),
    q1<{ n: string; s: string }>(
      `SELECT count(*) AS n, coalesce(sum(f.size), 0) AS s FROM files f WHERE ${b.sichtbar}
      AND GREATEST(f.last_view_at, f.geaendert_at, f.created_at) < now() - ($${aufNaechster(b)}::int * interval '1 day')`,
      [...b.params, f.tage]
    ),
    q1<{ n: string }>('SELECT count(*) AS n FROM papierkorb WHERE user_id = $1', [u.id])
  ])
  const proArt = Object.fromEntries(AUF_KATEGORIEN.map((k) => [k, { anzahl: 0, bytes: 0 }])) as Record<string, { anzahl: number; bytes: number }>
  for (const r of art) proArt[r.k] = { anzahl: Number(r.n), bytes: Number(r.s) }
  return {
    belegt: { gesamt: stand.used, dateien: stand.used - stand.papierkorb, papierkorb: stand.papierkorb, papierkorbAnzahl: Number(korb?.n || 0) },
    kontingent: { limit: stand.limit, frei: stand.free, prozent: stand.prozent, stufe: stand.stufe },
    dateien: Object.values(proArt).reduce((a, x) => a + x.anzahl, 0),
    proArt,
    duplikate: dup,
    alt: { tage: f.tage, anzahl: Number(alt?.n || 0), bytes: Number(alt?.s || 0) },
    teams: b.teamNamen.size
  }
})
