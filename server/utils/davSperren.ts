import { randomUUID } from 'node:crypto'
import { q, q1 } from './db'
import { davFehler, ifTokens, xmlEsc, type DavKontext } from './davKern'
import { unterOrdner, type Knoten } from './davBaum'

// Klasse-2-Sperren: exklusive Schreibsperren (Datei oder Ordner, Tiefe 0/infinity) mit Timeout, in der Datenbank
// (gelten damit auch bei mehreren Servern und ueberstehen einen Neustart). res = f<id> | o<id>.

export interface Sperre {
  token: string
  res: string
  user_id: number
  tiefe: '0' | 'infinity'
  besitzer: string
  timeout_s: number
  ablauf_at: string
}
export const MAX_TIMEOUT = 3600
export const STANDARD_TIMEOUT = 600

export const resSchluessel = (k: Knoten): string | null =>
  k.art === 'datei' ? `f${k.row.id}` : k.art === 'ordner' ? `o${k.row.id}` : null

async function gibtSperren(): Promise<boolean> {
  return !!(await q1('SELECT 1 FROM dav_sperren WHERE ablauf_at > now() LIMIT 1'))
}

/** Ordner-Schluessel von k bis zur Wurzel (ohne k selbst, wenn k ein Ordner ist). */
async function vorfahren(k: Knoten): Promise<string[]> {
  const start = k.art === 'datei' ? k.row.folder_id : k.art === 'ordner' ? k.row.parent_id : null
  if (!start) return []
  const r = await q<{ id: number }>(
    `WITH RECURSIVE o(id, parent_id, n) AS (SELECT id, parent_id, 0 FROM folders WHERE id = $1
      UNION ALL SELECT f.id, f.parent_id, o.n + 1 FROM folders f JOIN o ON f.id = o.parent_id WHERE o.n < 64) SELECT id FROM o`,
    [start]
  )
  return r.map((x) => `o${x.id}`)
}

/** Alle Sperren, die k betreffen: auf k selbst (jede Tiefe) und auf Vorfahren (nur infinity). */
export async function sperrenFuer(k: Knoten): Promise<Sperre[]> {
  const eigen = resSchluessel(k)
  const oben = await vorfahren(k)
  return q<Sperre>(
    `SELECT * FROM dav_sperren WHERE ablauf_at > now() AND (res = ANY($1::text[]) OR (tiefe = 'infinity' AND res = ANY($2::text[])))`,
    [eigen ? [eigen] : [], oben]
  )
}
async function sperrenUnter(k: Knoten): Promise<Sperre[]> {
  if (k.art !== 'ordner') return []
  const ids = await unterOrdner(k.row.id)
  return q<Sperre>(
    `SELECT * FROM dav_sperren WHERE ablauf_at > now() AND (res = ANY($1::text[]) OR res IN (SELECT 'f' || id FROM files WHERE folder_id = ANY($2::int[])))`,
    [ids.map((i) => `o${i}`), ids]
  )
}

function gesperrtFehler(): never {
  throw davFehler(
    423,
    'Die Datei ist gesperrt (von einem anderen Programm geöffnet).',
    'The resource is locked (opened by another program).',
    {},
    '<?xml version="1.0" encoding="utf-8"?><D:error xmlns:D="DAV:"><D:lock-token-submitted><D:href/></D:lock-token-submitted></D:error>'
  )
}

/**
 * Schreibzugriff pruefen (wirft 423). ziele = bestehende Ressourcen, die geaendert/geloescht/verschoben werden,
 * eltern = Behaelter, deren Mitgliedschaft sich aendert, mitNachkommen = Ordner, bei denen auch Sperren darunter zaehlen.
 */
export async function schreibzugriff(
  c: DavKontext,
  o: { ziele?: Knoten[]; eltern?: Knoten[]; mitNachkommen?: Knoten[] }
): Promise<void> {
  if (!(await gibtSperren())) return
  const tokens = ifTokens(c.event)
  const pruefen = (liste: Sperre[]) => {
    for (const s of liste) if (!tokens.has(s.token)) gesperrtFehler()
  }
  for (const k of o.ziele || []) pruefen(await sperrenFuer(k))
  for (const k of o.eltern || []) pruefen(await sperrenFuer(k))
  for (const k of o.mitNachkommen || []) pruefen(await sperrenUnter(k))
}

export async function sperreAnlegen(
  c: DavKontext,
  k: Knoten,
  tiefe: '0' | 'infinity',
  besitzer: string,
  timeout: number
): Promise<Sperre> {
  const res = resSchluessel(k)
  if (!res) throw davFehler(403, 'Dieser Ordner lässt sich nicht sperren.', 'This folder cannot be locked.')
  await q('DELETE FROM dav_sperren WHERE ablauf_at <= now()')
  const vorhanden = [...(await sperrenFuer(k)), ...(tiefe === 'infinity' ? await sperrenUnter(k) : [])]
  if (vorhanden.length) gesperrtFehler()
  const token = `opaquelocktoken:${randomUUID()}`
  const r = await q1<Sperre>(
    `INSERT INTO dav_sperren (token, res, user_id, tiefe, besitzer, timeout_s, ablauf_at)
    VALUES ($1, $2, $3, $4, $5, $6::int, now() + $6::int * interval '1 second') RETURNING *`,
    [token, res, c.u.id, tiefe, besitzer.slice(0, 256), timeout]
  )
  return r!
}
/** Sperre verlaengern (LOCK ohne Body). */
export async function sperreErneuern(c: DavKontext, token: string, timeout: number): Promise<Sperre | null> {
  const s = await q1<Sperre>('SELECT * FROM dav_sperren WHERE token = $1 AND ablauf_at > now()', [token])
  if (!s) return null
  if (s.user_id !== c.u.id) throw davFehler(403, 'Diese Sperre gehört jemand anderem.', 'This lock belongs to someone else.')
  return q1<Sperre>(
    `UPDATE dav_sperren SET timeout_s = $2::int, ablauf_at = now() + $2::int * interval '1 second' WHERE token = $1 RETURNING *`,
    [token, timeout]
  )
}
export async function sperreAufheben(c: DavKontext, token: string, k: Knoten): Promise<boolean> {
  const s = await q1<Sperre>('SELECT * FROM dav_sperren WHERE token = $1', [token])
  if (!s) return false
  const gilt = (await sperrenFuer(k)).some((x) => x.token === token)
  if (!gilt) return false
  if (s.user_id !== c.u.id) throw davFehler(403, 'Diese Sperre gehört jemand anderem.', 'This lock belongs to someone else.')
  await q('DELETE FROM dav_sperren WHERE token = $1', [token])
  return true
}
/** Sperren einer Ressource entfernen (nach Loeschen/Verschieben). */
export async function sperrenEntfernen(res: string[]): Promise<void> {
  if (res.length) await q('DELETE FROM dav_sperren WHERE res = ANY($1::text[])', [res])
}

/** XML fuer lockdiscovery; das Token zeigen wir nur dem Besitzer der Sperre. */
export function sperreXml(s: Sperre, c: DavKontext, hrefs: string): string {
  const rest = Math.max(1, Math.round((new Date(s.ablauf_at).getTime() - Date.now()) / 1000))
  return (
    `<D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope>` +
    `<D:depth>${s.tiefe === 'infinity' ? 'infinity' : '0'}</D:depth>` +
    (s.besitzer ? `<D:owner>${xmlEsc(s.besitzer)}</D:owner>` : '') +
    `<D:timeout>Second-${rest}</D:timeout>` +
    (s.user_id === c.u.id ? `<D:locktoken><D:href>${xmlEsc(s.token)}</D:href></D:locktoken>` : '') +
    `<D:lockroot><D:href>${xmlEsc(hrefs)}</D:href></D:lockroot></D:activelock>`
  )
}
export async function sperrenMap(keys: string[]): Promise<Map<string, Sperre[]>> {
  const m = new Map<string, Sperre[]>()
  if (!keys.length || !(await gibtSperren())) return m
  const r = await q<Sperre>('SELECT * FROM dav_sperren WHERE ablauf_at > now() AND res = ANY($1::text[])', [keys])
  for (const s of r) m.set(s.res, [...(m.get(s.res) || []), s])
  return m
}

export function timeoutAus(event: { node: { req: { headers: Record<string, any> } } }): number {
  const raw = String(event.node.req.headers.timeout || '')
  for (const t of raw.split(',')) {
    const m = /^\s*Second-(\d{1,9})\s*$/i.exec(t)
    if (m) return Math.min(MAX_TIMEOUT, Math.max(10, Number(m[1])))
    if (/^\s*Infinite\s*$/i.test(t)) return MAX_TIMEOUT
  }
  return STANDARD_TIMEOUT
}
