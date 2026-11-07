import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { getSetting, setSetting, st } from './settings'
import { datenordner } from './speicher'
import { VERSION } from './knoten'

const QUELLE = 'https://raw.githubusercontent.com/cubiqstudio/vylarisdrop/main/deploy/version.json'
const ABSTAND = 6 * 3600_000

export interface VersionInfo {
  version: string
  datum: string
  hinweise: { de: string[]; en: string[] }
}
interface Gespeichert {
  neueste: VersionInfo | null
  geprueft: number
  fehler: string
}

export function neuer(a: string, b: string): boolean {
  const x = a.split('.').map((n) => Number.parseInt(n, 10) || 0),
    y = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
  }
  return false
}

export async function versionPruefen(erzwingen = false): Promise<Gespeichert> {
  const alt = await getSetting<Gespeichert>('update', { neueste: null, geprueft: 0, fehler: '' }, true)
  if (!erzwingen && Date.now() - alt.geprueft < ABSTAND) return alt
  try {
    const r = await fetch(QUELLE, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'user-agent': `VylarisCloud/${VERSION}`, 'cache-control': 'no-cache' }
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j: any = await r.json()
    if (!/^\d+\.\d+\.\d+$/.test(String(j?.version || ''))) throw new Error('ungueltige Antwort')
    const liste = (v: any) =>
      Array.isArray(v)
        ? v
            .filter((s: any) => typeof s === 'string')
            .map((s: string) => s.slice(0, 300))
            .slice(0, 20)
        : []
    const neu: Gespeichert = {
      neueste: {
        version: j.version,
        datum: String(j.datum || '').slice(0, 20),
        hinweise: { de: liste(j.hinweise?.de), en: liste(j.hinweise?.en) }
      },
      geprueft: Date.now(),
      fehler: ''
    }
    await setSetting('update', neu)
    return neu
  } catch (e: any) {
    const neu: Gespeichert = {
      ...alt,
      geprueft: Date.now(),
      fehler:
        st('Die neueste Version ließ sich nicht abfragen.', 'The latest version could not be checked.') +
        ` (${String(e?.message || e).slice(0, 80)})`
    }
    await setSetting('update', neu)
    return neu
  }
}

const pfad = (n: string) => join(datenordner(), n)
export const UPDATE_BEFEHL =
  'curl -fsSL https://raw.githubusercontent.com/cubiqstudio/vylarisdrop/main/deploy/update.sh | sudo bash'
async function dienstAlt(): Promise<boolean> {
  const m = await fs.readFile(pfad('.updater'), 'utf8').catch(() => null)
  if (m === null) return false
  const z = /(^|\n)stand=(\d+)/.exec(m)
  return !z || Number(z[2]) < 2
}
export const dienstZuAlt = () =>
  fehler(
    409,
    st(
      `Der Dienst auf dem Server ist zu alt dafür — einmal auf dem Server ausführen: ${UPDATE_BEFEHL}`,
      `The service on the server is too old for this — run once on the server: ${UPDATE_BEFEHL}`
    )
  )
async function lesenJson(n: string): Promise<any> {
  try {
    return JSON.parse(await fs.readFile(pfad(n), 'utf8'))
  } catch {
    return null
  }
}

async function updateProtokoll(): Promise<string> {
  const f = await fs.open(pfad('.update.log'), 'r').catch(() => null)
  if (!f) return ''
  try {
    const { size, mtimeMs } = await f.stat()
    if (Date.now() - mtimeMs > 2 * 3600_000) return ''
    const n = Math.min(size, 12_000),
      b = Buffer.alloc(n)
    await f.read(b, 0, n, size - n)
    const t = b
      .toString('utf8')
      .replace(/\r(?!\n)/g, '\n')
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
      .replace(/[\x00-\x08\x0b-\x1f]/g, '')
    return (size > n ? t.slice(t.indexOf('\n') + 1) : t).split('\n').slice(-200).join('\n')
  } finally {
    await f.close()
  }
}
async function nichtAbgeholt(): Promise<boolean> {
  const st2 = await fs.stat(pfad('.update-anfrage')).catch(() => null)
  return !!st2 && Date.now() - st2.mtimeMs > 3 * 60_000
}

export async function updateStand() {
  const g = await getSetting<Gespeichert>('update', { neueste: null, geprueft: 0, fehler: '' })
  const updater = await fs.stat(pfad('.updater')).then(
    () => true,
    () => false
  )
  const lauf = await lesenJson('.update-status')
  const angefragt = await fs.stat(pfad('.update-anfrage')).then(
    () => true,
    () => false
  )
  return {
    aktuell: VERSION,
    neueste: g.neueste,
    geprueft: g.geprueft ? new Date(g.geprueft).toISOString() : null,
    fehler: g.fehler,
    verfuegbar: !!g.neueste && neuer(g.neueste.version, VERSION),
    updater,
    angefragt,
    dienstAlt: await dienstAlt(),
    befehl: UPDATE_BEFEHL,
    protokoll: await updateProtokoll(),
    nichtAbgeholt: await nichtAbgeholt(),
    lauf:
      lauf && typeof lauf === 'object'
        ? {
            status: String(lauf.status || ''),
            zeit: String(lauf.zeit || ''),
            meldung: String(lauf.meldung || '').slice(0, 500),
            von: String(lauf.von || ''),
            zu: String(lauf.zu || '')
          }
        : null
  }
}

export async function updateAnfragen(von: string): Promise<void> {
  if (
    !(await fs.stat(pfad('.updater')).then(
      () => true,
      () => false
    ))
  )
    throw fehler(
      409,
      st(
        `Auf diesem Server ist der Update-Dienst nicht eingerichtet — einmal auf dem Server ausführen: ${UPDATE_BEFEHL}`,
        `The update service is not set up on this server — run once on the server: ${UPDATE_BEFEHL}`
      )
    )
  const lauf = await lesenJson('.update-status')
  if (lauf?.status === 'laeuft' && Date.now() - new Date(lauf.zeit).getTime() < 15 * 60_000)
    throw fehler(409, st('Es läuft schon ein Update.', 'An update is already running.'))
  await fs.writeFile(
    pfad('.update-anfrage'),
    JSON.stringify({ id: randomBytes(6).toString('hex'), aktion: 'update', von, zeit: new Date().toISOString() }),
    { mode: 0o644 }
  )
}

export async function dienstKann(aktion: string): Promise<boolean> {
  const m = await fs.readFile(pfad('.updater'), 'utf8').catch(() => '')
  return new RegExp(`(^|\\n)aktionen=.*\\b${aktion}\\b`).test(m)
}
export async function virenscanAnfragen(an: boolean, von: string): Promise<void> {
  if (!(await dienstKann('virenscan'))) throw dienstZuAlt()
  await fs.writeFile(
    pfad('.update-anfrage'),
    JSON.stringify({
      id: randomBytes(6).toString('hex'),
      aktion: an ? 'virenscan-an' : 'virenscan-aus',
      von,
      zeit: new Date().toISOString()
    }),
    { mode: 0o644 }
  )
}
export async function virenscanDienstStand() {
  const s = await lesenJson('.virenscan-status')
  return s && typeof s === 'object'
    ? { status: String(s.status || ''), zeit: String(s.zeit || ''), meldung: String(s.meldung || '').slice(0, 500) }
    : null
}
