import { dateiCsp } from './dateiCsp'
import { createReadStream, promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { H3Event } from 'h3'
import type { DateiZeile } from './dateien'
import { datenordner, lokaleKopie, nebenKopie } from './speicher'
import { ffmpegLauf } from './medien'
import { getAuslieferung } from './settings'
import { gezaehlt } from './traffic'

const BILD = /^image\/(jpeg|png|webp|avif|gif|bmp|tiff)$/
const MIME: Record<string, string> = { webp: 'image/webp', avif: 'image/avif', jpeg: 'image/jpeg', png: 'image/png' }
export interface Variante {
  w: number | null
  h: number | null
  fit: 'contain' | 'cover'
  format: 'webp' | 'avif' | 'jpeg' | 'png' | 'auto' | null
  q: number
}

export const cacheOrdner = () => join(datenordner(), 'cache', 'bilder')

export function varianteAus(query: Record<string, any>, maxPx: number): Variante | null {
  const da = ['w', 'h', 'fit', 'format', 'q'].filter((k) => query[k] !== undefined && query[k] !== '')
  if (!da.length) return null
  const zahl = (k: string, min: number, max: number) => {
    if (query[k] === undefined || query[k] === '') return null
    const n = Number(query[k])
    if (!Number.isInteger(n) || n < min || n > max)
      throw fehler(
        400,
        `Ungültiger Wert für ${k} (erlaubt: ${min}–${max}).`,
        `Invalid value for ${k} (allowed: ${min}–${max}).`
      )
    return n
  }
  const fit = String(query.fit || 'contain')
  if (fit !== 'contain' && fit !== 'cover')
    throw fehler(400, 'fit muss contain oder cover sein.', 'fit must be contain or cover.')
  const format = query.format ? String(query.format).toLowerCase().replace('jpg', 'jpeg') : null
  if (format && !['webp', 'avif', 'jpeg', 'png', 'auto'].includes(format))
    throw fehler(
      400,
      'format muss webp, avif, jpeg, png oder auto sein.',
      'format must be webp, avif, jpeg, png or auto.'
    )
  return {
    w: zahl('w', 1, maxPx),
    h: zahl('h', 1, maxPx),
    fit: fit as Variante['fit'],
    format: format as Variante['format'],
    q: zahl('q', 1, 100) ?? 80
  }
}

const ORIGINAL: Record<string, Variante['format']> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif'
}
function zielFormat(v: Variante, f: DateiZeile, accept: string): 'webp' | 'avif' | 'jpeg' | 'png' {
  if (v.format && v.format !== 'auto') return v.format
  if (v.format === 'auto') {
    if (/image\/avif/.test(accept)) return 'avif'
    if (/image\/webp/.test(accept)) return 'webp'
  }
  const o = ORIGINAL[f.mime]
  return o && o !== 'auto'
    ? o
    : f.mime === 'image/gif' || f.mime === 'image/bmp' || f.mime === 'image/tiff'
      ? 'png'
      : 'jpeg'
}

function filter(v: Variante): string {
  if (v.fit === 'cover' && v.w && v.h)
    return `scale=${v.w}:${v.h}:force_original_aspect_ratio=increase,crop=${v.w}:${v.h}`
  if (v.w && v.h) return `scale='min(${v.w},iw)':'min(${v.h},ih)':force_original_aspect_ratio=decrease`
  if (v.w) return `scale='min(${v.w},iw)':-2`
  if (v.h) return `scale=-2:'min(${v.h},ih)'`
  return 'null'
}
function kodierer(fmt: string, q: number): string[] {
  if (fmt === 'webp') return ['-c:v', 'libwebp', '-quality', String(q)]
  if (fmt === 'avif')
    return ['-c:v', 'libaom-av1', '-still-picture', '1', '-crf', String(Math.round(63 - q * 0.5)), '-cpu-used', '6']
  if (fmt === 'jpeg')
    return ['-c:v', 'mjpeg', '-pix_fmt', 'yuvj420p', '-q:v', String(Math.max(2, Math.round(31 - (q / 100) * 29)))]
  return ['-c:v', 'png']
}

let laufend = 0
const warteschlange: Array<() => void> = []
const inArbeit = new Map<string, Promise<void>>()
async function platz() {
  if (laufend >= 2) await new Promise<void>((r) => warteschlange.push(r))
  laufend++
}
function frei() {
  laufend--
  warteschlange.shift()?.()
}

async function erzeugen(f: DateiZeile, v: Variante, fmt: string, ziel: string) {
  await platz()
  const kopie =
    (f.ansicht ? await nebenKopie(f.ablage, 'ansicht').catch(() => null) : null) ||
    (await lokaleKopie(f.ablage).catch((e) => {
      frei()
      throw e
    }))
  const tmp = `${ziel}.${process.pid}.tmp.${fmt === 'jpeg' ? 'jpg' : fmt}`
  try {
    const r = await ffmpegLauf([
      '-v',
      'error',
      '-y',
      '-i',
      kopie.pfad,
      '-frames:v',
      '1',
      '-map_metadata',
      '-1',
      '-vf',
      filter(v),
      ...kodierer(fmt, v.q),
      tmp
    ])
    if (r.code !== 0) throw fehler(422, 'Dieses Bild lässt sich nicht umrechnen.', 'This image cannot be converted.')
    await fs.rename(tmp, ziel)
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {})
    await kopie.weg()
    frei()
  }
}

export async function varianteAusliefern(event: H3Event, f: DateiZeile): Promise<{ antwort: any } | null> {
  const cfg = await getAuslieferung()
  if (!cfg.bilder || !(BILD.test(f.mime) || f.ansicht) || f.verschluesselt) return null
  const v = varianteAus(getQuery(event), cfg.maxPx)
  if (!v) return null
  const accept = String(getRequestHeader(event, 'accept') || '')
  const fmt = zielFormat(v, f, accept)
  const schluessel = createHash('sha1')
    .update(`${f.sha256 || f.ablage}|${v.w}|${v.h}|${v.fit}|${fmt}|${v.q}`)
    .digest('hex')
    .slice(0, 24)
  const ordner = join(cacheOrdner(), String(f.id))
  const ziel = join(ordner, `${schluessel}.${fmt === 'jpeg' ? 'jpg' : fmt}`)
  let groesse = await fs.stat(ziel).then(
    (s) => s.size,
    () => -1
  )
  if (groesse < 0) {
    await fs.mkdir(ordner, { recursive: true })
    const vorhanden = (await fs.readdir(ordner).catch(() => [] as string[])).filter((n) => !n.includes('.tmp.')).length
    if (vorhanden >= cfg.maxVarianten)
      throw fehler(
        429,
        `Für diese Datei gibt es schon ${cfg.maxVarianten} Varianten — bitte vorhandene Größen verwenden.`,
        `This file already has ${cfg.maxVarianten} variants — please reuse existing sizes.`
      )
    let p = inArbeit.get(ziel)
    if (!p) {
      p = erzeugen(f, v, fmt, ziel).finally(() => inArbeit.delete(ziel))
      inArbeit.set(ziel, p)
    }
    await p
    groesse = (await fs.stat(ziel)).size
  }
  const name = f.name.replace(/\.[^.]+$/, '') + '.' + (fmt === 'jpeg' ? 'jpg' : fmt)
  setResponseHeaders(event, {
    'Content-Type': MIME[fmt]!,
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Content-Security-Policy': dateiCsp(MIME[fmt]!),
    'Cache-Control': f.password_hash || f.max_views != null ? 'private, no-store' : 'public, max-age=86400',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
    'ETag': `"${schluessel}"`,
    ...(v.format === 'auto' ? { Vary: 'Accept' } : {})
  })
  setResponseHeader(event, 'Content-Length', groesse)
  if (event.method === 'HEAD') return { antwort: '' }
  return { antwort: sendStream(event, (await gezaehlt(createReadStream(ziel), f.user_id, f.id)) as any) }
}

export const variantenLoeschen = (fileId: string | number) =>
  fs.rm(join(cacheOrdner(), String(fileId)), { recursive: true, force: true }).catch(() => {})

export async function cacheGroesse(): Promise<{ dateien: number; bytes: number }> {
  let dateien = 0,
    bytes = 0
  for (const d of await fs.readdir(cacheOrdner()).catch(() => [] as string[])) {
    for (const n of await fs.readdir(join(cacheOrdner(), d)).catch(() => [] as string[])) {
      const s = await fs.stat(join(cacheOrdner(), d, n)).catch(() => null)
      if (s?.isFile()) {
        dateien++
        bytes += s.size
      }
    }
  }
  return { dateien, bytes }
}
export const cacheLeeren = () => fs.rm(cacheOrdner(), { recursive: true, force: true })
