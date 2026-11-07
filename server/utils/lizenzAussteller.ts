import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomInt,
  sign,
  type KeyObject
} from 'node:crypto'
import { q, q1 } from './db'
import { getInstance, getSetting } from './settings'

// Eigener Lizenzaussteller: Admins erzeugen Lizenzschluessel (Laufzeit, Geraete, Funktionen). Die Antworten sind mit einem
// Ed25519-Schluessel signiert, den die Installation selbst erzeugt. Dieselbe Installation prueft ihre Lizenz lokal;
// andere Installationen koennen sie ueber VD_LIZENZ_SERVER (…/lizenz) und VD_LIZENZ_KEY (oeffentlicher Schluessel) nutzen.
export const PRODUKT_ID = 'vylariscloud'
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // ohne 0, O, 1, I
export const SCHLUESSEL_FORM = /^[A-Z0-9-]{5,64}$/

export function neuerSchluessel(): string {
  const gruppe = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
  return `VD-${gruppe()}-${gruppe()}-${gruppe()}`
}

// ===== Signaturschluessel (privater Teil verschluesselt in den Einstellungen) =====
interface Signatur {
  oeffentlich: string
  privat: string
}
async function verschluesselungsKey(): Promise<Buffer> {
  const geheim = (await getInstance()).secret
  return Buffer.from(hkdfSync('sha256', Buffer.from(geheim), 'vylariscloud', 'lizenz-signatur-v1', 32))
}
async function verschluesseln(klar: string): Promise<string> {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', await verschluesselungsKey(), iv)
  const ct = Buffer.concat([c.update(klar, 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}
async function entschluesseln(s: string): Promise<string> {
  const [v, iv, tag, ct] = s.split(':')
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('format')
  const d = createDecipheriv('aes-256-gcm', await verschluesselungsKey(), Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8')
}

let geladen: { oeffentlich: string; privat: KeyObject } | null = null
let laden: Promise<{ oeffentlich: string; privat: KeyObject }> | null = null
async function ladenOderErzeugen() {
  let s = await getSetting<Signatur | null>('lizenz_signatur', null, true)
  if (!s) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const neu: Signatur = {
      oeffentlich: publicKey.export({ type: 'spki', format: 'pem' }).toString().trim(),
      privat: await verschluesseln(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())
    }
    // Gleichzeitige Starts (mehrere Prozesse): der erste Eintrag gewinnt, alle lesen danach dasselbe
    await q("INSERT INTO settings (key, value) VALUES ('lizenz_signatur', $1::jsonb) ON CONFLICT (key) DO NOTHING", [
      JSON.stringify(neu)
    ])
    s = await getSetting<Signatur | null>('lizenz_signatur', null, true)
  }
  if (!s) throw new Error('Signaturschluessel fehlt')
  return { oeffentlich: s.oeffentlich, privat: createPrivateKey(await entschluesseln(s.privat)) }
}
export async function signatur(): Promise<{ oeffentlich: string; privat: KeyObject }> {
  if (geladen) return geladen
  laden ??= ladenOderErzeugen()
    .then((r) => (geladen = r))
    .finally(() => {
      laden = null
    })
  return laden
}

// ===== Protokoll (dasselbe, das der Lizenz-Client spricht) =====
export type Aktion = 'activate' | 'heartbeat' | 'deactivate' | 'validate'
export interface SchluesselZeile {
  id: number
  schluessel: string
  notiz: string
  plan: string
  features: string[]
  laufzeit_tage: number | null
  aktiviert_at: Date | null
  max_geraete: number
  gesperrt: boolean
  created_by: number | null
  created_at: Date
}

export function ablaufVon(z: Pick<SchluesselZeile, 'laufzeit_tage' | 'aktiviert_at'>): Date | null {
  if (z.laufzeit_tage == null || !z.aktiviert_at) return null
  return new Date(new Date(z.aktiviert_at).getTime() + z.laufzeit_tage * 86400_000)
}

// Aktivierungen laufen nacheinander, damit das Geraetelimit auch bei parallelen Anfragen haelt
let kette: Promise<unknown> = Promise.resolve()
const nacheinander = <T>(fn: () => Promise<T>): Promise<T> => {
  const r = kette.then(fn, fn)
  kette = r.catch(() => {})
  return r
}

async function bauen(code: string, z: SchluesselZeile | null, geraete: number) {
  const ablauf = z ? ablaufVon(z) : null
  const antwort = {
    valid: code === 'OK',
    code,
    license: z
      ? {
          key: z.schluessel,
          product: PRODUKT_ID,
          plan: z.plan || null,
          trial: false,
          expiresAt: ablauf ? ablauf.toISOString() : null,
          maxDevices: z.max_geraete,
          devices: geraete,
          features: z.features || []
        }
      : null,
    ts: Math.floor(Date.now() / 1000)
  }
  const payload = JSON.stringify(antwort)
  const { privat } = await signatur()
  return { payload, signature: sign(null, Buffer.from(payload), privat).toString('base64') }
}

export async function antworten(
  aktion: Aktion,
  schluessel: string,
  produkt: string,
  hwid: string,
  name: string
): Promise<{ payload: string; signature: string }> {
  return nacheinander(async () => {
    const z = await q1<SchluesselZeile>('SELECT * FROM lizenz_schluessel WHERE schluessel = $1', [schluessel])
    if (!z) return bauen('NOT_FOUND', null, 0)
    const zaehle = async () => Number((await q1<{ n: string }>('SELECT count(*) AS n FROM lizenz_geraete WHERE key_id = $1', [z.id]))?.n || 0)
    if (produkt !== PRODUKT_ID) return bauen('WRONG_PRODUCT', null, 0)
    if (z.gesperrt) return bauen('BLOCKED', z, await zaehle())

    if (aktion === 'deactivate') {
      await q('DELETE FROM lizenz_geraete WHERE key_id = $1 AND hwid = $2', [z.id, hwid])
      return bauen('OK', z, await zaehle())
    }

    let zeile = z
    if (aktion === 'activate' && !z.aktiviert_at) {
      // Die Laufzeit beginnt mit der ersten Aktivierung
      zeile = (await q1<SchluesselZeile>(
        'UPDATE lizenz_schluessel SET aktiviert_at = COALESCE(aktiviert_at, now()) WHERE id = $1 RETURNING *',
        [z.id]
      ))!
    }
    const ablauf = ablaufVon(zeile)
    if (ablauf && ablauf.getTime() <= Date.now()) return bauen('EXPIRED', zeile, await zaehle())

    const bekannt = await q1('SELECT 1 FROM lizenz_geraete WHERE key_id = $1 AND hwid = $2', [z.id, hwid])
    if (aktion === 'activate') {
      if (!bekannt) {
        if ((await zaehle()) >= z.max_geraete) return bauen('DEVICE_LIMIT', zeile, await zaehle())
        await q('INSERT INTO lizenz_geraete (key_id, hwid, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [z.id, hwid, name])
      } else await q('UPDATE lizenz_geraete SET zuletzt_at = now(), name = $3 WHERE key_id = $1 AND hwid = $2', [z.id, hwid, name])
    } else if (aktion === 'heartbeat') {
      if (!bekannt) return bauen('NOT_ACTIVATED', zeile, await zaehle())
      await q('UPDATE lizenz_geraete SET zuletzt_at = now() WHERE key_id = $1 AND hwid = $2', [z.id, hwid])
    } else if (!z.aktiviert_at) {
      // validate vor der ersten Aktivierung: gueltig, aber ohne Geraet
    }
    return bauen('OK', zeile, await zaehle())
  })
}

export async function oeffentlicherSchluessel(): Promise<string> {
  return (await signatur()).oeffentlich
}
