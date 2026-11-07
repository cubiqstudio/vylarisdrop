import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { PassThrough, type Readable } from 'node:stream'
import type { H3Event } from 'h3'
import { q, q1, ereignis } from './db'
import { clientIp, fehlversuch, gesperrt, sha, type Nutzer } from './auth'
import { st } from './settings'
import { meineTeams } from './teams'

// WebDAV-Server der Cloud (Route /dav): Grundbausteine. Anmeldung nur mit App-Passwort, Fehlerklasse, Pfad- und Namenspruefung,
// Zeitformate und ein kleiner, toleranter XML-Leser fuer PROPFIND/PROPPATCH/LOCK.

export const DAV_BASIS = '/dav'
export const TEAM_ORDNER = 'Team-Ordner'
export const MAX_NAME = 200
export const REALM = 'VylarisCloud'

export class DavFehler extends Error {
  constructor(
    public status: number,
    public de: string,
    public en: string,
    public kopf: Record<string, string> = {},
    public xml: string = ''
  ) {
    super(de)
  }
}
export const davFehler = (status: number, de: string, en: string, kopf: Record<string, string> = {}, xml = '') =>
  new DavFehler(status, de, en, kopf, xml)

export interface Team {
  team_id: number
  rolle: 'leitung' | 'mitglied'
  name: string
  farbe: string
}
export interface DavKontext {
  event: H3Event
  u: Nutzer
  /** false bei Nur-Lesen-App-Passwort */
  schreiben: boolean
  zugangId: number
  teams: Team[]
}

// ---------- Zeit, XML ----------
export const rfc1123 = (d: Date | string) => new Date(d).toUTCString()
export const iso = (d: Date | string) => new Date(d).toISOString()
// eslint-disable-next-line no-control-regex
const UNGUELTIG = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g
export const xmlEsc = (s: string) =>
  String(s)
    .replace(UNGUELTIG, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
export const href = (teile: string[], ordner: boolean) =>
  DAV_BASIS + '/' + teile.map((t) => encodeURIComponent(t)).join('/') + (ordner && teile.length ? '/' : '')

export interface XmlKnoten {
  ns: string
  name: string
  text: string
  kinder: XmlKnoten[]
}
/** Kleiner, toleranter XML-Leser mit Namensraeumen (keine DTD/Entities ausser den fuenf Standardzeichen). */
export function xmlLesen(roh: string): XmlKnoten | null {
  const s = roh.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '')
  const wurzel: XmlKnoten = { ns: '', name: '#wurzel', text: '', kinder: [] }
  const stapel: Array<{ k: XmlKnoten; ns: Record<string, string> }> = [{ k: wurzel, ns: { '': '' } }]
  // Tag ohne ueberlappende Quantoren ueber Leerraum (sonst kubisches Backtracking bei unvollstaendigen Tags, ReDoS):
  // nach dem Namen genau ein Leerzeichen-Zeichen, dann lazy bis zum optionalen "/" vor ">"
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)((?:\s[^<>]*?)?)(\/?)>|([^<]+)/g
  let m: RegExpExecArray | null
  let n = 0
  const entit = (t: string) =>
    t
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
  while ((m = re.exec(s))) {
    if (++n > 5000) return null
    const top = stapel[stapel.length - 1]!
    if (m[1] !== undefined) {
      top.k.text += m[1]
    } else if (m[6] !== undefined) {
      top.k.text += entit(m[6])
    } else if (m[2] === '/') {
      if (stapel.length > 1) stapel.pop()
    } else {
      const ns = { ...top.ns }
      const attr = m[4] || ''
      for (const a of attr.matchAll(/xmlns(?::([\w.-]+))?\s*=\s*("([^"]*)"|'([^']*)')/g)) ns[a[1] || ''] = entit(a[3] ?? a[4] ?? '')
      const voll = m[3]!
      const i = voll.indexOf(':')
      const pre = i >= 0 ? voll.slice(0, i) : ''
      const lokal = i >= 0 ? voll.slice(i + 1) : voll
      const k: XmlKnoten = { ns: ns[pre] ?? '', name: lokal, text: '', kinder: [] }
      top.k.kinder.push(k)
      if (m[5] !== '/') {
        if (stapel.length > 64) return null
        stapel.push({ k, ns })
      }
    }
  }
  return wurzel.kinder[0] || null
}
export const xmlFinde = (k: XmlKnoten | null | undefined, name: string): XmlKnoten | undefined =>
  k?.kinder.find((x) => x.name === name)

// ---------- Anfrage lesen ----------
/** Obergrenze fuer XML-Anfragen (PROPFIND, PROPPATCH, LOCK): echte Anfragen sind wenige hundert Byte gross */
export const MAX_XML = 64 * 1024
export async function koerperLesen(event: H3Event, max = 1024 * 1024): Promise<string> {
  const req = event.node.req
  const teile: Buffer[] = []
  let n = 0
  for await (const c of req as AsyncIterable<Buffer>) {
    n += c.length
    if (n > max) {
      setResponseHeader(event, 'Connection', 'close')
      throw davFehler(413, 'Die Anfrage ist zu groß.', 'The request is too large.')
    }
    teile.push(c)
  }
  return Buffer.concat(teile).toString('utf8')
}
export const hatKoerper = (event: H3Event) => {
  const cl = Number(getRequestHeader(event, 'content-length') || 0)
  return cl > 0 || !!getRequestHeader(event, 'transfer-encoding')
}
/** Anfrage-Strom, der bei Abbruch des Clients sauber mit Fehler endet (statt zu haengen) und den Socket beim Fehler des Ziels nicht reisst. */
export function anfrageStrom(event: H3Event): Readable {
  const req = event.node.req
  const p = new PassThrough()
  req.on('error', (e) => p.destroy(e))
  req.on('aborted', () => p.destroy(Object.assign(new Error('abgebrochen'), { code: 'ABGEBROCHEN' })))
  req.on('close', () => {
    if (!req.complete) p.destroy(Object.assign(new Error('abgebrochen'), { code: 'ABGEBROCHEN' }))
  })
  req.pipe(p)
  return p
}

// ---------- Pfad und Namen ----------
const NAME_UNZULAESSIG = /[\u0000-\u001f\u007f/\\]/
export const nurPunkte = (s: string) => /^\.+$/.test(s)

/** Pfad (beginnt mit /dav) in dekodierte Segmente zerlegen. Pfadtricks (.., NUL, \\, %2F) werden abgewiesen, doppelte Slashes zusammengefasst. */
export function teileAusPfad(roh: string): string[] {
  if (roh.length > 4096) throw davFehler(414, 'Der Pfad ist zu lang.', 'The path is too long.')
  const rest = roh.slice(DAV_BASIS.length)
  const teile: string[] = []
  for (const s of rest.split('/')) {
    if (!s) continue
    let d: string
    try {
      d = decodeURIComponent(s)
    } catch {
      throw davFehler(400, 'Ungültige Zeichen im Pfad.', 'Invalid characters in the path.')
    }
    if (d.length > 255) throw davFehler(414, 'Ein Name im Pfad ist zu lang.', 'A name in the path is too long.')
    if (nurPunkte(d) || NAME_UNZULAESSIG.test(d)) throw davFehler(400, 'Ungültiger Pfad.', 'Invalid path.')
    teile.push(d)
  }
  return teile
}
// event.path ist bei h3 schon dekodiert (aus %23 wird #, aus %25 wird %) — der Rohpfad steht in originalUrl
export const pfadTeile = (event: H3Event): string[] =>
  teileAusPfad((event.node.req.originalUrl || event.node.req.url || '/').split('?')[0]!.split('#')[0]!)
export const endetMitSlash = (event: H3Event): boolean =>
  /\/$/.test((event.node.req.originalUrl || event.node.req.url || '/').split('?')[0]!) && pfadTeile(event).length > 0
/** Name fuer neue Dateien/Ordner pruefen. */
export function neuerNameOk(name: string): string {
  if (!name || name.length > MAX_NAME)
    throw davFehler(414, `Namen sind höchstens ${MAX_NAME} Zeichen lang.`, `Names are at most ${MAX_NAME} characters long.`)
  if (NAME_UNZULAESSIG.test(name) || nurPunkte(name) || name !== name.trim())
    throw davFehler(400, 'Dieser Name ist nicht erlaubt.', 'This name is not allowed.')
  return name
}
/** Anzeigename aus einem Namen der Datenbank (dort sind auch / und \ in Ordnernamen moeglich). */
export function anzeigeName(name: string): string {
  let n = String(name || '')
    .replace(NAME_UNZULAESSIG, '_')
    .trim()
    .slice(0, 255)
  if (!n || nurPunkte(n)) n = '_' + n
  return n
}
export const nameSchluessel = (s: string) => s.normalize('NFC').toLowerCase()

// ---------- Vorbedingungen ----------
const etagListe = (kopf: string) =>
  kopf
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
export const etagGleich = (a: string, b: string) => a.replace(/^W\//, '') === b.replace(/^W\//, '')
/** If-Match / If-None-Match gegen den aktuellen ETag (null = Ressource existiert nicht). Wirft 412. */
export function vorbedingungen(event: H3Event, etag: string | null) {
  const match = String(getRequestHeader(event, 'if-match') || '').trim()
  const keiner = String(getRequestHeader(event, 'if-none-match') || '').trim()
  if (match) {
    const ok = etag != null && (match === '*' || etagListe(match).some((x) => etagGleich(x, etag)))
    if (!ok) throw davFehler(412, 'Die Datei hat sich geändert.', 'The file has changed.')
  }
  if (keiner && etag != null) {
    if (keiner === '*' || etagListe(keiner).some((x) => etagGleich(x, etag)))
      throw davFehler(412, 'Die Datei existiert bereits.', 'The file already exists.')
  }
}
/** Lock-Tokens aus dem If-Header. */
export function ifTokens(event: H3Event): Set<string> {
  const kopf = String(getRequestHeader(event, 'if') || '')
  const r = new Set<string>()
  for (const m of kopf.matchAll(/<(opaquelocktoken:[0-9a-fA-F-]{8,64})>/g)) r.add(m[1]!)
  return r
}

// ---------- Anmeldung mit App-Passwort ----------
export const ZUGANG_FORMAT = /^vd_dav_[a-z0-9]{32}$/
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
export function neuesAppPasswort(): { klar: string; prefix: string; hash: string } {
  const klar = 'vd_dav_' + Array.from({ length: 32 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
  return { klar, prefix: klar.slice(0, 11), hash: sha(klar) }
}
const DUMMY = createHash('sha256').update('vd-dav-dummy').digest()
const gleich = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b)

function herausforderung(event: H3Event): DavFehler {
  return davFehler(401, 'Anmeldung erforderlich.', 'Authentication required.', {
    'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`
  })
}

export async function davAnmelden(event: H3Event): Promise<DavKontext> {
  const kopf = String(getRequestHeader(event, 'authorization') || '')
  if (!/^Basic\s+/i.test(kopf)) throw herausforderung(event)
  let name = ''
  let pw = ''
  try {
    const roh = Buffer.from(kopf.replace(/^Basic\s+/i, '').trim(), 'base64').toString('utf8')
    const i = roh.indexOf(':')
    if (i < 0) throw new Error('x')
    name = roh.slice(0, i)
    pw = roh.slice(i + 1)
  } catch {
    throw herausforderung(event)
  }
  if (name.length > 100 || pw.length > 200) throw herausforderung(event)
  // Windows liefert gelegentlich DOMAIN\benutzer
  name = name.replace(/^.*\\/, '')
  const ip = clientIp(event) || '-'
  const ipKey = 'davfail:' + ip
  const nutzerKey = 'davfail:' + ip + '|' + name.toLowerCase()
  if (gesperrt(ipKey, 40) || gesperrt(nutzerKey, 10))
    throw davFehler(
      429,
      'Zu viele fehlgeschlagene Anmeldungen. Bitte warte ein paar Minuten.',
      'Too many failed sign-ins. Please wait a few minutes.',
      { 'Retry-After': '600' }
    )
  const zeilen = await q<
    Nutzer & { zid: number | null; key_hash: string | null; z_schreiben: boolean | null; last_used_at: string | null }
  >(
    `SELECT u.id, u.username, u.email, u.role, u.quota_bytes, u.prefs, u.rolle_id, z.id AS zid, z.key_hash, z.schreiben AS z_schreiben, z.last_used_at
    FROM users u LEFT JOIN dav_zugaenge z ON z.user_id = u.id WHERE lower(u.username) = lower($1)`,
    [name]
  )
  const soll = ZUGANG_FORMAT.test(pw) ? Buffer.from(sha(pw), 'hex') : DUMMY
  // alle Hashes des Kontos vergleichen, ohne vorzeitig abzubrechen (konstante Zeit je Eintrag)
  let treffer: (typeof zeilen)[number] | null = null
  const kandidaten = zeilen.filter((z) => z.key_hash)
  for (const z of kandidaten.length ? kandidaten : [{ key_hash: sha('x') } as any]) {
    const ok = gleich(Buffer.from(String(z.key_hash), 'hex'), soll)
    if (ok && soll !== DUMMY && z.zid) treffer = z
  }
  if (!treffer) {
    fehlversuch(ipKey, 600)
    fehlversuch(nutzerKey, 600)
    if (gesperrt(nutzerKey, 10)) await ereignis('dav_login_gesperrt', null, { benutzer: name.slice(0, 40) }, ip)
    throw herausforderung(event)
  }
  const { zid, key_hash: _k, z_schreiben, last_used_at, ...u } = treffer
  if (!last_used_at || Date.now() - new Date(last_used_at).getTime() > 60_000)
    void q('UPDATE dav_zugaenge SET last_used_at = now() WHERE id = $1', [zid]).catch(() => {})
  return { event, u: u as Nutzer, schreiben: !!z_schreiben, zugangId: zid!, teams: await meineTeams(u.id) }
}

export function schreibenPruefen(c: DavKontext) {
  if (!c.schreiben)
    throw davFehler(
      403,
      'Dieses App-Passwort darf nur lesen.',
      'This app password is read-only.',
      {},
      '<?xml version="1.0" encoding="utf-8"?><D:error xmlns:D="DAV:"><D:cannot-modify-protected-property/></D:error>'
    )
}

export async function ordnerAnzahlOk(userId: number): Promise<boolean> {
  const n = await q1<{ n: string }>('SELECT count(*) AS n FROM folders WHERE user_id = $1', [userId])
  return Number(n?.n || 0) < 1000
}
