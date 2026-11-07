import { createHash, randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import bcrypt from 'bcryptjs'
import type { H3Event } from 'h3'
import { q, q1 } from './db'

const COOKIE = 'vd_session'
const TAGE = 30

export const hashPw = (pw: string) => bcrypt.hash(pw, 12)
export async function checkPw(pw: string, hash: string): Promise<boolean> {
  if (!hash) return false
  if (hash.startsWith('$argon2')) {
    const { argon2Verify } = await import('hash-wasm')
    return argon2Verify({ password: pw, hash }).catch(() => false)
  }
  return bcrypt.compare(pw, hash.startsWith('$2y$') ? '$2b$' + hash.slice(4) : hash).catch(() => false)
}
export const fremderHash = (hash: string) => hash.startsWith('$argon2') || hash.startsWith('$2y$')
export const sha = (s: string) => createHash('sha256').update(s).digest('hex')

/** Kommt die Verbindung aus einem lokalen/privaten Netz (Reverse-Proxy auf demselben Rechner oder im Docker-Netz)? */
function adresseIntern(roh: string): boolean {
  const a = roh.toLowerCase().replace(/^::ffff:/, '')
  if (isIP(a) === 4) {
    const [x, y] = a.split('.').map(Number) as [number, number]
    return x === 127 || x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254)
  }
  return a === '::1' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a)
}
/**
 * Absender der Anfrage (für Fehlversuch-Sperren, Protokoll, Sitzungen). Der erste X-Forwarded-For-Wert stammt vom Client und ist frei
 * wählbar (auch hinter nginx, das nur anhängt). Darum: ohne vorgeschalteten Proxy (Verbindung kommt von einer öffentlichen Adresse)
 * zählt die Verbindungsadresse, mit lokalem/privatem Proxy der LETZTE Eintrag, den der Proxy selbst gesetzt hat.
 */
export function clientIp(event: H3Event): string {
  const direkt = String(event.node.req.socket?.remoteAddress || '')
  if (!direkt) return getRequestIP(event) || ''
  if (!adresseIntern(direkt)) return direkt
  const letzte = String(getRequestHeader(event, 'x-forwarded-for') || '')
    .split(',')
    .pop()!
    .trim()
  return isIP(letzte) ? letzte : direkt
}
export function istHttps(event: H3Event): boolean {
  return (
    String(getRequestHeader(event, 'x-forwarded-proto') || '')
      .split(',')[0]!
      .trim() === 'https'
  )
}

// appGeraet: ID des App-Geraets (upload_tokens), aus dem die Sitzung stammt; Widerruf des Geraets beendet sie sofort
export async function sessionStart(event: H3Event, userId: number, appGeraet: number | null = null): Promise<void> {
  const token = randomBytes(32).toString('hex')
  await q(
    "INSERT INTO sessions (token_hash, user_id, expires_at, ip, ua, app_geraet) VALUES ($1, $2, now() + ($3 || ' days')::interval, $4, $5, $6)",
    [
      sha(token),
      userId,
      String(TAGE),
      clientIp(event),
      String(getRequestHeader(event, 'user-agent') || '').slice(0, 300),
      appGeraet
    ]
  )
  setCookie(event, COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: istHttps(event),
    path: '/',
    maxAge: TAGE * 86400
  })
}

export async function sessionEnd(event: H3Event): Promise<void> {
  const token = getCookie(event, COOKIE)
  if (token) await q('DELETE FROM sessions WHERE token_hash = $1', [sha(token)])
  deleteCookie(event, COOKIE, { path: '/' })
}

export const sessionTokenHash = (event: H3Event) => sha(getCookie(event, COOKIE) || '')

export type Rolle = 'owner' | 'admin' | 'user'
export interface Nutzer {
  id: number
  username: string
  email: string
  role: Rolle
  quota_bytes: number | null
  prefs: Record<string, any>
  rolle_id?: number | null
}

const SPALTEN = 'u.id, u.username, u.email, u.role, u.quota_bytes, u.prefs, u.rolle_id'

export async function currentUser(event: H3Event): Promise<Nutzer | null> {
  if (event.context.nutzer !== undefined) return event.context.nutzer
  const token = getCookie(event, COOKIE)
  let u: Nutzer | null = null
  if (token && /^[0-9a-f]{64}$/.test(token)) {
    u = await q1<Nutzer>(
      `SELECT ${SPALTEN} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sha(token)]
    )
  }
  event.context.nutzer = u
  return u
}

export async function requireUser(event: H3Event): Promise<Nutzer> {
  const u = await currentUser(event)
  if (!u) throw fehler(401, 'Nicht angemeldet', 'Not signed in')
  return u
}
export async function requireAdmin(event: H3Event): Promise<Nutzer> {
  const u = await requireUser(event)
  if (u.role !== 'owner' && u.role !== 'admin')
    throw fehler(403, 'Dafür brauchst du Admin-Rechte.', 'You need admin rights for this.')
  return u
}
export async function requireOwner(event: H3Event): Promise<Nutzer> {
  const u = await requireUser(event)
  if (u.role !== 'owner') throw fehler(403, 'Das darf nur der Inhaber.', 'Only the owner may do this.')
  return u
}

export function neuesToken(): { klar: string; prefix: string; hash: string } {
  const klar = 'vd_' + randomBytes(24).toString('hex')
  return { klar, prefix: klar.slice(0, 10), hash: sha(klar) }
}
export type TokenRecht = 'upload' | 'lesen' | 'verwalten'
export const TOKEN_RECHTE: TokenRecht[] = ['upload', 'lesen', 'verwalten']

export type TokenArt = 'api' | 'app'
export interface TokenNutzer extends Nutzer {
  tokenRechte: TokenRecht[]
  tokenId: number
  tokenArt: TokenArt
  tokenName: string
}
// Bearer-Token einer Anfrage. 'api' = normales Upload-/API-Token (vd_…), 'app' = App-Geraet (vd_app_…, siehe server/utils/app.ts)
export async function userAusToken(event: H3Event): Promise<TokenNutzer | null> {
  const kopf = String(getRequestHeader(event, 'authorization') || '').trim()
  const klar = kopf.replace(/^Bearer\s+/i, '')
  if (!/^vd_(app_)?[0-9a-f]{48}$/.test(klar)) return null
  const u = await q1<Nutzer & { tid: number; last_used_at: Date | null; rechte: TokenRecht[]; art: TokenArt; tname: string }>(
    `SELECT ${SPALTEN}, t.id AS tid, t.last_used_at, t.rechte, t.art, t.name AS tname FROM upload_tokens t JOIN users u ON u.id = t.user_id WHERE t.key_hash = $1`,
    [sha(klar)]
  )
  if (!u) return null
  // Format und Art muessen zusammenpassen (ein vd_app_-Token ist immer ein App-Geraet und umgekehrt)
  if (klar.startsWith('vd_app_') !== (u.art === 'app')) return null
  if (!u.last_used_at || Date.now() - new Date(u.last_used_at).getTime() > 60_000)
    void q('UPDATE upload_tokens SET last_used_at = now() WHERE id = $1', [u.tid]).catch(() => {})
  const { tid, last_used_at: _l, rechte, art, tname, ...n } = u
  return {
    ...n,
    tokenRechte: Array.isArray(rechte) ? rechte : ['upload'],
    tokenId: tid,
    tokenArt: art === 'app' ? 'app' : 'api',
    tokenName: tname
  }
}
export async function userAusSitzungOderToken(event: H3Event): Promise<Nutzer> {
  const s = await currentUser(event)
  if (s) return s
  const u = await userAusToken(event)
  if (!u) throw fehler(401, 'Nicht angemeldet oder Token ungültig.', 'Not signed in or invalid token.')
  if (!u.tokenRechte.includes('upload'))
    throw fehler(403, 'Dieses Token darf nicht hochladen.', 'This token may not upload.')
  return u
}

const zaehler = new Map<string, { n: number; bis: number }>()
export function limit(key: string, max: number, fensterSek: number): boolean {
  const jetzt = Date.now()
  const z = zaehler.get(key)
  if (!z || z.bis < jetzt) {
    zaehler.set(key, { n: 1, bis: jetzt + fensterSek * 1000 })
    return false
  }
  z.n++
  return z.n > max
}
export function gesperrt(key: string, max: number): boolean {
  const z = zaehler.get(key)
  return !!z && z.bis > Date.now() && z.n >= max
}
export function fehlversuch(key: string, fensterSek: number): void {
  const jetzt = Date.now()
  const z = zaehler.get(key)
  if (!z || z.bis < jetzt) zaehler.set(key, { n: 1, bis: jetzt + fensterSek * 1000 })
  else z.n++
}
setInterval(() => {
  const t = Date.now()
  for (const [k, v] of zaehler) if (v.bis < t) zaehler.delete(k)
}, 60_000).unref?.()
