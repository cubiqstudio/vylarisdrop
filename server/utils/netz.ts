import { promises as dns } from 'node:dns'
import { getInstance, st } from './settings'

let ipCache: { ip: string; t: number } | null = null

export async function serverIp(): Promise<string> {
  if (process.env.VD_PUBLIC_IP) return process.env.VD_PUBLIC_IP
  if (ipCache && Date.now() - ipCache.t < 10 * 60_000) return ipCache.ip
  for (const url of ['https://api.ipify.org', 'https://ipv4.icanhazip.com', 'https://checkip.amazonaws.com']) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) })
      const ip = (await r.text()).trim()
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
        ipCache = { ip, t: Date.now() }
        return ip
      }
    } catch {}
  }
  return ''
}

export const istDomain = (d: unknown): d is string =>
  typeof d === 'string' &&
  d.length <= 253 &&
  /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)

let pending: { domain: string; bis: number } | null = null
let geprueft: { domain: string; bis: number } | null = null
export const pendingDomain = () => (pending && pending.bis > Date.now() ? pending.domain : '')
export const istGeprueft = (domain: string) => !!geprueft && geprueft.bis > Date.now() && geprueft.domain === domain

export interface DomainPruefung {
  ip: string
  dns: { ok: boolean; ips: string[]; error?: string }
  https: { ok: boolean; error?: string }
}

export async function pruefeDomain(domain: string): Promise<DomainPruefung> {
  const ip = await serverIp()
  const erg: DomainPruefung = { ip, dns: { ok: false, ips: [] }, https: { ok: false } }
  try {
    erg.dns.ips = await dns.resolve4(domain)
    erg.dns.ok = !!ip && erg.dns.ips.includes(ip)
    if (!erg.dns.ok)
      erg.dns.error = ip
        ? st(
            `Die Domain zeigt auf ${erg.dns.ips.join(', ')}, nicht auf ${ip}.`,
            `The domain points to ${erg.dns.ips.join(', ')}, not to ${ip}.`
          )
        : st('Die Server-IP konnte nicht ermittelt werden.', 'The server IP could not be determined.')
  } catch {
    erg.dns.error = st(
      'Für diese Domain gibt es noch keinen A-Eintrag. DNS-Änderungen brauchen manchmal ein paar Minuten.',
      'There is no A record for this domain yet. DNS changes sometimes take a few minutes.'
    )
  }
  if (!erg.dns.ok) {
    erg.https.error = st('Erst muss der DNS-Eintrag stimmen.', 'The DNS record must be correct first.')
    return erg
  }

  pending = { domain, bis: Date.now() + 10 * 60_000 }
  const inst = await getInstance()
  let letzter = ''
  for (let versuch = 0; versuch < 4; versuch++) {
    try {
      const r = await fetch(`https://${domain}/api/public/health`, { signal: AbortSignal.timeout(25_000) })
      const j: any = await r.json()
      if (j?.instance === inst.id) {
        erg.https.ok = true
        geprueft = { domain, bis: Date.now() + 30 * 60_000 }
        return erg
      }
      letzter = st('Unter der Domain antwortet ein anderer Server.', 'A different server answers at this domain.')
    } catch (e: any) {
      letzter = String(e?.cause?.code || e?.cause?.message || e?.message || st('unbekannt', 'unknown'))
    }
    await new Promise((r) => setTimeout(r, 4000))
  }
  erg.https.error = st(
    `Das Zertifikat konnte nicht ausgestellt werden (${letzter}). Sind Port 80 und 443 in der Firewall offen?`,
    `The certificate could not be issued (${letzter}). Are ports 80 and 443 open in the firewall?`
  )
  return erg
}

export interface ProxyInfo {
  port: number
  bind: string
  domain: string
}
export function proxyInfo(): ProxyInfo | null {
  const port = Number(process.env.VD_PORT || 0)
  if (!(port > 0 && port < 65536)) return null
  return {
    port,
    bind: (process.env.VD_BIND || '127.0.0.1').trim(),
    domain: (process.env.VD_PROXY_DOMAIN || '').trim().toLowerCase()
  }
}
