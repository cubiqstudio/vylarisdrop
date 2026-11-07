import { createWriteStream, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { createGunzip } from 'node:zlib'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { H3Event } from 'h3'
import { q } from './db'
import { clientIp } from './auth'
import { datenordner } from './speicher'

const GEO = () => join(datenordner(), 'geoip', 'dbip-country.mmdb')
let leser: any = null
let geladenAm = 0

async function geoLeser() {
  if (leser && Date.now() - geladenAm < 24 * 3600_000) return leser
  try {
    const maxmind = await import('maxmind')
    leser = await (maxmind.default || maxmind).open(GEO())
    geladenAm = Date.now()
  } catch {
    leser = null
  }
  return leser
}

export async function geoAktualisieren(): Promise<void> {
  const ziel = GEO()
  const st = await fs.stat(ziel).catch(() => null)
  if (st && Date.now() - st.mtimeMs < 35 * 86400_000) return
  await fs.mkdir(join(ziel, '..'), { recursive: true })
  const d = new Date()
  for (const versatz of [0, 1]) {
    const m = new Date(d.getFullYear(), d.getMonth() - versatz, 1)
    const url = `https://download.db-ip.com/free/dbip-country-lite-${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}.mmdb.gz`
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120_000) })
      if (!r.ok || !r.body) continue
      const tmp = ziel + '.neu'
      await pipeline(Readable.fromWeb(r.body as any), createGunzip(), createWriteStream(tmp))
      await fs.rename(tmp, ziel)
      leser = null
      console.log('[vylariscloud] Länder-Datenbank (DB-IP Lite) aktualisiert.')
      return
    } catch {}
  }
}

export function quelleAus(event: H3Event): string {
  const ref = String(getRequestHeader(event, 'referer') || '')
  if (!ref) return 'direkt'
  let host = ''
  try {
    host = new URL(ref).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return 'direkt'
  }
  const eigen = String(getRequestHeader(event, 'host') || '')
    .split(':')[0]!
    .toLowerCase()
  if (host === eigen) return 'intern'
  const BEKANNT: Array<[RegExp, string]> = [
    [/(^|\.)discord(app)?\.com$/, 'Discord'],
    [/(^|\.)t\.me$|telegram/, 'Telegram'],
    [/whatsapp/, 'WhatsApp'],
    [/(^|\.)google\./, 'Google'],
    [/(^|\.)reddit\.com$/, 'Reddit'],
    [/(^|\.)(x|twitter)\.com$|t\.co$/, 'X'],
    [/(^|\.)facebook\.com$|fb\.me$/, 'Facebook'],
    [/(^|\.)github\.com$/, 'GitHub']
  ]
  for (const [re, name] of BEKANNT) if (re.test(host)) return name
  return host.slice(0, 80)
}

export function statZaehlen(event: H3Event, fileId: string | number): void {
  void (async () => {
    let land = ''
    try {
      const l = await geoLeser()
      const ip = clientIp(event)
      if (l && ip) land = String(l.get(ip)?.country?.iso_code || '')
    } catch {}
    await q(
      `INSERT INTO aufrufe (file_id, tag, quelle, land, n) VALUES ($1, (now() AT TIME ZONE 'Europe/Berlin')::date, $2, $3, 1)
      ON CONFLICT (file_id, tag, quelle, land) DO UPDATE SET n = aufrufe.n + 1`,
      [fileId, quelleAus(event), land]
    )
  })().catch(() => {})
}

export async function auswertung(w: { fileId?: string; userId?: number }, tage: number) {
  const bed = w.fileId ? 'a.file_id = $1' : 'a.file_id IN (SELECT id FROM files WHERE user_id = $1)'
  const par = [w.fileId ?? w.userId, String(tage)]
  const zeitraum = `a.tag > (now() AT TIME ZONE 'Europe/Berlin')::date - ($2 || ' days')::interval`
  const proTag = await q<{ tag: string; n: string }>(
    `SELECT to_char(a.tag, 'YYYY-MM-DD') AS tag, sum(a.n) AS n FROM aufrufe a WHERE ${bed} AND ${zeitraum} GROUP BY a.tag ORDER BY a.tag`,
    par
  )
  const quellen = await q<{ quelle: string; n: string }>(
    `SELECT a.quelle, sum(a.n) AS n FROM aufrufe a WHERE ${bed} AND ${zeitraum} GROUP BY a.quelle ORDER BY 2 DESC LIMIT 8`,
    par
  )
  const laender = await q<{ land: string; n: string }>(
    `SELECT a.land, sum(a.n) AS n FROM aufrufe a WHERE ${bed} AND ${zeitraum} GROUP BY a.land ORDER BY 2 DESC LIMIT 8`,
    par
  )
  const top = w.fileId
    ? []
    : await q<{ id: string; name: string; slug: string; art: string; n: string }>(
        `SELECT f.id, f.name, f.slug, f.art, sum(a.n) AS n FROM aufrufe a JOIN files f ON f.id = a.file_id
    WHERE ${bed} AND ${zeitraum} GROUP BY f.id ORDER BY 5 DESC LIMIT 8`,
        par
      )
  const map = new Map(proTag.map((r) => [r.tag, Number(r.n)]))
  const tageListe: Array<{ tag: string; n: number }> = []
  const heute = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }))
  for (let i = tage - 1; i >= 0; i--) {
    const d = new Date(heute)
    d.setDate(d.getDate() - i)
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    tageListe.push({ tag: k, n: map.get(k) || 0 })
  }
  return {
    tage: tageListe,
    gesamt: tageListe.reduce((a, x) => a + x.n, 0),
    quellen: quellen.map((r) => ({ name: r.quelle, n: Number(r.n) })),
    laender: laender.map((r) => ({ code: r.land, n: Number(r.n) })),
    top: top.map((r) => ({ id: String(r.id), name: r.name, slug: r.slug, art: r.art, n: Number(r.n) }))
  }
}
