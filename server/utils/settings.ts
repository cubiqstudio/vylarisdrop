import { randomBytes, randomUUID } from 'node:crypto'
import { q, q1 } from './db'

export interface Design {
  color: string
  name: string
}
export interface Net {
  mode: 'domain' | 'ip' | 'proxy'
  domain: string
  https: boolean
  ip: string
}
export interface Instance {
  id: string
  setupToken: string
  secret: string
}
export interface Uploads {
  maxBytes: number
  namensstil: NamensStil
  laenge: number
  registrierung: boolean
}
export type NamensStil = 'zufall' | 'woerter' | 'datum' | 'original' | 'unsichtbar' | 'uuid'
export interface Medien {
  exifEntfernen: boolean
  umwandeln: 'aus' | 'webp' | 'avif'
  qualitaet: number
  vorschau: boolean
}
export const getMedien = async (): Promise<Medien> => ({
  exifEntfernen: true,
  umwandeln: 'aus',
  qualitaet: 82,
  vorschau: true,
  ...(await getSetting<Partial<Medien>>('medien', {}))
})
export interface Auslieferung {
  bilder: boolean
  maxPx: number
  maxVarianten: number
  hotlink: boolean
  erlaubt: string[]
  ohneHerkunft: boolean
}
export const getAuslieferung = async (): Promise<Auslieferung> => ({
  bilder: false,
  maxPx: 4096,
  maxVarianten: 30,
  hotlink: false,
  erlaubt: [],
  ohneHerkunft: true,
  ...(await getSetting<Partial<Auslieferung>>('auslieferung', {}))
})
export interface Traffic {
  grenzeGb: number | null
}
export const getTraffic = async (): Promise<Traffic> => ({
  grenzeGb: null,
  ...(await getSetting<Partial<Traffic>>('traffic', {}))
})

const cache = new Map<string, any>()

export async function getSetting<T>(key: string, fallback: T, frisch = false): Promise<T> {
  if (!frisch && cache.has(key)) return cache.get(key) as T
  const row = await q1<{ value: T }>('SELECT value FROM settings WHERE key = $1', [key])
  const v = row ? row.value : fallback
  cache.set(key, v)
  return v
}
export async function setSetting(key: string, value: unknown): Promise<void> {
  await q(
    'INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, JSON.stringify(value)]
  )
  cache.set(key, value)
  await q("SELECT pg_notify('vd_settings', $1)", [`-|${key}`]).catch(() => {})
}

export const setupDone = async () => (await getSetting<{ done: boolean }>('setup', { done: false })).done === true
export const getDesign = () => getSetting<Design>('design', { color: '#1e73be', name: 'VylarisCloud' })
export const getNet = () => getSetting<Net>('net', { mode: 'ip', domain: '', https: false, ip: '' })
export const getUploads = async (): Promise<Uploads> => ({
  maxBytes: 2 * 1024 ** 3,
  namensstil: 'zufall',
  laenge: 8,
  registrierung: false,
  ...(await getSetting<Partial<Uploads>>('uploads', {}))
})

export async function getInstance(): Promise<Instance> {
  const vorhanden = await getSetting<Instance | null>('instance', null)
  if (vorhanden) return vorhanden
  const neu: Instance = {
    id: randomUUID(),
    setupToken: randomBytes(4)
      .toString('hex')
      .toUpperCase()
      .replace(/(.{4})/, '$1-'),
    secret: randomBytes(32).toString('hex')
  }
  await q('INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING', [
    'instance',
    JSON.stringify(neu)
  ])
  cache.delete('instance')
  return (await getSetting<Instance | null>('instance', null)) || neu
}

export const istHex = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s)

export function settingsCacheLeeren(key?: string): void {
  if (key && key !== '*') cache.delete(key)
  else cache.clear()
}

export type Sprache = 'de' | 'en'
let sprache: Sprache = 'de'
export const sLang = (): Sprache => sprache
export async function ladeSprache(): Promise<Sprache> {
  const vorgabe = process.env.VD_LANG === 'en' ? 'en' : 'de'
  sprache = (await getSetting<{ lang: string }>('lang', { lang: vorgabe })).lang === 'en' ? 'en' : 'de'
  return sprache
}
export async function setSprache(l: Sprache): Promise<void> {
  await setSetting('lang', { lang: l })
  sprache = l
}
export const st = (de: string, en: string): string => (sprache === 'en' ? en : de)
