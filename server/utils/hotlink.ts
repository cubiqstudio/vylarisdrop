import type { H3Event } from 'h3'
import { getAuslieferung, getNet } from './settings'

export function domainPasst(host: string, eintrag: string): boolean {
  const e = eintrag
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/:].*$/, '')
  if (!e) return false
  if (e.startsWith('*.')) return host.endsWith(e.slice(1))
  return host === e || host.endsWith('.' + e)
}

export async function hotlinkPruefen(event: H3Event): Promise<void> {
  const cfg = await getAuslieferung()
  if (!cfg.hotlink) return
  const ref = String(getRequestHeader(event, 'referer') || '').trim()
  if (!ref) {
    if (cfg.ohneHerkunft) return
    throw fehler(
      403,
      'Diese Datei darf nur auf erlaubten Websites eingebunden werden.',
      'This file may only be embedded on allowed websites.'
    )
  }
  let host = ''
  try {
    host = new URL(ref).hostname.toLowerCase()
  } catch {}
  const eigen = [
    String(getRequestHeader(event, 'x-forwarded-host') || getRequestHeader(event, 'host') || '')
      .split(',')[0]!
      .trim()
      .replace(/:\d+$/, '')
      .toLowerCase(),
    (await getNet()).domain.toLowerCase()
  ].filter(Boolean)
  if (host && (eigen.includes(host) || cfg.erlaubt.some((e) => domainPasst(host, e)))) return
  throw fehler(
    403,
    'Diese Datei darf nur auf erlaubten Websites eingebunden werden.',
    'This file may only be embedded on allowed websites.'
  )
}
