import { monitorEventLoopDelay } from 'node:perf_hooks'
import { cpus } from 'node:os'
import { randomBytes } from 'node:crypto'
import { q, q1, ereignis } from './db'
import { getSetting, setSetting } from './settings'
import { KNOTEN_ID, KNOTEN_NAME, VERSION, alleKnoten, mitSperre } from './knoten'
import { platte } from './speicher'
import { istPro, lizenzStand, aktivJetzt } from './lizenz'
import { clamStatus } from './virenscan'
import { benachrichtigen } from './benachrichtigen'

export interface MonEinst {
  token: string
  warnungen: { platteProzent: number; fehlerProzent: number; warteschlange: number }
  aus: boolean
}
export const getMon = async (): Promise<MonEinst> => {
  const s = await getSetting<Partial<MonEinst>>('monitoring', {})
  return {
    token: s.token || '',
    aus: !!s.aus,
    warnungen: { platteProzent: 10, fehlerProzent: 5, warteschlange: 200, ...(s.warnungen || {}) }
  }
}
export async function monToken(neu = false): Promise<string> {
  const m = await getMon()
  if (m.token && !neu) return m.token
  const token = 'vdm_' + randomBytes(24).toString('hex')
  await setSetting('monitoring', { ...m, token })
  return token
}

const GRENZEN = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
type Bereich = 'api' | 'datei' | 'seite' | 'panel'
const anfragen = new Map<string, number>()
const dauer = { buckets: new Array(GRENZEN.length).fill(0) as number[], summe: 0, anzahl: 0 }
let minute = { n: 0, f5: 0, f4: 0, ms: 0 }
const schleife = monitorEventLoopDelay({ resolution: 20 })
schleife.enable()
let cpuVorher = process.cpuUsage(),
  zeitVorher = Date.now()

export function bereichVon(pfad: string): Bereich | null {
  if (pfad.startsWith('/_nuxt/') || pfad.startsWith('/__') || pfad === '/favicon.ico') return null
  if (pfad.startsWith('/api/')) return 'api'
  if (/^\/(r|d|raw|t|s)\//.test(pfad)) return 'datei'
  if (/^\/(v|g|a)\//.test(pfad)) return 'seite'
  return 'panel'
}
export function anfrageZaehlen(pfad: string, status: number, sekunden: number) {
  const b = bereichVon(pfad)
  if (!b) return
  const k = `${b}|${Math.floor(status / 100)}xx`
  anfragen.set(k, (anfragen.get(k) || 0) + 1)
  for (let i = 0; i < GRENZEN.length; i++) if (sekunden <= GRENZEN[i]!) dauer.buckets[i]!++
  dauer.summe += sekunden
  dauer.anzahl++
  minute.n++
  minute.ms += sekunden * 1000
  if (status >= 500) minute.f5++
  else if (status >= 400) minute.f4++
}

async function minuteSchreiben() {
  const jetzt = Date.now()
  const c = process.cpuUsage(cpuVorher)
  const cpu = Math.min(100 * cpus().length, ((c.user + c.system) / 1000 / Math.max(1, jetzt - zeitVorher)) * 100)
  cpuVorher = process.cpuUsage()
  zeitVorher = jetzt
  const m = process.memoryUsage()
  const w = {
    anfragen: minute.n,
    f5: minute.f5,
    f4: minute.f4,
    ms: minute.n ? Math.round(minute.ms / minute.n) : 0,
    cpu: Math.round(cpu * 10) / 10,
    ram: m.rss,
    heap: m.heapUsed,
    schleife_ms: Math.round(schleife.percentile(99) / 1e5) / 10
  }
  minute = { n: 0, f5: 0, f4: 0, ms: 0 }
  schleife.reset()
  await q(
    `INSERT INTO messwerte (zeit, knoten, name, werte) VALUES (date_trunc('minute', now()), $1, $2, $3::jsonb) ON CONFLICT (zeit, knoten) DO UPDATE SET werte = EXCLUDED.werte`,
    [KNOTEN_ID, KNOTEN_NAME, JSON.stringify(w)]
  )
}

export async function zustand() {
  const [dateien, korb, nutzer, offen, wh, dbg, verb] = await Promise.all([
    q1<{ n: string; b: string; s3: string; aufrufe: string }>(
      `SELECT count(*) AS n, coalesce(sum(size), 0) AS b, coalesce(sum(size) FILTER (WHERE ablage LIKE 's3:%'), 0) AS s3, coalesce(sum(views), 0) AS aufrufe FROM files`
    ),
    q1<{ n: string }>('SELECT count(*) AS n FROM papierkorb'),
    q1<{ n: string }>('SELECT count(*) AS n FROM users'),
    q1<{ medien: string; scan: string }>(
      `SELECT count(*) FILTER (WHERE verarbeitung IN ('offen', 'laeuft')) AS medien, count(*) FILTER (WHERE scan IN ('', 'laeuft')) AS scan FROM files`
    ),
    q<{ status: string; n: string }>(`SELECT status, count(*) AS n FROM webhook_lieferungen GROUP BY status`),
    q1<{ b: string }>('SELECT pg_database_size(current_database()) AS b'),
    q<{ state: string; n: string }>(
      `SELECT coalesce(state, 'unbekannt') AS state, count(*) AS n FROM pg_stat_activity WHERE datname = current_database() GROUP BY 1`
    )
  ])
  const virenAn = (await getSetting<{ an?: boolean } | null>('virenscan', null))?.an === true
  const l = await lizenzStand()
  return {
    dateien: Number(dateien?.n || 0),
    bytes: Number(dateien?.b || 0),
    bytesS3: Number(dateien?.s3 || 0),
    aufrufe: Number(dateien?.aufrufe || 0),
    papierkorb: Number(korb?.n || 0),
    konten: Number(nutzer?.n || 0),
    warteschlangen: {
      medien: Number(offen?.medien || 0),
      virenscan: virenAn ? Number(offen?.scan || 0) : 0,
      webhooks: Number(wh.find((x) => x.status === 'offen')?.n || 0)
    },
    webhooks: Object.fromEntries(wh.map((x) => [x.status, Number(x.n)])),
    db: { bytes: Number(dbg?.b || 0), verbindungen: Object.fromEntries(verb.map((x) => [x.state, Number(x.n)])) },
    platte: await platte(),
    knoten: await alleKnoten(),
    lizenz: !!l && aktivJetzt(l),
    clamav: (await clamStatus()).erreichbar,
    hochgeladen24h: Number(
      (await q1<{ n: string }>(`SELECT count(*) AS n FROM files WHERE created_at > now() - interval '24 hours'`))?.n ||
        0
    )
  }
}

export async function prometheus(): Promise<string> {
  const z = await zustand()
  const zeilen: string[] = []
  const metrik = (name: string, typ: string, hilfe: string, werte: Array<[Record<string, string>, number]>) => {
    zeilen.push(`# HELP ${name} ${hilfe}`, `# TYPE ${name} ${typ}`)
    for (const [l, v] of werte) {
      const lab = Object.entries(l)
        .map(([k, x]) => `${k}="${String(x).replace(/["\\\n]/g, '_')}"`)
        .join(',')
      zeilen.push(`${name}${lab ? `{${lab}}` : ''} ${Number.isFinite(v) ? v : 0}`)
    }
  }
  const knoten = { node: KNOTEN_NAME }
  metrik('vylariscloud_info', 'gauge', 'Version and node of this instance', [[{ version: VERSION, node: KNOTEN_NAME }, 1]])
  metrik(
    'vylariscloud_http_requests_total',
    'counter',
    'HTTP requests handled by this node since start',
    [...anfragen].map(([k, n]) => {
      const [area, code] = k.split('|')
      return [{ ...knoten, area: area!, code: code! }, n]
    })
  )
  zeilen.push(
    '# HELP vylariscloud_http_request_duration_seconds Response time of this node',
    '# TYPE vylariscloud_http_request_duration_seconds histogram'
  )
  GRENZEN.forEach((g, i) =>
    zeilen.push(`vylariscloud_http_request_duration_seconds_bucket{node="${KNOTEN_NAME}",le="${g}"} ${dauer.buckets[i]}`)
  )
  zeilen.push(
    `vylariscloud_http_request_duration_seconds_bucket{node="${KNOTEN_NAME}",le="+Inf"} ${dauer.anzahl}`,
    `vylariscloud_http_request_duration_seconds_sum{node="${KNOTEN_NAME}"} ${dauer.summe.toFixed(4)}`,
    `vylariscloud_http_request_duration_seconds_count{node="${KNOTEN_NAME}"} ${dauer.anzahl}`
  )
  const m = process.memoryUsage(),
    c = process.cpuUsage()
  metrik('process_resident_memory_bytes', 'gauge', 'Resident memory of this node', [[knoten, m.rss]])
  metrik('process_cpu_seconds_total', 'counter', 'CPU time of this node', [[knoten, (c.user + c.system) / 1e6]])
  metrik('nodejs_heap_used_bytes', 'gauge', 'V8 heap in use', [[knoten, m.heapUsed]])
  metrik('nodejs_eventloop_lag_p99_seconds', 'gauge', 'Event loop delay (p99, since last minute)', [
    [knoten, schleife.percentile(99) / 1e9]
  ])
  metrik('vylariscloud_files', 'gauge', 'Stored files', [[{}, z.dateien]])
  metrik('vylariscloud_storage_bytes', 'gauge', 'Bytes of all stored files by location', [
    [{ location: 'local' }, z.bytes - z.bytesS3],
    [{ location: 's3' }, z.bytesS3]
  ])
  metrik('vylariscloud_trash_files', 'gauge', 'Files in the trash', [[{}, z.papierkorb]])
  metrik('vylariscloud_users', 'gauge', 'Accounts', [[{}, z.konten]])
  metrik('vylariscloud_views_total', 'counter', 'Counted views of all files', [[{}, z.aufrufe]])
  metrik('vylariscloud_uploads_24h', 'gauge', 'Files uploaded in the last 24 hours', [[{}, z.hochgeladen24h]])
  metrik(
    'vylariscloud_queue_jobs',
    'gauge',
    'Pending background jobs',
    Object.entries(z.warteschlangen).map(([k, v]) => [
      { queue: { medien: 'media', virenscan: 'virus_scan', webhooks: 'webhooks' }[k] || k },
      v
    ])
  )
  metrik(
    'vylariscloud_webhook_deliveries',
    'gauge',
    'Webhook deliveries in the last 14 days by status',
    Object.entries(z.webhooks).map(([k, v]) => [
      { status: { ok: 'delivered', fehler: 'failed', offen: 'pending' }[k] || k },
      v
    ])
  )
  if (z.platte) {
    metrik('vylariscloud_disk_free_bytes', 'gauge', 'Free space on the data volume', [[knoten, z.platte.frei]])
    metrik('vylariscloud_disk_total_bytes', 'gauge', 'Size of the data volume', [[knoten, z.platte.gesamt]])
  }
  metrik('vylariscloud_db_size_bytes', 'gauge', 'Database size', [[{}, z.db.bytes]])
  metrik(
    'vylariscloud_db_connections',
    'gauge',
    'Database connections by state',
    Object.entries(z.db.verbindungen).map(([k, v]) => [{ state: k }, v])
  )
  metrik('vylariscloud_nodes', 'gauge', 'Known nodes by state', [
    [{ state: 'alive' }, z.knoten.filter((k) => k.lebt).length],
    [{ state: 'dead' }, z.knoten.filter((k) => !k.lebt).length]
  ])
  metrik('vylariscloud_license_active', 'gauge', 'Pro licence active', [[{}, z.lizenz ? 1 : 0]])
  metrik('vylariscloud_clamav_up', 'gauge', 'ClamAV reachable', [[{}, z.clamav ? 1 : 0]])
  return zeilen.join('\n') + '\n'
}

export async function verlauf(stunden: number) {
  const stufe = stunden > 24 ? 'hour' : 'minute'
  const r = await q<{
    zeit: string
    anfragen: string
    f5: string
    f4: string
    ms: string
    cpu: string
    ram: string
    schleife: string
  }>(
    `
    SELECT to_char(date_trunc('${stufe}', zeit) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:00"Z"') AS zeit,
      sum((werte->>'anfragen')::numeric) / ${stufe === 'hour' ? 60 : 1} AS anfragen, sum((werte->>'f5')::numeric) AS f5, sum((werte->>'f4')::numeric) AS f4,
      sum((werte->>'ms')::numeric * (werte->>'anfragen')::numeric) / nullif(sum((werte->>'anfragen')::numeric), 0) AS ms,
      avg((werte->>'cpu')::numeric) AS cpu, sum((werte->>'ram')::numeric) / count(DISTINCT zeit) AS ram, max((werte->>'schleife_ms')::numeric) AS schleife
    FROM messwerte WHERE zeit > now() - ($1 || ' hours')::interval GROUP BY 1 ORDER BY 1`,
    [String(stunden)]
  )
  return r.map((x) => ({
    zeit: x.zeit,
    anfragen: Math.round(Number(x.anfragen) * 10) / 10,
    f5: Number(x.f5),
    f4: Number(x.f4),
    ms: Math.round(Number(x.ms || 0)),
    cpu: Math.round(Number(x.cpu) * 10) / 10,
    ram: Number(x.ram),
    schleife: Number(x.schleife)
  }))
}

async function warnungenPruefen() {
  if (!(await istPro('monitoring'))) return
  const m = await getMon()
  if (m.aus) return
  const z = await zustand()
  const gesendet = await getSetting<Record<string, number>>('monitoring-warnungen', {})
  const warnen = async (art: string, titel: string, text: string) => {
    if (Date.now() - (gesendet[art] || 0) < 6 * 3600_000) return
    gesendet[art] = Date.now()
    await setSetting('monitoring-warnungen', gesendet)
    const inhaber = await q1<{ id: number }>("SELECT id FROM users WHERE role = 'owner' ORDER BY id LIMIT 1")
    if (inhaber) {
      await benachrichtigen(inhaber.id, 'system', { titel, text })
      await ereignis('system_warnung', inhaber.id, { art, text: text.slice(0, 200) })
    }
  }
  if (z.platte && z.platte.gesamt && (z.platte.frei / z.platte.gesamt) * 100 < m.warnungen.platteProzent) {
    await warnen(
      'platte',
      'Speicherplatz fast voll',
      `Auf dem Datenträger sind nur noch ${Math.round((z.platte.frei / z.platte.gesamt) * 100)} % frei (${Math.round(z.platte.frei / 1024 ** 3)} GB).`
    )
  }
  const f = await q1<{ n: string; f5: string }>(
    `SELECT coalesce(sum((werte->>'anfragen')::int), 0) AS n, coalesce(sum((werte->>'f5')::int), 0) AS f5 FROM messwerte WHERE zeit > now() - interval '15 minutes'`
  )
  const n = Number(f?.n || 0),
    f5 = Number(f?.f5 || 0)
  if (n >= 50 && (f5 / n) * 100 > m.warnungen.fehlerProzent)
    await warnen(
      'fehler',
      'Viele Server-Fehler',
      `${f5} von ${n} Anfragen der letzten 15 Minuten endeten mit einem Server-Fehler (5xx).`
    )
  const summe = z.warteschlangen.medien + z.warteschlangen.virenscan + z.warteschlangen.webhooks
  if (summe > m.warnungen.warteschlange)
    await warnen(
      'warteschlange',
      'Warteschlange staut sich',
      `Gerade warten ${summe} Aufgaben (Vorschaubilder ${z.warteschlangen.medien}, Virenscan ${z.warteschlangen.virenscan}, Webhooks ${z.warteschlangen.webhooks}).`
    )
  const tot = z.knoten.filter((k) => !k.lebt)
  if (tot.length)
    await warnen('knoten', 'Server antwortet nicht', `${tot.map((k) => k.name).join(', ')} meldet sich nicht mehr.`)
}

export function messungStarten() {
  const naechste = 60_000 - (Date.now() % 60_000) + 500
  setTimeout(() => {
    void minuteSchreiben().catch(() => {})
    setInterval(() => {
      void minuteSchreiben().catch(() => {})
    }, 60_000).unref?.()
  }, naechste).unref?.()
  setInterval(() => {
    mitSperre('warnungen', warnungenPruefen).catch(() => {})
  }, 5 * 60_000).unref?.()
  setInterval(() => {
    mitSperre('messwerte-putzen', () => q(`DELETE FROM messwerte WHERE zeit < now() - interval '7 days'`)).catch(
      () => {}
    )
  }, 3600_000).unref?.()
}
