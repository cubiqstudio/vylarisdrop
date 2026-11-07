import { z } from 'zod'
import { q } from '../../utils/db'
import { limit, requireUser } from '../../utils/auth'
import { eingabe } from '../../utils/cloudListe'
import { loeschenAuswahl } from '../../utils/cloudAktionen'
import { mitNamenssperre } from '../../utils/dateiNamen'
import { quotaStand } from '../../utils/quota'
import { aufBereichLaden, aufNaechster } from '../../utils/aufraeumen'

const Body = z.object({
  dateien: z
    .array(z.string().regex(/^\d{1,18}$/))
    .min(1)
    .max(5000),
  /** duplikate: es muss mindestens eine gleiche Kopie stehen bleiben; frei: beliebige Dateien (große, lange nicht genutzte) */
  modus: z.enum(['duplikate', 'frei']).default('frei')
})

/**
 * Markierte Dateien in den Papierkorb legen (kein hartes Löschen). Die Berechtigungen prüft die Löschlogik des Dateimanagers
 * (loeschenAuswahl: eigene Dateien, Team-Dateien nur als Leitung; sonst wird nichts gelöscht und 404 gemeldet).
 * Im Modus "duplikate" wird zusätzlich serverseitig geprüft, dass je Gruppe mindestens eine für das Konto sichtbare Kopie bleibt.
 */
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (limit('aufraeumen-loeschen:' + u.id, 30, 60)) throw fehler(429, 'Zu viele Aktionen — bitte kurz warten.', 'Too many actions — please wait a moment.')
  const b = eingabe(Body, await readBody(event))
  const ids = [...new Set(b.dateien)]
  return mitNamenssperre('aufraeumen:' + u.id, async () => {
    const uebersprungen: Array<{ id: string; grund: 'letzte-kopie' | 'kein-duplikat' }> = []
    let frei = ids
    if (b.modus === 'duplikate') {
      const bereich = await aufBereichLaden(u, true)
      const gew = await q<{ id: string; sha256: string; size: string }>(
        'SELECT id::text AS id, sha256, size::text AS size FROM files WHERE id = ANY($1::bigint[])',
        [ids]
      )
      const schluessel = (s: string, z: string | number) => `${s}|${z}`
      const echte = gew.filter((g) => g.sha256 && Number(g.size) > 0)
      const uniq = new Map(echte.map((g) => [schluessel(g.sha256, g.size), g]))
      const n = aufNaechster(bereich)
      const rest = uniq.size
        ? await q<{ sha256: string; size: string; rest: string }>(
            `SELECT f.sha256, f.size::text AS size, count(*) AS rest FROM files f
            WHERE ${bereich.sichtbar} AND f.sha256 <> '' AND f.size > 0 AND (f.sha256, f.size) IN (SELECT s, z FROM unnest($${n}::text[], $${n + 1}::bigint[]) AS k(s, z))
              AND NOT (f.id = ANY($${n + 2}::bigint[])) GROUP BY f.sha256, f.size`,
            [...bereich.params, [...uniq.values()].map((g) => g.sha256), [...uniq.values()].map((g) => g.size), ids]
          )
        : []
      const uebrig = new Map(rest.map((r) => [schluessel(r.sha256, r.size), Number(r.rest)]))
      const zulassen = new Set<string>()
      for (const g of gew) {
        if (!g.sha256 || Number(g.size) <= 0) uebersprungen.push({ id: g.id, grund: 'kein-duplikat' })
        else if (!(uebrig.get(schluessel(g.sha256, g.size)) || 0)) uebersprungen.push({ id: g.id, grund: 'letzte-kopie' })
        else zulassen.add(g.id)
      }
      // Nicht mehr vorhandene IDs übergibt die Löschlogik einfach nicht weiter; vorhandene, aber nicht zugelassene bleiben stehen
      const vorhanden = new Set(gew.map((g) => g.id))
      frei = ids.filter((id) => zulassen.has(id) || !vorhanden.has(id))
    }
    // Größen vor dem Löschen (für die Gewinnanzeige)
    const vorher = frei.length ? await q<{ s: string }>('SELECT coalesce(sum(size), 0) AS s FROM files WHERE id = ANY($1::bigint[])', [frei]) : []
    let r = { ok: true, dateien: 0, ordner: 0, papierkorb: [] as Array<{ id: string; name: string }> }
    if (frei.length) r = await loeschenAuswahl(u, { dateien: frei, ordner: [] }, event)
    const bytes = r.papierkorb.length
      ? Number(
          (await q<{ s: string }>(`SELECT coalesce(sum((datei->>'size')::bigint), 0) AS s FROM papierkorb WHERE id = ANY($1::bigint[])`, [r.papierkorb.map((p) => p.id)]))[0]?.s || 0
        )
      : 0
    const stand = await quotaStand(u)
    return {
      ok: true,
      geloescht: r.dateien,
      bytes,
      angefragtBytes: Number(vorher[0]?.s || 0),
      uebersprungen,
      papierkorb: r.papierkorb,
      belegt: { gesamt: stand.used, dateien: stand.used - stand.papierkorb, papierkorb: stand.papierkorb }
    }
  })
})
