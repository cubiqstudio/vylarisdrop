import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { posix } from 'node:path'
import { z } from 'zod'
import ssh2 from 'ssh2'
import { q, q1 } from './db'
import { getInstance, st } from './settings'
import { hoeren, melde } from './knoten'

/**
 * Speicher-Erweiterungen (SFTP): Stammdaten, Verschlüsselung der Zugangsdaten, Prüfung von Host/Pfad/Schlüssel
 * (SSRF-Schutz) und ein kurzer Zwischenspeicher. Die Verbindungen selbst liegen in sftpClient.ts.
 */

export type Anmeldung = 'passwort' | 'schluessel'
export interface ZielStatus {
  online?: boolean | null
  geprueft?: string
  latenzMs?: number | null
  fehler?: string
  fehlerCode?: string
  hostKeyGeaendert?: boolean
  banner?: string
  platz?: { frei: number; gesamt: number } | null
}
export interface ZielZeile {
  id: number
  name: string
  art: string
  host: string
  port: number
  benutzer: string
  auth: Anmeldung
  geheim: string
  host_key: string
  basis_pfad: string
  aktiv: boolean
  schreibbar: boolean
  status: ZielStatus
  created_at: string
}
export interface Geheim {
  passwort?: string
  schluessel?: string
  passphrase?: string
}

// ===== Fehler =====
export type SftpCode =
  | 'OFFLINE'
  | 'TIMEOUT'
  | 'HOSTKEY'
  | 'AUTH'
  | 'AUSGELASTET'
  | 'DEAKTIVIERT'
  | 'GELOESCHT'
  | 'SCHREIBGESCHUETZT'
  | 'RECHT'
  | 'ADRESSE'
  | 'GEHEIMNIS'
  | 'NICHT_DA'
  | 'SFTP'
export class SftpFehler extends Error {
  code: SftpCode
  status: number
  ziel: string
  constructor(code: SftpCode, ziel = '', roh = '') {
    super(sftpText(code, ziel))
    this.code = code
    this.ziel = ziel
    this.status = code === 'NICHT_DA' ? 404 : code === 'HOSTKEY' || code === 'AUTH' || code === 'SFTP' || code === 'GEHEIMNIS' ? 502 : 503
    if (roh) (this as any).roh = roh.slice(0, 200)
  }
}
export function sftpText(code: SftpCode, ziel = ''): string {
  const z = ziel ? `„${ziel}“` : st('der SFTP-Speicher', 'the SFTP storage')
  const ze = ziel ? `“${ziel}”` : 'the SFTP storage'
  switch (code) {
    case 'OFFLINE':
      return st(`Der SFTP-Speicher ${z} ist gerade nicht erreichbar.`, `The SFTP storage ${ze} is currently unreachable.`)
    case 'TIMEOUT':
      return st(
        `Der SFTP-Speicher ${z} antwortet nicht rechtzeitig.`,
        `The SFTP storage ${ze} did not respond in time.`
      )
    case 'HOSTKEY':
      return st(
        `Host-Schlüssel hat sich geändert: Die Verbindung zu ${z} wurde aus Sicherheitsgründen verweigert.`,
        `Host key has changed: the connection to ${ze} was refused for security reasons.`
      )
    case 'AUTH':
      return st(
        `Anmeldung am SFTP-Speicher ${z} fehlgeschlagen (Benutzer, Passwort oder Schlüssel prüfen).`,
        `Login to the SFTP storage ${ze} failed (check user, password or key).`
      )
    case 'AUSGELASTET':
      return st(
        `Der SFTP-Speicher ${z} ist gerade ausgelastet. Bitte gleich noch einmal versuchen.`,
        `The SFTP storage ${ze} is busy right now. Please try again shortly.`
      )
    case 'DEAKTIVIERT':
      return st(
        `Die Speicher-Erweiterung ${z} ist deaktiviert. Ein Admin muss sie wieder aktivieren.`,
        `The storage add-on ${ze} is disabled. An admin has to enable it again.`
      )
    case 'GELOESCHT':
      return st(
        'Der Speicherort dieser Datei (SFTP-Erweiterung) wurde entfernt.',
        'The storage location of this file (SFTP add-on) has been removed.'
      )
    case 'SCHREIBGESCHUETZT':
      return st(
        `Die Speicher-Erweiterung ${z} ist schreibgeschützt.`,
        `The storage add-on ${ze} is write-protected.`
      )
    case 'RECHT':
      return st(
        `Zugriff auf dem SFTP-Speicher ${z} verweigert (Rechte im Zielordner prüfen).`,
        `Access denied on the SFTP storage ${ze} (check permissions of the target folder).`
      )
    case 'NICHT_DA':
      return st('Die Datei fehlt auf dem SFTP-Speicher.', 'The file is missing on the SFTP storage.')
    case 'ADRESSE':
      return st('Diese Serveradresse ist nicht erlaubt.', 'This server address is not allowed.')
    case 'GEHEIMNIS':
      return st(
        `Die gespeicherten Zugangsdaten von ${z} lassen sich nicht entschlüsseln.`,
        `The stored credentials of ${ze} cannot be decrypted.`
      )
    default:
      return st(`Fehler beim Zugriff auf den SFTP-Speicher ${z}.`, `Error accessing the SFTP storage ${ze}.`)
  }
}
export const alsHttpFehler = (e: any) =>
  e instanceof SftpFehler
    ? Object.assign(fehler(e.status, e.message), { sftpCode: e.code })
    : e?.statusCode
      ? e
      : Object.assign(fehler(502, sftpText('SFTP')), { sftpCode: 'SFTP' })

// ===== Verschlüsselung der Zugangsdaten =====
let schlChache: { quelle: string; key: Buffer } | null = null
async function schluessel(): Promise<Buffer> {
  const geheim = (await getInstance()).secret + '|' + (process.env.VD_SFTP_SCHLUESSEL || '')
  if (schlChache?.quelle === geheim) return schlChache.key
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(geheim), 'vylariscloud', 'sftp-zugangsdaten-v1', 32))
  schlChache = { quelle: geheim, key }
  return key
}
export async function verschluesseln(g: Geheim): Promise<string> {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', await schluessel(), iv)
  const ct = Buffer.concat([c.update(JSON.stringify(g), 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}
export async function entschluesseln(s: string, zielName = ''): Promise<Geheim> {
  if (!s) return {}
  try {
    const [v, iv, tag, ct] = s.split(':')
    if (v !== 'v1' || !iv || !tag || !ct) throw new Error('format')
    const d = createDecipheriv('aes-256-gcm', await schluessel(), Buffer.from(iv, 'base64'))
    d.setAuthTag(Buffer.from(tag, 'base64'))
    return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8'))
  } catch {
    throw new SftpFehler('GEHEIMNIS', zielName)
  }
}

// ===== Eingabeprüfung =====
const DOMAIN =
  /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/
export function hostNorm(h: string): string | null {
  let s = h.trim()
  if (/^\[.*\]$/.test(s)) s = s.slice(1, -1)
  if (isIP(s)) return s.toLowerCase()
  if (!DOMAIN.test(s)) return null
  if (/^\d+$/.test(s.split('.').pop()!)) return null
  return s.toLowerCase()
}
export function pfadNorm(p: string): string | null {
  const s = p.trim()
  if (!s.startsWith('/') || s.length > 400 || /[\0\\\r\n]/.test(s)) return null
  for (const teil of s.split('/')) if (teil === '..') return null
  let n = posix.normalize(s).replace(/\/+$/, '')
  if (!n) n = '/'
  return n.startsWith('/') && !n.split('/').includes('..') ? n : null
}
export const FINGERABDRUCK = /^SHA256:[A-Za-z0-9+/]{43}$/
export function schluesselPruefen(text: string, passphrase?: string): string | null {
  const t = text.trim()
  if (!/^-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(t) || t.length > 20000)
    return st('Das ist kein privater SSH-Schlüssel (Textformat).', 'This is not a private SSH key (text format).')
  const k: any = ssh2.utils.parseKey(t + '\n', passphrase || undefined)
  const e = Array.isArray(k) ? k[0] : k
  if (e instanceof Error) {
    if (/passphrase/i.test(e.message))
      return passphrase
        ? st('Die Passphrase passt nicht zum Schlüssel.', 'The passphrase does not match the key.')
        : st('Der Schlüssel ist durch eine Passphrase geschützt — bitte eintragen.', 'The key is protected by a passphrase — please enter it.')
    return st('Der private Schlüssel ist ungültig oder wird nicht unterstützt.', 'The private key is invalid or unsupported.')
  }
  if (!e || typeof e.isPrivateKey !== 'function' || !e.isPrivateKey())
    return st('Das ist kein privater SSH-Schlüssel.', 'This is not a private SSH key.')
  return null
}

export const ZielEingabe = z.object({
  name: z.string().trim().min(1).max(60),
  host: z.string().trim().min(1).max(260),
  port: z.number().int().min(1).max(65535),
  benutzer: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._@-]+$/),
  auth: z.enum(['passwort', 'schluessel']),
  passwort: z.string().max(500).optional(),
  schluessel: z.string().max(20000).optional(),
  passphrase: z.string().max(500).optional(),
  basis_pfad: z.string().trim().min(1).max(400),
  host_key: z.string().trim().regex(FINGERABDRUCK).optional(),
  schreibbar: z.boolean().optional(),
  aktiv: z.boolean().optional()
})
export type ZielDaten = z.infer<typeof ZielEingabe>

// ===== SSRF-Schutz =====
const gesperrt = new BlockList()
for (const [a, n] of [
  ['0.0.0.0', 8], // "dieses Netz"
  ['127.0.0.0', 8], // Loopback
  ['169.254.0.0', 16], // Link-Local, Cloud-Metadaten (169.254.169.254)
  ['100.100.100.200', 32], // Alibaba-Metadaten
  ['192.0.0.192', 32], // Oracle-Metadaten
  ['224.0.0.0', 4], // Multicast
  ['240.0.0.0', 4] // reserviert/Broadcast
] as const)
  gesperrt.addSubnet(a, n, 'ipv4')
for (const [a, n] of [
  ['::', 128],
  ['::1', 128],
  ['fe80::', 10], // Link-Local
  ['ff00::', 8], // Multicast
  ['fd00:ec2::254', 128] // AWS-Metadaten (IPv6)
] as const)
  gesperrt.addSubnet(a, n, 'ipv6')

/** Liefert true, wenn die Adresse nicht angesprochen werden darf. Private LAN-Adressen (NAS) bleiben erlaubt. */
export function adresseGesperrt(ip: string): boolean {
  const art = isIP(ip)
  if (!art) return true
  if (art === 4) return gesperrt.check(ip, 'ipv4')
  const v = ip.toLowerCase()
  const abgebildet = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(v)
  if (abgebildet) return adresseGesperrt(abgebildet[1]!)
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v)
  if (hex) {
    const hi = parseInt(hex[1]!, 16),
      lo = parseInt(hex[2]!, 16)
    return adresseGesperrt(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
  }
  return gesperrt.check(v, 'ipv6')
}
/** Löst den Host auf und prüft JEDE aufgelöste Adresse; verbunden wird mit der geprüften IP (kein DNS-Rebinding). */
export async function adresseAufloesen(host: string): Promise<{ ip: string; familie: 4 | 6 }> {
  const h = hostNorm(host)
  if (!h) throw new SftpFehler('ADRESSE')
  const art = isIP(h)
  let liste: Array<{ address: string; family: number }>
  if (art) liste = [{ address: h, family: art }]
  else {
    try {
      liste = await Promise.race([
        lookup(h, { all: true, verbatim: true }),
        new Promise<never>((_, rej) => setTimeout(() => rej(Object.assign(new Error('dns'), { code: 'ETIMEOUT' })), 6000).unref?.())
      ])
    } catch {
      throw new SftpFehler('OFFLINE', '', 'dns')
    }
  }
  if (!liste.length) throw new SftpFehler('OFFLINE', '', 'dns')
  if (liste.some((a) => adresseGesperrt(a.address))) throw new SftpFehler('ADRESSE')
  const v4 = liste.find((a) => a.family === 4) || liste[0]!
  return { ip: v4.address, familie: v4.family === 6 ? 6 : 4 }
}

// ===== Fingerabdruck =====
export function fingerabdruck(key: Buffer): { fp: string; typ: string } {
  const fp = 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
  let typ = 'ssh'
  try {
    const n = key.readUInt32BE(0)
    typ = key.subarray(4, 4 + n).toString('ascii')
  } catch {}
  return { fp, typ }
}

// ===== Datenhaltung mit kurzem Zwischenspeicher =====
const SPALTEN = 'id, name, art, host, port, benutzer, auth, geheim, host_key, basis_pfad, aktiv, schreibbar, status, created_at'
let zwischen: { bis: number; liste: ZielZeile[] } | null = null
let hoererAn = false
function hoererAnmelden() {
  if (hoererAn) return
  hoererAn = true
  hoeren('vd_settings', (n) => {
    if (n === '*' || n === 'sftp_ziele') zwischen = null
  })
}
export const zieleVergessen = () => {
  zwischen = null
}
async function zieleHolen(frisch = false): Promise<ZielZeile[]> {
  hoererAnmelden()
  if (!frisch && zwischen && zwischen.bis > Date.now()) return zwischen.liste
  const liste = await q<ZielZeile>(`SELECT ${SPALTEN} FROM speicher_ziele ORDER BY id`)
  zwischen = { bis: Date.now() + 5000, liste }
  return liste
}
export const alleZiele = zieleHolen
export async function zielLaden(id: number, frisch = false): Promise<ZielZeile | null> {
  return (await zieleHolen(frisch)).find((z) => z.id === id) || null
}
async function geaendert() {
  zwischen = null
  await melde('vd_settings', 'sftp_ziele')
}

/** Prüfsumme der Verbindungsdaten: ändert sich sie, werden offene Verbindungen verworfen. */
export const zielStempel = (z: ZielZeile) =>
  createHash('sha256')
    .update([z.host, z.port, z.benutzer, z.auth, z.geheim, z.host_key, z.basis_pfad, z.aktiv].join('\n'))
    .digest('hex')

export function zielOeffentlich(z: ZielZeile) {
  return {
    id: z.id,
    name: z.name,
    host: z.host,
    port: z.port,
    benutzer: z.benutzer,
    auth: z.auth,
    hatGeheim: !!z.geheim,
    hostKey: z.host_key,
    basisPfad: z.basis_pfad,
    aktiv: z.aktiv,
    schreibbar: z.schreibbar,
    status: z.status || {},
    erstellt: z.created_at
  }
}

/** Baut die zu speichernde Geheimnis-Struktur; leere Felder behalten bei einer Änderung den alten Wert. */
export async function geheimBauen(d: Pick<ZielDaten, 'auth' | 'passwort' | 'schluessel' | 'passphrase'>, alt?: ZielZeile | null) {
  const vorher = alt ? await entschluesseln(alt.geheim, alt.name) : {}
  const altGleich = !!alt && alt.auth === d.auth
  if (d.auth === 'passwort') {
    const passwort = d.passwort || (altGleich ? vorher.passwort : '') || ''
    if (!passwort) throw fehler(400, 'Bitte ein Passwort eingeben.', 'Please enter a password.')
    return { passwort } as Geheim
  }
  const schl = (d.schluessel || '').trim() || (altGleich ? vorher.schluessel : '') || ''
  if (!schl) throw fehler(400, 'Bitte einen privaten Schlüssel angeben.', 'Please provide a private key.')
  const phrase = d.schluessel?.trim() ? d.passphrase || '' : d.passphrase || (altGleich ? vorher.passphrase : '') || ''
  const problem = schluesselPruefen(schl, phrase)
  if (problem) throw fehler(400, problem)
  return { schluessel: schl + '\n', ...(phrase ? { passphrase: phrase } : {}) } as Geheim
}

export function pruefeDaten(d: ZielDaten): { host: string; basis: string } {
  const host = hostNorm(d.host)
  if (!host)
    throw fehler(
      400,
      'Ungültiger Host: bitte nur den Namen oder die IP angeben, ohne „sftp://“ und ohne Pfad.',
      'Invalid host: please enter only the name or IP, without “sftp://” and without a path.'
    )
  const basis = pfadNorm(d.basis_pfad)
  if (!basis)
    throw fehler(
      400,
      'Ungültiger Zielordner: er muss mit / beginnen und darf kein „..“ enthalten.',
      'Invalid target folder: it must start with / and must not contain “..”.'
    )
  return { host, basis }
}

export async function zielAnlegen(d: ZielDaten, host: string, basis: string, geheim: Geheim, status: ZielStatus) {
  const r = await q1<ZielZeile>(
    `INSERT INTO speicher_ziele (name, art, host, port, benutzer, auth, geheim, host_key, basis_pfad, aktiv, schreibbar, status)
     VALUES ($1, 'sftp', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb) RETURNING ${SPALTEN}`,
    [
      d.name,
      host,
      d.port,
      d.benutzer,
      d.auth,
      await verschluesseln(geheim),
      d.host_key,
      basis,
      d.aktiv !== false,
      d.schreibbar !== false,
      JSON.stringify(status)
    ]
  )
  await geaendert()
  return r!
}
export async function zielAktualisieren(id: number, felder: Record<string, unknown>): Promise<void> {
  const erlaubt = ['name', 'host', 'port', 'benutzer', 'auth', 'geheim', 'host_key', 'basis_pfad', 'aktiv', 'schreibbar']
  const teile: string[] = [],
    w: unknown[] = [id]
  for (const [k, v] of Object.entries(felder)) {
    if (!erlaubt.includes(k)) continue
    w.push(v)
    teile.push(`${k} = $${w.length}`)
  }
  if (!teile.length) return
  await q(`UPDATE speicher_ziele SET ${teile.join(', ')} WHERE id = $1`, w)
  await geaendert()
}
export async function zielLoeschen(id: number): Promise<void> {
  await q('DELETE FROM speicher_ziele WHERE id = $1', [id])
  await geaendert()
}

let statusLetzter = new Map<number, string>()
/** Status zusammenführen. Schreibt nur bei einer Änderung (online/offline/Fehler) oder wenn `erzwingen` gesetzt ist. */
export async function statusSetzen(id: number, teil: ZielStatus, erzwingen = false): Promise<void> {
  const z = await zielLaden(id)
  if (!z) return
  const neu: ZielStatus = { ...z.status, ...teil, geprueft: new Date().toISOString() }
  if (teil.online === true) {
    delete neu.fehler
    delete neu.fehlerCode
    neu.hostKeyGeaendert = false
  }
  const marke = `${neu.online}|${neu.fehlerCode || ''}|${neu.hostKeyGeaendert || false}`
  if (!erzwingen && statusLetzter.get(id) === marke) return
  statusLetzter.set(id, marke)
  await q('UPDATE speicher_ziele SET status = $2::jsonb WHERE id = $1', [id, JSON.stringify(neu)])
  zwischen = null
}

/** Dateien je Erweiterung (aktive Dateien und Papierkorb), aus der Datenbank. */
export async function zielBelegung(): Promise<Map<number, { dateien: number; bytes: number; korb: number }>> {
  const m = new Map<number, { dateien: number; bytes: number; korb: number }>()
  const d = await q<{ zid: string; n: string; b: string }>(
    `SELECT substring(ablage from '^sftp([0-9]+):') AS zid, count(*) AS n, coalesce(sum(size), 0) AS b FROM files WHERE ablage LIKE 'sftp%:%' GROUP BY 1`
  )
  for (const r of d) if (r.zid) m.set(Number(r.zid), { dateien: Number(r.n), bytes: Number(r.b), korb: 0 })
  const k = await q<{ zid: string; n: string }>(
    `SELECT substring(datei->>'ablage' from '^sftp([0-9]+):') AS zid, count(*) AS n FROM papierkorb WHERE datei->>'ablage' LIKE 'sftp%:%' GROUP BY 1`
  )
  for (const r of k)
    if (r.zid) {
      const e = m.get(Number(r.zid)) || { dateien: 0, bytes: 0, korb: 0 }
      e.korb = Number(r.n)
      m.set(Number(r.zid), e)
    }
  return m
}
