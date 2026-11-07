import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { getSetting, st } from './settings'
import { datenordner } from './speicher'
import { dienstKann, dienstZuAlt, UPDATE_BEFEHL } from './update'

const SFTPGO = (process.env.VD_SFTPGO_URL || 'http://sftpgo:8080').replace(/\/+$/, '')
export const WEBDAV_ZIEL = (process.env.VD_SFTPGO_WEBDAV || 'http://sftpgo:8090').replace(/\/+$/, '')
const GARAGE = (process.env.VD_GARAGE_URL || 'http://garage:3903').replace(/\/+$/, '')
export const S3_ZIEL = (process.env.VD_GARAGE_S3 || 'http://garage:3900').replace(/\/+$/, '')
export const S3_REGION = 'garage'
const SFTPGO_ADMIN = 'vylariscloud'
export const BOXEN_APP =
  process.env.VD_SPEICHER_DIR || (process.platform === 'win32' ? join(process.cwd(), 'speicher') : '/speicher')
export const BOXEN_SFTPGO = (process.env.VD_SPEICHER_SFTPGO_DIR || '/srv/sftpgo/data').replace(/\/+$/, '')

export const speicherKonfiguriert = () => !!(process.env.VD_SFTPGO_ADMIN_PW && process.env.VD_GARAGE_ADMIN_TOKEN)
export const sftpPort = () => Number(process.env.VD_SFTP_PORT || 0) || 2222

export class DienstFehler extends Error {
  constructor(
    public quelle: 'sftpgo' | 'garage',
    public status: number,
    nachricht: string
  ) {
    super(nachricht)
  }
}
export function dienstFehlerMelden(e: unknown, was: string): never {
  if (e instanceof DienstFehler) {
    console.error(`[vylariscloud] Speicher (${e.quelle}) bei „${was}“: HTTP ${e.status} ${e.message.slice(0, 300)}`)
    if (e.status === 0)
      throw fehler(
        503,
        st(
          'Der Speicherdienst antwortet gerade nicht. Läuft er (Speicher → Status)?',
          'The storage service is not responding right now. Is it running (Storage → status)?'
        )
      )
    throw fehler(
      502,
      st(
        'Der Speicherdienst hat den Auftrag abgelehnt. Einzelheiten stehen im Server-Protokoll.',
        'The storage service rejected the request. Details are in the server log.'
      )
    )
  }
  throw e
}

async function anfrage(
  quelle: 'sftpgo' | 'garage',
  url: string,
  init: RequestInit,
  zeit = 20_000
): Promise<{ status: number; text: string; json: any }> {
  let r: Response
  try {
    r = await fetch(url, { ...init, signal: AbortSignal.timeout(zeit) })
  } catch (e: any) {
    throw new DienstFehler(quelle, 0, String(e?.cause?.code || e?.message || e))
  }
  const text = await r.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: r.status, text, json }
}

let sftpgoToken: { wert: string; bis: number } | null = null
async function sftpgoAnmelden(): Promise<string> {
  if (sftpgoToken && sftpgoToken.bis > Date.now() + 30_000) return sftpgoToken.wert
  const basic = Buffer.from(`${SFTPGO_ADMIN}:${process.env.VD_SFTPGO_ADMIN_PW || ''}`).toString('base64')
  const r = await anfrage('sftpgo', `${SFTPGO}/api/v2/token`, { headers: { authorization: `Basic ${basic}` } }, 10_000)
  if (r.status !== 200 || !r.json?.access_token) throw new DienstFehler('sftpgo', r.status, r.text || 'keine Anmeldung')
  sftpgoToken = { wert: r.json.access_token, bis: Date.now() + 15 * 60_000 }
  return sftpgoToken.wert
}
export async function sftpgo(methode: string, pfad: string, body?: unknown): Promise<{ status: number; json: any }> {
  for (let versuch = 0; versuch < 2; versuch++) {
    const tok = await sftpgoAnmelden()
    const r = await anfrage('sftpgo', `${SFTPGO}/api/v2${pfad}`, {
      method: methode,
      headers: {
        authorization: `Bearer ${tok}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
    if (r.status === 401 && versuch === 0) {
      sftpgoToken = null
      continue
    }
    if (r.status >= 400 && r.status !== 404)
      throw new DienstFehler('sftpgo', r.status, r.json?.error || r.json?.message || r.text)
    return { status: r.status, json: r.json }
  }
  throw new DienstFehler('sftpgo', 401, 'Anmeldung abgelehnt')
}

export async function garage(methode: string, pfad: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await anfrage('garage', `${GARAGE}/v2/${pfad}`, {
    method: methode,
    headers: {
      authorization: `Bearer ${process.env.VD_GARAGE_ADMIN_TOKEN || ''}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  if (r.status >= 400 && r.status !== 404)
    throw new DienstFehler('garage', r.status, r.json?.message || r.json?.code || r.text)
  return { status: r.status, json: r.json }
}

const pfad = (n: string) => join(datenordner(), n)
async function lesenJson(n: string): Promise<any> {
  try {
    return JSON.parse(await fs.readFile(pfad(n), 'utf8'))
  } catch {
    return null
  }
}

export async function speicherErreichbar(): Promise<{ sftpgo: boolean; garage: boolean; fehler: string }> {
  if (!speicherKonfiguriert()) return { sftpgo: false, garage: false, fehler: '' }
  // Hinweis: keine lokale Variable "fehler" — sie würde den automatischen Import von fehler() in dieser Datei verdecken
  let meldung = ''
  const s = await sftpgo('GET', '/status').then(
    () => true,
    (e) => {
      meldung = `SFTPGo: ${String(e?.message || e).slice(0, 120)}`
      return false
    }
  )
  const g = await garage('GET', 'GetClusterHealth').then(
    (r) => r.status === 200 && r.json?.status !== 'unavailable',
    (e) => {
      meldung ||= `Garage: ${String(e?.message || e).slice(0, 120)}`
      return false
    }
  )
  return { sftpgo: s, garage: g, fehler: meldung }
}

export interface SpeicherEinst {
  wer: 'admins' | 'alle'
  grenzeGb: number
  maxAnzahl: number
}
export const getSpeicherEinst = async (): Promise<SpeicherEinst> => ({
  wer: 'admins',
  grenzeGb: 100,
  maxAnzahl: 5,
  ...(await getSetting<Partial<SpeicherEinst>>('speicherdienst', {}))
})

export async function speicherStand() {
  const lauf = await lesenJson('.speicher-status')
  const angefragt = await fs.stat(pfad('.update-anfrage')).then(
    (s) => ({ da: true, alt: Date.now() - s.mtimeMs > 3 * 60_000 }),
    () => ({ da: false, alt: false })
  )
  return {
    konfiguriert: speicherKonfiguriert(),
    ...(await speicherErreichbar()),
    port: sftpPort(),
    dienst: await fs.stat(pfad('.updater')).then(
      () => true,
      () => false
    ),
    kann: await dienstKann('speicher'),
    befehl: UPDATE_BEFEHL,
    angefragt: angefragt.da,
    nichtAbgeholt: angefragt.alt,
    lauf:
      lauf && typeof lauf === 'object'
        ? {
            status: String(lauf.status || ''),
            zeit: String(lauf.zeit || ''),
            meldung: String(lauf.meldung || '').slice(0, 500)
          }
        : null
  }
}

export async function speicherAnfragen(an: boolean, port: number, von: string): Promise<void> {
  if (!(await dienstKann('speicher'))) throw dienstZuAlt()
  if (an && (!Number.isInteger(port) || port < 1 || port > 65535 || port === 80 || port === 443))
    throw fehler(
      400,
      st(
        'Bitte einen Port zwischen 1 und 65535 wählen (nicht 80 oder 443).',
        'Please choose a port between 1 and 65535 (not 80 or 443).'
      )
    )
  const lauf = await lesenJson('.speicher-status')
  if (lauf?.status === 'laeuft' && Date.now() - new Date(lauf.zeit).getTime() < 10 * 60_000)
    throw fehler(
      409,
      st('Der Speicherdienst wird gerade umgeschaltet.', 'The storage service is being switched right now.')
    )
  await fs.writeFile(
    pfad('.update-anfrage'),
    JSON.stringify({
      id: randomBytes(6).toString('hex'),
      aktion: an ? 'speicher-an' : 'speicher-aus',
      port: String(port),
      von,
      zeit: new Date().toISOString()
    }),
    { mode: 0o644 }
  )
}

export function neuesPasswort(): string {
  const zeichen = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const b = randomBytes(16)
  let s = ''
  for (let i = 0; i < 16; i++) {
    s += zeichen[b[i]! % zeichen.length]
    if (i % 4 === 3 && i < 15) s += '-'
  }
  return s
}
export const fuerSftpgo = (hash: string) => hash.replace(/^\$2[by]\$/, '$2a$')
