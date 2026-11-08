import { z } from 'zod'
import type { PoolClient } from 'pg'
import { q } from '../../utils/db'
import { limit, requireUser } from '../../utils/auth'
import { eingabe } from '../../utils/cloudListe'
import { loeschenAuswahl } from '../../utils/cloudAktionen'
import { mitNamenssperre } from '../../utils/dateiNamen'
import { quotaStand } from '../../utils/quota'
import type { DateiZeile } from '../../utils/dateien'
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
 * Im Modus "duplikate" wird zusätzlich serverseitig geprüft, dass je Gruppe mindestens eine für das Konto sichtbare, nicht ablaufende Kopie bleibt
 * (vorab für die Meldung und noch einmal beim Löschen unter einer Datenbanksperre auf der Gruppe, damit gleichzeitige Löschungen nicht beide durchgehen).
 */
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (limit('aufraeumen-loeschen:' + u.id, 30, 60)) throw fehler(429, 'Zu viele Aktionen — bitte kurz warten.', 'Too many actions — please wait a moment.')
  const b = eingabe(Body, await readBody(event))
  const ids = [...new Set(b.dateien)]
  return mitNamenssperre('aufraeumen:' + u.id, async () => {
    const uebersprungen: Array<{ id: string; grund: 'letzte-kopie' | 'kein-duplikat' }> = []
    let frei = ids
    // Kopien, die erst beim eigentlichen Löschen (unter der Gruppensperre) als letzte Kopie erkannt wurden
    const verweigert = new Set<string>()
    let bedingung: ((z: DateiZeile, c: PoolClient) => Promise<boolean>) | undefined
    if (b.modus === 'duplikate') {
      const bereich = await aufBereichLaden(u, true)
      // Nur für das Konto sichtbare Dateien: fremde IDs verhalten sich wie nicht vorhandene (kein Hinweis auf Inhalt oder Existenz)
      const n0 = aufNaechster(bereich)
      const gew = await q<{ id: string; sha256: string; size: string; dauer: boolean }>(
        `SELECT f.id::text AS id, f.sha256, f.size::text AS size, (f.expires_at IS NULL AND f.max_views IS NULL) AS dauer FROM files f
        WHERE ${bereich.sichtbar} AND f.id = ANY($${n0}::bigint[])`,
        [...bereich.params, ids]
      )
      const schluessel = (s: string, z: string | number) => `${s}|${z}`
      const echte = gew.filter((g) => g.sha256 && Number(g.size) > 0)
      const uniq = new Map(echte.map((g) => [schluessel(g.sha256, g.size), g]))
      const n = aufNaechster(bereich)
      // Als bleibende Kopie zählt nur, was nicht schon abgelaufen oder aufgebraucht ist (das räumt der Server von selbst hart ab);
      // eine dauerhafte Datei darf nur gehen, wenn eine andere dauerhafte Kopie bleibt (Kopien mit Ablauf oder Aufruf-Limit zählen dafür nicht)
      const rest = uniq.size
        ? await q<{ sha256: string; size: string; rest: string; dauer: string }>(
            `SELECT f.sha256, f.size::text AS size, count(*) AS rest, count(*) FILTER (WHERE f.expires_at IS NULL AND f.max_views IS NULL) AS dauer FROM files f
            WHERE ${bereich.sichtbar} AND f.sha256 <> '' AND f.size > 0 AND (f.sha256, f.size) IN (SELECT s, z FROM unnest($${n}::text[], $${n + 1}::bigint[]) AS k(s, z))
              AND (f.expires_at IS NULL OR f.expires_at > now()) AND (f.max_views IS NULL OR f.views < f.max_views)
              AND NOT (f.id = ANY($${n + 2}::bigint[])) GROUP BY f.sha256, f.size`,
            [...bereich.params, [...uniq.values()].map((g) => g.sha256), [...uniq.values()].map((g) => g.size), ids]
          )
        : []
      const uebrig = new Map(rest.map((r) => [schluessel(r.sha256, r.size), r]))
      const zulassen = new Set<string>()
      for (const g of gew) {
        const r = uebrig.get(schluessel(g.sha256, g.size))
        if (!g.sha256 || Number(g.size) <= 0) uebersprungen.push({ id: g.id, grund: 'kein-duplikat' })
        else if (!Number(g.dauer ? r?.dauer : r?.rest) || 0) uebersprungen.push({ id: g.id, grund: 'letzte-kopie' })
        else zulassen.add(g.id)
      }
      // Nicht zugelassene, nicht sichtbare und nicht vorhandene IDs gehen nicht an die Löschlogik
      frei = ids.filter((id) => zulassen.has(id))
      // Dieselbe Prüfung noch einmal im Löschvorgang unter der Gruppensperre: dort ist der Stand gleichzeitiger Löschungen sichtbar
      bedingung = async (z, c) => {
        const dauer = z.expires_at == null && z.max_views == null
        const m = bereich.params.length + 1
        const r = await c.query(
          `SELECT 1 FROM files f WHERE ${bereich.sichtbar} AND f.sha256 = $${m} AND f.size = $${m + 1} AND f.id <> $${m + 2}
            AND (f.expires_at IS NULL OR f.expires_at > now()) AND (f.max_views IS NULL OR f.views < f.max_views)
            AND (NOT $${m + 3}::boolean OR (f.expires_at IS NULL AND f.max_views IS NULL)) LIMIT 1`,
          [...bereich.params, z.sha256, z.size, z.id, dauer]
        )
        if (r.rowCount) return true
        verweigert.add(String(z.id))
        return false
      }
    }
    // Größen vor dem Löschen (für die Gewinnanzeige)
    const vorher = frei.length ? await q<{ s: string }>('SELECT coalesce(sum(size), 0) AS s FROM files WHERE id = ANY($1::bigint[])', [frei]) : []
    let r = { ok: true, dateien: 0, ordner: 0, papierkorb: [] as Array<{ id: string; name: string }> }
    if (frei.length) r = await loeschenAuswahl(u, { dateien: frei, ordner: [] }, event, bedingung)
    for (const id of verweigert) uebersprungen.push({ id, grund: 'letzte-kopie' })
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
