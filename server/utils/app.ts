import { randomBytes, randomInt } from 'node:crypto'
import { isIP } from 'node:net'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { H3Event } from 'h3'
import { db, q, q1, ereignis } from './db'
import { clientIp, fehlversuch, gesperrt, limit, sha, userAusToken, type TokenNutzer } from './auth'
import { basisUrl } from './dateien'
import { getDesign } from './settings'
import { VERSION } from './knoten'
import { datenordner } from './speicher'

// Android-App: Kopplung und App-Geraete. Ein App-Geraet ist ein Token (upload_tokens.art = 'app', Format vd_app_<48 Hex>);
// gespeichert wird nur der SHA-256-Hash. Das Token darf hochladen und lesen (API v1, POST /api/upload) und die App-Routen
// /api/app/ich und /api/app/sitzung nutzen — nichts anderes (alle Verwaltungs-Routen verlangen eine Browser-Sitzung).

export const CODE_ZEICHEN = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const CODE_LAENGE = 8
export const CODE_SEKUNDEN = 300
export const MAX_OFFENE_CODES = 5
export const MAX_GERAETE = 10
export const APK_DATEI = 'VylarisCloud.apk'

export const apkPfad = () => join(datenordner(), APK_DATEI)

/** Code in der Anzeigeform ABCD-EFGH. */
export function appNeuerCode(): string {
  let c = ''
  for (let i = 0; i < CODE_LAENGE; i++) c += CODE_ZEICHEN[randomInt(CODE_ZEICHEN.length)]
  return `${c.slice(0, 4)}-${c.slice(4)}`
}
/** Eingabe vereinheitlichen (Gross-/Kleinschreibung, Leerzeichen, Bindestrich); null, wenn die Form nicht stimmt. */
export function appCodeNormal(roh: unknown): string | null {
  if (typeof roh !== 'string' || roh.length > 40) return null
  const c = roh.toUpperCase().replace(/[\s-]/g, '')
  return new RegExp(`^[${CODE_ZEICHEN}]{${CODE_LAENGE}}$`).test(c) ? c : null
}
export const appCodeHash = (normal: string) => sha('vd-koppelcode:' + normal)

export function appGeraetName(roh: unknown): string {
  const s = String(typeof roh === 'string' ? roh : '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  return s || 'App'
}

export interface ServerInfo {
  name: string
  version: string
  farbe: string
}
export async function appServerInfo(): Promise<ServerInfo> {
  const d = await getDesign()
  return { name: d.name || 'VylarisCloud', version: VERSION, farbe: d.color || '#1e73be' }
}
export const appNutzerInfo = (u: { id: number; username: string; role: string }) => ({
  id: u.id,
  name: u.username,
  rolle: u.role
})

/** Legt ein neues App-Geraet an. Ab dem elften wird das am laengsten ungenutzte ersetzt. Klartext nur hier. */
export async function appGeraetAnlegen(userId: number, name: string): Promise<{ id: number; klar: string }> {
  const klar = 'vd_app_' + randomBytes(24).toString('hex')
  const c = await db().connect()
  try {
    await c.query('BEGIN')
    await c.query('SELECT pg_advisory_xact_lock(5242007, $1)', [userId])
    await c.query(
      `DELETE FROM upload_tokens WHERE id IN (
         SELECT id FROM upload_tokens WHERE user_id = $1 AND art = 'app'
         ORDER BY coalesce(last_used_at, created_at) DESC, id DESC
         OFFSET $2)`,
      [userId, MAX_GERAETE - 1]
    )
    const r = await c.query(
      `INSERT INTO upload_tokens (user_id, name, prefix, key_hash, rechte, art)
       VALUES ($1, $2, $3, $4, '["upload","lesen"]'::jsonb, 'app') RETURNING id`,
      [userId, name, klar.slice(0, 11), sha(klar)]
    )
    await c.query('COMMIT')
    return { id: r.rows[0].id, klar }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}

/** Antwort fuer koppeln / token: das neue Token mit Angaben zu Nutzer und Server. */
export async function appGeraetAntwort(
  event: H3Event,
  u: { id: number; username: string; role: string },
  geraet: string,
  art: 'koppeln' | 'token'
) {
  const g = await appGeraetAnlegen(u.id, geraet)
  await ereignis('app_gekoppelt', u.id, { geraet, id: g.id, weg: art }, clientIp(event))
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { ok: true, token: g.klar, nutzer: appNutzerInfo(u), server: await appServerInfo() }
}

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
 * Absender fuer die Zaehler der App-Routen. Der erste X-Forwarded-For-Wert stammt vom Client und ist frei waehlbar (auch hinter
 * nginx, das nur anhaengt). Darum: ohne vorgeschalteten Proxy (Verbindung kommt von einer oeffentlichen Adresse) zaehlt die
 * Verbindungsadresse, mit lokalem Proxy der LETZTE Eintrag, den der Proxy selbst gesetzt hat.
 */
export function appIp(event: H3Event): string {
  const direkt = String(event.node.req.socket?.remoteAddress || '')
  if (!direkt || !adresseIntern(direkt)) return direkt || clientIp(event)
  const letzte = String(getRequestHeader(event, 'x-forwarded-for') || '')
    .split(',')
    .pop()!
    .trim()
  return isIP(letzte) ? letzte : direkt
}

/** App-Geraete eines Nutzers widerrufen (Passwortaenderung, Admin-Reset, „Alle Sitzungen beenden“). Das Geraet, aus dem die aktuelle
 *  Sitzung stammt (sitzungHash), bleibt erhalten. Die Sitzungen widerrufener Geraete enden durch ON DELETE CASCADE. */
export async function appGeraeteWiderrufen(userId: number, sitzungHash: string | null = null): Promise<number> {
  const r = await q(
    `DELETE FROM upload_tokens WHERE user_id = $1 AND art = 'app'
       AND id NOT IN (SELECT app_geraet FROM sessions WHERE token_hash = $2 AND app_geraet IS NOT NULL) RETURNING id`,
    [userId, sitzungHash ?? '']
  )
  return r.length
}

/** Anfrage mit einem App-Token (vd_app_…) — sonst 401. Normale Upload-Token und Browser-Sitzungen gelten hier nicht. */
export async function requireAppToken(event: H3Event): Promise<TokenNutzer> {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const ip = appIp(event)
  if (limit('app-token-ip:' + ip, 300, 60)) {
    setResponseHeader(event, 'Retry-After', 60)
    throw fehler(429, 'Zu viele Anfragen. Bitte warte kurz.', 'Too many requests. Please wait a moment.')
  }
  const t = await userAusToken(event)
  if (!t || t.tokenArt !== 'app')
    throw fehler(
      401,
      'App-Token fehlt oder ist ungültig (Authorization: Bearer vd_app_…).',
      'Missing or invalid app token (Authorization: Bearer vd_app_…).'
    )
  return t
}

/** Kopplung per Code: einmal verwendbar, atomar. Gibt die Nutzer-ID zurueck oder null (unbekannt/abgelaufen/benutzt). */
export async function appCodeEinloesen(code: string): Promise<number | null> {
  const r = await q1<{ user_id: number }>(
    `UPDATE app_koppelcodes SET benutzt_at = now()
     WHERE code_hash = $1 AND benutzt_at IS NULL AND ablauf_at > now() RETURNING user_id`,
    [appCodeHash(code)]
  )
  return r?.user_id ?? null
}

export const KOPPEL_FEHLER_SPERRE = 10
export const KOPPEL_FENSTER = 600
export function appKoppelnGesperrt(ip: string): boolean {
  return gesperrt('app-koppeln:' + ip, KOPPEL_FEHLER_SPERRE) || gesperrt('app-koppeln:*', 400)
}
export function appKoppelnFehlversuch(ip: string): void {
  fehlversuch('app-koppeln:' + ip, KOPPEL_FENSTER)
  fehlversuch('app-koppeln:*', KOPPEL_FENSTER)
}

export async function appKoppelLink(event: H3Event, code: string): Promise<string> {
  return `${await basisUrl(event)}/app/koppeln?c=${encodeURIComponent(code)}`
}

/** Abgelaufene und benutzte Codes entfernen, verwaiste App-Sitzungen gibt es durch ON DELETE CASCADE nicht. */
export async function appAufraeumen(): Promise<void> {
  await q(
    "DELETE FROM app_koppelcodes WHERE ablauf_at < now() - interval '1 hour' OR (benutzt_at IS NOT NULL AND benutzt_at < now() - interval '1 hour')"
  )
}

export async function apkInfo(): Promise<{ vorhanden: boolean; groesse: number }> {
  try {
    const s = await fs.stat(apkPfad())
    return { vorhanden: s.isFile() && s.size > 0, groesse: s.size }
  } catch {
    return { vorhanden: false, groesse: 0 }
  }
}
