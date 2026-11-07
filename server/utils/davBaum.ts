import { q } from './db'
import { istPro } from './lizenz'
import { ordnerRecht, type OrdnerRecht } from './teams'
import {
  anzeigeName,
  davFehler,
  nameSchluessel,
  TEAM_ORDNER,
  type DavKontext,
  type Team
} from './davKern'

// Der WebDAV-Baum bildet die Cloud ab: Wurzel = eigene Ordner/Dateien ohne Ordner, dazu der virtuelle Ordner
// "Team-Ordner/<Team>/…" mit den Team-Ordnern. Namen sind im DAV-Baum je Ordner eindeutig (ohne Gross-/Kleinschreibung):
// Doppelte werden deterministisch nach id zu "name (2).ext" umbenannt — in der Datenbank bleibt der Name unveraendert.

export interface OrdnerZeile {
  id: number
  user_id: number
  parent_id: number | null
  team_id: number | null
  name: string
  created_at: string
  geaendert_at: string
}
export interface DateiZeile2 {
  id: string
  user_id: number
  folder_id: number | null
  name: string
  mime: string
  size: string
  ablage: string
  sha256: string
  created_at: string
  geaendert_at: string
  scan: string
  verschluesselt: boolean
}

export type Knoten =
  | { art: 'wurzel'; anzeige: string }
  | { art: 'teams'; anzeige: string }
  | { art: 'team'; anzeige: string; team: Team }
  | { art: 'ordner'; anzeige: string; row: OrdnerZeile }
  | { art: 'datei'; anzeige: string; row: DateiZeile2 }

export const istBehaelter = (k: Knoten) => k.art !== 'datei'

const ORDNER_SPALTEN = 'id, user_id, parent_id, team_id, name, created_at, geaendert_at'
const DATEI_SPALTEN = 'id, user_id, folder_id, name, mime, size, ablage, sha256, created_at, geaendert_at, scan, verschluesselt'

export const teamIds = async (c: DavKontext) => ((await istPro('teams')) ? c.teams.map((t) => t.team_id) : [])

/** Namen eindeutig machen: erste Vorkommen (nach Reihenfolge) behalten ihren Namen, spaetere bekommen " (n)". */
function eindeutig<T extends { anzeige: string }>(liste: T[], belegt: Set<string> = new Set()): T[] {
  const erste = new Set(belegt)
  const behalten: boolean[] = []
  for (const k of liste) {
    const s = nameSchluessel(k.anzeige)
    if (erste.has(s)) behalten.push(false)
    else {
      erste.add(s)
      behalten.push(true)
    }
  }
  const benutzt = new Set(erste)
  liste.forEach((k, i) => {
    if (behalten[i]) return
    const m = /^(.*?)(\.[^./ ][^/ ]{0,15})?$/.exec(k.anzeige) || []
    const stamm = m[1] ?? k.anzeige
    const ext = m[2] ?? ''
    for (let n = 2; ; n++) {
      const kandidat = `${stamm || k.anzeige} (${n})${stamm ? ext : ''}`
      const s = nameSchluessel(kandidat)
      if (!benutzt.has(s)) {
        benutzt.add(s)
        k.anzeige = kandidat
        return
      }
    }
  })
  return liste
}

export const wurzel = (): Knoten => ({ art: 'wurzel', anzeige: '' })

/** Kinder eines Behaelters mit eindeutigen Anzeigenamen. */
export async function kinder(c: DavKontext, k: Knoten): Promise<Knoten[]> {
  const uid = c.u.id
  if (k.art === 'datei') return []
  if (k.art === 'teams') {
    const t = (await istPro('teams')) ? c.teams : []
    return eindeutig(t.map((x) => ({ art: 'team' as const, anzeige: anzeigeName(x.name), team: x })))
  }
  if (k.art === 'team') {
    const o = await q<OrdnerZeile>(
      `SELECT ${ORDNER_SPALTEN.replace(/(\w+)/g, 'o.$1')} FROM folders o LEFT JOIN folders p ON p.id = o.parent_id
      WHERE o.team_id = $1 AND (o.parent_id IS NULL OR p.team_id IS DISTINCT FROM $1) ORDER BY o.id`,
      [k.team.team_id]
    )
    return eindeutig(o.map((r) => ({ art: 'ordner' as const, anzeige: anzeigeName(r.name), row: r })))
  }
  if (k.art === 'wurzel') {
    const meine = await teamIds(c)
    const o = await q<OrdnerZeile>(
      `SELECT ${ORDNER_SPALTEN} FROM folders WHERE user_id = $1 AND parent_id IS NULL AND (team_id IS NULL OR NOT (team_id = ANY($2::int[]))) ORDER BY id`,
      [uid, meine]
    )
    const d = await q<DateiZeile2>(
      `SELECT ${DATEI_SPALTEN} FROM files WHERE user_id = $1 AND folder_id IS NULL ORDER BY id`,
      [uid]
    )
    const virtuell: Knoten[] = c.teams.length && meine.length ? [{ art: 'teams', anzeige: TEAM_ORDNER }] : []
    const belegt = new Set(virtuell.map((v) => nameSchluessel(v.anzeige)))
    return [
      ...virtuell,
      ...eindeutig(
        [
          ...o.map((r) => ({ art: 'ordner' as const, anzeige: anzeigeName(r.name), row: r })),
          ...d.map((r) => ({ art: 'datei' as const, anzeige: anzeigeName(r.name), row: r }))
        ],
        belegt
      )
    ]
  }
  // normaler Ordner: Unterordner und Dateien; im Team-Ordner sieht man alles, sonst nur Eigenes
  const recht = await ordnerRecht(uid, k.row.id)
  if (!recht) return []
  const team = recht.team_id
  const o = await q<OrdnerZeile>(
    `SELECT ${ORDNER_SPALTEN} FROM folders WHERE parent_id = $1 AND (user_id = $2 OR ($3::int IS NOT NULL AND team_id = $3::int)) ORDER BY id`,
    [k.row.id, uid, team]
  )
  const d = await q<DateiZeile2>(
    `SELECT ${DATEI_SPALTEN} FROM files WHERE folder_id = $1 AND (user_id = $2 OR $3::int IS NOT NULL) ORDER BY id`,
    [k.row.id, uid, team]
  )
  return eindeutig([
    ...o.map((r) => ({ art: 'ordner' as const, anzeige: anzeigeName(r.name), row: r })),
    ...d.map((r) => ({ art: 'datei' as const, anzeige: anzeigeName(r.name), row: r }))
  ])
}

export interface Aufloesung {
  /** gefundener Knoten oder null */
  knoten: Knoten | null
  /** Behaelter, in dem der letzte Segmentname liegt (oder liegen wuerde); null, wenn ein Zwischenordner fehlt */
  eltern: Knoten | null
  name: string
  /** gleicher Name, nur andere Gross-/Kleinschreibung: Namenskollision */
  kollision: Knoten | null
  /** Knoten von der Wurzel bis zum gefundenen (inklusive) */
  kette: Knoten[]
}

function finde(liste: Knoten[], name: string): { treffer: Knoten | null; kollision: Knoten | null } {
  const nfc = name.normalize('NFC')
  let kollision: Knoten | null = null
  const schl = nameSchluessel(name)
  for (const k of liste) {
    if (k.anzeige === name || k.anzeige.normalize('NFC') === nfc) return { treffer: k, kollision: null }
    if (!kollision && nameSchluessel(k.anzeige) === schl) kollision = k
  }
  return { treffer: null, kollision }
}

export async function aufloesen(c: DavKontext, teile: string[]): Promise<Aufloesung> {
  let cur: Knoten = wurzel()
  const kette: Knoten[] = [cur]
  if (!teile.length) return { knoten: cur, eltern: null, name: '', kollision: null, kette }
  for (let i = 0; i < teile.length; i++) {
    const letzt = i === teile.length - 1
    const liste = await kinder(c, cur)
    const { treffer, kollision } = finde(liste, teile[i]!)
    if (!treffer) {
      if (letzt) return { knoten: null, eltern: cur, name: teile[i]!, kollision, kette }
      return { knoten: null, eltern: null, name: teile[i]!, kollision: null, kette }
    }
    if (!letzt && treffer.art === 'datei')
      return { knoten: null, eltern: null, name: teile[i]!, kollision: null, kette }
    cur = treffer
    kette.push(cur)
    if (letzt) return { knoten: cur, eltern: kette[kette.length - 2]!, name: teile[i]!, kollision: null, kette }
  }
  return { knoten: cur, eltern: null, name: '', kollision: null, kette }
}

// ---------- Rechte ----------
export interface Darf {
  /** neue Dateien in diesem Behaelter */
  datei: boolean
  /** neue Ordner in diesem Behaelter */
  ordner: boolean
}
export async function darfHinein(c: DavKontext, k: Knoten): Promise<Darf> {
  if (k.art === 'wurzel') return { datei: true, ordner: true }
  if (k.art === 'teams') return { datei: false, ordner: false }
  if (k.art === 'team') return { datei: false, ordner: k.team.rolle === 'leitung' }
  if (k.art === 'ordner') {
    const r = await ordnerRecht(c.u.id, k.row.id)
    return { datei: !!r?.hineinladen, ordner: !!r?.hineinladen }
  }
  return { datei: false, ordner: false }
}
export async function darfAendern(c: DavKontext, k: Knoten): Promise<boolean> {
  if (k.art === 'datei') {
    if (k.row.user_id === c.u.id) return true
    if (!k.row.folder_id) return false
    const r = await ordnerRecht(c.u.id, k.row.folder_id)
    return !!r?.team_id && r.leitung
  }
  if (k.art === 'ordner') return !!(await ordnerRecht(c.u.id, k.row.id))?.verwalten
  return false
}
export const rechtOrdner = (c: DavKontext, id: number): Promise<OrdnerRecht | null> => ordnerRecht(c.u.id, id)

/** id des Ordners, in dem Dateien eines Behaelters liegen (null = Wurzel). */
export const ordnerIdVon = (k: Knoten): number | null => (k.art === 'ordner' ? k.row.id : null)
/** Team, dem neue Unterordner eines Behaelters gehoeren. */
export async function teamVon(c: DavKontext, k: Knoten): Promise<number | null> {
  if (k.art === 'team') return k.team.team_id
  if (k.art === 'ordner') return (await ordnerRecht(c.u.id, k.row.id))?.team_id ?? null
  return null
}

export function nichtGefunden() {
  return davFehler(404, 'Nicht gefunden.', 'Not found.')
}

/** Alle Ordner-IDs unterhalb (inklusive) eines Ordners. */
export async function unterOrdner(id: number): Promise<number[]> {
  const r = await q<{ id: number }>(
    `WITH RECURSIVE u(id, n) AS (SELECT $1::int, 0 UNION ALL SELECT f.id, u.n + 1 FROM folders f JOIN u ON f.parent_id = u.id WHERE u.n < 64) SELECT id FROM u`,
    [id]
  )
  return r.map((x) => x.id)
}
