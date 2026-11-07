import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
  constants,
  type KeyObject
} from 'node:crypto'
import type { H3Event } from 'h3'
import { q, q1 } from './db'
import { hashPw, istHttps, type Nutzer } from './auth'
import { getInstance, getSetting, setSetting, st } from './settings'
import { istPro } from './lizenz'

export type SsoArt = 'oidc' | 'google' | 'microsoft' | 'github' | 'discord'
export interface Anbieter {
  id: string
  art: SsoArt
  name: string
  aktiv: boolean
  clientId: string
  clientSecret: string
  issuer: string
  scopes: string
  autoAnlegen: boolean
  domains: string[]
  perEmail: boolean
  rolleId: number | null
  teamId: number | null
  adminGruppe: string
}
export interface SsoEinstellung {
  anbieter: Anbieter[]
  passwortAus: boolean
}
export const getSso = async (): Promise<SsoEinstellung> => ({
  anbieter: [],
  passwortAus: false,
  ...(await getSetting<Partial<SsoEinstellung>>('sso', {}))
})
export const setSso = (s: SsoEinstellung) => setSetting('sso', s)

export async function ssoFuerLogin(): Promise<{
  anbieter: Array<{ id: string; name: string; art: SsoArt }>
  passwortAus: boolean
}> {
  if (!(await istPro('sso'))) return { anbieter: [], passwortAus: false }
  const s = await getSso()
  return {
    anbieter: s.anbieter.filter((a) => a.aktiv).map((a) => ({ id: a.id, name: a.name, art: a.art })),
    passwortAus: s.passwortAus
  }
}

interface Endpunkte {
  authorize: string
  token: string
  userinfo?: string
  jwks?: string
  issuer?: string
  oidc: boolean
}
const discoCache = new Map<string, { e: Endpunkte; bis: number }>()

function issuerVon(a: Anbieter): string {
  if (a.art === 'google') return 'https://accounts.google.com'
  if (a.art === 'microsoft')
    return `https://login.microsoftonline.com/${encodeURIComponent(a.issuer.trim() || 'common')}/v2.0`
  return a.issuer.trim().replace(/\/+$/, '')
}
async function endpunkte(a: Anbieter): Promise<Endpunkte> {
  if (a.art === 'github')
    return {
      authorize: 'https://github.com/login/oauth/authorize',
      token: 'https://github.com/login/oauth/access_token',
      userinfo: 'https://api.github.com/user',
      oidc: false
    }
  if (a.art === 'discord')
    return {
      authorize: 'https://discord.com/oauth2/authorize',
      token: 'https://discord.com/api/oauth2/token',
      userinfo: 'https://discord.com/api/users/@me',
      oidc: false
    }
  const iss = issuerVon(a)
  const c = discoCache.get(iss)
  if (c && c.bis > Date.now()) return c.e
  let j: any
  try {
    const r = await fetch(`${iss}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(10_000),
      headers: { accept: 'application/json' }
    })
    if (!r.ok) throw new Error(String(r.status))
    j = await r.json()
  } catch (e: any) {
    throw new Error(st(`Der Anbieter ist nicht erreichbar (${iss}).`, `The provider cannot be reached (${iss}).`))
  }
  if (!j?.authorization_endpoint || !j?.token_endpoint)
    throw new Error(
      st(
        'Die OpenID-Konfiguration des Anbieters ist unvollständig.',
        "The provider's OpenID configuration is incomplete."
      )
    )
  const e: Endpunkte = {
    authorize: j.authorization_endpoint,
    token: j.token_endpoint,
    userinfo: j.userinfo_endpoint,
    jwks: j.jwks_uri,
    issuer: j.issuer,
    oidc: true
  }
  discoCache.set(iss, { e, bis: Date.now() + 3600_000 })
  return e
}
function scopesVon(a: Anbieter): string {
  const basis =
    a.art === 'github'
      ? ['read:user', 'user:email']
      : a.art === 'discord'
        ? ['identify', 'email']
        : ['openid', 'email', 'profile']
  return [...new Set([...basis, ...a.scopes.split(/\s+/).filter((s) => /^[\w:.\/-]{1,60}$/.test(s))])].join(' ')
}

const b64u = (b: Buffer) => b.toString('base64url')
const KEKS = 'vd_sso'
interface Flug {
  a: string
  s: string
  v: string
  n: string
  l: number | null
  bis: number
  z: string
}

async function signieren(w: string) {
  return createHmac('sha256', (await getInstance()).secret)
    .update('sso:' + w)
    .digest('base64url')
}
async function flugSetzen(event: H3Event, f: Flug) {
  const w = b64u(Buffer.from(JSON.stringify(f)))
  setCookie(event, KEKS, `${w}.${await signieren(w)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: istHttps(event),
    path: '/api/sso/',
    maxAge: 600
  })
}
async function flugLesen(event: H3Event): Promise<Flug | null> {
  const roh = getCookie(event, KEKS) || ''
  deleteCookie(event, KEKS, { path: '/api/sso/' })
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

export async function ssoStart(
  event: H3Event,
  a: Anbieter,
  basis: string,
  verknuepfenMit: number | null,
  zurueck: string
): Promise<string> {
  const e = await endpunkte(a)
  const v = b64u(randomBytes(32)),
    s = b64u(randomBytes(18)),
    n = b64u(randomBytes(18))
  await flugSetzen(event, { a: a.id, s, v, n, l: verknuepfenMit, bis: Date.now() + 600_000, z: zurueck })
  const u = new URL(e.authorize)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', a.clientId)
  u.searchParams.set('redirect_uri', `${basis}/api/sso/${a.id}/callback`)
  u.searchParams.set('scope', scopesVon(a))
  u.searchParams.set('state', s)
  u.searchParams.set('code_challenge', b64u(createHash('sha256').update(v).digest()))
  u.searchParams.set('code_challenge_method', 'S256')
  if (e.oidc) u.searchParams.set('nonce', n)
  if (a.art === 'discord') u.searchParams.set('prompt', 'none')
  return u.toString()
}

export interface Identitaet {
  sub: string
  email: string
  emailOk: boolean
  name: string
  gruppen: string[]
}

export async function ssoRueckkehr(
  event: H3Event,
  a: Anbieter,
  basis: string
): Promise<{ id: Identitaet; flug: Flug }> {
  const qy = getQuery(event)
  const flug = await flugLesen(event)
  if (qy.error)
    throw new Error(
      st(
        `Der Anbieter meldet: ${String(qy.error_description || qy.error).slice(0, 200)}`,
        `The provider reports: ${String(qy.error_description || qy.error).slice(0, 200)}`
      )
    )
  if (!flug || flug.a !== a.id || flug.s !== String(qy.state || ''))
    throw new Error(
      st(
        'Die Anmeldung ist abgelaufen oder wurde in einem anderen Fenster begonnen. Bitte noch einmal versuchen.',
        'The sign-in expired or was started in another window. Please try again.'
      )
    )
  const code = String(qy.code || '')
  if (!code || code.length > 2000)
    throw new Error(st('Vom Anbieter kam kein Code zurück.', 'No code came back from the provider.'))
  const e = await endpunkte(a)
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${basis}/api/sso/${a.id}/callback`,
    client_id: a.clientId,
    client_secret: a.clientSecret,
    code_verifier: flug.v
  })
  const r = await fetch(e.token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(15_000)
  })
  const t: any = await r.json().catch(() => ({}))
  if (!r.ok || !t.access_token)
    throw new Error(
      st(
        `Der Anbieter hat den Code nicht angenommen (${t.error || r.status}). Client-ID, Geheimnis und Rücksprung-Adresse prüfen.`,
        `The provider rejected the code (${t.error || r.status}). Check client ID, secret and redirect URL.`
      )
    )

  if (a.art === 'github') {
    const kopf = {
      authorization: `Bearer ${t.access_token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'VylarisCloud'
    }
    const u: any = await (
      await fetch('https://api.github.com/user', { headers: kopf, signal: AbortSignal.timeout(10_000) })
    ).json()
    const mails: any[] = await (
      await fetch('https://api.github.com/user/emails', { headers: kopf, signal: AbortSignal.timeout(10_000) })
    )
      .json()
      .catch(() => [])
    const m = Array.isArray(mails) ? mails.find((x) => x.primary && x.verified) || mails.find((x) => x.verified) : null
    if (!u?.id) throw new Error(st('GitHub hat kein Profil geliefert.', 'GitHub did not return a profile.'))
    return {
      id: { sub: String(u.id), email: m?.email || '', emailOk: !!m, name: u.login || u.name || '', gruppen: [] },
      flug
    }
  }
  if (a.art === 'discord') {
    const u: any = await (
      await fetch('https://discord.com/api/users/@me', {
        headers: { authorization: `Bearer ${t.access_token}` },
        signal: AbortSignal.timeout(10_000)
      })
    ).json()
    if (!u?.id) throw new Error(st('Discord hat kein Profil geliefert.', 'Discord did not return a profile.'))
    return {
      id: {
        sub: String(u.id),
        email: u.email || '',
        emailOk: !!u.verified && !!u.email,
        name: u.username || u.global_name || '',
        gruppen: []
      },
      flug
    }
  }
  if (!t.id_token)
    throw new Error(
      st(
        'Der Anbieter hat kein ID-Token geliefert (Scope „openid“ fehlt?).',
        'The provider returned no ID token (scope "openid" missing?).'
      )
    )
  const c = await idTokenPruefen(String(t.id_token), a, e, flug.n)
  let claims: any = c
  if ((!c.email || !c.groups) && e.userinfo) {
    try {
      const ui: any = await (
        await fetch(e.userinfo, {
          headers: { authorization: `Bearer ${t.access_token}` },
          signal: AbortSignal.timeout(10_000)
        })
      ).json()
      if (ui?.sub === c.sub)
        claims = {
          ...ui,
          ...c,
          email: c.email || ui.email,
          email_verified: c.email_verified ?? ui.email_verified,
          groups: c.groups || ui.groups
        }
    } catch {}
  }
  const gruppen = Array.isArray(claims.groups)
    ? claims.groups.map(String)
    : Array.isArray(claims.roles)
      ? claims.roles.map(String)
      : []
  const emailOk =
    claims.email_verified === true || claims.email_verified === 'true' || (a.art === 'microsoft' && !!claims.email)
  return {
    id: {
      sub: String(c.sub),
      email: String(claims.email || ''),
      emailOk,
      name: String(claims.preferred_username || claims.name || claims.nickname || ''),
      gruppen
    },
    flug
  }
}

const jwksCache = new Map<string, { keys: any[]; bis: number }>()
async function schluesselFuer(uri: string, kid: string | undefined, neu = false): Promise<KeyObject | null> {
  let c = jwksCache.get(uri)
  if (!c || c.bis < Date.now() || neu) {
    const r = await fetch(uri, { signal: AbortSignal.timeout(10_000) })
    const j: any = await r.json()
    c = { keys: Array.isArray(j?.keys) ? j.keys : [], bis: Date.now() + 3600_000 }
    jwksCache.set(uri, c)
  }
  const k = c.keys.find((x) => !kid || x.kid === kid)
  if (!k) return neu ? null : schluesselFuer(uri, kid, true)
  try {
    return createPublicKey({ key: k, format: 'jwk' })
  } catch {
    return null
  }
}

async function idTokenPruefen(jwt: string, a: Anbieter, e: Endpunkte, nonce: string): Promise<any> {
  const teile = jwt.split('.')
  if (teile.length !== 3) throw new Error(st('Ungültiges ID-Token.', 'Invalid ID token.'))
  const kopf = JSON.parse(Buffer.from(teile[0]!, 'base64url').toString())
  const c = JSON.parse(Buffer.from(teile[1]!, 'base64url').toString())
  const sig = Buffer.from(teile[2]!, 'base64url')
  const daten = Buffer.from(`${teile[0]}.${teile[1]}`)
  if (!e.jwks)
    throw new Error(st('Der Anbieter nennt keine Schlüssel (jwks_uri).', 'The provider lists no keys (jwks_uri).'))
  const key = await schluesselFuer(e.jwks, kopf.kid)
  if (!key)
    throw new Error(
      st('Der Signaturschlüssel des Anbieters wurde nicht gefunden.', "The provider's signing key was not found.")
    )
  const alg = String(kopf.alg || '')
  const hash = { '256': 'sha256', '384': 'sha384', '512': 'sha512' }[alg.slice(2)] || 'sha256'
  let ok = false
  if (/^RS(256|384|512)$/.test(alg)) ok = verify(hash, daten, key, sig)
  else if (/^PS(256|384|512)$/.test(alg))
    ok = verify(
      hash,
      daten,
      { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST },
      sig
    )
  else if (/^ES(256|384|512)$/.test(alg)) ok = verify(hash, daten, { key, dsaEncoding: 'ieee-p1363' }, sig)
  else if (alg === 'EdDSA') ok = verify(null, daten, key, sig)
  if (!ok) throw new Error(st('Die Signatur des ID-Tokens stimmt nicht.', 'The ID token signature is invalid.'))
  const iss = String(e.issuer || issuerVon(a)).replace('{tenantid}', String(c.tid || ''))
  if (c.iss !== iss)
    throw new Error(
      st('Das ID-Token stammt von einem anderen Aussteller.', 'The ID token comes from a different issuer.')
    )
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud]
  if (!aud.includes(a.clientId))
    throw new Error(
      st('Das ID-Token ist für eine andere Anwendung bestimmt.', 'The ID token is meant for a different application.')
    )
  const jetzt = Date.now() / 1000
  if (!(Number(c.exp) > jetzt - 60)) throw new Error(st('Das ID-Token ist abgelaufen.', 'The ID token has expired.'))
  if (c.nonce !== nonce)
    throw new Error(
      st('Das ID-Token gehört nicht zu dieser Anmeldung.', 'The ID token does not belong to this sign-in.')
    )
  if (!c.sub) throw new Error(st('Im ID-Token fehlt die Kennung (sub).', 'The ID token lacks the subject (sub).'))
  return c
}

export type Ergebnis = { art: 'login'; userId: number; neu: boolean } | { art: 'verknuepft'; userId: number }

export async function kontoFuer(a: Anbieter, id: Identitaet, verknuepfenMit: number | null): Promise<Ergebnis> {
  const da = await q1<{ user_id: number }>(
    'SELECT user_id FROM user_identitaeten WHERE anbieter = $1 AND subjekt = $2',
    [a.id, id.sub]
  )
  if (verknuepfenMit) {
    if (da && da.user_id !== verknuepfenMit)
      throw new Error(
        st(
          'Diese Anmeldung ist schon mit einem anderen Konto verbunden.',
          'This sign-in is already linked to another account.'
        )
      )
    await q(
      `INSERT INTO user_identitaeten (anbieter, subjekt, user_id, email) VALUES ($1, $2, $3, $4) ON CONFLICT (anbieter, subjekt) DO UPDATE SET zuletzt_at = now(), email = EXCLUDED.email`,
      [a.id, id.sub, verknuepfenMit, id.email.slice(0, 200)]
    )
    return { art: 'verknuepft', userId: verknuepfenMit }
  }
  if (da) {
    await q('UPDATE user_identitaeten SET zuletzt_at = now(), email = $3 WHERE anbieter = $1 AND subjekt = $2', [
      a.id,
      id.sub,
      id.email.slice(0, 200)
    ])
    await adminAusGruppe(a, id, da.user_id)
    return { art: 'login', userId: da.user_id, neu: false }
  }
  const domain = id.email.split('@')[1]?.toLowerCase() || ''
  if (a.domains.length && (!id.emailOk || !a.domains.includes(domain)))
    throw new Error(
      st(
        'Mit dieser E-Mail-Adresse ist die Anmeldung hier nicht erlaubt.',
        'Signing in with this email address is not allowed here.'
      )
    )
  if (a.perEmail && id.emailOk && id.email) {
    const u = await q1<{ id: number; role: string }>(
      'SELECT id, role FROM users WHERE lower(email) = lower($1) ORDER BY id LIMIT 1',
      [id.email]
    )
    if (u && u.role !== 'owner') {
      await q(
        'INSERT INTO user_identitaeten (anbieter, subjekt, user_id, email) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [a.id, id.sub, u.id, id.email.slice(0, 200)]
      )
      await adminAusGruppe(a, id, u.id)
      return { art: 'login', userId: u.id, neu: false }
    }
  }
  if (!a.autoAnlegen)
    throw new Error(
      st(
        'Für diese Anmeldung gibt es hier noch kein Konto. Ein Admin kann eins anlegen — danach in den Einstellungen verknüpfen.',
        'There is no account for this sign-in yet. An admin can create one — then link it in the settings.'
      )
    )
  const name = await freierName(id.name || id.email.split('@')[0] || `${a.id}-${id.sub.slice(0, 8)}`)
  const u = await q1<{ id: number }>(
    `INSERT INTO users (username, email, password, role, rolle_id) VALUES ($1, $2, $3, 'user', $4) RETURNING id`,
    [
      name,
      id.emailOk ? id.email.slice(0, 200) : '',
      await hashPw(randomBytes(24).toString('hex')),
      a.rolleId && (await q1('SELECT 1 FROM rollen WHERE id = $1', [a.rolleId])) ? a.rolleId : null
    ]
  )
  await q('INSERT INTO user_identitaeten (anbieter, subjekt, user_id, email) VALUES ($1, $2, $3, $4)', [
    a.id,
    id.sub,
    u!.id,
    id.email.slice(0, 200)
  ])
  if (a.teamId)
    await q(
      `INSERT INTO team_mitglieder (team_id, user_id) SELECT id, $2 FROM teams WHERE id = $1 ON CONFLICT DO NOTHING`,
      [a.teamId, u!.id]
    )
  await adminAusGruppe(a, id, u!.id)
  return { art: 'login', userId: u!.id, neu: true }
}

async function adminAusGruppe(a: Anbieter, id: Identitaet, userId: number) {
  if (!a.adminGruppe || !id.gruppen.includes(a.adminGruppe)) return
  await q(`UPDATE users SET role = 'admin' WHERE id = $1 AND role = 'user'`, [userId])
}

async function freierName(wunsch: string): Promise<string> {
  const basis =
    wunsch
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '')
      .replace(/^[._-]+/, '')
      .slice(0, 28) || 'konto'
  for (let i = 0; i < 50; i++) {
    const n = i ? `${basis}${i + 1}` : basis
    if (!(await q1('SELECT 1 FROM users WHERE lower(username) = lower($1)', [n]))) return n
  }
  return `${basis}-${randomBytes(3).toString('hex')}`
}

export async function identitaetenVon(u: Nutzer) {
  const s = await getSso()
  const z = await q<{ anbieter: string; email: string; created_at: string; zuletzt_at: string }>(
    'SELECT anbieter, email, created_at, zuletzt_at FROM user_identitaeten WHERE user_id = $1 ORDER BY created_at',
    [u.id]
  )
  return z.map((x) => ({ ...x, name: s.anbieter.find((a) => a.id === x.anbieter)?.name || x.anbieter }))
}
