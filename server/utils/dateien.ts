import { dateiCsp } from './dateiCsp'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { q, q1 } from './db'
import { checkPw, hashPw, istHttps } from './auth'
import { getInstance, getNet, getUploads, type NamensStil } from './settings'
import { ablageBereit, lesen, loeschen, type Geschrieben } from './speicher'
import { neuerName, istSlug } from './namen'
import { verarbeiten } from './medien'
import { ablaufBegrenzen, ordnerRecht } from './teams'
import { gezaehlt } from './traffic'
import { variantenLoeschen } from './bildvarianten'

const MAGIE: Array<[number[], number, string]> = [
  [[0x89, 0x50, 0x4e, 0x47], 0, 'image/png'],
  [[0xff, 0xd8, 0xff], 0, 'image/jpeg'],
  [[0x47, 0x49, 0x46, 0x38], 0, 'image/gif'],
  [[0x52, 0x49, 0x46, 0x46], 0, 'riff'],
  [[0x42, 0x4d], 0, 'image/bmp'],
  [[0x00, 0x00, 0x01, 0x00], 0, 'image/x-icon'],
  [[0x25, 0x50, 0x44, 0x46], 0, 'application/pdf'],
  [[0x50, 0x4b, 0x03, 0x04], 0, 'application/zip'],
  [[0x1f, 0x8b], 0, 'application/gzip'],
  [[0x37, 0x7a, 0xbc, 0xaf], 0, 'application/x-7z-compressed'],
  [[0x52, 0x61, 0x72, 0x21], 0, 'application/vnd.rar'],
  [[0x1a, 0x45, 0xdf, 0xa3], 0, 'video/webm'],
  [[0x4f, 0x67, 0x67, 0x53], 0, 'audio/ogg'],
  [[0x66, 0x4c, 0x61, 0x43], 0, 'audio/flac'],
  [[0x49, 0x44, 0x33], 0, 'audio/mpeg'],
  [[0xff, 0xfb], 0, 'audio/mpeg'],
  [[0xff, 0xf3], 0, 'audio/mpeg'],
  [[0x66, 0x74, 0x79, 0x70], 4, 'ftyp']
]
const ENDUNG: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heic',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  pdf: 'application/pdf',
  zip: 'application/zip',
  gz: 'application/gzip',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  json: 'application/json',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  log: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  xml: 'text/xml'
}
const TEXT_ENDUNG =
  /^(txt|md|markdown|log|csv|tsv|json|ya?ml|toml|ini|conf|cfg|env|xml|html?|css|scss|less|js|mjs|cjs|ts|tsx|jsx|vue|svelte|py|rb|php|go|rs|java|kt|c|h|cpp|hpp|cs|swift|sh|bash|zsh|ps1|bat|sql|lua|r|dart|ex|exs|diff|patch|dockerfile|gitignore|properties|gradle)$/i

export const endung = (name: string) => (/\.([a-z0-9]{1,10})$/i.exec(name)?.[1] || '').toLowerCase()

export function typErkennen(kopf: Buffer, name: string, gemeldet: string): string {
  const ext = endung(name)
  for (const [bytes, ab, typ] of MAGIE) {
    if (bytes.every((b, i) => kopf[ab + i] === b)) {
      if (typ === 'riff') {
        const art = kopf.subarray(8, 12).toString('latin1')
        return art === 'WEBP'
          ? 'image/webp'
          : art === 'WAVE'
            ? 'audio/wav'
            : art === 'AVI '
              ? 'video/x-msvideo'
              : 'application/octet-stream'
      }
      if (typ === 'ftyp') {
        const marke = kopf.subarray(8, 12).toString('latin1')
        if (/^(avif|avis)/.test(marke)) return 'image/avif'
        if (/^(heic|heix|heim|heis|hevc|hevx|mif1|msf1)/.test(marke)) return 'image/heic'
        if (/^qt/.test(marke)) return 'video/quicktime'
        if (/^M4A/.test(marke)) return 'audio/mp4'
        return /^audio\/mp4\b/i.test(gemeldet) ? 'audio/mp4' : 'video/mp4'
      }
      if (typ === 'video/webm' && /^audio\/webm\b/i.test(gemeldet)) return 'audio/webm'
      if (typ === 'application/zip' && ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'jar', 'apk'].includes(ext))
        return 'application/octet-stream'
      return typ
    }
  }
  if (ENDUNG[ext]) return ENDUNG[ext]!
  if (TEXT_ENDUNG.test(ext) || istText(kopf)) return 'text/plain'
  return /^[a-z]+\/[a-z0-9.+-]+$/i.test(gemeldet) ? gemeldet.toLowerCase() : 'application/octet-stream'
}
function istText(b: Buffer): boolean {
  if (!b.length) return false
  let auffaellig = 0
  for (const c of b.subarray(0, 1024)) {
    if (c === 0) return false
    if (c < 9 || (c > 13 && c < 32)) auffaellig++
  }
  return auffaellig / Math.min(b.length, 1024) < 0.02
}
export function artVon(mime: string, name: string): 'bild' | 'video' | 'audio' | 'text' | 'datei' {
  if (mime.startsWith('image/') && mime !== 'image/svg+xml') return 'bild'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'image/svg+xml' ||
    TEXT_ENDUNG.test(endung(name))
  )
    return 'text'
  return 'datei'
}

const AKTIV =
  /^(text\/html|application\/xhtml|image\/svg|text\/xml|application\/xml|text\/javascript|application\/javascript|application\/x-javascript)/i

export interface UploadOptionen {
  name?: string
  stil?: NamensStil
  ordner?: number | null
  ablauf?: string | null
  maxAufrufe?: number | null
  passwort?: string
  verschluesselt?: boolean
}

export interface DateiZeile {
  id: string
  user_id: number
  folder_id: number | null
  slug: string
  name: string
  original_name: string
  mime: string
  art: string
  size: string
  ablage: string
  sha256: string
  expires_at: string | null
  max_views: number | null
  views: number
  password_hash: string
  favorite: boolean
  width: number | null
  height: number | null
  duration_ms: number | null
  created_at: string
  last_view_at: string | null
  verarbeitung: string
  vorschau: boolean
  streifen: number
  wellen: number[] | null
  exif_entfernt: boolean
  anfrage_id: number | null
  notiz?: string
  von_gast: string
  verschluesselt: boolean
  scan: string
  scan_info: string
  ansicht: boolean
  live: boolean
  live_mp4: boolean
}

export function ablaufAus(wert: unknown): Date | null {
  const s = String(wert ?? '').trim()
  if (!s || s === 'nie' || s === 'never' || s === '0') return null
  const m = /^(\d{1,4})\s*(m|h|d|w)$/i.exec(s)
  if (m) {
    const n = Number(m[1])
    const f = { m: 60e3, h: 3600e3, d: 86400e3, w: 7 * 86400e3 }[m[2]!.toLowerCase() as 'm']
    return new Date(Date.now() + n * f)
  }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) throw fehler(400, 'Ungültiges Ablaufdatum.', 'Invalid expiry date.')
  if (d.getTime() < Date.now() + 30_000)
    throw fehler(400, 'Das Ablaufdatum liegt in der Vergangenheit.', 'The expiry date is in the past.')
  return d
}

export interface ImportWerte {
  slug?: string
  erstellt?: Date | null
  ablauf?: Date | null
  aufrufe?: number
  favorit?: boolean
  passwortHash?: string
  live?: boolean
}

export async function dateiAnlegen(
  userId: number,
  g: Geschrieben,
  original: string,
  gemeldet: string,
  o: UploadOptionen,
  sprache: 'de' | 'en' = 'de',
  x?: ImportWerte
): Promise<DateiZeile> {
  const cfg = await getUploads()
  const name =
    (o.name || original || 'datei')
      .replace(/[\u0000-\u001f\\/]/g, '')
      .trim()
      .slice(0, 200) || 'datei'
  const e2e = !!o.verschluesselt
  if (e2e && g.kopf.subarray(0, 4).toString('latin1') !== 'RDE1') {
    await loeschen(g.schluessel)
    throw fehler(400, 'Die verschlüsselte Datei ist ungültig.', 'The encrypted file is invalid.')
  }
  const mime = e2e ? 'application/octet-stream' : typErkennen(g.kopf, name, gemeldet)
  const art = e2e ? 'datei' : artVon(mime, name)
  if (o.ordner && !(await ordnerRecht(userId, o.ordner))?.hineinladen)
    throw fehler(404, 'Ordner nicht gefunden.', 'Folder not found.')
  const ablauf =
    x?.ablauf !== undefined ? x.ablauf : await ablaufBegrenzen(userId, o.ablauf ? ablaufAus(o.ablauf) : null)
  const max = o.maxAufrufe && o.maxAufrufe > 0 ? Math.min(1_000_000, Math.floor(o.maxAufrufe)) : null
  const pw = x?.passwortHash || (o.passwort ? await hashPw(String(o.passwort).slice(0, 200)) : '')
  const wunsch = x?.slug && istSlug(x.slug) ? x.slug : ''
  const stil = o.stil || cfg.namensstil
  for (let versuch = 0; versuch < 8; versuch++) {
    let slug = neuerName(stil, { laenge: cfg.laenge + Math.floor(versuch / 3), original: name, sprache })
    if (versuch > 0 && (stil === 'datum' || stil === 'woerter' || stil === 'original'))
      slug += '-' + neuerName('zufall', { laenge: 3 })
    if (versuch === 0 && wunsch) slug = wunsch
    try {
      const z = await q1<DateiZeile>(
        `INSERT INTO files (user_id, folder_id, slug, name, original_name, mime, art, size, ablage, sha256, expires_at, max_views, password_hash, created_at, views, favorite, verschluesselt, live)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, coalesce($14, now()), $15, $16, $17, $18) RETURNING *`,
        [
          userId,
          o.ordner || null,
          slug,
          name,
          original.slice(0, 200),
          mime,
          art,
          g.size,
          g.schluessel,
          g.sha256,
          ablauf,
          max,
          pw,
          x?.erstellt || null,
          Math.max(0, Math.floor(x?.aufrufe || 0)),
          !!x?.favorit,
          e2e,
          !!x?.live && art === 'bild'
        ]
      )
      verarbeiten(z!.id)
      return z!
    } catch (e: any) {
      if (e?.code !== '23505') {
        await loeschen(g.schluessel)
        throw e
      }
    }
  }
  await loeschen(g.schluessel)
  throw fehler(500, 'Es konnte kein freier Link-Name gefunden werden.', 'No free link name could be found.')
}

export async function basisUrl(event: H3Event): Promise<string> {
  const net = await getNet()
  if (net.domain && (net.mode === 'domain' || net.mode === 'proxy')) return `https://${net.domain}`
  const roh = String(getRequestHeader(event, 'x-forwarded-host') || getRequestHeader(event, 'host') || 'localhost')
    .split(',')[0]!
    .trim()
  const host = /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$|^\[[0-9a-fA-F:]{2,45}\](:\d{1,5})?$/.test(roh) ? roh : 'localhost'
  return `${istHttps(event) ? 'https' : 'http'}://${host}`
}
export function links(
  basis: string,
  f: Pick<DateiZeile, 'slug' | 'name'> & Partial<Pick<DateiZeile, 'ansicht' | 'live' | 'mime'>>
) {
  const s = encodeURIComponent(f.slug)
  const ext = f.ansicht || /^image\/hei[cf]$/.test(f.mime || '') ? 'jpg' : endung(f.name)
  return {
    seite: `${basis}/v/${s}`,
    direkt: `${basis}/r/${s}${ext ? '.' + ext : ''}`,
    download: `${basis}/d/${s}`,
    raw: `${basis}/raw/${s}`,
    vorschau: `${basis}/t/${s}`,
    streifen: `${basis}/s/${s}`,
    ...(f.live ? { live: `${basis}/l/${s}.mp4` } : {})
  }
}

export function fuerPanel(basis: string, f: DateiZeile, tags: Array<{ id: number; name: string; color: string }> = []) {
  return {
    id: String(f.id),
    slug: f.slug,
    name: f.name,
    mime: f.mime,
    art: f.art,
    size: Number(f.size),
    folder_id: f.folder_id,
    expires_at: f.expires_at,
    max_views: f.max_views,
    views: f.views,
    passwort: !!f.password_hash,
    favorite: f.favorite,
    width: f.width,
    height: f.height,
    duration_ms: f.duration_ms,
    created_at: f.created_at,
    tags,
    links: links(basis, f),
    verarbeitung: f.verarbeitung,
    hat_vorschau: f.vorschau,
    streifen: f.streifen,
    wellen: f.wellen,
    exif_entfernt: f.exif_entfernt,
    notiz: f.notiz || '',
    anfrage_id: f.anfrage_id,
    von_gast: f.von_gast || '',
    verschluesselt: !!f.verschluesselt,
    scan: f.scan || '',
    scan_info: f.scan_info || '',
    ansicht: !!f.ansicht,
    live: !!f.live
  }
}

export const dateiPerSlug = (slug: string) =>
  istSlug(slug) ? q1<DateiZeile>('SELECT * FROM files WHERE slug = $1', [slug]) : Promise.resolve(null)

export function erloschen(f: DateiZeile): boolean {
  if (f.expires_at && new Date(f.expires_at).getTime() <= Date.now()) return true
  if (f.max_views != null && f.views >= f.max_views) return true
  return false
}

const freigabeName = (id: string) => `vd_f${id}`
async function freigabeWert(id: string, bis: number) {
  const s = (await getInstance()).secret
  return `${bis}.${createHmac('sha256', s).update(`datei:${id}:${bis}`).digest('base64url')}`
}
export async function freigeben(event: H3Event, f: DateiZeile, pw: string): Promise<boolean> {
  if (!f.password_hash || !(await checkPw(String(pw || '').slice(0, 200), f.password_hash))) return false
  const bis = Date.now() + 12 * 3600_000
  setCookie(event, freigabeName(String(f.id)), await freigabeWert(String(f.id), bis), {
    httpOnly: true,
    sameSite: 'lax',
    secure: istHttps(event),
    path: '/',
    maxAge: 12 * 3600
  })
  return true
}
export async function freigegeben(event: H3Event, f: DateiZeile, betrachterId?: number | null): Promise<boolean> {
  if (!f.password_hash) return true
  if (betrachterId && betrachterId === f.user_id) return true
  const roh = getCookie(event, freigabeName(String(f.id))) || ''
  const bis = Number(roh.split('.')[0])
  if (!bis || bis < Date.now()) return false
  const soll = Buffer.from(await freigabeWert(String(f.id), bis)),
    ist = Buffer.from(roh)
  return soll.length === ist.length && timingSafeEqual(soll, ist)
}

export async function aufrufZaehlen(f: DateiZeile): Promise<boolean> {
  const r = await q1(
    'UPDATE files SET views = views + 1, last_view_at = now() WHERE id = $1 AND (max_views IS NULL OR views < max_views) RETURNING views',
    [f.id]
  )
  return !!r
}

export async function vorschauToken(f: Pick<DateiZeile, 'id'>): Promise<string> {
  const bis = Math.floor(Date.now() / 1000) + 1800
  const s = (await getInstance()).secret
  return `${bis}.${createHmac('sha256', s).update(`vorschau:${f.id}:${bis}`).digest('base64url').slice(0, 22)}`
}
export async function vorschauTokenOk(f: Pick<DateiZeile, 'id'>, t: unknown): Promise<boolean> {
  const roh = String(t || '')
  const bis = Number(roh.split('.')[0])
  if (!bis || bis < Date.now() / 1000) return false
  const s = (await getInstance()).secret
  const soll = Buffer.from(
    `${bis}.${createHmac('sha256', s).update(`vorschau:${f.id}:${bis}`).digest('base64url').slice(0, 22)}`
  )
  const ist = Buffer.from(roh)
  return soll.length === ist.length && timingSafeEqual(soll, ist)
}
export const abgelaufen = (f: DateiZeile) => !!f.expires_at && new Date(f.expires_at).getTime() <= Date.now()

export async function ausliefern(event: H3Event, f: DateiZeile, modus: 'inline' | 'download' | 'raw') {
  const size = Number(f.size)
  let typ = f.mime
  if (AKTIV.test(typ) || (modus === 'raw' && f.art === 'text')) typ = 'text/plain; charset=utf-8'
  else if (typ.startsWith('text/')) typ = `${typ}; charset=utf-8`
  const dateiname = encodeURIComponent(f.name).replace(/['()]/g, escape)
  setResponseHeaders(event, {
    'Content-Type': typ,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': dateiCsp(typ),
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Cache-Control': f.password_hash || f.max_views != null ? 'private, no-store' : 'public, max-age=3600',
    'Content-Disposition': `${modus === 'download' ? 'attachment' : 'inline'}; filename*=UTF-8''${dateiname}`,
    'ETag': `"${f.sha256.slice(0, 32) || f.id}"`
  })
  if (event.method !== 'HEAD') await ablageBereit(f.ablage)
  const range = String(getRequestHeader(event, 'range') || '')
  const m = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (m && size > 0) {
    let start = m[1] ? Number(m[1]) : NaN,
      end = m[2] ? Number(m[2]) : NaN
    if (Number.isNaN(start)) {
      start = Math.max(0, size - (Number.isNaN(end) ? 0 : end))
      end = size - 1
    }
    if (Number.isNaN(end) || end >= size) end = size - 1
    if (start > end || start >= size) {
      setResponseStatus(event, 416)
      setResponseHeader(event, 'Content-Range', `bytes */${size}`)
      return ''
    }
    setResponseStatus(event, 206)
    setResponseHeaders(event, { 'Content-Range': `bytes ${start}-${end}/${size}` })
    setResponseHeader(event, 'Content-Length', end - start + 1)
    if (event.method === 'HEAD') return ''
    return sendStream(event, (await gezaehlt(lesen(f.ablage, { start, end }), f.user_id, f.id)) as any)
  }
  setResponseHeader(event, 'Content-Length', size)
  if (event.method === 'HEAD') return ''
  return sendStream(event, (await gezaehlt(lesen(f.ablage), f.user_id, f.id)) as any)
}

export function istErsterAbruf(event: H3Event): boolean {
  if (event.method === 'HEAD') return false
  const r = String(getRequestHeader(event, 'range') || '')
  return !r || /^bytes=0-/.test(r)
}

export async function dateiLoeschen(f: Pick<DateiZeile, 'id' | 'ablage'>): Promise<void> {
  await q('DELETE FROM files WHERE id = $1', [f.id])
  await loeschen(f.ablage)
  await variantenLoeschen(f.id)
}

export async function aufraeumen(): Promise<number> {
  const weg = await q<{
    id: string
    ablage: string
  }>(`SELECT id, ablage FROM files WHERE (expires_at IS NOT NULL AND expires_at <= now())
    OR (max_views IS NOT NULL AND views >= max_views AND coalesce(last_view_at, created_at) < now() - interval '15 minutes') LIMIT 500`)
  for (const f of weg) await dateiLoeschen(f)
  return weg.length
}
