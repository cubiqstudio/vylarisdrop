import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { q1 } from './db'
import { checkPw, istHttps } from './auth'
import { getInstance } from './settings'

export interface Anfrage {
  aufnahme: boolean
  aufnahme_min: number
  id: number
  user_id: number
  token: string
  titel: string
  nachricht: string
  folder_id: number | null
  max_bytes: string | null
  max_dateien: number | null
  laeuft_ab: string | null
  password_hash: string
  aktiv: boolean
  anzahl: number
  created_at: string
}
export const neuesAnfrageToken = () => randomBytes(12).toString('base64url')
export const anfragePerToken = (t: string) =>
  /^[A-Za-z0-9_-]{10,40}$/.test(t) ? q1<Anfrage>('SELECT * FROM anfragen WHERE token = $1', [t]) : Promise.resolve(null)

export function anfrageOffen(a: Anfrage): { offen: boolean; grund?: 'geschlossen' | 'abgelaufen' | 'voll' } {
  if (!a.aktiv) return { offen: false, grund: 'geschlossen' }
  if (a.laeuft_ab && new Date(a.laeuft_ab).getTime() <= Date.now()) return { offen: false, grund: 'abgelaufen' }
  if (a.max_dateien != null && a.anzahl >= a.max_dateien) return { offen: false, grund: 'voll' }
  return { offen: true }
}

const cookieName = (id: number) => `vd_a${id}`
async function wert(id: number, bis: number) {
  return `${bis}.${createHmac('sha256', (await getInstance()).secret)
    .update(`anfrage:${id}:${bis}`)
    .digest('base64url')}`
}
export async function anfrageFreigeben(event: H3Event, a: Anfrage, pw: string): Promise<boolean> {
  if (!a.password_hash || !(await checkPw(String(pw || '').slice(0, 200), a.password_hash))) return false
  const bis = Date.now() + 6 * 3600_000
  setCookie(event, cookieName(a.id), await wert(a.id, bis), {
    httpOnly: true,
    sameSite: 'lax',
    secure: istHttps(event),
    path: '/',
    maxAge: 6 * 3600
  })
  return true
}
export async function anfrageFreigegeben(event: H3Event, a: Anfrage): Promise<boolean> {
  if (!a.password_hash) return true
  const roh = getCookie(event, cookieName(a.id)) || ''
  const bis = Number(roh.split('.')[0])
  if (!bis || bis < Date.now()) return false
  const soll = Buffer.from(await wert(a.id, bis)),
    ist = Buffer.from(roh)
  return soll.length === ist.length && timingSafeEqual(soll, ist)
}
