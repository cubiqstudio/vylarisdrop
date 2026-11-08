import { promises as fs } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import type { H3Event } from 'h3'
import { q, q1, ereignis } from './db'
import { clientIp, type Nutzer } from './auth'
import { getNet, getUploads, st } from './settings'
import { lesen, loeschen, ortVon, pfadVon, platte, schreiben } from './speicher'
import { artVon, basisUrl, dateiAnlegen, fuerPanel, typErkennen, type DateiZeile } from './dateien'
import { dateiCsp } from './dateiCsp'
import { ablageKontextFuer } from './ablageRegeln'
import { freierPlatz } from './hochladen'
import {
  hatGrenze,
  kontingentPruefen,
  mitKontingentSperre,
  ordnerBaumBytes,
  quotaStand,
  teamStand,
  teamVonOrdner,
  verschiebenPruefen,
  type Ausf
} from './quota'
import { rechteVon, ordnerRecht } from './teams'
import { inPapierkorb } from './papierkorb'
import { webhookAusloesen } from './webhooks'
import { alsApi } from './api'
import { verarbeiten } from './medien'
import { variantenLoeschen } from './bildvarianten'
import { gezaehlt } from './traffic'
import { speicherPruefen } from './benachrichtigen'
import {
  DAV_BASIS,
  DavFehler,
  anfrageStrom,
  davAnmelden,
  davFehler,
  endetMitSlash,
  etagGleich,
  hatKoerper,
  href as hrefVon,
  iso,
  koerperLesen,
  MAX_XML,
  neuerNameOk,
  nameSchluessel,
  ordnerAnzahlOk,
  pfadTeile,
  rfc1123,
  schreibenPruefen,
  teileAusPfad,
  vorbedingungen,
  xmlEsc,
  xmlFinde,
  xmlLesen,
  type DavKontext,
  type XmlKnoten
} from './davKern'
import {
  aufloesen,
  darfAendern,
  darfHinein,
  istBehaelter,
  kinder,
  ordnerIdVon,
  teamVon,
  unterOrdner,
  type Aufloesung,
  type DateiZeile2,
  type Knoten
} from './davBaum'
import {
  resSchluessel,
  schreibzugriff,
  sperreAnlegen,
  sperreAufheben,
  sperreErneuern,
  sperreXml,
  tokenSichtbar,
  sperrenEntfernen,
  sperrenFuer,
  sperrenMap,
  timeoutAus
} from './davSperren'

const ERLAUBT = 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK'
const BEKANNT_ABGELEHNT = new Set(['POST', 'PATCH', 'TRACE', 'CONNECT'])
const AKTIV =
  /^(text\/html|application\/xhtml|image\/svg|text\/xml|application\/xml|text\/javascript|application\/javascript|application\/x-javascript)/i
const XML_KOPF = '<?xml version="1.0" encoding="utf-8"?>'

// ---------- Antworten ----------
type Kopf = Record<string, string | number>
function senden(event: H3Event, status: number, body: string | Buffer | null = null, kopf: Kopf = {}) {
  const res = event.node.res
  res.statusCode = status
  res.setHeader('DAV', '1, 2')
  res.setHeader('MS-Author-Via', 'DAV')
  for (const [k, v] of Object.entries(kopf)) res.setHeader(k, v)
  if (status === 204 || status === 304) res.removeHeader('Content-Length')
  if (body == null || status === 204 || status === 304 || event.method === 'HEAD') {
    if (body != null && event.method === 'HEAD' && !res.hasHeader('Content-Length'))
      res.setHeader('Content-Length', Buffer.byteLength(body))
    res.end()
    return
  }
  res.setHeader('Content-Length', Buffer.byteLength(body))
  res.end(body)
}
const xmlSenden = (event: H3Event, status: number, xml: string, kopf: Kopf = {}) =>
  senden(event, status, XML_KOPF + xml, { 'Content-Type': 'application/xml; charset=utf-8', ...kopf })

/** HTTP-Status eines Fehlers (DavFehler, createError aus fehler()), sonst 500 */
function statusVon(e: any): number {
  if (e instanceof DavFehler) return e.status
  const s = Number(e?.statusCode || e?.status)
  return (s >= 400 && s < 500) || s === 507 ? s : 500
}

function fehlerSenden(event: H3Event, e: any) {
  const res = event.node.res
  if (res.headersSent) {
    res.destroy()
    return
  }
  if (e instanceof DavFehler) {
    if (e.xml) return xmlSenden(event, e.status, e.xml.replace(/^<\?xml[^>]*\?>/, ''), e.kopf)
    return senden(event, e.status, st(e.de, e.en), { 'Content-Type': 'text/plain; charset=utf-8', ...e.kopf })
  }
  const status = statusVon(e)
  // 4xx und der Kontingent-Fehler 507 (aus quota.ts) gehen mit Klartext an den Client; alles andere ist ein Serverfehler
  if (((status >= 400 && status < 500) || status === 507) && e?.message)
    return senden(event, status, String(e.message), { 'Content-Type': 'text/plain; charset=utf-8' })
  console.error('[vylariscloud] WebDAV-Fehler:', e?.message || e)
  senden(event, 500, st('Interner Fehler.', 'Internal error.'), { 'Content-Type': 'text/plain; charset=utf-8' })
}

// ---------- Hilfen ----------
const etagDatei = (r: DateiZeile2) =>
  `"${r.id}-${(r.sha256 || '').slice(0, 16) || new Date(r.geaendert_at).getTime().toString(36)}"`
const etagKnoten = (k: Knoten): string | null =>
  k.art === 'datei' ? etagDatei(k.row) : k.art === 'ordner' ? `"o${k.row.id}-${new Date(k.row.geaendert_at).getTime()}"` : null

const reihenfolge = new Map<string, Promise<unknown>>()
/** Schreibende Vorgaenge auf demselben Namen nacheinander ausfuehren (verhindert doppelte Namen bei gleichzeitigem PUT/MKCOL). */
async function seriell<T>(schluessel: string, fn: () => Promise<T>): Promise<T> {
  const vorher = reihenfolge.get(schluessel) || Promise.resolve()
  let frei!: () => void
  const dieser = new Promise<void>((r) => (frei = r))
  const kette = vorher.then(() => dieser)
  reihenfolge.set(schluessel, kette)
  await vorher.catch(() => {})
  try {
    return await fn()
  } finally {
    frei()
    if (reihenfolge.get(schluessel) === kette) reihenfolge.delete(schluessel)
  }
}
const behaelterId = (k: Knoten) =>
  k.art === 'ordner' ? `o${k.row.id}` : k.art === 'team' ? `t${k.team.team_id}` : k.art === 'teams' ? 'teams' : 'wurzel'

async function ordnerBeruehren(id: number | null) {
  if (id) await q('UPDATE folders SET geaendert_at = now() WHERE id = $1', [id]).catch(() => {})
}
let letztePruefung = new Map<number, number>()
function speicherWarnung(c: DavKontext) {
  const t = letztePruefung.get(c.u.id) || 0
  if (Date.now() - t < 60_000) return
  letztePruefung.set(c.u.id, Date.now())
  if (letztePruefung.size > 500) letztePruefung = new Map()
  void speicherPruefen(c.u).catch(() => {})
}

/** Konto des Besitzers einer fremden Datei (Team-Ordner), fuer die Vorabpruefung beim Ueberschreiben */
const nutzerVon = (id: number) =>
  q1<Nutzer>('SELECT id, username, email, role, quota_bytes, prefs, rolle_id FROM users WHERE id = $1', [id])

/**
 * Vorab-Grenzen fuer einen Upload: freier Platz (Konto des Besitzers und, mit `ordner`, Team-Kontingent des Zielordners),
 * Instanz- und Rollen-Dateigroesse. `alt` = Bytes der Datei, die ersetzt wird. Nicht verbindlich: die endgueltige Pruefung
 * macht dateiAnlegen() bzw. der Ueberschreib-Zweig von putKern unter der Kontingent-Sperre.
 */
async function limiten(c: DavKontext, alt = 0, ordner: number | null = null, besitzer?: Nutzer) {
  const cfg = await getUploads()
  const frei = (await freierPlatz(besitzer || c.u, ordner)) + alt
  const inst = cfg.maxBytes > 0 ? cfg.maxBytes : Infinity
  const rolle = (await rechteVon(c.u)).maxDateiMb
  const datei = Math.min(inst, rolle ? Math.round(rolle * 1024 ** 2) : Infinity)
  const max = Math.min(frei, datei)
  return { frei, datei, max, fuerSchreiben: max === Infinity ? 0 : max <= 0 ? -1 : max }
}
const zuGrossFehler = (l: { frei: number; datei: number }) =>
  l.datei <= l.frei
    ? davFehler(413, 'Die Datei ist zu groß.', 'The file is too large.', { Connection: 'close' })
    : davFehler(507, 'Nicht genug Speicherplatz.', 'Insufficient storage.', { Connection: 'close' })

async function zuNode(c: DavKontext, teile: string[]): Promise<{ a: Aufloesung; k: Knoten }> {
  const a = await aufloesen(c, teile)
  if (!a.knoten) throw davFehler(404, 'Nicht gefunden.', 'Not found.')
  return { a, k: a.knoten }
}

function endpunkt(pfad: string[], k: Knoten) {
  return hrefVon(pfad, istBehaelter(k))
}

// ---------- OPTIONS ----------
function options(c: DavKontext) {
  senden(c.event, 200, null, { Allow: ERLAUBT, 'Accept-Ranges': 'bytes', 'Content-Length': 0 })
}

// ---------- PROPFIND ----------
interface Eigenschaft {
  ns: string
  name: string
}
const DAVNS = 'DAV:'
const STANDARD_PROPS = [
  'resourcetype',
  'creationdate',
  'displayname',
  'getcontentlength',
  'getcontenttype',
  'getetag',
  'getlastmodified',
  'lockdiscovery',
  'supportedlock'
]
const ALLE_PROPS = [...STANDARD_PROPS, 'quota-available-bytes', 'quota-used-bytes']

function propfindAnfrage(body: string): { modus: 'allprop' | 'propname' | 'prop'; props: Eigenschaft[] } {
  if (!body.trim()) return { modus: 'allprop', props: [] }
  const w = xmlLesen(body)
  if (!w || w.name !== 'propfind') throw davFehler(400, 'Ungültige PROPFIND-Anfrage.', 'Invalid PROPFIND request.')
  if (xmlFinde(w, 'propname')) return { modus: 'propname', props: [] }
  const p = xmlFinde(w, 'prop')
  if (p) return { modus: 'prop', props: p.kinder.map((k) => ({ ns: k.ns, name: k.name })).slice(0, 100) }
  return { modus: 'allprop', props: [] }
}

interface PropfindStand {
  quota?: { frei: number | null; belegt: number }
  sperren: Map<string, import('./davSperren').Sperre[]>
}
async function quotaVon(c: DavKontext, s: PropfindStand) {
  if (s.quota) return s.quota
  // belegt und frei aus demselben Stand (Dateien plus Papierkorb), damit used + available das Kontingent ergibt
  const stand = await quotaStand(c.u)
  let fr: number | null = stand.free
  if (fr == null) fr = (await platte())?.frei ?? null
  return (s.quota = { frei: fr, belegt: stand.used })
}
const element = (ns: string, name: string, inhalt: string | null) => {
  const [pre, deklaration] = ns === DAVNS ? ['D', ''] : ['x', ` xmlns:x="${xmlEsc(ns)}"`]
  return inhalt == null ? `<${pre}:${name}${deklaration}/>` : `<${pre}:${name}${deklaration}>${inhalt}</${pre}:${name}>`
}

/** Wert einer Eigenschaft als fertiges XML-Element; null = gibt es hier nicht (404). */
async function eigenschaft(
  c: DavKontext,
  k: Knoten,
  pfad: string[],
  p: Eigenschaft,
  s: PropfindStand,
  nurName: boolean
): Promise<string | null> {
  if (p.ns !== DAVNS) return null
  const behaelter = istBehaelter(k)
  const echt = k.art === 'datei' || k.art === 'ordner'
  const leer = (n: string) => element(DAVNS, n, null)
  switch (p.name) {
    case 'resourcetype':
      return nurName ? leer(p.name) : element(DAVNS, p.name, behaelter ? '<D:collection/>' : null)
    case 'displayname':
      return nurName ? leer(p.name) : element(DAVNS, p.name, xmlEsc(k.anzeige))
    case 'getcontentlength':
      return k.art === 'datei' ? (nurName ? leer(p.name) : element(DAVNS, p.name, String(Number(k.row.size)))) : null
    case 'getcontenttype':
      if (nurName) return leer(p.name)
      return element(DAVNS, p.name, k.art === 'datei' ? xmlEsc(k.row.mime || 'application/octet-stream') : 'httpd/unix-directory')
    case 'getlastmodified':
      return nurName ? leer(p.name) : element(DAVNS, p.name, rfc1123(echt ? (k as any).row.geaendert_at : new Date()))
    case 'creationdate':
      return nurName ? leer(p.name) : element(DAVNS, p.name, iso(echt ? (k as any).row.created_at : new Date()))
    case 'getetag': {
      const e = etagKnoten(k)
      return e ? (nurName ? leer(p.name) : element(DAVNS, p.name, xmlEsc(e))) : null
    }
    case 'supportedlock':
      if (nurName) return leer(p.name)
      return element(
        DAVNS,
        p.name,
        echt
          ? '<D:lockentry><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry>'
          : null
      )
    case 'lockdiscovery': {
      if (nurName) return leer(p.name)
      const r = resSchluessel(k)
      const liste = (r && s.sperren.get(r)) || []
      const eintraege: string[] = []
      for (const x of liste) eintraege.push(sperreXml(x, c, endpunkt(pfad, k), await tokenSichtbar(c, x, k)))
      return element(DAVNS, p.name, eintraege.join(''))
    }
    case 'quota-available-bytes': {
      if (!behaelter) return null
      if (nurName) return leer(p.name)
      const qv = await quotaVon(c, s)
      return qv.frei == null ? null : element(DAVNS, p.name, String(Math.round(qv.frei)))
    }
    case 'quota-used-bytes': {
      if (!behaelter) return null
      return nurName ? leer(p.name) : element(DAVNS, p.name, String((await quotaVon(c, s)).belegt))
    }
  }
  return null
}

async function propfind(c: DavKontext, teile: string[]) {
  const ev = c.event
  const tiefeKopf = String(getRequestHeader(ev, 'depth') ?? 'infinity').trim().toLowerCase()
  if (!['0', '1', 'infinity'].includes(tiefeKopf)) throw davFehler(400, 'Ungültiger Depth-Header.', 'Invalid Depth header.')
  const anfrage = propfindAnfrage(await koerperLesen(ev, MAX_XML))
  const { k } = await zuNode(c, teile)
  if (tiefeKopf === 'infinity' && istBehaelter(k))
    throw davFehler(
      403,
      'Depth: infinity wird nicht unterstützt.',
      'Depth: infinity is not supported.',
      {},
      '<D:error xmlns:D="DAV:"><D:propfind-finite-depth/></D:error>'
    )
  const eintraege: Array<{ k: Knoten; pfad: string[] }> = [{ k, pfad: teile }]
  if (tiefeKopf === '1' && istBehaelter(k))
    for (const x of await kinder(c, k)) eintraege.push({ k: x, pfad: [...teile, x.anzeige] })
  const schluessel = eintraege.map((e) => resSchluessel(e.k)).filter(Boolean) as string[]
  const stand: PropfindStand = { sperren: await sperrenMap(schluessel) }
  const proben: Eigenschaft[] =
    anfrage.modus === 'prop'
      ? anfrage.props
      : (anfrage.modus === 'propname' ? ALLE_PROPS : STANDARD_PROPS).map((n) => ({ ns: DAVNS, name: n }))
  let xml = '<D:multistatus xmlns:D="DAV:">'
  for (const e of eintraege) {
    const da: string[] = []
    const fehlt: string[] = []
    for (const p of proben) {
      const w = await eigenschaft(c, e.k, e.pfad, p, stand, anfrage.modus === 'propname')
      if (w == null) fehlt.push(element(p.ns, p.name, null))
      else da.push(w)
    }
    xml += `<D:response><D:href>${xmlEsc(endpunkt(e.pfad, e.k))}</D:href>`
    if (da.length || !fehlt.length)
      xml += `<D:propstat><D:prop>${da.join('')}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>`
    if (fehlt.length)
      xml += `<D:propstat><D:prop>${fehlt.join('')}</D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat>`
    xml += '</D:response>'
  }
  xml += '</D:multistatus>'
  xmlSenden(ev, 207, xml)
}

// ---------- PROPPATCH ----------
const MS_NS = 'urn:schemas-microsoft-com:'
async function proppatch(c: DavKontext, teile: string[]) {
  schreibenPruefen(c)
  const ev = c.event
  const body = await koerperLesen(ev, MAX_XML)
  const w = xmlLesen(body)
  if (!w || w.name !== 'propertyupdate') throw davFehler(400, 'Ungültige PROPPATCH-Anfrage.', 'Invalid PROPPATCH request.')
  const { k } = await zuNode(c, teile)
  if (k.art !== 'datei' && k.art !== 'ordner') throw davFehler(403, 'Hier nicht änderbar.', 'Not modifiable here.')
  if (!(await darfAendern(c, k))) throw davFehler(403, 'Keine Berechtigung.', 'No permission.')
  await schreibzugriff(c, { ziele: [k] })
  const posten: Array<{ p: Eigenschaft; wert: string; entfernen: boolean }> = []
  for (const op of w.kinder) {
    if (op.name !== 'set' && op.name !== 'remove') continue
    for (const pr of xmlFinde(op, 'prop')?.kinder || [])
      posten.push({ p: { ns: pr.ns, name: pr.name }, wert: pr.text.trim(), entfernen: op.name === 'remove' })
  }
  const aenderbar = (x: (typeof posten)[number]) =>
    (x.p.ns === DAVNS && x.p.name === 'getlastmodified') ||
    (x.p.ns.startsWith(MS_NS) && /^Win32(LastModifiedTime|CreationTime|LastAccessTime|FileAttributes)$/.test(x.p.name))
  const alleOk = posten.every(aenderbar)
  let mtime: Date | null = null
  if (alleOk)
    for (const x of posten) {
      if (x.entfernen) continue
      if (x.p.name === 'getlastmodified' || x.p.name === 'Win32LastModifiedTime') {
        const d = new Date(x.wert)
        if (!Number.isNaN(d.getTime()) && d.getTime() > 0 && d.getTime() < Date.now() + 86400_000 * 366) mtime = d
      }
    }
  if (alleOk && mtime) {
    if (k.art === 'datei') await q('UPDATE files SET geaendert_at = $2 WHERE id = $1', [k.row.id, mtime])
    else await q('UPDATE folders SET geaendert_at = $2 WHERE id = $1', [k.row.id, mtime])
  }
  const gruppen = new Map<string, string[]>()
  for (const x of posten) {
    const status = alleOk ? '200 OK' : aenderbar(x) ? '424 Failed Dependency' : '403 Forbidden'
    gruppen.set(status, [...(gruppen.get(status) || []), element(x.p.ns, x.p.name, null)])
  }
  let xml = `<D:multistatus xmlns:D="DAV:"><D:response><D:href>${xmlEsc(endpunkt(teile, k))}</D:href>`
  for (const [status, props] of gruppen)
    xml += `<D:propstat><D:prop>${props.join('')}</D:prop><D:status>HTTP/1.1 ${status}</D:status></D:propstat>`
  if (!gruppen.size) xml += '<D:propstat><D:prop/><D:status>HTTP/1.1 200 OK</D:status></D:propstat>'
  xml += '</D:response></D:multistatus>'
  xmlSenden(ev, 207, xml)
}

// ---------- GET / HEAD ----------
function sichererTyp(mime: string): string {
  if (AKTIV.test(mime)) return 'text/plain; charset=utf-8'
  return mime.startsWith('text/') ? `${mime}; charset=utf-8` : mime
}
function bereichAus(kopf: string, size: number): { start: number; end: number } | 'ungueltig' | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(kopf.trim())
  if (!m || (!m[1] && !m[2]) || size <= 0) return null
  let start = m[1] ? Number(m[1]) : NaN
  let end = m[2] ? Number(m[2]) : NaN
  if (Number.isNaN(start)) {
    start = Math.max(0, size - end)
    end = size - 1
  }
  if (Number.isNaN(end) || end >= size) end = size - 1
  if (start > end || start >= size) return 'ungueltig'
  return { start, end }
}

async function holen(c: DavKontext, teile: string[]) {
  const ev = c.event
  const { k } = await zuNode(c, teile)
  const kopfNur = ev.method === 'HEAD'
  if (k.art !== 'datei') {
    const liste = await kinder(c, k)
    const zeilen = liste
      .map((x) => {
        const o = istBehaelter(x)
        return `<li><a href="${xmlEsc(hrefVon([...teile, x.anzeige], o))}">${xmlEsc(x.anzeige)}${o ? '/' : ''}</a></li>`
      })
      .join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${xmlEsc(k.anzeige || 'VylarisCloud')}</title></head><body><h1>${xmlEsc(
      '/' + teile.join('/')
    )}</h1><ul>${zeilen}</ul></body></html>`
    return senden(ev, 200, html, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store'
    })
  }
  const f = k.row
  if (f.scan === 'fund')
    throw davFehler(403, 'Die Datei wurde als Schadsoftware erkannt.', 'The file was flagged as malware.')
  const size = Number(f.size)
  const etag = etagDatei(f)
  const mod = new Date(f.geaendert_at)
  mod.setMilliseconds(0)
  const typ = sichererTyp(f.mime || 'application/octet-stream')
  const name = encodeURIComponent(f.name).replace(/['()]/g, escape)
  const kopf: Kopf = {
    'Content-Type': typ,
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Last-Modified': mod.toUTCString(),
    'Cache-Control': 'private, no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': dateiCsp(typ),
    'Content-Disposition': `attachment; filename*=UTF-8''${name}`
  }
  const inm = String(getRequestHeader(ev, 'if-none-match') || '').trim()
  const ims = String(getRequestHeader(ev, 'if-modified-since') || '').trim()
  const im = String(getRequestHeader(ev, 'if-match') || '').trim()
  if (im && !(im === '*' || im.split(',').some((x) => etagGleich(x.trim(), etag))))
    throw davFehler(412, 'Die Datei hat sich geändert.', 'The file has changed.')
  if (inm ? inm === '*' || inm.split(',').some((x) => etagGleich(x.trim(), etag)) : ims && Date.parse(ims) >= mod.getTime())
    return senden(ev, 304, null, { ETag: etag, 'Last-Modified': mod.toUTCString() })
  let bereich = bereichAus(String(getRequestHeader(ev, 'range') || ''), size)
  const ifRange = String(getRequestHeader(ev, 'if-range') || '').trim()
  if (bereich && ifRange && !(ifRange.startsWith('"') || ifRange.startsWith('W/') ? etagGleich(ifRange, etag) : Date.parse(ifRange) === mod.getTime()))
    bereich = null
  if (bereich === 'ungueltig')
    return senden(ev, 416, null, { ...kopf, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 })
  if (ortVon(f.ablage) === 'lokal' && size > 0) {
    const da = await fs.stat(pfadVon(f.ablage)).then(
      () => true,
      () => false
    )
    if (!da) throw davFehler(404, 'Der Dateiinhalt fehlt im Speicher.', 'The file content is missing from storage.')
  }
  const laenge = bereich ? bereich.end - bereich.start + 1 : size
  const antwort: Kopf = {
    ...kopf,
    'Content-Length': laenge,
    ...(bereich ? { 'Content-Range': `bytes ${bereich.start}-${bereich.end}/${size}` } : {})
  }
  if (kopfNur || size === 0) return senden(ev, bereich ? 206 : 200, null, antwort)
  const res = ev.node.res
  res.statusCode = bereich ? 206 : 200
  res.setHeader('DAV', '1, 2')
  for (const [h, v] of Object.entries(antwort)) res.setHeader(h, v)
  const strom = await gezaehlt(lesen(f.ablage, bereich || undefined), f.user_id, f.id)
  try {
    await pipeline(strom, res)
  } catch {
    if (!res.writableEnded) res.destroy()
  }
}

// ---------- PUT ----------
async function putKern(c: DavKontext, teile: string[]) {
  schreibenPruefen(c)
  const ev = c.event
  // RFC 7231, 4.3.4: Content-Range bei PUT darf nicht ignoriert werden (sonst ersetzt das Teilstueck die ganze Datei)
  if (getRequestHeader(ev, 'content-range')) {
    ev.node.req.resume()
    throw davFehler(400, 'Content-Range wird bei PUT nicht unterstützt.', 'Content-Range is not supported for PUT.', {
      Connection: 'close'
    })
  }
  if (!teile.length) throw davFehler(405, 'Die Wurzel lässt sich nicht überschreiben.', 'The root cannot be overwritten.')
  if (!(await rechteVon(c.u)).hochladen)
    throw davFehler(403, 'Deine Rolle erlaubt keine Uploads.', 'Your role does not allow uploads.')
  const pruefen = async (a: Aufloesung) => {
    if (a.knoten && istBehaelter(a.knoten))
      throw davFehler(405, 'Das ist ein Ordner.', 'This is a folder.', { Allow: ERLAUBT })
    if (!a.knoten && !a.eltern)
      throw davFehler(409, 'Der übergeordnete Ordner existiert nicht.', 'The parent folder does not exist.')
    if (!a.knoten && endetMitSlash(ev))
      throw davFehler(409, 'Eine Datei darf nicht mit / enden.', 'A file name cannot end with /.')
    if (!a.knoten && a.kollision)
      throw davFehler(409, 'Es gibt schon einen Eintrag mit diesem Namen (Groß-/Kleinschreibung).', 'An entry with this name already exists (case-insensitive).')
    if (a.knoten) {
      if (!(await darfAendern(c, a.knoten))) throw davFehler(403, 'Du darfst diese Datei nicht ändern.', 'You may not modify this file.')
    } else {
      neuerNameOk(a.name)
      if (!(await darfHinein(c, a.eltern!)).datei)
        throw davFehler(403, 'Hier dürfen keine Dateien angelegt werden.', 'Files cannot be created here.')
    }
    vorbedingungen(ev, a.knoten ? etagKnoten(a.knoten) : null)
    await schreibzugriff(c, a.knoten ? { ziele: [a.knoten] } : { eltern: [a.eltern!] })
  }
  const frueh = await aufloesen(c, teile)
  await pruefen(frueh)
  // Vorabpruefung (nicht verbindlich): beim Ueberschreiben zaehlt das Konto des Dateibesitzers und das Team des Ordners
  const vorhanden = frueh.knoten && frueh.knoten.art === 'datei' ? frueh.knoten.row : null
  const zielOrdner = vorhanden ? vorhanden.folder_id : ordnerIdVon(frueh.eltern!)
  const besitzer = vorhanden && vorhanden.user_id !== c.u.id ? await nutzerVon(vorhanden.user_id) : null
  const lim = await limiten(c, vorhanden ? Number(vorhanden.size) : 0, zielOrdner, besitzer || undefined)
  const clRoh = getRequestHeader(ev, 'content-length')
  const cl = clRoh != null && /^\d+$/.test(String(clRoh)) ? Number(clRoh) : null
  if (cl != null && cl > lim.max) {
    ev.node.req.resume()
    throw zuGrossFehler(lim)
  }
  let g
  try {
    // Ablage-Regeln: neue Datei -> Ort nach den Regeln; Überschreiben bleibt am Ort der vorhandenen Datei (nur Verbote gelten).
    // Größe: Content-Length; ohne (chunked) unbekannt, Verbote werden dann nach dem Schreiben mit der echten Größe geprüft
    g = await schreiben(
      anfrageStrom(ev),
      lim.fuerSchreiben,
      vorhanden ? ortVon(vorhanden.ablage) : undefined,
      ablageKontextFuer(c.u, {
        name: vorhanden ? vorhanden.name : frueh.name,
        mime: String(getRequestHeader(ev, 'content-type') || '').split(';')[0]!.trim(),
        groesse: cl,
        ordnerId: zielOrdner
      })
    )
  } catch (e: any) {
    ev.node.req.resume()
    if (e?.ablage) throw davFehler(e.statusCode, e.message, e.message, { Connection: 'close' })
    if (e?.code === 'ZU_GROSS') throw zuGrossFehler(lim)
    if (e?.code === 'ABGEBROCHEN' || /aborted|ECONNRESET|abgebrochen/i.test(String(e?.message || e?.code))) {
      // Client hat abgebrochen: schreiben() hat die halbe Datei bereits entfernt, es gibt nichts zu antworten
      throw davFehler(400, 'Upload abgebrochen.', 'Upload aborted.', { Connection: 'close' })
    }
    throw e
  }
  if (cl != null && g.size !== cl) {
    await loeschen(g.schluessel)
    throw davFehler(400, 'Der Upload war unvollständig.', 'The upload was incomplete.', { Connection: 'close' })
  }
  const ctype = String(getRequestHeader(ev, 'content-type') || '').split(';')[0]!.trim()
  const mt = Number(getRequestHeader(ev, 'x-oc-mtime'))
  const mtime = Number.isFinite(mt) && mt > 0 && mt < Date.now() / 1000 + 86400 * 366 ? new Date(mt * 1000) : null
  const schluessel = (a: Aufloesung) => `${behaelterId(a.eltern || frueh.eltern!)}/${nameSchluessel(a.name)}`
  try {
    return await seriell(schluessel(frueh), async () => {
      const a = await aufloesen(c, teile)
      await pruefen(a)
      if (a.knoten && a.knoten.art === 'datei') {
        const f = a.knoten.row
        const mime = typErkennen(g.kopf, f.name, ctype)
        // verbindliche Pruefung unter der Kontingent-Sperre (Konto des Besitzers, Team des Ordners): nur die Differenz zur
        // alten Datei zaehlt, die alte Groesse wird innerhalb der Sperre neu gelesen (wie /api/files/[id]/inhalt.put)
        const grenze = await hatGrenze(f.user_id, f.folder_id)
        const setzen = async (x: Ausf) => {
          if (grenze.begrenzt) {
            const jetzt = (await x('SELECT size, folder_id FROM files WHERE id = $1', [f.id]))[0]
            await kontingentPruefen(grenze.nutzer, g.size, {
              ordner: jetzt ? jetzt.folder_id : f.folder_id,
              ersetzt: Number(jetzt?.size ?? f.size),
              x
            })
          }
          return (
            await x(
              `WITH alt AS (SELECT id, ablage FROM files WHERE id = $1 FOR UPDATE)
          UPDATE files f SET ablage = $2, size = $3, sha256 = $4, mime = $5, art = $6, geaendert_at = coalesce($7, now()),
            verarbeitung = 'offen', vorschau = false, streifen = 0, wellen = NULL, width = NULL, height = NULL, duration_ms = NULL,
            exif_entfernt = false, ansicht = false, live = false, live_mp4 = false, verschluesselt = false, scan = '', scan_info = '',
            verarbeitung_seit = NULL, verarbeitet_von = NULL
          FROM alt WHERE f.id = alt.id RETURNING alt.ablage AS alte_ablage, f.geaendert_at, f.created_at`,
              [f.id, g.schluessel, g.size, g.sha256, mime, artVon(mime, f.name), mtime]
            )
          )[0] as { alte_ablage: string; geaendert_at: string; created_at: string } | undefined
        }
        const r = grenze.begrenzt ? await mitKontingentSperre(f.user_id, grenze.team, setzen) : await setzen((sql, p = []) => q(sql, p))
        if (!r) throw davFehler(404, 'Die Datei wurde inzwischen gelöscht.', 'The file has since been deleted.')
        if (r.alte_ablage !== g.schluessel && !(await q1('SELECT 1 FROM files WHERE ablage = $1', [r.alte_ablage])))
          await loeschen(r.alte_ablage)
        await variantenLoeschen(f.id)
        verarbeiten(f.id)
        const neu = { ...f, sha256: g.sha256, size: String(g.size) }
        await ordnerBeruehren(f.folder_id)
        await ereignis('file_edited', c.u.id, { name: f.name.slice(0, 80), via: 'dav' }, clientIp(ev))
        const z = await q1<DateiZeile>('SELECT * FROM files WHERE id = $1', [f.id])
        if (z) webhookAusloesen(z.user_id, 'file.uploaded', { file: alsApi(fuerPanel(await basisUrl(ev), z)) })
        speicherWarnung(c)
        return senden(ev, 204, null, { ETag: etagDatei(neu), 'Last-Modified': rfc1123(r.geaendert_at), ...(mtime ? { 'X-OC-Mtime': 'accepted' } : {}) })
      }
      const ordner = ordnerIdVon(a.eltern!)
      const z = await dateiAnlegen(c.u.id, g, a.name, ctype, { ordner, name: a.name }, c.u.prefs?.lang === 'en' ? 'en' : 'de')
      if (mtime) await q('UPDATE files SET geaendert_at = $2 WHERE id = $1', [z.id, mtime])
      await ordnerBeruehren(ordner)
      await ereignis('upload', c.u.id, { anzahl: 1, via: 'dav' }, clientIp(ev))
      webhookAusloesen(c.u.id, 'file.uploaded', { file: alsApi(fuerPanel(await basisUrl(ev), z)) })
      speicherWarnung(c)
      return senden(ev, 201, null, {
        ETag: etagDatei({ ...(z as any), sha256: g.sha256 }),
        Location: hrefVon(teile, false),
        'Content-Length': 0,
        ...(mtime ? { 'X-OC-Mtime': 'accepted' } : {})
      })
    })
  } catch (e) {
    await loeschen(g.schluessel).catch(() => {})
    throw e
  }
}

// ---------- DELETE ----------
async function inKorb(c: DavKontext, f: { id: string; user_id: number; name: string }) {
  const z = await q1<{ slug: string }>('SELECT slug FROM files WHERE id = $1', [f.id])
  if (await inPapierkorb({ id: f.id }, c.u.id))
    webhookAusloesen(f.user_id, 'file.deleted', {
      file: { id: String(f.id), slug: z?.slug, name: f.name },
      trashed: true,
      by: c.u.username
    })
}
/** Datei oder Ordner (rekursiv) in den Papierkorb. Dateien landen dort, Ordner werden entfernt. */
async function knotenLoeschen(c: DavKontext, k: Knoten): Promise<number> {
  if (k.art === 'datei') {
    await inKorb(c, k.row)
    await sperrenEntfernen([`f${k.row.id}`])
    await ordnerBeruehren(k.row.folder_id)
    await ereignis('file_deleted', c.u.id, { name: k.row.name.slice(0, 80), via: 'dav' }, clientIp(c.event))
    return 1
  }
  if (k.art !== 'ordner') throw davFehler(403, 'Das lässt sich nicht löschen.', 'This cannot be deleted.')
  const ids = await unterOrdner(k.row.id)
  const dateien = await q<{ id: string; user_id: number; name: string }>(
    'SELECT id, user_id, name FROM files WHERE folder_id = ANY($1::int[]) ORDER BY id',
    [ids]
  )
  for (const f of dateien) await inKorb(c, f)
  await sperrenEntfernen([...ids.map((i) => `o${i}`), ...dateien.map((f) => `f${f.id}`)])
  await q('DELETE FROM folders WHERE id = $1', [k.row.id])
  await ordnerBeruehren(k.row.parent_id)
  await ereignis('files_deleted', c.u.id, { anzahl: dateien.length, ordner: k.row.name.slice(0, 80), via: 'dav' }, clientIp(c.event))
  return dateien.length
}
/** Darf der Nutzer den Ordner samt Inhalt entfernen? Fremde Inhalte nur die Team-Leitung. */
async function ordnerLoeschenErlaubt(c: DavKontext, k: Knoten): Promise<boolean> {
  if (k.art !== 'ordner') return false
  const r = await ordnerRecht(c.u.id, k.row.id)
  if (!r?.verwalten) return false
  if (r.leitung) return true
  const ids = await unterOrdner(k.row.id)
  const fremd = await q1<{ n: string }>(
    `SELECT (SELECT count(*) FROM files WHERE folder_id = ANY($1::int[]) AND user_id <> $2)
      + (SELECT count(*) FROM folders WHERE id = ANY($1::int[]) AND user_id <> $2) AS n`,
    [ids, c.u.id]
  )
  return Number(fremd?.n || 0) === 0
}

async function loeschenMethode(c: DavKontext, teile: string[]) {
  schreibenPruefen(c)
  const { a, k } = await zuNode(c, teile)
  if (k.art !== 'datei' && k.art !== 'ordner') throw davFehler(403, 'Das lässt sich nicht löschen.', 'This cannot be deleted.')
  if (k.art === 'datei' ? !(await darfAendern(c, k)) : !(await ordnerLoeschenErlaubt(c, k)))
    throw davFehler(403, 'Dafür fehlt dir die Berechtigung.', 'You do not have permission for this.')
  vorbedingungen(c.event, etagKnoten(k))
  await schreibzugriff(c, { ziele: [k], eltern: a.eltern ? [a.eltern] : [], mitNachkommen: [k] })
  const n = await knotenLoeschen(c, k)
  if (n >= 0) senden(c.event, 204)
}

// ---------- MKCOL ----------
async function mkcol(c: DavKontext, teile: string[]) {
  schreibenPruefen(c)
  const ev = c.event
  if (hatKoerper(ev)) {
    ev.node.req.resume()
    throw davFehler(415, 'MKCOL mit Inhalt wird nicht unterstützt.', 'MKCOL with a body is not supported.', { Connection: 'close' })
  }
  if (!teile.length) throw davFehler(405, 'Existiert bereits.', 'Already exists.', { Allow: ERLAUBT })
  const frueh = await aufloesen(c, teile)
  if (frueh.knoten || frueh.kollision) throw davFehler(405, 'Existiert bereits.', 'Already exists.', { Allow: ERLAUBT })
  if (!frueh.eltern) throw davFehler(409, 'Der übergeordnete Ordner existiert nicht.', 'The parent folder does not exist.')
  neuerNameOk(frueh.name)
  await seriell(`${behaelterId(frueh.eltern)}/${nameSchluessel(frueh.name)}`, async () => {
    const a = await aufloesen(c, teile)
    if (a.knoten || a.kollision) throw davFehler(405, 'Existiert bereits.', 'Already exists.', { Allow: ERLAUBT })
    const eltern = a.eltern
    if (!eltern) throw davFehler(409, 'Der übergeordnete Ordner existiert nicht.', 'The parent folder does not exist.')
    if (!(await darfHinein(c, eltern)).ordner)
      throw davFehler(403, 'Hier dürfen keine Ordner angelegt werden.', 'Folders cannot be created here.')
    await schreibzugriff(c, { eltern: [eltern] })
    if (!(await ordnerAnzahlOk(c.u.id)))
      throw davFehler(507, 'Höchstens 1.000 Ordner.', 'At most 1,000 folders.')
    const team = await teamVon(c, eltern)
    await q('INSERT INTO folders (user_id, parent_id, name, team_id) VALUES ($1, $2, $3, $4)', [
      c.u.id,
      ordnerIdVon(eltern),
      a.name,
      team
    ])
    await ordnerBeruehren(ordnerIdVon(eltern))
  })
  senden(ev, 201, null, { Location: hrefVon(teile, true), 'Content-Length': 0 })
}

// ---------- MOVE / COPY ----------
async function zielTeile(ev: H3Event): Promise<string[]> {
  const d = String(getRequestHeader(ev, 'destination') || '').trim()
  if (!d) throw davFehler(400, 'Destination fehlt.', 'Destination header is missing.')
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(d)
  if (m) {
    // Absolute Adresse: der Host muss zu diesem Server gehoeren (Host-Header, X-Forwarded-Host oder die eingestellte Domain)
    const nurHost = (h: string) => h.split(',')[0]!.trim().toLowerCase().replace(/:\d+$/, '')
    const erlaubt = new Set(
      [getRequestHeader(ev, 'host'), getRequestHeader(ev, 'x-forwarded-host'), (await getNet()).domain]
        .filter(Boolean)
        .map((h) => nurHost(String(h)))
    )
    if (!erlaubt.has(nurHost(m[1]!.replace(/^[^@]*@/, ''))))
      throw davFehler(502, 'Das Ziel liegt auf einem anderen Server.', 'The destination is on another server.')
  }
  const pfad = d.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '').split('?')[0]!.split('#')[0]!
  if (pfad !== DAV_BASIS && !pfad.startsWith(DAV_BASIS + '/'))
    throw davFehler(502, 'Das Ziel liegt auf einem anderen Server.', 'The destination is on another server.')
  return teileAusPfad(pfad)
}
const gleicherKnoten = (a: Knoten, b: Knoten) =>
  a.art === b.art &&
  ((a.art === 'datei' && b.art === 'datei' && a.row.id === b.row.id) ||
    (a.art === 'ordner' && b.art === 'ordner' && a.row.id === b.row.id) ||
    (a.art === 'team' && b.art === 'team' && a.team.team_id === b.team.team_id) ||
    a.art === 'wurzel' ||
    a.art === 'teams')

/** Freier Platz am Ziel: beim Ablegen direkt im Team-Ordner-Wurzelknoten zaehlt zusaetzlich das Team-Kontingent */
async function zielFrei(eltern: Knoten, frei: number): Promise<number> {
  if (eltern.art !== 'team') return frei
  const t = await teamStand(eltern.team.team_id)
  return t?.free != null ? Math.min(frei, t.free) : frei
}
/** Besteht der Ordnerbaum nur aus Dateien und Ordnern des Nutzers? (sonst darf er das Team nicht mit ihnen verlassen) */
async function teilbaumNurEigen(id: number, userId: number): Promise<boolean> {
  const ids = await unterOrdner(id)
  const fremd = await q1<{ n: string }>(
    `SELECT (SELECT count(*) FROM files WHERE folder_id = ANY($1::int[]) AND user_id <> $2)
      + (SELECT count(*) FROM folders WHERE id = ANY($1::int[]) AND user_id <> $2) AS n`,
    [ids, userId]
  )
  return Number(fremd?.n || 0) === 0
}

interface Teilfehler {
  pfad: string[]
  status: number
}

/** `vorAnlegen` laeuft, nachdem der Inhalt kopiert ist und bevor die Datei angelegt wird (hier wird ein Ziel ersetzt) */
async function dateiKopieren(
  c: DavKontext,
  f: DateiZeile2,
  ordner: number | null,
  name: string,
  lim: Awaited<ReturnType<typeof limiten>>,
  vorAnlegen?: () => Promise<void>
) {
  const quelle = await q1<{ verschluesselt: boolean; mime: string }>('SELECT verschluesselt, mime FROM files WHERE id = $1', [f.id])
  let g
  try {
    // Die Kopie folgt den Ablage-Regeln des Ziels (Name, Typ, Größe der Quelle, Konto des Kopierenden, Zielordner)
    g = await schreiben(
      lesen(f.ablage),
      lim.fuerSchreiben,
      undefined,
      ablageKontextFuer(c.u, { name, mime: quelle?.mime || f.mime, groesse: Number(f.size), ordnerId: ordner })
    )
  } catch (e: any) {
    if (e?.ablage) throw davFehler(e.statusCode, e.message, e.message)
    if (e?.code === 'ZU_GROSS') throw zuGrossFehler(lim)
    throw e
  }
  try {
    await vorAnlegen?.()
  } catch (e) {
    await loeschen(g.schluessel).catch(() => {})
    throw e
  }
  await dateiAnlegen(
    c.u.id,
    g,
    name,
    quelle?.mime || f.mime,
    { ordner, name, verschluesselt: !!quelle?.verschluesselt },
    c.u.prefs?.lang === 'en' ? 'en' : 'de'
  )
}

async function ordnerKopieren(
  c: DavKontext,
  quelle: Knoten,
  eltern: Knoten,
  name: string,
  tief: boolean,
  fehlerListe: Teilfehler[],
  pfad: string[],
  lim: Awaited<ReturnType<typeof limiten>>
) {
  if (!(await ordnerAnzahlOk(c.u.id))) throw davFehler(507, 'Höchstens 1.000 Ordner.', 'At most 1,000 folders.')
  const team = await teamVon(c, eltern)
  const neu = await q1<{ id: number }>('INSERT INTO folders (user_id, parent_id, name, team_id) VALUES ($1, $2, $3, $4) RETURNING id', [
    c.u.id,
    ordnerIdVon(eltern),
    name,
    team
  ])
  if (!tief || !neu) return
  const knotenNeu: Knoten = {
    art: 'ordner',
    anzeige: name,
    row: { id: neu.id, user_id: c.u.id, parent_id: ordnerIdVon(eltern), team_id: team, name, created_at: '', geaendert_at: '' }
  }
  for (const k of await kinder(c, quelle)) {
    const p = [...pfad, k.anzeige]
    try {
      if (k.art === 'datei') await dateiKopieren(c, k.row, neu.id, k.anzeige, lim)
      else if (k.art === 'ordner') await ordnerKopieren(c, k, knotenNeu, k.anzeige, true, fehlerListe, p, lim)
    } catch (e: any) {
      const status = statusVon(e)
      fehlerListe.push({ pfad: p, status })
      if (status === 500) console.error('[vylariscloud] WebDAV COPY:', e?.message || e)
    }
  }
}

async function ordnerGroesse(ids: number[]): Promise<number> {
  const r = await q1<{ s: string }>('SELECT coalesce(sum(size), 0) AS s FROM files WHERE folder_id = ANY($1::int[])', [ids])
  return Number(r?.s || 0)
}

async function verschiebenKopieren(c: DavKontext, teile: string[], kopie: boolean) {
  schreibenPruefen(c)
  // Kopieren legt neue Dateien an: dieselbe Rollenregel wie bei PUT und beim Kopieren im Dateimanager
  if (kopie && !(await rechteVon(c.u)).hochladen)
    throw davFehler(403, 'Deine Rolle erlaubt keine Uploads.', 'Your role does not allow uploads.')
  const ev = c.event
  const { a: quelleA, k: quelle } = await zuNode(c, teile)
  if (quelle.art !== 'datei' && quelle.art !== 'ordner')
    throw davFehler(403, 'Dieser Eintrag lässt sich nicht verschieben oder kopieren.', 'This entry cannot be moved or copied.')
  const zT = await zielTeile(ev)
  if (!zT.length) throw davFehler(403, 'Die Wurzel kann nicht überschrieben werden.', 'The root cannot be overwritten.')
  const ueberschreiben = String(getRequestHeader(ev, 'overwrite') || 'T').trim().toUpperCase() !== 'F'
  const tiefKopf = String(getRequestHeader(ev, 'depth') ?? 'infinity').trim().toLowerCase()
  if (kopie && !['0', 'infinity'].includes(tiefKopf)) throw davFehler(400, 'Ungültiger Depth-Header.', 'Invalid Depth header.')
  const ziel = await aufloesen(c, zT)
  if (!ziel.knoten && !ziel.eltern)
    throw davFehler(409, 'Der Zielordner existiert nicht.', 'The destination folder does not exist.')
  if (ziel.knoten && gleicherKnoten(ziel.knoten, quelle))
    throw davFehler(403, 'Quelle und Ziel sind identisch.', 'Source and destination are the same.')
  if (ziel.knoten && quelleA.kette.some((x) => gleicherKnoten(x, ziel.knoten!)))
    throw davFehler(403, 'Das Ziel liegt über der Quelle.', 'The destination contains the source.')
  if (quelle.art === 'ordner' && ziel.kette.some((x) => gleicherKnoten(x, quelle)))
    throw davFehler(403, 'Ein Ordner kann nicht in sich selbst liegen.', 'A folder cannot be inside itself.')
  if (quelle.art === 'ordner' && !ziel.knoten && ziel.eltern && gleicherKnoten(ziel.eltern, quelle))
    throw davFehler(403, 'Ein Ordner kann nicht in sich selbst liegen.', 'A folder cannot be inside itself.')
  // Umbenennung nur der Gross-/Kleinschreibung (m1.txt -> M1.TXT): die "Kollision" ist die Quelle selbst, das ist erlaubt
  if (!ziel.knoten && ziel.kollision && (kopie || !gleicherKnoten(ziel.kollision, quelle)))
    throw davFehler(409, 'Es gibt schon einen Eintrag mit diesem Namen (Groß-/Kleinschreibung).', 'An entry with this name already exists (case-insensitive).')
  const eltern = ziel.knoten ? ziel.kette[ziel.kette.length - 2]! : ziel.eltern!
  const zielName = ziel.name
  neuerNameOk(zielName)
  if (ziel.knoten && !ueberschreiben)
    throw davFehler(412, 'Das Ziel existiert bereits.', 'The destination already exists.')
  if (ziel.knoten && ziel.knoten.art !== 'datei' && ziel.knoten.art !== 'ordner')
    throw davFehler(403, 'Das Ziel lässt sich nicht überschreiben.', 'The destination cannot be overwritten.')
  // Rechte
  const darf = await darfHinein(c, eltern)
  if (quelle.art === 'datei' ? !darf.datei : !darf.ordner)
    throw davFehler(403, 'Im Ziel darfst du das nicht anlegen.', 'You cannot create this at the destination.')
  if (!kopie && !(await darfAendern(c, quelle)))
    throw davFehler(403, 'Dafür fehlt dir die Berechtigung.', 'You do not have permission for this.')
  if (ziel.knoten) {
    const ok = ziel.knoten.art === 'datei' ? await darfAendern(c, ziel.knoten) : await ordnerLoeschenErlaubt(c, ziel.knoten)
    if (!ok) throw davFehler(403, 'Das Ziel darfst du nicht überschreiben.', 'You may not overwrite the destination.')
  }
  // Sperren
  await schreibzugriff(c, {
    ziele: ziel.knoten ? [ziel.knoten] : [],
    eltern: [eltern, ...(!kopie && quelleA.eltern ? [quelleA.eltern] : [])],
    ...(ziel.knoten ? { mitNachkommen: [ziel.knoten] } : {})
  })
  if (!kopie) await schreibzugriff(c, { ziele: [quelle], mitNachkommen: [quelle] })
  const status = ziel.knoten ? 204 : 201
  const locationKopf = { Location: hrefVon(zT, quelle.art === 'ordner'), 'Content-Length': 0 }
  const zielOrdner = ordnerIdVon(eltern)
  // Ein vorhandenes Ziel kommt erst in den Papierkorb, wenn alle Pruefungen bestanden sind (ein fehlgeschlagener Befehl
  // darf das Ziel nicht veraendern). Der Papierkorb zaehlt weiter zum Kontingent, das Ziel bringt also keinen Platz zurueck.
  const zielLoeschen = async () => {
    if (ziel.knoten) await knotenLoeschen(c, ziel.knoten)
  }

  return await seriell(`${behaelterId(eltern)}/${nameSchluessel(zielName)}`, async () => {
    if (kopie) {
      const fehlerListe: Teilfehler[] = []
      if (quelle.art === 'datei') {
        const lim = await limiten(c, 0, zielOrdner)
        if (Number(quelle.row.size) > (await zielFrei(eltern, lim.frei))) throw zuGrossFehler({ frei: lim.frei, datei: Infinity })
        // das Ziel wird erst ersetzt, wenn der Inhalt kopiert ist
        await dateiKopieren(c, quelle.row, zielOrdner, zielName, lim, zielLoeschen)
      } else {
        const tief = tiefKopf !== '0'
        const lim = await limiten(c, 0, zielOrdner)
        if (tief && Number(await ordnerGroesse(await unterOrdner(quelle.row.id))) > (await zielFrei(eltern, lim.frei)))
          throw davFehler(507, 'Nicht genug Speicherplatz.', 'Insufficient storage.')
        await zielLoeschen()
        await ordnerKopieren(c, quelle, eltern, zielName, tief, fehlerListe, zT, lim)
      }
      await ordnerBeruehren(zielOrdner)
      if (fehlerListe.length) {
        let xml = '<D:multistatus xmlns:D="DAV:">'
        for (const f of fehlerListe)
          xml += `<D:response><D:href>${xmlEsc(hrefVon(f.pfad, false))}</D:href><D:status>HTTP/1.1 ${f.status} ${f.status === 507 ? 'Insufficient Storage' : 'Error'}</D:status></D:response>`
        return xmlSenden(ev, 207, xml + '</D:multistatus>')
      }
      return senden(ev, status, null, locationKopf)
    }
    // MOVE
    if (quelle.art === 'datei') {
      if (eltern.art === 'wurzel' && quelle.row.user_id !== c.u.id)
        throw davFehler(403, 'Fremde Dateien bleiben im Team-Ordner.', "Other people's files stay in the team folder.")
      const mime =
        (quelle.row as any).verschluesselt || endungGleich(quelle.row.name, zielName)
          ? quelle.row.mime
          : typErkennen(Buffer.alloc(0), zielName, quelle.row.mime)
      const art = (quelle.row as any).verschluesselt ? 'datei' : artVon(mime, zielName)
      // Team-Kontingent des Ziels: die Datei zaehlt im Ziel-Team neu (ausser sie liegt dort schon)
      const vonTeam = await teamVonOrdner(quelle.row.folder_id)
      await verschiebenPruefen({ ordner: zielOrdner }, Number(quelle.row.size), vonTeam, async (x) => {
        await zielLoeschen()
        await x('UPDATE files SET name = $2, folder_id = $3, mime = $4, art = $5, geaendert_at = now() WHERE id = $1', [
          quelle.row.id,
          zielName,
          zielOrdner,
          mime,
          art
        ])
      })
      await sperrenEntfernen([`f${quelle.row.id}`])
      await ordnerBeruehren(quelle.row.folder_id)
      await ordnerBeruehren(zielOrdner)
      return senden(ev, status, null, locationKopf)
    }
    // Ordner verschieben
    const id = quelle.row.id
    const r = await ordnerRecht(c.u.id, id)
    const vonTeam = r?.team_id ?? null
    let zielTeam: number | null = null
    if (eltern.art === 'teams') throw davFehler(403, 'Hier lassen sich keine Ordner ablegen.', 'Folders cannot be placed here.')
    if (eltern.art === 'team') {
      zielTeam = eltern.team.team_id
    } else if (eltern.art === 'wurzel') {
      if (r?.team_id && !r.eigen)
        throw davFehler(403, 'Ein Team-Ordner bleibt im Team.', 'A team folder stays in the team.')
    } else if (eltern.art === 'ordner') {
      const zr = await ordnerRecht(c.u.id, eltern.row.id)
      if (!zr?.hineinladen) throw davFehler(403, 'Im Ziel darfst du das nicht anlegen.', 'You cannot create this at the destination.')
      if (!zr.team_id && quelle.row.user_id !== c.u.id)
        throw davFehler(403, 'Fremde Ordner bleiben im Team.', "Other people's folders stay in the team.")
      zielTeam = zr.team_id
    }
    let bytes = 0
    if (zielTeam !== vonTeam) {
      // Der Teilbaum wechselt das Team: Inhalte anderer Mitglieder wuerden sonst fuer ihre Besitzer unsichtbar (oder an ein
      // anderes Team gehen) und der Zuwachs muss ins Team-Kontingent des Ziels passen
      if (!(await teilbaumNurEigen(id, c.u.id)))
        throw davFehler(
          403,
          'Der Ordner enthält Dateien oder Ordner anderer Mitglieder und bleibt im Team.',
          "The folder contains other members' files or folders and stays in the team."
        )
      if (zielTeam) {
        bytes = await ordnerBaumBytes(id)
        await kontingentPruefen(null, bytes, { zielTeam, vonTeam, mehrere: true })
      }
    }
    // Zyklenpruefung, Kontingent und Umhaengen gemeinsam unter einer Sperre (im Prozess und in der Datenbank): zwei
    // gegenlaeufige Verschiebungen (A nach B/A und B nach A/B) duerfen sich nicht gegenseitig zum Zyklus machen
    await seriell('ordner-umhaengen', () =>
      mitKontingentSperre(null, zielTeam && zielTeam !== vonTeam ? zielTeam : null, async (x) => {
        await x('SELECT pg_advisory_lock($1, $2)', [7103, 1])
        if (eltern.art === 'ordner') {
          const zyklus = await x(
            `WITH RECURSIVE o(id, parent_id, n) AS (SELECT id, parent_id, 0 FROM folders WHERE id = $1
              UNION ALL SELECT f.id, f.parent_id, o.n + 1 FROM folders f JOIN o ON f.id = o.parent_id WHERE o.n < 64)
            SELECT 1 FROM o WHERE id = $2`,
            [eltern.row.id, id]
          )
          if (zyklus.length)
            throw davFehler(403, 'Ein Ordner kann nicht in sich selbst liegen.', 'A folder cannot be inside itself.')
        }
        if (zielTeam && zielTeam !== vonTeam) await kontingentPruefen(null, bytes, { zielTeam, vonTeam, mehrere: true, x })
        await zielLoeschen()
        await x(
          `WITH RECURSIVE unter(id) AS (SELECT $1::int UNION SELECT f.id FROM folders f JOIN unter ON f.parent_id = unter.id)
          UPDATE folders SET team_id = $2 WHERE id IN (SELECT id FROM unter)`,
          [id, zielTeam]
        )
        await x('UPDATE folders SET name = $2, parent_id = $3, geaendert_at = now() WHERE id = $1', [id, zielName, zielOrdner])
      })
    )
    await ordnerBeruehren(quelle.row.parent_id)
    await ordnerBeruehren(zielOrdner)
    return senden(ev, status, null, locationKopf)
  })
}
const endungGleich = (a: string, b: string) =>
  (/\.([^.]{1,10})$/.exec(a)?.[1] || '').toLowerCase() === (/\.([^.]{1,10})$/.exec(b)?.[1] || '').toLowerCase()

// ---------- LOCK / UNLOCK ----------
async function lockMethode(c: DavKontext, teile: string[]) {
  schreibenPruefen(c)
  const ev = c.event
  const timeout = timeoutAus(ev)
  const body = await koerperLesen(ev, MAX_XML)
  const einmal = (s: any) => ({
    ok: true,
    xml: `<D:prop xmlns:D="DAV:"><D:lockdiscovery>${sperreXml(s, c, hrefVon(teile, false))}</D:lockdiscovery></D:prop>`
  })
  // Erneuern: kein Body, Token im If-Header
  if (!body.trim()) {
    const { k } = await zuNode(c, teile)
    const tokens = [...(String(getRequestHeader(ev, 'if') || '').matchAll(/<(opaquelocktoken:[0-9a-fA-F-]{8,64})>/g))].map((m) => m[1]!)
    const gueltig = (await sperrenFuer(k)).filter((s) => tokens.includes(s.token))
    if (!gueltig.length) throw davFehler(412, 'Keine passende Sperre zum Erneuern.', 'No matching lock to refresh.')
    const s = await sperreErneuern(c, gueltig[0]!.token, timeout)
    if (!s) throw davFehler(412, 'Die Sperre ist abgelaufen.', 'The lock has expired.')
    return xmlSenden(ev, 200, einmal(s).xml, { 'Lock-Token': `<${s.token}>` })
  }
  const w = xmlLesen(body)
  if (!w || w.name !== 'lockinfo') throw davFehler(400, 'Ungültige LOCK-Anfrage.', 'Invalid LOCK request.')
  const owner = xmlFinde(w, 'owner')
  const besitzer = ((owner && (collect(owner) || owner.text)) || c.u.username).trim().slice(0, 256)
  const tiefe: '0' | 'infinity' = String(getRequestHeader(ev, 'depth') ?? 'infinity').trim() === '0' ? '0' : 'infinity'
  let a = await aufloesen(c, teile)
  let angelegt = false
  if (!a.knoten) {
    if (endetMitSlash(ev) && a.eltern) throw davFehler(404, 'Nicht gefunden.', 'Not found.')
    if (!a.eltern) throw davFehler(409, 'Der übergeordnete Ordner existiert nicht.', 'The parent folder does not exist.')
    if (a.kollision) throw davFehler(409, 'Es gibt schon einen Eintrag mit diesem Namen.', 'An entry with this name already exists.')
    neuerNameOk(a.name)
    if (!(await rechteVon(c.u)).hochladen) throw davFehler(403, 'Deine Rolle erlaubt keine Uploads.', 'Your role does not allow uploads.')
    if (!(await darfHinein(c, a.eltern)).datei)
      throw davFehler(403, 'Hier dürfen keine Dateien angelegt werden.', 'Files cannot be created here.')
    await schreibzugriff(c, { eltern: [a.eltern] })
    // gesperrte, noch nicht vorhandene Adresse: leere Datei anlegen (RFC 4918, 7.3)
    await seriell(`${behaelterId(a.eltern)}/${nameSchluessel(a.name)}`, async () => {
      const b = await aufloesen(c, teile)
      if (b.knoten) return
      const g = await schreiben(Readable.from([]), 0, undefined, ablageKontextFuer(c.u, { name: a.name, groesse: 0, ordnerId: ordnerIdVon(a.eltern!) }))
      await dateiAnlegen(c.u.id, g, a.name, '', { ordner: ordnerIdVon(a.eltern!), name: a.name }, c.u.prefs?.lang === 'en' ? 'en' : 'de')
      angelegt = true
    })
    a = await aufloesen(c, teile)
    if (!a.knoten) throw davFehler(409, 'Anlegen fehlgeschlagen.', 'Creation failed.')
  } else {
    // sperren darf, wer die Ressource auch aendern darf (Ordner: nur Besitzer und Team-Leitung, nicht jedes Mitglied)
    if (!(await darfAendern(c, a.knoten)))
      throw davFehler(403, 'Dafür fehlt dir die Berechtigung.', 'You do not have permission for this.')
  }
  const k = a.knoten
  const s = await sperreAnlegen(c, k, k.art === 'datei' ? '0' : tiefe, besitzer, timeout)
  xmlSenden(ev, angelegt ? 201 : 200, einmal(s).xml, { 'Lock-Token': `<${s.token}>` })
}
function collect(k: XmlKnoten): string {
  return (k.text + k.kinder.map(collect).join(' ')).trim()
}

async function unlockMethode(c: DavKontext, teile: string[]) {
  schreibenPruefen(c)
  const ev = c.event
  const token = /^<?\s*(opaquelocktoken:[0-9a-fA-F-]{8,64})\s*>?$/.exec(String(getRequestHeader(ev, 'lock-token') || '').trim())?.[1]
  if (!token) throw davFehler(400, 'Lock-Token fehlt.', 'Lock-Token header is missing.')
  const { k } = await zuNode(c, teile)
  if (!(await sperreAufheben(c, token, k)))
    throw davFehler(409, 'Diese Sperre gehört nicht zu dieser Adresse.', 'This lock does not belong to this resource.')
  senden(ev, 204)
}

// ---------- Einstieg ----------
export async function davBehandeln(event: H3Event) {
  const methode = String(event.method || 'GET').toUpperCase()
  try {
    // Browser-Anfragen von fremden Seiten (CSRF) ablehnen: nur Methoden ohne Preflight-Schutz gefaehrden uns, aber sicher ist sicher
    if (!['GET', 'HEAD', 'OPTIONS', 'PROPFIND'].includes(methode)) {
      const origin = getRequestHeader(event, 'origin')
      if (origin) {
        let ok = false
        try {
          ok = new URL(origin).host === getRequestHeader(event, 'host')
        } catch {
          ok = false
        }
        if (!ok) throw davFehler(403, 'Anfrage von fremder Seite abgelehnt.', 'Request from another site rejected.')
      }
    }
    const c = await davAnmelden(event)
    if (methode === 'OPTIONS') return options(c)
    if (BEKANNT_ABGELEHNT.has(methode))
      throw davFehler(405, 'Methode nicht erlaubt.', 'Method not allowed.', { Allow: ERLAUBT })
    const teile = pfadTeile(event)
    switch (methode) {
      case 'PROPFIND':
        return await propfind(c, teile)
      case 'PROPPATCH':
        return await proppatch(c, teile)
      case 'GET':
      case 'HEAD':
        return await holen(c, teile)
      case 'PUT':
        return await putKern(c, teile)
      case 'DELETE':
        return await loeschenMethode(c, teile)
      case 'MKCOL':
        return await mkcol(c, teile)
      case 'MOVE':
        return await verschiebenKopieren(c, teile, false)
      case 'COPY':
        return await verschiebenKopieren(c, teile, true)
      case 'LOCK':
        return await lockMethode(c, teile)
      case 'UNLOCK':
        return await unlockMethode(c, teile)
      default:
        throw davFehler(501, 'Methode nicht implementiert.', 'Method not implemented.', { Allow: ERLAUBT })
    }
  } catch (e) {
    return fehlerSenden(event, e)
  }
}
