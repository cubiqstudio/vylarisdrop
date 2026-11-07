import { q } from './db'

// Namensraum eines Ordners: Dateien und Unterordner teilen sich pro Ordner die Namen (ohne Groß-/Kleinschreibung).
// Die Wurzel eines Nutzers (ordnerId = null) umfasst seine Dateien ohne Ordner und seine Ordner ohne Eltern, die nicht
// zu einem Team gehören.

export const MAX_DATEINAME = 200
export const MAX_ORDNERNAME = 80

export type NamensArt = 'datei' | 'ordner'

/** Säubert einen vom Nutzer eingegebenen Namen. Gibt '' zurück, wenn nichts Brauchbares übrig bleibt. */
export function namenSaeubern(roh: unknown, art: NamensArt): string {
  const max = art === 'ordner' ? MAX_ORDNERNAME : MAX_DATEINAME
  const n = String(roh ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f\\/]/g, '')
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .trim()
    .slice(0, max)
    .trim()
  if (n === '.' || n === '..') return ''
  return n
}

/** Trennt "name.ext" in Stamm und Endung (".tar.gz" bleibt zusammen, ".gitignore" hat keine Endung). */
export function stammUndEndung(name: string, art: NamensArt): { stamm: string; ende: string } {
  if (art === 'ordner') return { stamm: name, ende: '' }
  const m = /^(.+?)((?:\.tar)?\.[A-Za-z0-9]{1,10})$/.exec(name)
  if (!m || !m[1]) return { stamm: name, ende: '' }
  return { stamm: m[1], ende: m[2]! }
}

interface Abfrager {
  query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>
}
const standard: Abfrager = { query: async (sql, params) => ({ rows: await q(sql, params || []) }) }

const like = (s: string) => s.replace(/[%_\\]/g, (m) => '\\' + m)

/** Wählt aus einer Menge belegter Namen (klein geschrieben) den nächsten freien: "name", "name (2).ext", … */
export function freierName(name: string, art: NamensArt, belegt: Set<string>): string {
  const max = art === 'ordner' ? MAX_ORDNERNAME : MAX_DATEINAME
  if (!belegt.has(name.toLowerCase())) return name
  const { stamm, ende } = stammUndEndung(name, art)
  for (let i = 2; i < 100_000; i++) {
    const zusatz = ` (${i})`
    const rest = Math.max(1, max - zusatz.length - ende.length)
    const kandidat = stamm.slice(0, rest).replace(/[ .]+$/, '') + zusatz + ende
    if (!belegt.has(kandidat.toLowerCase())) return kandidat
  }
  return name.slice(0, max - 12) + ' ' + Date.now().toString(36) + ende
}

export interface NamensWunsch {
  ordnerId: number | null
  userId: number
  /** Nur für Ordner auf oberster Ebene eines Teams (ordnerId = null): der Namensraum ist dann das Team. */
  teamId?: number | null
  name: string
  art: NamensArt
  /** Element, das gerade benannt wird und beim Vergleich nicht mitzählt (Datei-ID oder Ordner-ID). */
  ausser?: string | number | null
}

/** Liefert den Namen, falls frei, sonst "name (2).ext", "name (3).ext" … */
export async function eindeutigerName(w: NamensWunsch, db: Abfrager = standard): Promise<string> {
  const name = namenSaeubern(w.name, w.art) || (w.art === 'ordner' ? 'Neuer Ordner' : 'datei')
  const { stamm } = stammUndEndung(name, w.art)
  // Nur Namen holen, die mit dem Stamm beginnen (reicht für alle Kandidaten "stamm (n).ende")
  const muster = like(stamm.toLowerCase()) + '%'
  const ausDatei = w.art === 'datei' && w.ausser != null ? String(w.ausser) : null
  const ausOrdner = w.art === 'ordner' && w.ausser != null ? Number(w.ausser) : null
  const teamWurzel = w.ordnerId == null && !!w.teamId
  const dateien = teamWurzel
    ? { rows: [] as any[] }
    : await db.query(
    w.ordnerId == null
      ? `SELECT lower(name) AS n FROM files WHERE user_id = $1 AND folder_id IS NULL AND lower(name) LIKE $2 AND ($3::bigint IS NULL OR id <> $3)`
      : `SELECT lower(name) AS n FROM files WHERE folder_id = $4 AND lower(name) LIKE $2 AND ($3::bigint IS NULL OR id <> $3) AND $1::int > 0`,
    w.ordnerId == null ? [w.userId, muster, ausDatei] : [w.userId, muster, ausDatei, w.ordnerId]
  )
  const ordner = await db.query(
    teamWurzel
      ? `SELECT lower(name) AS n FROM folders WHERE parent_id IS NULL AND team_id = $4 AND lower(name) LIKE $2 AND ($3::int IS NULL OR id <> $3) AND $1::int > 0`
      : w.ordnerId == null
      ? `SELECT lower(name) AS n FROM folders WHERE user_id = $1 AND parent_id IS NULL AND team_id IS NULL AND lower(name) LIKE $2 AND ($3::int IS NULL OR id <> $3)`
      : `SELECT lower(name) AS n FROM folders WHERE parent_id = $4 AND lower(name) LIKE $2 AND ($3::int IS NULL OR id <> $3) AND $1::int > 0`,
    teamWurzel
      ? [w.userId, muster, ausOrdner, w.teamId]
      : w.ordnerId == null
        ? [w.userId, muster, ausOrdner]
        : [w.userId, muster, ausOrdner, w.ordnerId]
  )
  const belegt = new Set<string>([...dateien.rows, ...ordner.rows].map((r) => String(r.n)))
  return freierName(name, w.art, belegt)
}

// Einfache Sperre pro Ordner innerhalb dieses Prozesses, damit zwei gleichzeitige Aktionen (z. B. mehrere Uploads
// derselben Datei) nicht denselben freien Namen berechnen. Es gibt keine Datenbank-Eindeutigkeit; im Cluster kann in
// seltenen Fällen ein Namensdoppel entstehen, das ist harmlos.
const sperren = new Map<string, Promise<unknown>>()
export async function mitNamenssperre<T>(schluessel: string, fn: () => Promise<T>): Promise<T> {
  const vorher = sperren.get(schluessel) || Promise.resolve()
  let frei!: () => void
  const dieses = new Promise<void>((res) => (frei = res))
  const kette = vorher.then(() => dieses)
  sperren.set(schluessel, kette)
  try {
    await vorher.catch(() => {})
    return await fn()
  } finally {
    frei()
    if (sperren.get(schluessel) === kette) sperren.delete(schluessel)
  }
}
export const sperrSchluessel = (userId: number, ordnerId: number | null) => (ordnerId == null ? `u${userId}` : `o${ordnerId}`)

/** Gibt einer frisch angelegten Datei einen im Ordner freien Namen (Cloud-Uploads: "name (2).ext"). */
export async function dateinameEindeutig(f: { id: string | number; user_id: number; folder_id: number | null; name: string }): Promise<string> {
  return mitNamenssperre(sperrSchluessel(f.user_id, f.folder_id), async () => {
    const neu = await eindeutigerName({ ordnerId: f.folder_id, userId: f.user_id, name: f.name, art: 'datei', ausser: f.id })
    if (neu !== f.name) await q('UPDATE files SET name = $2 WHERE id = $1', [f.id, neu])
    return neu
  })
}
