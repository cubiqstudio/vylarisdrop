import { createHmac, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransport,
  type WebAuthnCredential
} from '@simplewebauthn/server'
import { q, q1 } from './db'
import { istHttps } from './auth'
import { getDesign, getInstance } from './settings'

interface Flug {
  c: string
  u: number | null
  bis: number
}
const KEKS = 'vd_wa'

async function signieren(w: string) {
  return createHmac('sha256', (await getInstance()).secret)
    .update('wa:' + w)
    .digest('base64url')
}
async function flugSetzen(event: H3Event, f: Flug) {
  const w = Buffer.from(JSON.stringify(f)).toString('base64url')
  setCookie(event, KEKS, `${w}.${await signieren(w)}`, {
    httpOnly: true,
    sameSite: 'strict',
    secure: istHttps(event),
    path: '/api/passkey/',
    maxAge: 300
  })
}
async function flugLesen(event: H3Event): Promise<Flug | null> {
  const roh = getCookie(event, KEKS) || ''
  deleteCookie(event, KEKS, { path: '/api/passkey/' })
  const [w, sig] = roh.split('.')
  if (!w || !sig) return null
  const soll = Buffer.from(await signieren(w)),
    ist = Buffer.from(sig)
  if (soll.length !== ist.length || !timingSafeEqual(soll, ist)) return null
  try {
    const f = JSON.parse(Buffer.from(w, 'base64url').toString()) as Flug
    return f.bis > Date.now() ? f : null
  } catch {
    return null
  }
}

function herkunft(event: H3Event) {
  const host = String(getRequestHeader(event, 'x-forwarded-host') || getRequestHeader(event, 'host') || '')
    .split(',')[0]!
    .trim()
  const rpID = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  return { rpID, origin: `${istHttps(event) ? 'https' : 'http'}://${host}` }
}

interface PkZeile {
  id: string
  user_id: number
  schluessel: string
  zaehler: string
  transports: AuthenticatorTransport[]
  name: string
}

export async function registrierenStart(event: H3Event, u: { id: number; username: string }) {
  const { rpID } = herkunft(event)
  const vorhanden = await q<{ id: string; transports: AuthenticatorTransport[] }>(
    'SELECT id, transports FROM passkeys WHERE user_id = $1',
    [u.id]
  )
  const opt = await generateRegistrationOptions({
    rpName: (await getDesign()).name,
    rpID,
    userName: u.username,
    userID: new TextEncoder().encode(`vd-${u.id}`),
    attestationType: 'none',
    excludeCredentials: vorhanden.map((p) => ({ id: p.id, transports: p.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' }
  })
  await flugSetzen(event, { c: opt.challenge, u: u.id, bis: Date.now() + 300_000 })
  return opt
}

export async function registrierenEnde(event: H3Event, userId: number, antwort: any, name: string) {
  const f = await flugLesen(event)
  if (!f || f.u !== userId)
    throw fehler(400, 'Die Anfrage ist abgelaufen — bitte noch einmal.', 'The request expired — please try again.')
  const { rpID, origin } = herkunft(event)
  const r = await verifyRegistrationResponse({
    response: antwort,
    expectedChallenge: f.c,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true
  }).catch(() => null)
  if (!r?.verified)
    throw fehler(400, 'Der Passkey konnte nicht bestätigt werden.', 'The passkey could not be verified.')
  const c = r.registrationInfo.credential
  await q(
    `INSERT INTO passkeys (id, user_id, schluessel, zaehler, transports, name) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      c.id,
      userId,
      Buffer.from(c.publicKey).toString('base64url'),
      c.counter,
      JSON.stringify(c.transports || []),
      name.slice(0, 60) || 'Passkey'
    ]
  )
  return { id: c.id }
}

export async function anmeldenStart(event: H3Event) {
  const { rpID } = herkunft(event)
  const opt = await generateAuthenticationOptions({ rpID, userVerification: 'required' })
  await flugSetzen(event, { c: opt.challenge, u: null, bis: Date.now() + 300_000 })
  return opt
}

export async function anmeldenEnde(event: H3Event, antwort: any): Promise<{ userId: number; name: string } | null> {
  const f = await flugLesen(event)
  if (!f || typeof antwort?.id !== 'string') return null
  const p = await q1<PkZeile>('SELECT * FROM passkeys WHERE id = $1', [antwort.id])
  if (!p) return null
  const { rpID, origin } = herkunft(event)
  const credential: WebAuthnCredential = {
    id: p.id,
    publicKey: new Uint8Array(Buffer.from(p.schluessel, 'base64url')),
    counter: Number(p.zaehler),
    transports: p.transports
  }
  const r = await verifyAuthenticationResponse({
    response: antwort,
    expectedChallenge: f.c,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential,
    requireUserVerification: true
  }).catch(() => null)
  if (!r?.verified) return null
  await q('UPDATE passkeys SET zaehler = $2, zuletzt_at = now() WHERE id = $1', [p.id, r.authenticationInfo.newCounter])
  return { userId: p.user_id, name: p.name }
}

export function geraetName(ua: string): string {
  const b = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser'
  const s = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : ''
  return s ? `${b} · ${s}` : b
}
