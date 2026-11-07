import { connect } from 'node:net'
import type { Readable } from 'node:stream'
import { q, q1, ereignis } from './db'
import { getSetting } from './settings'
import { lesen } from './speicher'
import { KNOTEN_ID, lebendeKnoten } from './knoten'
import { imHintergrund } from './benachrichtigen'
import { wiederherstellungLaeuft } from './sicherung'
import { webhookAusloesen } from './webhooks'

export const MAX_SCAN = 100 * 1024 ** 2
const ZIEL = (process.env.VD_CLAMAV || '').trim()

export interface VirenEinst {
  an: boolean
}
export async function getViren(): Promise<VirenEinst> {
  const s = await getSetting<Partial<VirenEinst> | null>('virenscan', null, true)
  if (s && typeof s.an === 'boolean') return { an: s.an }
  return { an: (await clamStatus()).erreichbar }
}

function adresse(): { host: string; port: number } | null {
  const m = /^([A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\]):(\d{1,5})$/.exec(ZIEL)
  return m ? { host: m[1]!.replace(/^\[|\]$/g, ''), port: Number(m[2]) } : null
}

function clamd(befehl: string, strom?: Readable, zeit = 5000): Promise<string> {
  const a = adresse()
  if (!a) return Promise.reject(new Error('kein-clamav'))
  return new Promise((resolve, reject) => {
    const s = connect(a.port, a.host)
    let antwort = '',
      vorbei = false
    const ende = (f: () => void) => {
      if (!vorbei) {
        vorbei = true
        clearTimeout(uhr)
        s.destroy()
        f()
      }
    }
    let uhr = setTimeout(() => ende(() => reject(new Error('zeit'))), zeit)
    s.on('error', (e) => ende(() => reject(e)))
    s.on('data', (b) => {
      antwort += b.toString('utf8')
      if (antwort.includes('\0')) ende(() => resolve(antwort.replace(/\0[\s\S]*$/, '').trim()))
    })
    s.on('end', () => ende(() => resolve(antwort.replace(/\0/g, '').trim())))
    s.on('connect', () => {
      s.write(`z${befehl}\0`)
      if (!strom) return
      clearTimeout(uhr)
      uhr = setTimeout(() => ende(() => reject(new Error('zeit'))), 5 * 60_000)
      strom.on('data', (c: Buffer) => {
        const len = Buffer.alloc(4)
        len.writeUInt32BE(c.length)
        if (!s.write(Buffer.concat([len, c]))) {
          strom.pause()
          s.once('drain', () => strom.resume())
        }
      })
      strom.on('end', () => s.write(Buffer.alloc(4)))
      strom.on('error', (e) => ende(() => reject(e)))
    })
  })
}

export async function clamStatus(): Promise<{ eingerichtet: boolean; erreichbar: boolean; version: string }> {
  if (!adresse()) return { eingerichtet: false, erreichbar: false, version: '' }
  try {
    if ((await clamd('PING', undefined, 3000)) !== 'PONG') return { eingerichtet: true, erreichbar: false, version: '' }
    return {
      eingerichtet: true,
      erreichbar: true,
      version: (await clamd('VERSION', undefined, 3000)).replace(/^ClamAV\s*/, '')
    }
  } catch {
    return { eingerichtet: true, erreichbar: false, version: '' }
  }
}

export async function pruefen(strom: Readable): Promise<{ ok: true } | { fund: string } | { zuGross: true }> {
  const r = await clamd('INSTREAM', strom)
  if (/size limit exceeded/i.test(r)) return { zuGross: true }
  const m = /^stream: (.+) FOUND$/.exec(r)
  if (m) return { fund: m[1]!.slice(0, 200) }
  if (/^stream: OK$/.test(r)) return { ok: true }
  throw new Error('clamd: ' + r.slice(0, 120))
}

let laeuft = false
export async function scanArbeiten(): Promise<void> {
  if (laeuft || wiederherstellungLaeuft()) return
  laeuft = true
  try {
    if (!(await getViren()).an || !(await clamStatus()).erreichbar) return
    for (let n = 0; n < 500; n++) {
      if (n > 0 && !(await getViren()).an) return
      const f = await q1<{
        id: string
        user_id: number
        name: string
        ablage: string
        size: string
        verschluesselt: boolean
      }>(
        `UPDATE files SET scan = 'laeuft', scan_info = $1 WHERE id = (SELECT id FROM files WHERE scan = '' ORDER BY id DESC LIMIT 1 FOR UPDATE SKIP LOCKED)
         RETURNING id, user_id, name, ablage, size, verschluesselt`,
        [KNOTEN_ID]
      )
      if (!f) return
      if (f.verschluesselt) {
        await setzen(f.id, 'uebersprungen', 'verschluesselt')
        continue
      }
      if (Number(f.size) > MAX_SCAN) {
        await setzen(f.id, 'uebersprungen', 'zu-gross')
        continue
      }
      try {
        const r = await pruefen(lesen(f.ablage))
        if ('fund' in r) await fund(f, r.fund)
        else if ('zuGross' in r) await setzen(f.id, 'uebersprungen', 'zu-gross')
        else await setzen(f.id, 'ok', '')
      } catch (e: any) {
        await setzen(f.id, '', '')
        console.warn('[vylariscloud] Virenscan:', e?.message)
        return
      }
    }
  } finally {
    laeuft = false
  }
}

const setzen = (id: string, scan: string, info: string) =>
  q('UPDATE files SET scan = $2, scan_info = $3 WHERE id = $1', [id, scan, info])

async function fund(f: { id: string; user_id: number; name: string }, signatur: string) {
  await setzen(f.id, 'fund', signatur)
  const s = await q1<{ slug: string }>('SELECT slug FROM files WHERE id = $1', [f.id])
  webhookAusloesen(f.user_id, 'virus.found', {
    file: { id: String(f.id), slug: s?.slug, name: f.name },
    threat: signatur
  })
  await ereignis('virus_fund', f.user_id, { name: f.name.slice(0, 80), virus: signatur })
  const u = await q1<{ prefs: any }>('SELECT prefs FROM users WHERE id = $1', [f.user_id])
  imHintergrund(
    f.user_id,
    'virus',
    u?.prefs?.lang === 'en'
      ? {
          titel: 'Malware found',
          text: `${f.name} contains ${signatur} and was quarantined. It is no longer delivered.`
        }
      : {
          titel: 'Schadsoftware gefunden',
          text: `${f.name} enthält ${signatur} und wurde in Quarantäne gelegt. Sie wird nicht mehr ausgeliefert.`
        }
  )
}

export async function scanAufraeumen() {
  const leben = (await lebendeKnoten()).map((k) => k.id)
  await q(`UPDATE files SET scan = '', scan_info = '' WHERE scan = 'laeuft' AND NOT (scan_info = ANY($1::text[]))`, [
    [...leben, KNOTEN_ID]
  ])
}

export const inQuarantaene = (f: { scan?: string }) => f.scan === 'fund'

export async function scanZahlen() {
  const r = await q1<{
    offen: string
    funde: string
    geprueft: string
  }>(`SELECT count(*) FILTER (WHERE scan IN ('', 'laeuft')) AS offen, count(*) FILTER (WHERE scan = 'fund') AS funde,
    count(*) FILTER (WHERE scan IN ('ok', 'frei')) AS geprueft FROM files`)
  return { offen: Number(r?.offen || 0), funde: Number(r?.funde || 0), geprueft: Number(r?.geprueft || 0) }
}
