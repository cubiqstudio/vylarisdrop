import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { hostname, loadavg, totalmem, freemem, cpus } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { q, q1 } from './db'
import { datenordner } from './speicher'

export const KNOTEN_ID = randomUUID()
export const KNOTEN_NAME = (process.env.VD_NODE_NAME || hostname() || 'vylariscloud').slice(0, 60)
export const NUR_WEB = process.env.VD_NODE_ROLE === 'web'
export const VERSION = process.env.VD_VERSION || '1.0.0'
const GESTARTET = new Date()
let ordnerId = ''
export const meinOrdner = () => ordnerId

export async function ordnerIdLaden(): Promise<string> {
  const p = join(datenordner(), '.ordner-id')
  try {
    ordnerId = (await fs.readFile(p, 'utf8')).trim()
  } catch {}
  if (!/^[0-9a-f-]{36}$/.test(ordnerId)) {
    ordnerId = randomUUID()
    await fs.writeFile(p, ordnerId, { flag: 'wx' }).catch(async () => {
      ordnerId = (await fs.readFile(p, 'utf8')).trim() || ordnerId
    })
  }
  return ordnerId
}

export interface KnotenZeile {
  id: string
  name: string
  version: string
  ordner: string
  rolle: string
  gestartet_at: string
  zuletzt_at: string
  info: any
  lebt: boolean
}

async function melden(): Promise<void> {
  const info = {
    last: loadavg()[0],
    kerne: cpus().length,
    ram: totalmem(),
    ramFrei: freemem(),
    rss: process.memoryUsage().rss,
    node: process.version,
    arbeit: arbeitsStand()
  }
  await q(
    `INSERT INTO knoten (id, name, version, ordner, rolle, gestartet_at, zuletzt_at, info) VALUES ($1,$2,$3,$4,$5,$6, now(), $7::jsonb)
    ON CONFLICT (id) DO UPDATE SET zuletzt_at = now(), info = EXCLUDED.info, ordner = EXCLUDED.ordner`,
    [KNOTEN_ID, KNOTEN_NAME, VERSION, ordnerId, NUR_WEB ? 'web' : 'alles', GESTARTET, JSON.stringify(info)]
  )
}
export async function lebendeKnoten(): Promise<KnotenZeile[]> {
  return q<KnotenZeile>(
    `SELECT *, zuletzt_at > now() - interval '60 seconds' AS lebt FROM knoten WHERE zuletzt_at > now() - interval '60 seconds' ORDER BY gestartet_at, id`
  )
}
export async function alleKnoten(): Promise<KnotenZeile[]> {
  return q<KnotenZeile>(
    `SELECT *, zuletzt_at > now() - interval '60 seconds' AS lebt FROM knoten WHERE zuletzt_at > now() - interval '1 day' ORDER BY gestartet_at, id`
  )
}
export async function knotenLebt(id: string | null | undefined): Promise<boolean> {
  if (!id) return false
  if (id === KNOTEN_ID) return true
  return !!(await q1(`SELECT 1 FROM knoten WHERE id = $1 AND zuletzt_at > now() - interval '60 seconds'`, [id]))
}

const zaehler = { medien: 0, importe: 0, umzug: 0 }
export const arbeitsStand = () => ({ ...zaehler })
export function arbeitBeginnt(art: keyof typeof zaehler) {
  zaehler[art]++
}
export function arbeitEndet(art: keyof typeof zaehler) {
  zaehler[art] = Math.max(0, zaehler[art] - 1)
}

export async function mitSperre<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (laufend.has(name)) return undefined
  const nr = sperrNummer(name)
  laufend.add(name)
  try {
    const r = await sperrAbfrage<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [nr]).catch(() => null)
    if (!r?.rows[0]?.ok) return undefined
    try {
      return await fn()
    } finally {
      await sperrAbfrage('SELECT pg_advisory_unlock($1)', [nr]).catch(() => {})
    }
  } finally {
    laufend.delete(name)
  }
}
const laufend = new Set<string>()
let sperrC: pg.Client | null = null
let sperrKette: Promise<unknown> = Promise.resolve()
async function sperrClient(): Promise<pg.Client> {
  if (sperrC) return sperrC
  const url = useRuntimeConfig().dbUrl || process.env.DATABASE_URL
  const c = new pg.Client({ connectionString: url })
  const weg = () => {
    if (sperrC === c) sperrC = null
  }
  c.on('error', weg)
  c.on('end', weg)
  await c.connect()
  sperrC = c
  return c
}
function sperrAbfrage<R extends pg.QueryResultRow = any>(sql: string, p: unknown[]): Promise<pg.QueryResult<R>> {
  const lauf = sperrKette.then(async () => (await sperrClient()).query<R>(sql, p as any[]))
  sperrKette = lauf.catch(() => {})
  return lauf
}
function sperrNummer(name: string): number {
  let h = 0x5244
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0
  return h
}

type Hoerer = (nutzlast: string) => void
const hoerer = new Map<string, Hoerer[]>()
export function hoeren(kanal: 'vd_settings' | 'vd_arbeit', fn: Hoerer) {
  hoerer.set(kanal, [...(hoerer.get(kanal) || []), fn])
}
export async function melde(kanal: 'vd_settings' | 'vd_arbeit', nutzlast: string): Promise<void> {
  await q('SELECT pg_notify($1, $2)', [kanal, `${KNOTEN_ID}|${nutzlast}`.slice(0, 7000)]).catch(() => {})
}

let lauscher: pg.Client | null = null
async function lauschen(): Promise<void> {
  const url = useRuntimeConfig().dbUrl || process.env.DATABASE_URL
  if (!url) return
  const c = new pg.Client({ connectionString: url })
  const neu = () => {
    if (lauscher === c) {
      lauscher = null
      setTimeout(() => {
        void lauschen().catch(() => {})
      }, 5000).unref?.()
    }
  }
  c.on('error', neu)
  c.on('end', neu)
  c.on('notification', (n) => {
    const [von, ...rest] = String(n.payload || '').split('|')
    if (von === KNOTEN_ID) return
    for (const fn of hoerer.get(n.channel) || []) {
      try {
        fn(rest.join('|'))
      } catch {}
    }
  })
  await c.connect()
  await c.query('LISTEN vd_settings')
  await c.query('LISTEN vd_arbeit')
  lauscher = c
  for (const fn of hoerer.get('vd_settings') || []) fn('*')
}

let zweitSeit = 0
let gesperrt = false
export const knotenGesperrt = () => gesperrt
async function freiPruefen(): Promise<void> {
  const { istPro } = await import('./lizenz')
  const live = await lebendeKnoten()
  const ersterId = live[0]?.id
  const zweit = live.length > 1 && ersterId !== KNOTEN_ID && !(await istPro('multi-server'))
  if (!zweit) {
    zweitSeit = 0
    gesperrt = false
    return
  }
  if (!zweitSeit) zweitSeit = Date.now()
  const frist = Math.min(600, Number(process.env.VD_ZWEIT_FRIST) || 600) * 1000
  gesperrt = Date.now() - zweitSeit > frist
}

let gestartet = false
export async function knotenStarten(): Promise<void> {
  if (gestartet) return
  gestartet = true
  await ordnerIdLaden()
  await q('DELETE FROM knoten WHERE name = $1 AND id <> $2', [KNOTEN_NAME, KNOTEN_ID]).catch(() => {})
  await melden()
  await lauschen().catch((e) => console.error('[vylariscloud] LISTEN:', e.message))
  setInterval(() => {
    melden().catch(() => {})
    freiPruefen().catch(() => {})
  }, 15_000).unref?.()
  setInterval(() => {
    q(`DELETE FROM knoten WHERE zuletzt_at < now() - interval '1 day'`).catch(() => {})
  }, 3600_000).unref?.()
  console.log(`[vylariscloud] Knoten ${KNOTEN_NAME} (${KNOTEN_ID.slice(0, 8)})${NUR_WEB ? ' — nur Auslieferung' : ''}`)
}
export async function knotenAbmelden(): Promise<void> {
  await q('DELETE FROM knoten WHERE id = $1', [KNOTEN_ID]).catch(() => {})
  await lauscher?.end().catch(() => {})
}
