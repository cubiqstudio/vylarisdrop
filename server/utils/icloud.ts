import { createHash, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto'
import { sLang } from './settings'

const de = () => sLang() !== 'en'
const tx = (d: string, e: string) => (de() ? d : e)
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15'
const ZEIT = 30_000

export const APPLE_DATEI_HOST = /(^|\.)(icloud-content\.com|icloud\.com)$/i

export type IcloudQuelle =
  | { art: 'icloud'; typ: 'album'; token: string; host: string; guid: string; checksum: string }
  | {
      art: 'icloud'
      typ: 'ck'
      db: 'privat' | 'geteilt' | 'oeffentlich'
      zone: Record<string, any>
      record: string
      feld: string
      name: string
      url?: string
      token?: string
    }
  | { art: 'icloud'; typ: 'drive'; guid: string; name: string }
  | { art: 'icloud'; typ: 'drivekonto'; docwsid: string; zone: string }

async function holen(url: string, init: RequestInit & { kopf?: Record<string, string> } = {}): Promise<Response> {
  const ab = new AbortController()
  const uhr = setTimeout(() => ab.abort(), ZEIT)
  try {
    return await fetch(url, {
      ...init,
      headers: { 'user-agent': UA, ...(init.kopf || {}), ...((init.headers as any) || {}) },
      redirect: 'manual',
      signal: ab.signal
    })
  } catch (e: any) {
    if (e?.name === 'AbortError')
      throw fehler(504, 'iCloud antwortet nicht (Zeitüberschreitung).', 'iCloud is not responding (timeout).')
    throw fehler(502, `iCloud nicht erreichbar: ${e?.message || e}`, `iCloud not reachable: ${e?.message || e}`)
  } finally {
    clearTimeout(uhr)
  }
}
async function json(r: Response): Promise<any> {
  const t = await r.text()
  try {
    return t ? JSON.parse(t) : {}
  } catch {
    return { _text: t.slice(0, 300) }
  }
}
const mitName = (url: string, name: string) =>
  url.replace(/\$\{f\}|%24%7Bf%7D|\$%7Bf%7D/g, encodeURIComponent(name || 'datei'))
function baldWeg(url?: string): boolean {
  if (!url) return true
  const e = Number(/[?&]e=(\d{9,11})/.exec(url)?.[1] || 0)
  return !e || e * 1000 < Date.now() + 120_000
}

export type IcloudLink =
  { art: 'album'; token: string } | { art: 'albumck'; token: string } | { art: 'drive'; guid: string }

export function linkErkennen(roh: string): IcloudLink | null {
  const s = String(roh || '').trim()
  if (!s) return null
  let u: URL | null = null
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s)
  } catch {
    u = null
  }
  if (u && /(^|\.)icloud\.com$/i.test(u.hostname)) {
    const pfad = u.pathname.replace(/\/+$/, '')
    if (/^\/sharedalbum(\/[a-z]{2}-[a-z]{2})?$/i.test(pfad)) {
      const t = decodeURIComponent(u.hash.slice(1)).split(';')[0]!.trim()
      return /^[0-9A-Za-z]{10,40}$/.test(t) ? { art: 'album', token: t } : null
    }
    const ck = /^\/shared\/album\/([0-9A-Za-z_-]{10,60})$/.exec(pfad)
    if (ck) return { art: 'albumck', token: ck[1]! }
    const dr = /^\/iclouddrive\/([0-9A-Za-z_-]{10,60})$/i.exec(pfad)
    if (dr) return { art: 'drive', guid: dr[1]! }
    const kurz = /^\/([0-9A-Za-z_-]{20,60})$/.exec(pfad)
    if (kurz && /^photos\./i.test(u.hostname)) return { art: 'albumck', token: kurz[1]! }
  }
  return null
}

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
function hostRaten(token: string): string {
  const teil = token[0] === 'A' ? token.slice(1, 2) : token.slice(1, 3)
  let n = 0
  for (const c of teil) {
    const i = B62.indexOf(c)
    if (i < 0) return 'p01-sharedstreams.icloud.com'
    n = n * 62 + i
  }
  return `p${String(n).padStart(2, '0')}-sharedstreams.icloud.com`
}
const STREAM_HOST = /^p\d{1,4}-sharedstreams\.icloud\.com$/

async function stream(
  token: string,
  host: string,
  pfad: 'webstream' | 'webasseturls',
  body: unknown
): Promise<{ host: string; daten: any }> {
  let h = host
  for (let versuch = 0; versuch < 3; versuch++) {
    const r = await holen(`https://${h}/${encodeURIComponent(token)}/sharedstreams/${pfad}`, {
      method: 'POST',
      body: JSON.stringify(body),
      kopf: { 'content-type': 'text/plain', origin: 'https://www.icloud.com', accept: 'application/json' }
    })
    if (r.status === 330) {
      const d = await json(r)
      const neu = String(r.headers.get('x-apple-mme-host') || d['X-Apple-MMe-Host'] || '')
      if (!STREAM_HOST.test(neu) || neu === h)
        throw fehler(
          502,
          'iCloud hat das Album auf einen unbekannten Server umgeleitet.',
          'iCloud redirected the album to an unknown server.'
        )
      h = neu
      continue
    }
    if (r.status === 404 || r.status === 410)
      throw fehler(
        400,
        'Dieses geteilte Album gibt es nicht (mehr) oder die öffentliche Website ist ausgeschaltet.',
        'This shared album does not exist (anymore) or its public website is turned off.'
      )
    if (!r.ok) throw fehler(502, `iCloud-Album: HTTP ${r.status}`, `iCloud album: HTTP ${r.status}`)
    return { host: h, daten: await json(r) }
  }
  throw fehler(502, 'iCloud leitet das Album im Kreis.', 'iCloud keeps redirecting the album.')
}

export interface AlbumFoto {
  guid: string
  checksum: string
  groesse: number
  video: boolean
  erstellt: string | null
  titel: string
  name: string
}

export async function albumLesen(
  token: string,
  melden?: (t: string) => Promise<void>
): Promise<{ titel: string; von: string; host: string; fotos: AlbumFoto[] }> {
  const ws = await stream(token, hostRaten(token), 'webstream', { streamCtag: null })
  const d = ws.daten || {}
  const fotos: AlbumFoto[] = []
  for (const p of d.photos || []) {
    const der = p.derivatives || {}
    const video = p.mediaAssetType === 'video'
    let best: { k: string; v: any; rang: number } | null = null
    for (const [k, v] of Object.entries<any>(der)) {
      if (!v?.checksum) continue
      if (video ? !/^\d+p$/i.test(k) : !/^\d+$/.test(k)) continue
      const rang = parseInt(k, 10) * 1e9 + Number(v.fileSize || 0)
      if (!best || rang > best.rang) best = { k, v, rang }
    }
    if (!best) continue
    const zeit = p.dateCreated ? new Date(p.dateCreated) : null
    fotos.push({
      guid: String(p.photoGuid),
      checksum: String(best.v.checksum),
      groesse: Number(best.v.fileSize) || 0,
      video,
      erstellt: zeit && !Number.isNaN(zeit.getTime()) ? zeit.toISOString() : null,
      titel: String(p.caption || '')
        .trim()
        .slice(0, 120),
      name: ''
    })
  }
  for (let i = 0; i < fotos.length; i += 50) {
    const block = fotos.slice(i, i + 50)
    const r = await stream(token, ws.host, 'webasseturls', { photoGuids: block.map((f) => f.guid) })
    const items = r.daten?.items || {}
    for (const f of block) {
      const it = items[f.checksum]
      const n = it?.url_path ? decodeURIComponent(String(it.url_path).split('?')[0]!.split('/').pop() || '') : ''
      f.name =
        n && /\.[A-Za-z0-9]{2,5}$/.test(n) ? n.slice(0, 200) : `${f.guid.slice(0, 12)}.${f.video ? 'mp4' : 'jpg'}`
    }
    if (melden)
      await melden(
        tx(
          `Album „${d.streamName || ''}“: ${Math.min(i + 50, fotos.length)} von ${fotos.length} …`,
          `Album “${d.streamName || ''}”: ${Math.min(i + 50, fotos.length)} of ${fotos.length} …`
        )
      )
  }
  return {
    titel: String(d.streamName || 'iCloud').slice(0, 80),
    von: [d.userFirstName, d.userLastName].filter(Boolean).join(' '),
    host: ws.host,
    fotos
  }
}

async function albumUrl(q: Extract<IcloudQuelle, { typ: 'album' }>): Promise<string> {
  const host = STREAM_HOST.test(q.host) ? q.host : hostRaten(q.token)
  const r = await stream(q.token, host, 'webasseturls', {
    photoGuids: [q.guid],
    derivatives: { [q.guid]: [q.checksum] }
  })
  const it = r.daten?.items?.[q.checksum]
  const loc = it ? r.daten?.locations?.[it.url_location] : null
  if (!it?.url_location || !it?.url_path)
    throw new Error(tx('Foto ist nicht mehr im Album', 'photo is no longer in the album'))
  const host2 = String(loc?.hosts?.[0] || it.url_location)
  const url = `${loc?.scheme || 'https'}://${host2}${it.url_path}`
  if (!APPLE_DATEI_HOST.test(new URL(url).hostname))
    throw new Error(tx('Unerwartete Download-Adresse', 'unexpected download address'))
  return url
}

const CK = 'https://ckdatabasews.icloud.com'
const CK_KOPF = {
  'content-type': 'text/plain',
  origin: 'https://www.icloud.com',
  referer: 'https://www.icloud.com/',
  accept: 'application/json'
}
const CK_FOTOS = 'com.apple.photos.cloud'

const b64Text = (v: unknown) => {
  try {
    return typeof v === 'string' && v ? Buffer.from(v, 'base64').toString('utf8') : ''
  } catch {
    return ''
  }
}
const wert = (f: any, k: string) => f?.[k]?.value

async function aufloesen(container: 'com.apple.cloudkit' | typeof CK_FOTOS, guid: string): Promise<any> {
  const r = await holen(
    `${CK}/database/1/${container}/production/public/records/resolve?ckjsBuildVersion=2626&shortGUID=${encodeURIComponent(guid)}`,
    {
      method: 'POST',
      body: JSON.stringify({ shortGUIDs: [{ value: guid }], shouldFetchRootRecord: true }),
      kopf: CK_KOPF
    }
  )
  const d = await json(r)
  const x = d?.results?.[0]
  if (!r.ok || !x) throw fehler(400, 'iCloud kennt diesen Link nicht.', 'iCloud does not know this link.')
  if (x.serverErrorCode)
    throw fehler(
      400,
      x.serverErrorCode === 'NOT_FOUND'
        ? 'Diese Freigabe gibt es nicht (mehr).'
        : `iCloud: ${x.reason || x.serverErrorCode}`,
      x.serverErrorCode === 'NOT_FOUND'
        ? 'This share does not exist (anymore).'
        : `iCloud: ${x.reason || x.serverErrorCode}`
    )
  return x
}

export interface DriveDatei {
  guid: string
  name: string
  groesse: number
  geaendert: string | null
}

export async function driveLinkLesen(guid: string): Promise<DriveDatei> {
  const x = await aufloesen('com.apple.cloudkit', guid)
  const rr = x.rootRecord || {}
  if (rr.recordType === 'structure' || !wert(rr.fields, 'fileContent')) {
    throw fehler(
      400,
      'Das ist ein geteilter Ordner — iCloud gibt Ordner nur mit Anmeldung heraus. Bitte „Mit Apple-ID anmelden“ nutzen oder die Dateien einzeln teilen.',
      'This is a shared folder — iCloud only hands out folders after signing in. Please use “Sign in with Apple ID” or share the files one by one.'
    )
  }
  const f = rr.fields || {}
  const ext = String(wert(f, 'extension') || '')
  const name =
    (b64Text(wert(f, 'encryptedBasename')) || String(x.share?.fields?.['cloudkit.title']?.value || 'datei')) +
    (ext ? '.' + ext : '')
  const mt = Number(wert(f, 'mtime') || 0)
  return {
    guid,
    name: name.replace(/[\u0000-\u001f\\/]/g, '').slice(0, 200),
    groesse: Number(wert(f, 'fileContent')?.size || wert(f, 'size') || 0),
    geaendert: mt > 0 ? new Date(mt).toISOString() : null
  }
}
async function driveUrl(q: Extract<IcloudQuelle, { typ: 'drive' }>): Promise<string> {
  const x = await aufloesen('com.apple.cloudkit', q.guid)
  const url = wert(x.rootRecord?.fields, 'fileContent')?.downloadURL
  if (!url) throw new Error(tx('Freigabe enthält keine Datei mehr', 'the share no longer contains a file'))
  return mitName(String(url), q.name)
}

export interface CkEintrag {
  record: string
  name: string
  feld: string
  url: string
  groesse: number
  typ: string
  erstellt: string | null
  favorit: boolean
  live: { feld: string; url: string; groesse: number } | null
}

const CK_TYPEN: Record<string, string> = {
  'public.heic': 'image/heic',
  'public.heif': 'image/heic',
  'public.jpeg': 'image/jpeg',
  'public.png': 'image/png',
  'com.compuserve.gif': 'image/gif',
  'public.tiff': 'image/tiff',
  'org.webmproject.webp': 'image/webp',
  'public.avif': 'image/avif',
  'com.apple.quicktime-movie': 'video/quicktime',
  'public.mpeg-4': 'video/mp4'
}
const CK_ENDUNG: Record<string, string> = {
  'image/heic': 'heic',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/tiff': 'tif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'video/quicktime': 'mov',
  'video/mp4': 'mp4'
}

export function ckEintraege(records: any[]): { eintraege: CkEintrag[]; masterZahl: number } {
  const assets = new Map<string, any>()
  const masters: any[] = []
  for (const r of records || []) {
    if (r?.recordType === 'CPLAsset') {
      const m = r.fields?.masterRef?.value?.recordName
      if (m) assets.set(m, r)
    } else if (r?.recordType === 'CPLMaster') masters.push(r)
  }
  const eintraege: CkEintrag[] = []
  for (const m of masters) {
    const a = assets.get(m.recordName)
    const af = a?.fields || {},
      mf = m.fields || {}
    if (wert(af, 'isDeleted') || wert(af, 'isHidden') || wert(af, 'trashReason')) continue
    const res = wert(af, 'resOriginalRes') || wert(mf, 'resOriginalRes')
    if (!res?.downloadURL) continue
    const typUti = String(
      wert(af, 'resOriginalFileType') || wert(mf, 'resOriginalFileType') || wert(mf, 'itemType') || ''
    )
    const typ = CK_TYPEN[typUti] || ''
    let name = b64Text(wert(mf, 'filenameEnc')) || String(wert(mf, 'filenameEnc') || '')
    if (!name) name = `${String(m.recordName).slice(0, 16)}.${CK_ENDUNG[typ] || 'bin'}`
    const dat = Number(wert(af, 'assetDate') || wert(mf, 'originalCreationDate') || 0)
    const lv = wert(mf, 'resOriginalVidComplRes')
    eintraege.push({
      record: String(m.recordName),
      name: name.replace(/[\u0000-\u001f\\/]/g, '').slice(0, 200),
      feld: 'resOriginalRes',
      url: mitName(String(res.downloadURL), name),
      groesse: Number(res.size) || 0,
      typ,
      erstellt: dat > 0 ? new Date(dat).toISOString() : null,
      favorit: Number(wert(af, 'isFavorite') || 0) === 1,
      live: lv?.downloadURL
        ? {
            feld: 'resOriginalVidComplRes',
            url: mitName(String(lv.downloadURL), name.replace(/\.[^.]+$/, '') + '.mov'),
            groesse: Number(lv.size) || 0
          }
        : null
    })
  }
  return { eintraege, masterZahl: masters.length }
}

export async function albumCkLesen(
  token: string,
  melden?: (t: string) => Promise<void>
): Promise<{ titel: string; zone: any; basis: string; zugriff: string; eintraege: CkEintrag[] }> {
  const x = await aufloesen(CK_FOTOS, token)
  const zugriff = x.anonymousPublicAccess?.token,
    partition = x.anonymousPublicAccess?.databasePartition
  if (!x.zoneID || !zugriff || !partition)
    throw fehler(400, 'Dieses Album ist nicht öffentlich geteilt.', 'This album is not shared publicly.')
  const basis = `${String(partition).replace(/\/+$/, '')}/database/1/${CK_FOTOS}/production`
  if (!/^https:\/\/[a-z0-9.-]+\.icloud\.com\//i.test(basis + '/'))
    throw fehler(502, 'Unerwarteter iCloud-Server.', 'Unexpected iCloud server.')
  const eintraege: CkEintrag[] = []
  let marke: string | null = null
  for (let seite = 0; seite < 500; seite++) {
    const r = await holen(
      `${basis}/shared/records/query?remapEnums=true&getCurrentSyncToken=true&sharing_url_key=${encodeURIComponent(token)}&publicAccessAuthToken=${encodeURIComponent(zugriff)}`,
      {
        method: 'POST',
        kopf: CK_KOPF,
        body: JSON.stringify({
          zoneID: x.zoneID,
          query: { recordType: 'CPLAssetAndMasterByAssetDateWithoutHiddenOrDeleted' },
          resultsLimit: 200,
          ...(marke ? { continuationMarker: marke } : {})
        })
      }
    )
    const d = await json(r)
    if (!r.ok) throw fehler(502, `iCloud-Album: HTTP ${r.status}`, `iCloud album: HTTP ${r.status}`)
    eintraege.push(...ckEintraege(d.records || []).eintraege)
    if (melden) await melden(tx(`${eintraege.length} Fotos gefunden …`, `${eintraege.length} photos found …`))
    marke = d.continuationMarker || null
    if (!marke || !(d.records || []).length) break
  }
  return {
    titel: String(x.share?.fields?.['cloudkit.title']?.value || 'iCloud').slice(0, 80),
    zone: x.zoneID,
    basis,
    zugriff,
    eintraege
  }
}

export interface Sitzung {
  appleId: string
  clientId: string
  cookies: Array<{ n: string; v: string; d: string }>
  scnt?: string
  sessionId?: string
  sessionToken?: string
  trustToken?: string
  land?: string
  dsid?: string
  dienste?: { ck?: string; drivews?: string; docws?: string }
  schritt: 'code' | 'fertig'
  sms?: number
}

const IDMSA = 'https://idmsa.apple.com'
const AUTH = `${IDMSA}/appleauth/auth`
const SETUP = 'https://setup.icloud.com/setup/ws/1'
const WIDGET = 'd39ba9916b7251055b22c7f910e2ea796ee65e98b2ddecea8f5dde8d9d1a815d'
const KOPF_DATEN: Record<string, keyof Sitzung> = {
  'x-apple-id-account-country': 'land',
  'x-apple-id-session-id': 'sessionId',
  'x-apple-session-token': 'sessionToken',
  'x-apple-twosv-trust-token': 'trustToken',
  scnt: 'scnt'
}

function cookiesSetzen(s: Sitzung, r: Response, host: string) {
  const liste: string[] = typeof (r.headers as any).getSetCookie === 'function' ? (r.headers as any).getSetCookie() : []
  for (const roh of liste) {
    const teile = roh.split(';').map((x) => x.trim())
    const [nv, ...attr] = teile
    const gl = nv!.indexOf('=')
    if (gl <= 0) continue
    const n = nv!.slice(0, gl),
      v = nv!.slice(gl + 1)
    let d = host
    let weg = false
    for (const a of attr) {
      const [k, w = ''] = a.split('=')
      const kl = k!.toLowerCase()
      if (kl === 'domain' && w) d = w.replace(/^\./, '').toLowerCase()
      if (kl === 'max-age' && Number(w) <= 0) weg = true
      if (kl === 'expires' && w && new Date(w).getTime() < Date.now()) weg = true
    }
    s.cookies = s.cookies.filter((c) => !(c.n === n && c.d === d))
    if (!weg && v) s.cookies.push({ n, v, d })
  }
}
const cookieKopf = (s: Sitzung, host: string) =>
  s.cookies
    .filter((c) => host === c.d || host.endsWith('.' + c.d))
    .map((c) => `${c.n}=${c.v}`)
    .join('; ')

async function apple(
  s: Sitzung,
  url: string,
  opt: { method?: string; body?: string | null; kopf?: Record<string, string> } = {}
): Promise<{ status: number; daten: any; text: string; kopf: Headers }> {
  const host = new URL(url).hostname.toLowerCase()
  const k: Record<string, string> = {
    origin: 'https://www.icloud.com',
    referer: 'https://www.icloud.com/',
    ...(opt.kopf || {})
  }
  const c = cookieKopf(s, host)
  if (c) k.cookie = c
  const r = await holen(url, { method: opt.method || 'GET', body: opt.body ?? undefined, kopf: k })
  cookiesSetzen(s, r, host)
  for (const [h, feld] of Object.entries(KOPF_DATEN)) {
    const w = r.headers.get(h)
    if (w) (s as any)[feld] = w
  }
  const text = await r.text()
  let daten: any = {}
  try {
    daten = text ? JSON.parse(text) : {}
  } catch {
    daten = {}
  }
  return { status: r.status, daten, text, kopf: r.headers }
}

function authKopf(s: Sitzung, extra: Record<string, string> = {}): Record<string, string> {
  return {
    accept: 'application/json, text/javascript',
    'content-type': 'application/json',
    'x-apple-oauth-client-id': WIDGET,
    'x-apple-oauth-client-type': 'firstPartyAuth',
    'x-apple-oauth-redirect-uri': 'https://www.icloud.com',
    'x-apple-oauth-require-grant-code': 'true',
    'x-apple-oauth-response-mode': 'web_message',
    'x-apple-oauth-response-type': 'code',
    'x-apple-oauth-state': s.clientId,
    'x-apple-widget-key': WIDGET,
    'x-apple-frame-id': s.clientId,
    ...(s.scnt ? { scnt: s.scnt } : {}),
    ...(s.sessionId ? { 'x-apple-id-session-id': s.sessionId } : {}),
    ...extra
  }
}
const IDMSA_HERKUNFT = { origin: IDMSA, referer: IDMSA + '/' }
const params = (s: Sitzung) =>
  `clientBuildNumber=2522Project44&clientMasteringNumber=2522B2&clientId=${encodeURIComponent(s.clientId)}${s.dsid ? `&dsid=${encodeURIComponent(s.dsid)}` : ''}`

const N = BigInt(
  '0xAC6BDB41324A9A9BF166DE5E1389582FAF72B6651987EE07FC3192943DB56050A37329CBB4A099ED8193E0757767A13DD52312AB4B03310DCD7F48A9DA04FD50E8083969EDB767B0CF6095179A163AB3661A05FBD5FAAAE82918A9962F0B93B855F97993EC975EEAA80D740ADBF4FF747359D041D5C33EA71D281E446B14773BCA97B43A23FB801676BD207A436C6481F1D2B9078717461A5B9D32E688F87748544523B524B0D57D5EA77A2775D2ECFA032CFBDBF52FB3786160279004E57AE6AF874E7303CE53299CCC041C7BC308D82A5698F3A8D0C38271AE35F8E9DBFBB694B5C803D89F7AE435DE236D525F54759B65E372FCD68EF20FA7111F9E4AFF73'
)
const G = 2n
const alsBytes = (n: bigint) => {
  let h = n.toString(16)
  if (h.length % 2) h = '0' + h
  return Buffer.from(h, 'hex')
}
const alsZahl = (b: Buffer) => BigInt('0x' + (b.toString('hex') || '0'))
const auf256 = (b: Buffer) => Buffer.concat([Buffer.alloc(Math.max(0, 256 - b.length)), b])
const H = (...t: Buffer[]) => createHash('sha256').update(Buffer.concat(t)).digest()
function hoch(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n
  b %= m
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m
    e >>= 1n
    b = (b * b) % m
  }
  return r
}

export function srpStart(aBytes?: Buffer) {
  const roh = aBytes || randomBytes(256)
  roh[0] = roh[0]! | 0x80
  const a = alsZahl(roh)
  return { a, A: hoch(G, a, N) }
}
export function srpAntwort(o: {
  a: bigint
  A: bigint
  name: string
  passwort: string
  salz: Buffer
  B: Buffer
  iterationen: number
  protokoll: string
}) {
  const B = alsZahl(o.B)
  if (B % N === 0n) throw new Error('SRP: ungueltiges B')
  const k = alsZahl(H(auf256(alsBytes(N)), auf256(alsBytes(G))))
  const u = alsZahl(H(auf256(alsBytes(o.A)), auf256(alsBytes(B))))
  if (u === 0n) throw new Error('SRP: u = 0')
  const pw = createHash('sha256').update(o.passwort, 'utf8')
  const p = pbkdf2Sync(
    o.protokoll === 's2k_fo' ? Buffer.from(pw.digest('hex'), 'latin1') : pw.digest(),
    o.salz,
    o.iterationen,
    32,
    'sha256'
  )
  const x = alsZahl(H(o.salz, H(Buffer.from(':'), p)))
  const v = hoch(G, x, N)
  const basis = (((B - k * v) % N) + N) % N
  const S = hoch(basis, o.a + u * x, N)
  const K = H(alsBytes(S))
  const hN = H(alsBytes(N)),
    hg = H(auf256(alsBytes(G)))
  const xor = Buffer.alloc(32)
  for (let i = 0; i < 32; i++) xor[i] = hN[i]! ^ hg[i]!
  const M1 = H(xor, H(Buffer.from(o.name, 'utf8')), o.salz, alsBytes(o.A), alsBytes(B), K)
  const M2 = H(alsBytes(o.A), M1, K)
  return { M1, M2, K }
}

function appleFehler(d: any, status: number): string {
  const m =
    d?.serviceErrors?.[0]?.message || d?.service_errors?.[0]?.message || d?.errorMessage || d?.reason || d?.error
  return String(m || `HTTP ${status}`).slice(0, 200)
}

async function kontoAnmelden(s: Sitzung): Promise<any> {
  const r = await apple(s, `${SETUP}/accountLogin?${params(s)}`, {
    method: 'POST',
    body: JSON.stringify({
      accountCountryCode: s.land || '',
      dsWebAuthToken: s.sessionToken || '',
      extended_login: true,
      trustToken: s.trustToken || ''
    }),
    kopf: { 'content-type': 'application/json' }
  })
  if (r.status === 503)
    throw fehler(
      503,
      'Apple bremst gerade Anmeldungen — bitte in ein paar Minuten noch einmal.',
      'Apple is throttling sign-ins right now — please try again in a few minutes.'
    )
  if (r.status >= 400 || !r.daten?.dsInfo)
    throw fehler(
      400,
      `iCloud-Anmeldung abgelehnt: ${appleFehler(r.daten, r.status)}`,
      `iCloud sign-in rejected: ${appleFehler(r.daten, r.status)}`
    )
  if (r.daten.domainToUse)
    throw fehler(
      400,
      'Dieses Konto gehört zu iCloud China (icloud.com.cn) — das wird nicht unterstützt.',
      'This account belongs to iCloud China (icloud.com.cn) — that is not supported.'
    )
  s.dsid = String(r.daten.dsInfo.dsid || '')
  const ws = r.daten.webservices || {}
  s.dienste = { ck: ws.ckdatabasews?.url, drivews: ws.drivews?.url, docws: ws.docws?.url }
  return r.daten
}

export async function icloudAnmelden(appleId: string, passwort: string, alt?: Sitzung | null): Promise<Sitzung> {
  const s: Sitzung = {
    appleId,
    clientId: alt?.appleId === appleId ? alt.clientId : `auth-${randomUUID().toLowerCase()}`,
    cookies: alt?.appleId === appleId ? alt.cookies : [],
    trustToken: alt?.appleId === appleId ? alt.trustToken : undefined,
    schritt: 'code'
  }
  await apple(
    s,
    `${AUTH}/authorize/signin?frame_id=${s.clientId}&skVersion=7&iframeId=${s.clientId}&client_id=${WIDGET}&response_type=code&redirect_uri=${encodeURIComponent('https://www.icloud.com')}&response_mode=web_message&state=${s.clientId}&authVersion=latest`,
    { kopf: { accept: 'text/html', ...IDMSA_HERKUNFT } }
  ).catch(() => null)
  const { a, A } = srpStart()
  const init = await apple(s, `${AUTH}/signin/init`, {
    method: 'POST',
    body: JSON.stringify({ a: alsBytes(A).toString('base64'), accountName: appleId, protocols: ['s2k', 's2k_fo'] }),
    kopf: authKopf(s, IDMSA_HERKUNFT)
  })
  if (init.status === 503)
    throw fehler(
      503,
      'Apple bremst gerade Anmeldungen — bitte in ein paar Minuten noch einmal.',
      'Apple is throttling sign-ins right now — please try again in a few minutes.'
    )
  if (init.status >= 400 || !init.daten?.salt)
    throw fehler(400, 'Apple-ID oder Passwort stimmt nicht.', 'The Apple ID or password is incorrect.')
  const { M1, M2 } = srpAntwort({
    a,
    A,
    name: appleId,
    passwort,
    salz: Buffer.from(init.daten.salt, 'base64'),
    B: Buffer.from(init.daten.b, 'base64'),
    iterationen: Number(init.daten.iteration),
    protokoll: String(init.daten.protocol)
  })
  const fertig = await apple(s, `${AUTH}/signin/complete?isRememberMeEnabled=true`, {
    method: 'POST',
    kopf: authKopf(s, IDMSA_HERKUNFT),
    body: JSON.stringify({
      accountName: appleId,
      c: init.daten.c,
      m1: M1.toString('base64'),
      m2: M2.toString('base64'),
      rememberMe: true,
      trustTokens: s.trustToken ? [s.trustToken] : []
    })
  })
  if (fertig.status === 412)
    await apple(s, `${AUTH}/repair/complete`, { method: 'POST', body: '{}', kopf: authKopf(s) })
  else if (fertig.status === 401 || fertig.status === 403)
    throw fehler(
      400,
      'Apple-ID oder Passwort stimmt nicht. (App-spezifische Passwörter funktionieren hier nicht.)',
      'The Apple ID or password is incorrect. (App-specific passwords do not work here.)'
    )
  else if (fertig.status === 503)
    throw fehler(
      503,
      'Apple bremst gerade Anmeldungen — bitte in ein paar Minuten noch einmal.',
      'Apple is throttling sign-ins right now — please try again in a few minutes.'
    )
  else if (fertig.status >= 400 && fertig.status !== 409)
    throw fehler(
      400,
      `Apple hat die Anmeldung abgelehnt: ${appleFehler(fertig.daten, fertig.status)}`,
      `Apple rejected the sign-in: ${appleFehler(fertig.daten, fertig.status)}`
    )
  const daten = await kontoAnmelden(s)
  const brauchtCode =
    fertig.status === 409 ||
    !!daten.hsaChallengeRequired ||
    (Number(daten.dsInfo?.hsaVersion || 0) >= 1 && !daten.hsaTrustedBrowser)
  if (!brauchtCode) {
    s.schritt = 'fertig'
    return s
  }
  await apple(s, `${AUTH}/verify/trusteddevice/securitycode`, {
    method: 'PUT',
    kopf: authKopf(s, { accept: 'application/json' })
  })
  s.schritt = 'code'
  return s
}

export async function icloudTelefone(s: Sitzung): Promise<Array<{ id: number; nummer: string }>> {
  const r = await apple(s, AUTH, { kopf: authKopf(s, { accept: 'text/html' }) })
  const m = /<script[^>]*class="boot_args"[^>]*>([\s\S]*?)<\/script>/.exec(r.text)
  let d: any = {}
  try {
    d = JSON.parse(m?.[1] || '{}')
  } catch {
    d = {}
  }
  const tw = d?.direct?.twoSV || {}
  const liste =
    tw.phoneNumberVerification?.trustedPhoneNumbers ||
    tw.bridgeInitiateData?.phoneNumberVerification?.trustedPhoneNumbers ||
    []
  return liste
    .map((p: any) => ({ id: Number(p.id), nummer: String(p.numberWithDialCode || p.obfuscatedNumber || '') }))
    .filter((p: any) => p.id)
}
export async function icloudSms(s: Sitzung, telefon: number): Promise<void> {
  const r = await apple(s, `${AUTH}/verify/phone`, {
    method: 'PUT',
    body: JSON.stringify({ phoneNumber: { id: telefon }, mode: 'sms' }),
    kopf: authKopf(s)
  })
  if (r.status >= 400)
    throw fehler(
      400,
      `SMS konnte nicht gesendet werden: ${appleFehler(r.daten, r.status)}`,
      `The SMS could not be sent: ${appleFehler(r.daten, r.status)}`
    )
  s.sms = telefon
}

export async function icloudCode(s: Sitzung, code: string): Promise<Sitzung> {
  const c = String(code || '').replace(/\D/g, '')
  if (c.length !== 6) throw fehler(400, 'Der Code hat sechs Ziffern.', 'The code has six digits.')
  const r = s.sms
    ? await apple(s, `${AUTH}/verify/phone/securitycode`, {
        method: 'POST',
        body: JSON.stringify({ phoneNumber: { id: s.sms }, securityCode: { code: c }, mode: 'sms' }),
        kopf: authKopf(s, { accept: 'application/json' })
      })
    : await apple(s, `${AUTH}/verify/trusteddevice/securitycode`, {
        method: 'POST',
        body: JSON.stringify({ securityCode: { code: c } }),
        kopf: authKopf(s, { accept: 'application/json' })
      })
  const ok = r.status < 400 || (r.status === 409 && r.daten?.securityCode?.valid === true)
  if (!ok) {
    const falsch = /-21669/.test(r.text) || r.status === 400
    throw fehler(
      400,
      falsch
        ? 'Der Code stimmt nicht — bitte den neuesten Code eingeben.'
        : `Apple hat den Code abgelehnt: ${appleFehler(r.daten, r.status)}`,
      falsch
        ? 'The code is incorrect — please enter the latest code.'
        : `Apple rejected the code: ${appleFehler(r.daten, r.status)}`
    )
  }
  await apple(s, `${AUTH}/2sv/trust`, { kopf: authKopf(s) })
  await kontoAnmelden(s)
  s.schritt = 'fertig'
  delete s.sms
  return s
}

export async function icloudBereit(s: Sitzung): Promise<Sitzung> {
  if (s.schritt !== 'fertig') throw fehler(400, 'Bitte zuerst bei iCloud anmelden.', 'Please sign in to iCloud first.')
  const r = await apple(s, `${SETUP}/validate?${params(s)}`, {
    method: 'POST',
    body: 'null',
    kopf: { 'content-type': 'application/json' }
  })
  if (r.status === 421 || r.status === 450 || r.status === 500 || r.status === 401) await kontoAnmelden(s)
  else if (r.daten?.webservices?.ckdatabasews?.url)
    s.dienste = {
      ck: r.daten.webservices.ckdatabasews.url,
      drivews: r.daten.webservices.drivews?.url,
      docws: r.daten.webservices.docws?.url
    }
  if (!s.dienste?.ck)
    throw fehler(
      400,
      'iCloud liefert keine Dienste — ist „Zugriff auf iCloud-Daten im Web“ in den Einstellungen des iPhones eingeschaltet?',
      'iCloud returns no services — is “Access iCloud Data on the Web” turned on in the iPhone settings?'
    )
  return s
}

async function ckPost(s: Sitzung, pfad: string, body: unknown, extra = ''): Promise<any> {
  for (let versuch = 0; versuch < 2; versuch++) {
    const url = `${s.dienste!.ck}/database/1/${CK_FOTOS}/production/${pfad}?${params(s)}&remapEnums=true&getCurrentSyncToken=true${extra}`
    const r = await apple(s, url, {
      method: 'POST',
      body: JSON.stringify(body),
      kopf: { 'content-type': 'text/plain' }
    })
    if ((r.status === 401 || r.status === 421) && versuch === 0) {
      await kontoAnmelden(s)
      continue
    }
    if (r.status === 503)
      throw fehler(
        503,
        'iCloud bremst gerade — bitte später erneut versuchen.',
        'iCloud is throttling — please try again later.'
      )
    if (r.status >= 400) {
      const code = String(r.daten?.serverErrorCode || '')
      if (code === 'ZONE_NOT_FOUND' || code === 'AUTHENTICATION_FAILED' || /PCS|ADP|protected/i.test(r.text))
        throw fehler(
          400,
          'Die Fotos sind nicht erreichbar. Mit „Erweitertem Datenschutz“ muss auf dem iPhone „Zugriff auf iCloud-Daten im Web“ eingeschaltet sein.',
          'The photos are not reachable. With “Advanced Data Protection”, “Access iCloud Data on the Web” must be turned on on the iPhone.'
        )
      throw fehler(
        502,
        `iCloud Fotos: ${appleFehler(r.daten, r.status)}`,
        `iCloud Photos: ${appleFehler(r.daten, r.status)}`
      )
    }
    return r.daten
  }
}

const SCHLUESSEL = [
  'resOriginalRes',
  'resOriginalFileType',
  'resOriginalVidComplRes',
  'resOriginalVidComplFileType',
  'filenameEnc',
  'itemType',
  'masterRef',
  'assetDate',
  'addedDate',
  'isFavorite',
  'isHidden',
  'isDeleted',
  'recordName',
  'recordType',
  'originalCreationDate'
]

async function ckListe(
  s: Sitzung,
  db: 'private' | 'shared',
  zone: any,
  art: string,
  filter: any[] = [],
  melden?: (n: number) => Promise<void>
): Promise<CkEintrag[]> {
  const aus: CkEintrag[] = []
  let rang = 0
  for (let seite = 0; seite < 5000; seite++) {
    const d = await ckPost(s, `${db}/records/query`, {
      query: {
        filterBy: [
          { fieldName: 'startRank', fieldValue: { type: 'INT64', value: rang }, comparator: 'EQUALS' },
          { fieldName: 'direction', fieldValue: { type: 'STRING', value: 'ASCENDING' }, comparator: 'EQUALS' },
          ...filter
        ],
        recordType: art
      },
      resultsLimit: 200,
      desiredKeys: SCHLUESSEL,
      zoneID: zone
    })
    const { eintraege, masterZahl } = ckEintraege(d?.records || [])
    if (!masterZahl) break
    aus.push(...eintraege)
    rang += masterZahl
    if (melden) await melden(aus.length)
    if (aus.length > 300_000) break
  }
  return aus
}

export interface MediathekEintrag extends CkEintrag {
  zone: any
  db: 'privat' | 'geteilt'
  album: string[]
}

export async function mediathekLesen(s: Sitzung, melden: (t: string) => Promise<void>): Promise<MediathekEintrag[]> {
  const prim = { zoneName: 'PrimarySync' }
  const stand = await ckPost(s, 'private/records/query', { query: { recordType: 'CheckIndexingState' }, zoneID: prim })
  if (stand?.records?.[0]?.fields?.state?.value && stand.records[0].fields.state.value !== 'FINISHED')
    throw fehler(
      409,
      'iCloud ordnet die Mediathek gerade noch — bitte später erneut versuchen.',
      'iCloud is still indexing the library — please try again later.'
    )
  const zonen: Array<{ db: 'private' | 'shared'; zone: any }> = [{ db: 'private', zone: prim }]
  for (const db of ['private', 'shared'] as const) {
    const zl = await ckPost(s, `${db}/zones/list`, {}).catch(() => null)
    for (const z of zl?.zones || []) {
      const n = String(z.zoneID?.zoneName || '')
      if (!z.deleted && /^SharedSync-/.test(n) && !zonen.some((x) => x.zone.zoneName === n))
        zonen.push({ db, zone: z.zoneID })
    }
  }
  const alle = new Map<string, MediathekEintrag>()
  for (const { db, zone } of zonen) {
    const geteilt = zone.zoneName !== 'PrimarySync'
    const liste = await ckListe(s, db, zone, 'CPLAssetAndMasterByAssetDateWithoutHiddenOrDeleted', [], (n) =>
      melden(tx(`${n} Fotos und Videos gefunden …`, `${n} photos and videos found …`))
    ).catch((e) => {
      if (geteilt) return [] as CkEintrag[]
      throw e
    })
    for (const e of liste)
      if (!alle.has(e.record))
        alle.set(e.record, {
          ...e,
          zone,
          db: db === 'shared' ? 'geteilt' : 'privat',
          album: geteilt ? [tx('Geteilte Mediathek', 'Shared Library')] : []
        })
  }
  const alben = await ckPost(s, 'private/records/query', {
    query: { recordType: 'CPLAlbumByPositionLive' },
    zoneID: prim
  }).catch(() => null)
  for (const a of alben?.records || []) {
    if (['----Root-Folder----', '----Project-Root-Folder----'].includes(a.recordName) || wert(a.fields, 'isDeleted'))
      continue
    const name = b64Text(wert(a.fields, 'albumNameEnc')).trim().slice(0, 80)
    if (!name) continue
    await melden(tx(`Album „${name}“ …`, `Album “${name}” …`))
    const inhalt = await ckListe(s, 'private', prim, 'CPLContainerRelationLiveByAssetDate', [
      { fieldName: 'parentId', comparator: 'EQUALS', fieldValue: { type: 'STRING', value: a.recordName } }
    ]).catch(() => [])
    for (const e of inhalt) {
      const x = alle.get(e.record)
      if (x && !x.album.length) x.album = [name]
    }
  }
  return [...alle.values()]
}

export interface DriveEintrag {
  docwsid: string
  zone: string
  name: string
  groesse: number
  geaendert: string | null
  ordner: string[]
}

export async function driveKontoLesen(s: Sitzung, melden: (t: string) => Promise<void>): Promise<DriveEintrag[]> {
  if (!s.dienste?.drivews || !s.dienste?.docws)
    throw fehler(
      400,
      'iCloud Drive ist für dieses Konto nicht verfügbar.',
      'iCloud Drive is not available for this account.'
    )
  const aus: DriveEintrag[] = []
  let offen: Array<{ id: string; pfad: string[] }> = [{ id: 'FOLDER::com.apple.CloudDocs::root', pfad: [] }]
  let runden = 0
  while (offen.length && runden++ < 5000) {
    const block = offen.splice(0, 20)
    const r = await apple(s, `${s.dienste.drivews}/retrieveItemDetailsInFolders?${params(s)}`, {
      method: 'POST',
      body: JSON.stringify(block.map((b) => ({ drivewsid: b.id, partialData: false }))),
      kopf: { 'content-type': 'text/plain' }
    })
    if (r.status === 401 || r.status === 421) {
      await kontoAnmelden(s)
      offen.unshift(...block)
      continue
    }
    if (r.status >= 400 || !Array.isArray(r.daten))
      throw fehler(
        502,
        `iCloud Drive: ${appleFehler(r.daten, r.status)}`,
        `iCloud Drive: ${appleFehler(r.daten, r.status)}`
      )
    r.daten.forEach((ordner: any, i: number) => {
      const pfad = block[i]?.pfad || []
      for (const it of ordner?.items || []) {
        const name = (String(it.name || '') + (it.extension ? '.' + it.extension : ''))
          .replace(/[\u0000-\u001f\\/]/g, '')
          .slice(0, 200)
        if (!name) continue
        if (it.type === 'FOLDER' || it.type === 'APP_LIBRARY') {
          if (pfad.length < 12) offen.push({ id: String(it.drivewsid), pfad: [...pfad, name] })
          continue
        }
        if (it.type !== 'FILE' || !it.docwsid) continue
        const t = new Date(it.dateModified || it.dateCreated || '')
        aus.push({
          docwsid: String(it.docwsid),
          zone: String(it.zone || 'com.apple.CloudDocs'),
          name,
          groesse: Number(it.size) || 0,
          geaendert: Number.isNaN(t.getTime()) ? null : t.toISOString(),
          ordner: pfad
        })
      }
    })
    await melden(tx(`iCloud Drive: ${aus.length} Dateien gefunden …`, `iCloud Drive: ${aus.length} files found …`))
    if (aus.length > 300_000) break
  }
  return aus
}

export interface IcloudKontext {
  zugang: Record<string, any>
  speichern: (zugang: Record<string, any>) => Promise<void>
}

export async function icloudUrl(kx: IcloudKontext, q: IcloudQuelle): Promise<string> {
  let url: string
  if (q.typ === 'album') url = await albumUrl(q)
  else if (q.typ === 'drive') url = await driveUrl(q)
  else if (q.typ === 'ck') {
    if (q.url && !baldWeg(q.url)) url = q.url
    else if (q.db === 'oeffentlich') {
      const lk = async (basis: string, zugriff: string) =>
        holen(
          `${basis}/shared/records/lookup?remapEnums=true&sharing_url_key=${encodeURIComponent(q.token || '')}&publicAccessAuthToken=${encodeURIComponent(zugriff)}`,
          {
            method: 'POST',
            kopf: CK_KOPF,
            body: JSON.stringify({
              records: [{ recordName: q.record }],
              zoneID: q.zone,
              desiredKeys: [q.feld, 'filenameEnc']
            })
          }
        )
      let ck = kx.zugang.icloudCk as { basis: string; zugriff: string } | undefined
      let r = ck ? await lk(ck.basis, ck.zugriff) : null
      if (!r || !r.ok) {
        const x = await aufloesen(CK_FOTOS, q.token || '')
        ck = {
          basis: `${String(x.anonymousPublicAccess?.databasePartition || '').replace(/\/+$/, '')}/database/1/${CK_FOTOS}/production`,
          zugriff: String(x.anonymousPublicAccess?.token || '')
        }
        kx.zugang.icloudCk = ck
        await kx.speichern(kx.zugang)
        r = await lk(ck.basis, ck.zugriff)
      }
      const d = await json(r)
      const v = d?.records?.[0]?.fields?.[q.feld]?.value
      if (!v?.downloadURL) throw new Error(tx('Foto ist nicht mehr im Album', 'photo is no longer in the album'))
      url = mitName(String(v.downloadURL), q.name)
    } else {
      const s = kx.zugang.icloud as Sitzung | undefined
      if (!s?.dienste?.ck)
        throw new Error(
          tx('iCloud-Sitzung fehlt — bitte neu anmelden', 'iCloud session missing — please sign in again')
        )
      const d = await ckPost(s, `${q.db === 'geteilt' ? 'shared' : 'private'}/records/lookup`, {
        records: [{ recordName: q.record }],
        zoneID: q.zone,
        desiredKeys: [q.feld, 'filenameEnc']
      })
      await kx.speichern(kx.zugang)
      const v = d?.records?.[0]?.fields?.[q.feld]?.value
      if (!v?.downloadURL) throw new Error(tx('Foto gibt es in iCloud nicht mehr', 'photo no longer exists in iCloud'))
      url = mitName(String(v.downloadURL), q.name)
    }
  } else {
    const s = kx.zugang.icloud as Sitzung | undefined
    if (!s?.dienste?.docws)
      throw new Error(tx('iCloud-Sitzung fehlt — bitte neu anmelden', 'iCloud session missing — please sign in again'))
    let r = await apple(
      s,
      `${s.dienste.docws}/ws/${encodeURIComponent(q.zone)}/download/by_id?document_id=${encodeURIComponent(q.docwsid)}&${params(s)}`
    )
    if (r.status === 401 || r.status === 421) {
      await kontoAnmelden(s)
      r = await apple(
        s,
        `${s.dienste.docws}/ws/${encodeURIComponent(q.zone)}/download/by_id?document_id=${encodeURIComponent(q.docwsid)}&${params(s)}`
      )
    }
    await kx.speichern(kx.zugang)
    url = String(r.daten?.data_token?.url || r.daten?.package_token?.url || '')
    if (!url)
      throw new Error(
        r.status >= 400 ? `iCloud Drive: HTTP ${r.status}` : tx('Datei hat keinen Inhalt', 'file has no content')
      )
  }
  const h = new URL(url)
  if (h.protocol !== 'https:' || !APPLE_DATEI_HOST.test(h.hostname))
    throw new Error(tx('Unerwartete Download-Adresse von iCloud', 'unexpected download address from iCloud'))
  return url
}
