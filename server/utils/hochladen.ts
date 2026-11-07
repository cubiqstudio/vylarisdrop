import type { H3Event } from 'h3'
import { q1 } from './db'
import type { Nutzer } from './auth'
import { getUploads, type NamensStil } from './settings'
import type { UploadOptionen } from './dateien'
import { rechteVon } from './teams'

const STILE: NamensStil[] = ['zufall', 'woerter', 'datum', 'original', 'unsichtbar', 'uuid']

export function optionenAus(event: H3Event, felder: Record<string, string> = {}): UploadOptionen {
  const h = (n: string) => String(getRequestHeader(event, `x-vd-${n}`) || felder[n] || '').trim()
  const stil = h('name-style') || h('stil')
  const ordner = Number(h('folder') || h('ordner'))
  const max = Number(h('max-views') || h('max-aufrufe'))
  return {
    stil: STILE.includes(stil as NamensStil) ? (stil as NamensStil) : undefined,
    ordner: Number.isInteger(ordner) && ordner > 0 ? ordner : null,
    ablauf: h('expires') || h('ablauf') || null,
    maxAufrufe: Number.isFinite(max) && max > 0 ? max : null,
    passwort: h('password') || h('passwort') || undefined
  }
}

export async function kontingentVon(u: Nutzer): Promise<number | null> {
  if (u.quota_bytes != null && Number(u.quota_bytes) > 0) return Number(u.quota_bytes)
  const r = await rechteVon(u)
  return r.kontingentGb ? Math.round(r.kontingentGb * 1024 ** 3) : null
}
export async function freierPlatz(u: Nutzer): Promise<number> {
  const k = await kontingentVon(u)
  if (k == null) return Infinity
  const r = await q1<{ s: string }>('SELECT coalesce(sum(size), 0) AS s FROM files WHERE user_id = $1', [u.id])
  return Math.max(0, k - Number(r?.s || 0))
}

export async function maxFuer(u: Nutzer): Promise<number> {
  const cfg = await getUploads()
  const frei = await freierPlatz(u)
  const inst = cfg.maxBytes > 0 ? cfg.maxBytes : Infinity
  const rolle = (await rechteVon(u)).maxDateiMb
  const m = Math.min(frei, inst, rolle ? Math.round(rolle * 1024 ** 2) : Infinity)
  return m === Infinity ? 0 : m > 0 ? m : -1
}
