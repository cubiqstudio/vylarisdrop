import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { getSetting, setSetting, getNet, getInstance, st, type Net } from './settings'
import { datenordner } from './speicher'
import { dienstKann, dienstZuAlt } from './update'

export interface TunnelEinst {
  an: boolean
  modus: 'token' | 'auto'
  domain: string
  token: string
  auto?: { apiToken: string; accountId: string; zoneId: string; tunnelId: string; dnsId: string }
  netVorher?: Net | null
}
const API = (process.env.VD_CF_API || 'https://api.cloudflare.com/client/v4').replace(/\/$/, '')
const METRIK = (process.env.VD_TUNNEL_METRICS || 'cloudflared:2000').trim()
export const ZIEL_DIENST = 'http://app:3000'

export const getTunnel = () => getSetting<TunnelEinst | null>('tunnel', null, true)
export const istDomain = (d: string) => /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)

export function tokenPruefen(t: string): { a: string; t: string } | null {
  const roh = t
    .trim()
    .replace(/^.*--token\s+/, '')
    .replace(/^.*\s/, '')
  if (!/^[A-Za-z0-9+/=_-]{60,2000}$/.test(roh)) return null
  try {
    const j = JSON.parse(Buffer.from(roh.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    return j && typeof j.a === 'string' && typeof j.t === 'string' && typeof j.s === 'string'
      ? { a: j.a, t: j.t }
      : null
  } catch {
    return null
  }
}
export const tokenSauber = (t: string) =>
  t
    .trim()
    .replace(/^.*--token\s+/, '')
    .replace(/^.*\s/, '')

export async function tunnelBereit(): Promise<{ erreichbar: boolean; bereit: boolean; verbindungen: number }> {
  try {
    const r = await fetch(`http://${METRIK}/ready`, { signal: AbortSignal.timeout(2500) })
    const j: any = await r.json().catch(() => ({}))
    return { erreichbar: true, bereit: r.status === 200, verbindungen: Number(j?.readyConnections || 0) }
  } catch {
    return { erreichbar: false, bereit: false, verbindungen: 0 }
  }
}

const pfad = (n: string) => join(datenordner(), n)
export async function tunnelAnfragen(an: boolean, token: string, von: string) {
  if (!(await dienstKann('tunnel'))) throw dienstZuAlt()
  await fs.writeFile(
    pfad('.update-anfrage'),
    JSON.stringify({
      id: randomBytes(6).toString('hex'),
      aktion: an ? 'tunnel-an' : 'tunnel-aus',
      ...(an ? { token } : {}),
      von,
      zeit: new Date().toISOString()
    }),
    { mode: 0o600 }
  )
}
export async function tunnelDienstStand() {
  try {
    const s = JSON.parse(await fs.readFile(pfad('.tunnel-status'), 'utf8'))
    return {
      status: String(s.status || ''),
      zeit: String(s.zeit || ''),
      meldung: String(s.meldung || '').slice(0, 500)
    }
  } catch {
    return null
  }
}

export async function netzUmstellen(t: TunnelEinst, an: boolean): Promise<TunnelEinst> {
  const net = await getNet()
  if (an) {
    const vorher = t.netVorher === undefined || t.netVorher === null ? net : t.netVorher
    await setSetting('net', { ...net, mode: 'proxy', domain: t.domain, https: true })
    return { ...t, netVorher: vorher }
  }
  if (t.netVorher) await setSetting('net', t.netVorher)
  return { ...t, netVorher: null }
}

export type TunnelStart =
  | { aktion: 'token'; token: string; domain: string }
  | { aktion: 'auto'; apiToken?: string; domain: string; ueberschreiben: boolean }
export async function tunnelStarten(b: TunnelStart, von: string): Promise<TunnelEinst> {
  if (!istDomain(b.domain))
    throw fehler(
      400,
      'Bitte eine gültige Domain eingeben, z. B. cloud.deinefirma.de.',
      'Please enter a valid domain, e.g. cloud.yourcompany.com.'
    )
  if (!(await dienstKann('tunnel'))) throw dienstZuAlt()
  const alt = await getTunnel()
  let neu: TunnelEinst
  if (b.aktion === 'token') {
    if (!tokenPruefen(b.token))
      throw fehler(
        400,
        'Das ist kein Tunnel-Token. Im Cloudflare-Dashboard unter Zero Trust → Networks → Tunnels → dein Tunnel → „Install connector“ den langen Wert hinter --token kopieren.',
        'That is not a tunnel token. In the Cloudflare dashboard go to Zero Trust → Networks → Tunnels → your tunnel → “Install connector” and copy the long value after --token.'
      )
    neu = { an: true, modus: 'token', domain: b.domain, token: tokenSauber(b.token), netVorher: alt?.netVorher ?? null }
  } else {
    const apiToken = b.apiToken || alt?.auto?.apiToken || ''
    if (!/^[A-Za-z0-9_-]{30,120}$/.test(apiToken))
      throw fehler(400, 'Bitte ein Cloudflare-API-Token einfügen.', 'Please paste a Cloudflare API token.')
    const r = await autoEinrichten(apiToken, b.domain, b.ueberschreiben, alt?.auto)
    neu = { an: true, modus: 'auto', domain: b.domain, token: r.token, auto: r.auto, netVorher: alt?.netVorher ?? null }
  }
  neu = await netzUmstellen(neu, true)
  await setSetting('tunnel', neu)
  await tunnelAnfragen(true, neu.token, von)
  return neu
}

async function cf(apiToken: string, methode: string, weg: string, body?: unknown): Promise<any> {
  const r = await fetch(API + weg, {
    method: methode,
    signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  })
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok || j?.success === false) {
    const e = j?.errors?.[0]
    const text = e ? `${e.message}${e.code ? ` (${e.code})` : ''}` : `HTTP ${r.status}`
    throw Object.assign(new Error(text), { status: r.status, code: e?.code })
  }
  return j.result
}
const cfFehler = (e: any, schritt: string) =>
  fehler(
    400,
    `Cloudflare (${schritt}): ${e?.status === 403 || e?.code === 10000 ? 'Dem Token fehlt ein Recht — nötig sind „Konto → Cloudflare Tunnel → Bearbeiten“ und „Zone → DNS → Bearbeiten“.' : e?.message || 'Fehler'}`,
    `Cloudflare (${schritt}): ${e?.status === 403 || e?.code === 10000 ? 'The token lacks a permission — needed are “Account → Cloudflare Tunnel → Edit” and “Zone → DNS → Edit”.' : e?.message || 'error'}`
  )

async function zoneFinden(apiToken: string, domain: string): Promise<{ id: string; name: string; account: string }> {
  const teile = domain.split('.')
  for (let i = 0; i < teile.length - 1; i++) {
    const name = teile.slice(i).join('.')
    const z = await cf(apiToken, 'GET', `/zones?name=${encodeURIComponent(name)}`)
    if (Array.isArray(z) && z[0]) return { id: z[0].id, name: z[0].name, account: z[0].account?.id }
  }
  throw fehler(
    400,
    `Die Domain ${domain} liegt in keiner Zone, auf die das Token zugreifen darf.`,
    `The domain ${domain} is not in any zone this token can access.`
  )
}

export async function autoEinrichten(
  apiToken: string,
  domain: string,
  ueberschreiben: boolean,
  alt?: TunnelEinst['auto']
) {
  let z
  try {
    z = await zoneFinden(apiToken, domain)
  } catch (e: any) {
    if (e?.statusCode) throw e
    throw cfFehler(e, 'Zone')
  }
  if (!z.account)
    throw fehler(400, 'Cloudflare hat kein Konto zur Zone geliefert.', 'Cloudflare returned no account for the zone.')
  let vorhanden: any[] = []
  try {
    vorhanden = await cf(apiToken, 'GET', `/zones/${z.id}/dns_records?name=${encodeURIComponent(domain)}`)
  } catch (e) {
    throw cfFehler(e, 'DNS lesen')
  }
  const fremd = vorhanden.filter(
    (r) => !(r.type === 'CNAME' && alt?.tunnelId && String(r.content).startsWith(alt.tunnelId))
  )
  if (fremd.length && !ueberschreiben) {
    throw fehler(
      409,
      `Für ${domain} gibt es schon einen DNS-Eintrag (${fremd.map((r) => `${r.type} → ${r.content}`).join(', ')}). Zum Ersetzen „Vorhandenen Eintrag ersetzen“ anhaken.`,
      `${domain} already has a DNS record (${fremd.map((r) => `${r.type} → ${r.content}`).join(', ')}). Tick “Replace existing record” to replace it.`
    )
  }
  let tunnelId = alt?.tunnelId && alt.accountId === z.account ? alt.tunnelId : ''
  if (tunnelId) {
    try {
      await cf(apiToken, 'GET', `/accounts/${z.account}/cfd_tunnel/${tunnelId}`)
    } catch {
      tunnelId = ''
    }
  }
  if (!tunnelId) {
    const inst = await getInstance()
    try {
      const t = await cf(apiToken, 'POST', `/accounts/${z.account}/cfd_tunnel`, {
        name: `vylariscloud-${inst.id.slice(0, 8)}-${randomBytes(2).toString('hex')}`,
        config_src: 'cloudflare'
      })
      tunnelId = t.id
    } catch (e) {
      throw cfFehler(e, 'Tunnel anlegen')
    }
  }
  try {
    await cf(apiToken, 'PUT', `/accounts/${z.account}/cfd_tunnel/${tunnelId}/configurations`, {
      config: { ingress: [{ hostname: domain, service: ZIEL_DIENST }, { service: 'http_status:404' }] }
    })
  } catch (e) {
    throw cfFehler(e, 'Weiterleitung')
  }
  let dnsId = ''
  try {
    for (const r of fremd) await cf(apiToken, 'DELETE', `/zones/${z.id}/dns_records/${r.id}`)
    const eigen = vorhanden.find(
      (r) => r.type === 'CNAME' && alt?.tunnelId && String(r.content).startsWith(alt.tunnelId)
    )
    const satz = {
      type: 'CNAME',
      name: domain,
      content: `${tunnelId}.cfargotunnel.com`,
      proxied: true,
      comment: 'VylarisCloud Tunnel'
    }
    dnsId = eigen
      ? (await cf(apiToken, 'PUT', `/zones/${z.id}/dns_records/${eigen.id}`, satz)).id
      : (await cf(apiToken, 'POST', `/zones/${z.id}/dns_records`, satz)).id
  } catch (e) {
    throw cfFehler(e, 'DNS-Eintrag')
  }
  let token = ''
  try {
    token = await cf(apiToken, 'GET', `/accounts/${z.account}/cfd_tunnel/${tunnelId}/token`)
  } catch (e) {
    throw cfFehler(e, 'Tunnel-Token')
  }
  return { token: String(token), auto: { apiToken, accountId: z.account, zoneId: z.id, tunnelId, dnsId } }
}

export async function autoAbbauen(a: NonNullable<TunnelEinst['auto']>) {
  if (a.dnsId) {
    try {
      await cf(a.apiToken, 'DELETE', `/zones/${a.zoneId}/dns_records/${a.dnsId}`)
    } catch (e: any) {
      if (e?.status !== 404) throw cfFehler(e, 'DNS löschen')
    }
  }
  await cf(a.apiToken, 'DELETE', `/accounts/${a.accountId}/cfd_tunnel/${a.tunnelId}/connections`).catch(() => {})
  try {
    await cf(a.apiToken, 'DELETE', `/accounts/${a.accountId}/cfd_tunnel/${a.tunnelId}`)
  } catch (e: any) {
    if (e?.status !== 404) throw cfFehler(e, 'Tunnel löschen')
  }
}
