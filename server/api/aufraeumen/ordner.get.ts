import { q } from '../../utils/db'
import { limit, requireUser } from '../../utils/auth'
import { eingabe } from '../../utils/cloudListe'
import { aufBereichLaden, aufPfadVon, AufTeamFrage } from '../../utils/aufraeumen'

/**
 * Die größten Ordner (rekursiv: Ordner samt Unterordnern). Die Summen je Ordner kommen in einer Abfrage aus der Datenbank,
 * das Aufsummieren nach oben macht der Server im Speicher (ein Durchlauf über den Ordnerbaum statt einer Rekursion je Ordner).
 */
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (limit('aufraeumen:' + u.id, 90, 60)) throw fehler(429, 'Zu viele Anfragen — bitte kurz warten.', 'Too many requests — please wait a moment.')
  const f = eingabe(AufTeamFrage, getQuery(event))
  const b = await aufBereichLaden(u, f.team === '1')
  const direkt = await q<{ folder_id: number | null; n: string; s: string }>(
    `SELECT f.folder_id, count(*) AS n, coalesce(sum(f.size), 0) AS s FROM files f WHERE ${b.sichtbar} GROUP BY f.folder_id`,
    b.params
  )
  const summe = new Map<number, { bytes: number; dateien: number }>()
  let ohneOrdner = { bytes: 0, dateien: 0 }
  for (const d of direkt) {
    const bytes = Number(d.s),
      dateien = Number(d.n)
    if (d.folder_id == null || !b.ordner.has(d.folder_id)) {
      ohneOrdner = { bytes: ohneOrdner.bytes + bytes, dateien: ohneOrdner.dateien + dateien }
      continue
    }
    let id: number | null = d.folder_id
    for (let i = 0; i < 100 && id != null; i++) {
      const s = summe.get(id) || { bytes: 0, dateien: 0 }
      s.bytes += bytes
      s.dateien += dateien
      summe.set(id, s)
      id = b.ordner.get(id)?.parent_id ?? null
    }
  }
  const cache = new Map<number, { pfad: string; geteilt: boolean }>()
  const ordner = [...summe.entries()]
    .filter(([, s]) => s.bytes > 0)
    .sort((x, y) => y[1].bytes - x[1].bytes || x[0] - y[0])
    .slice(0, 30)
    .map(([id, s]) => {
      const o = b.ordner.get(id)!
      const p = aufPfadVon(b, id, cache)
      const team = o.team_id != null ? b.teamNamen.get(o.team_id) : undefined
      return {
        id,
        name: o.name,
        pfad: p.pfad,
        bytes: s.bytes,
        dateien: s.dateien,
        galerie: p.geteilt,
        team: o.team_id != null && team ? { id: o.team_id, ...team } : null
      }
    })
  return { ordner, ohneOrdner }
})
