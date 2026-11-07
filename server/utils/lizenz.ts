import { createPublicKey, verify } from 'node:crypto'
import { hostname } from 'node:os'
import { getInstance, getNet, getSetting, setSetting, st } from './settings'
import { antworten as lokalAntworten, oeffentlicherSchluessel } from './lizenzAussteller'

// Lizenzserver und Prüfschlüssel (Ed25519, PEM) kommen aus der Umgebung. Ohne Eintrag prüft diese Installation gegen
// ihren eigenen Lizenzaussteller (Seite „Lizenzen“): Schlüssel, die der Inhaber dort erzeugt, gelten lokal.
export const LIZENZ_SERVER = (process.env.VD_LIZENZ_SERVER || '').trim().replace(/\/+$/, '')
export const PRODUKT = 'vylariscloud'
const OEFFENTLICH = (process.env.VD_LIZENZ_KEY || '').replace(/\\n/g, '\n').trim()
export const KULANZ_TAGE = 7
const PRUEF_ABSTAND = 6 * 3600_000

export type ProFunktion =
  'multi-server' | 's3' | 'teams' | 'sso' | 'white-label' | 'sicherung' | 'monitoring' | 'traffic'
export const FUNKTIONEN: ProFunktion[] = [
  'multi-server',
  's3',
  'teams',
  'sso',
  'white-label',
  'sicherung',
  'monitoring',
  'traffic'
]

export interface LizenzStand {
  schluessel: string
  art: 'online' | 'offline'
  status: 'aktiv' | 'kulanz' | 'ungueltig' | 'abgelaufen'
  code: string
  plan: string | null
  trial: boolean
  ablauf: string | null
  features: string[]
  maxGeraete: number
  geraete: number
  zuletztOk: number
  zuletztVersuch: number
  meldung: string
  offlineBis?: string | null
  offline?: { payload: string; signature: string }
}

const leer = (): LizenzStand | null => null
export const lizenzStand = () => getSetting<LizenzStand | null>('lizenz', leer())

export async function istPro(f?: ProFunktion): Promise<boolean> {
  const l = await lizenzStand()
  if (!l || !aktivJetzt(l)) return false
  return !f || !l.features.length || l.features.includes(f)
}
export function aktivJetzt(l: LizenzStand): boolean {
  if (l.ablauf && new Date(l.ablauf).getTime() <= Date.now()) return false
  if (l.art === 'offline') return !!l.offlineBis && new Date(l.offlineBis).getTime() > Date.now()
  if (l.status === 'aktiv') return true
  if (l.status === 'kulanz') return Date.now() - l.zuletztOk < KULANZ_TAGE * 86400_000
  return false
}
export async function requirePro(f: ProFunktion): Promise<void> {
  if (!(await istPro(f)))
    throw fehler(
      402,
      st(
        'Das ist Teil von VylarisCloud Pro. Eine Lizenz aktivierst du unter „Pro".',
        'This is part of VylarisCloud Pro. Activate a licence under "Pro".'
      )
    )
}

function echt(payload: unknown, signature: unknown, pem: string = OEFFENTLICH): boolean {
  if (!pem) return false
  if (typeof payload !== 'string' || typeof signature !== 'string' || payload.length > 20_000) return false
  try {
    return verify(null, Buffer.from(payload), createPublicKey(pem), Buffer.from(signature, 'base64'))
  } catch {
    return false
  }
}

interface Antwort {
  valid: boolean
  code: string
  license: null | {
    key: string
    product: string
    plan: string | null
    trial: boolean
    expiresAt: string | null
    maxDevices: number
    devices: number
    features: string[]
  }
  ts: number
}

class Netzfehler extends Error {}

async function anfrage(aktion: 'activate' | 'heartbeat' | 'deactivate' | 'validate', key: string): Promise<Antwort> {
  const inst = await getInstance()
  const net = await getNet().catch(() => null)
  const name = (net?.domain || hostname() || 'VylarisCloud').slice(0, 80)
  let j: any
  let pem = OEFFENTLICH
  if (!LIZENZ_SERVER) {
    // Kein externer Server: der eigene Lizenzaussteller dieser Installation antwortet (signiert, ohne Netzwerk)
    j = await lokalAntworten(aktion, key, PRODUKT, inst.id, name)
    pem = await oeffentlicherSchluessel()
  } else {
    let r: Response
    try {
      r = await fetch(`${LIZENZ_SERVER}/api/v1/${aktion}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'VylarisCloud-Lizenz/1.0' },
        body: JSON.stringify({ key, product: PRODUKT, hwid: inst.id, name }),
        signal: AbortSignal.timeout(15_000)
      })
    } catch {
      throw new Netzfehler(st('Der Lizenzserver ist nicht erreichbar.', 'The licence server is unreachable.'))
    }
    if (r.status === 429)
      throw new Netzfehler(
        st(
          'Der Lizenzserver bittet um eine Pause — gleich noch einmal versuchen.',
          'The licence server asks for a pause — try again shortly.'
        )
      )
    if (!r.ok)
      throw new Netzfehler(
        st(`Der Lizenzserver antwortet mit Fehler ${r.status}.`, `The licence server answered with error ${r.status}.`)
      )
    j = await r.json().catch(() => null)
  }
  if (!j || !echt(j.payload, j.signature, pem))
    throw new Netzfehler(
      st(
        'Die Antwort des Lizenzservers ist nicht korrekt signiert.',
        'The licence server response is not correctly signed.'
      )
    )
  const a = JSON.parse(j.payload) as Antwort
  if (Math.abs(Date.now() / 1000 - Number(a.ts)) > 600)
    throw new Netzfehler(
      st(
        'Die Uhrzeit dieses Servers weicht stark ab — bitte Uhr/NTP prüfen.',
        "This server's clock is far off — please check the clock/NTP."
      )
    )
  if (a.license && (a.license.key !== key || a.license.product !== PRODUKT))
    throw new Netzfehler(st('Die Antwort passt nicht zu diesem Schlüssel.', 'The response does not match this key.'))
  return a
}

const CODES: Record<string, [string, string]> = {
  NOT_FOUND: ['Diesen Lizenzschlüssel gibt es nicht.', 'This licence key does not exist.'],
  WRONG_PRODUCT: ['Dieser Schlüssel gehört zu einem anderen Produkt.', 'This key belongs to another product.'],
  BLOCKED: ['Diese Lizenz ist gesperrt.', 'This licence is blocked.'],
  EXPIRED: ['Diese Lizenz ist abgelaufen.', 'This licence has expired.'],
  DEVICE_LIMIT: [
    'Die Lizenz ist schon auf der erlaubten Zahl an Installationen aktiv. Gib sie dort frei oder setze die Geräte im Kunden-Portal zurück.',
    'The licence is already active on the allowed number of installations. Release it there or reset the devices in the customer portal.'
  ],
  NOT_ACTIVATED: [
    'Diese Installation ist für die Lizenz nicht mehr freigeschaltet.',
    'This installation is no longer activated for the licence.'
  ]
}
const codeText = (c: string) => {
  const x = CODES[c]
  return x ? st(x[0], x[1]) : st(`Lizenz ungültig (${c}).`, `Licence invalid (${c}).`)
}

function ausAntwort(key: string, a: Antwort, alt?: LizenzStand | null): LizenzStand {
  const l = a.license
  return {
    schluessel: key,
    art: 'online',
    status: a.valid ? 'aktiv' : 'ungueltig',
    code: a.code,
    plan: l?.plan ?? alt?.plan ?? null,
    trial: !!l?.trial,
    ablauf: l?.expiresAt ?? null,
    features: Array.isArray(l?.features) ? l!.features.filter((f) => typeof f === 'string').slice(0, 20) : [],
    maxGeraete: Number(l?.maxDevices || 0),
    geraete: Number(l?.devices || 0),
    zuletztOk: a.valid ? Date.now() : alt?.zuletztOk || 0,
    zuletztVersuch: Date.now(),
    meldung: a.valid ? '' : codeText(a.code)
  }
}

export const schluesselNorm = (k: unknown) =>
  String(k ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')

export async function lizenzAktivieren(roh: string): Promise<LizenzStand> {
  const key = schluesselNorm(roh)
  if (!/^[A-Z0-9-]{5,64}$/.test(key))
    throw fehler(
      400,
      st(
        'Das sieht nicht wie ein Lizenzschlüssel aus (z. B. VD-ABCD-EFGH-JKLM).',
        'That does not look like a licence key (e.g. VD-ABCD-EFGH-JKLM).'
      )
    )
  let a: Antwort
  try {
    a = await anfrage('activate', key)
  } catch (e: any) {
    throw fehler(502, e.message)
  }
  if (!a.valid) throw fehler(400, codeText(a.code))
  const neu = ausAntwort(key, a)
  await setSetting('lizenz', neu)
  return neu
}

export async function lizenzPruefen(erzwingen = false): Promise<LizenzStand | null> {
  const l = await lizenzStand()
  if (!l || l.art !== 'online') return l
  if (!erzwingen && Date.now() - l.zuletztVersuch < PRUEF_ABSTAND - 60_000) return l
  try {
    let a = await anfrage('heartbeat', l.schluessel)
    if (!a.valid && a.code === 'NOT_ACTIVATED') a = await anfrage('activate', l.schluessel)
    const neu = ausAntwort(l.schluessel, a, l)
    await setSetting('lizenz', neu)
    return neu
  } catch (e: any) {
    const neu: LizenzStand = {
      ...l,
      zuletztVersuch: Date.now(),
      meldung: e.message,
      status:
        l.status === 'ungueltig'
          ? 'ungueltig'
          : Date.now() - l.zuletztOk < KULANZ_TAGE * 86400_000
            ? 'kulanz'
            : 'abgelaufen'
    }
    await setSetting('lizenz', neu)
    return neu
  }
}

export async function lizenzEntfernen(): Promise<{ freigegeben: boolean }> {
  const l = await lizenzStand()
  let freigegeben = false
  if (l?.art === 'online') {
    try {
      await anfrage('deactivate', l.schluessel)
      freigegeben = true
    } catch {}
  }
  await setSetting('lizenz', null)
  return { freigegeben }
}

export async function offlineEinspielen(text: string): Promise<LizenzStand> {
  let d: any
  try {
    d = JSON.parse(text)
  } catch {
    throw fehler(400, st('Das ist keine Lizenzdatei (kein JSON).', 'This is not a licence file (not JSON).'))
  }
  if (d?.format !== 'vd-license-offline-v1' || !echt(d.payload, d.signature))
    throw fehler(
      400,
      st('Die Lizenzdatei ist nicht echt oder beschädigt.', 'The licence file is not genuine or damaged.')
    )
  const p = JSON.parse(d.payload)
  const inst = await getInstance()
  if (p.type !== 'offline' || p.product !== PRODUKT)
    throw fehler(
      400,
      st('Diese Lizenzdatei gehört zu einem anderen Produkt.', 'This licence file belongs to another product.')
    )
  if (p.hwid && p.hwid !== inst.id)
    throw fehler(
      400,
      st(
        'Diese Lizenzdatei ist für eine andere Installation ausgestellt. Gib im Portal die Geräte-ID dieser Installation an.',
        "This licence file was issued for another installation. Enter this installation's device ID in the portal."
      )
    )
  if (!p.validUntil || new Date(p.validUntil).getTime() <= Date.now())
    throw fehler(400, st('Diese Lizenzdatei ist abgelaufen.', 'This licence file has expired.'))
  const neu: LizenzStand = {
    schluessel: String(p.key || ''),
    art: 'offline',
    status: 'aktiv',
    code: 'OK',
    plan: p.plan ?? null,
    trial: false,
    ablauf: p.licenseExpiresAt ?? null,
    features: Array.isArray(p.features) ? p.features.slice(0, 20) : [],
    maxGeraete: 0,
    geraete: 0,
    zuletztOk: Date.now(),
    zuletztVersuch: Date.now(),
    meldung: '',
    offlineBis: p.validUntil,
    offline: { payload: d.payload, signature: d.signature }
  }
  await setSetting('lizenz', neu)
  return neu
}

export async function lizenzAnsicht() {
  const l = await lizenzStand()
  const inst = await getInstance()
  const an = !!l && aktivJetzt(l)
  const funktionen = Object.fromEntries(
    FUNKTIONEN.map((f) => [f, an && (!l!.features.length || l!.features.includes(f))])
  )
  if (!l) return { pro: false, geraeteId: inst.id, server: LIZENZ_SERVER, lizenz: null, funktionen }
  const { offline: _o, ...rest } = l
  const sichtbar = rest.schluessel ? rest.schluessel.replace(/^(.+-)?(.{4})$/, (_m, _a, b) => `****-****-${b}`) : ''
  return {
    pro: an,
    geraeteId: inst.id,
    server: LIZENZ_SERVER,
    funktionen,
    lizenz: {
      ...rest,
      schluessel: sichtbar,
      kulanzBis:
        l.art === 'online' && l.status === 'kulanz'
          ? new Date(l.zuletztOk + KULANZ_TAGE * 86400_000).toISOString()
          : null
    }
  }
}
