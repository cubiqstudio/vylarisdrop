import { q } from '../../utils/db'
import { limit, requireUser } from '../../utils/auth'
import { eingabe } from '../../utils/cloudListe'
import { aufBereichLaden, aufDuplikatSeite, aufEintraege, aufNaechster, AUF_SPALTEN, AufDuplikatFrage, type AufDateiEintrag, type AufDateiZeile } from '../../utils/aufraeumen'

const MAX_KOPIEN = 60

/**
 * Duplikate: Dateien mit gleichem sha256 UND gleicher Größe (leerer sha256 und leere Dateien zählen nicht), in Gruppen,
 * größte Ersparnis zuerst. Je Gruppe die Kopien (höchstens 60) mit Ordnerpfad, Datum und Freigabe-Kennzeichen sowie eine Empfehlung:
 *   behalten = die Kopie, die bleiben soll (nicht löschbare zuerst, dann Kopien ohne Ablauf und Aufruf-Limit, dann geteilte, dann in einem Ordner, dann die älteste)
 *   geschuetzt = geteilt (Link wurde aufgerufen, Passwort, Ablauf, Galerie): wird nie automatisch zum Löschen vorgeschlagen
 *   fremd = darf das Konto nicht löschen (Team-Datei eines anderen Mitglieds)
 *   loeschen = überzählige, ungeteilte Kopie
 */
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (limit('aufraeumen:' + u.id, 90, 60)) throw fehler(429, 'Zu viele Anfragen — bitte kurz warten.', 'Too many requests — please wait a moment.')
  const f = eingabe(AufDuplikatFrage, getQuery(event))
  const b = await aufBereichLaden(u, f.team === '1')
  const { summe, gruppen } = await aufDuplikatSeite(b, f.pro, (f.seite - 1) * f.pro)
  if (!gruppen.length) return { summe, seite: f.seite, pro: f.pro, gruppen: [] }
  const m = aufNaechster(b)
  const zeilen = await q<AufDateiZeile & { k: number }>(
    `SELECT ${AUF_SPALTEN}, k.i AS k FROM unnest($${m}::text[], $${m + 1}::bigint[]) WITH ORDINALITY AS k(s, z, i)
    CROSS JOIN LATERAL (SELECT * FROM files f WHERE f.sha256 <> '' AND f.size > 0 AND f.sha256 = k.s AND f.size = k.z AND ${b.sichtbar} ORDER BY f.created_at, f.id LIMIT ${MAX_KOPIEN}) f`,
    [...b.params, gruppen.map((g) => g.sha256), gruppen.map((g) => g.size)]
  )
  const alle = await aufEintraege(b, zeilen)
  const nachGruppe = new Map<number, AufDateiEintrag[]>()
  zeilen.forEach((z, i) => {
    const l = nachGruppe.get(Number(z.k)) || []
    l.push(alle[i]!)
    nachGruppe.set(Number(z.k), l)
  })
  const aus = gruppen.map((g, i) => {
    const kopien = nachGruppe.get(i + 1) || []
    // Rangfolge für die zu behaltende Kopie
    const rang = (d: AufDateiEintrag) => [d.darfLoeschen ? 1 : 0, d.geteilt.schutz ? 1 : 0, d.geteilt.irgendwie ? 0 : 1, d.ordnerId != null ? 0 : 1, new Date(d.erstellt).getTime()]
    const sortiert = [...kopien].sort((a, c) => {
      const x = rang(a),
        y = rang(c)
      for (let j = 0; j < x.length; j++) if (x[j] !== y[j]) return x[j]! - y[j]!
      return Number(a.id) - Number(c.id)
    })
    const behalten = sortiert[0]?.id
    const mitEmpfehlung = kopien.map((d) => ({
      ...d,
      empfehlung: d.id === behalten ? 'behalten' : !d.darfLoeschen ? 'fremd' : d.geteilt.irgendwie ? 'geschuetzt' : 'loeschen'
    }))
    const groesse = Number(g.size)
    const anzahl = Number(g.n)
    return {
      sha256: g.sha256,
      size: groesse,
      anzahl,
      ausgeblendet: Math.max(0, anzahl - kopien.length),
      ersparnis: groesse * (anzahl - 1),
      empfohleneErsparnis: groesse * mitEmpfehlung.filter((d) => d.empfehlung === 'loeschen').length,
      kopien: mitEmpfehlung
    }
  })
  return { summe, seite: f.seite, pro: f.pro, gruppen: aus }
})
