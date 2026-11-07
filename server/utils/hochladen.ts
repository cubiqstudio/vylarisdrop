import type { H3Event } from 'h3'
import type { Nutzer } from './auth'
import { getUploads, type NamensStil } from './settings'
import type { UploadOptionen } from './dateien'
import { rechteVon } from './teams'
import { quotaStand, teamStand, teamVonOrdner, wirksamesKontingent } from './quota'

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

// Kontingent-Logik liegt in quota.ts (Vererbung, Papierkorb, Team-Kontingent). Diese Funktionen bleiben als
// stabile Schnittstelle bestehen (Signaturen kompatibel; `ordnerId` ist optional und zieht das Team-Kontingent mit ein).

/** Wirksames Kontingent in Bytes; null = unbegrenzt */
export async function kontingentVon(u: Nutzer): Promise<number | null> {
  return (await wirksamesKontingent(u)).limit
}
/** Freier Platz in Bytes (Infinity = unbegrenzt); mit `ordnerId` auch durch das Team-Kontingent des Ordners begrenzt */
export async function freierPlatz(u: Nutzer, ordnerId?: number | null): Promise<number> {
  const s = await quotaStand(u)
  let frei = s.free == null ? Infinity : s.free
  const team = ordnerId ? await teamVonOrdner(ordnerId) : null
  if (team) {
    const t = await teamStand(team)
    if (t?.free != null) frei = Math.min(frei, t.free)
  }
  return frei
}

/** Größte erlaubte Dateigröße für diesen Upload (0 = ohne Grenze, -1 = nichts mehr frei) */
export async function maxFuer(u: Nutzer, ordnerId?: number | null): Promise<number> {
  const cfg = await getUploads()
  const frei = await freierPlatz(u, ordnerId)
  const inst = cfg.maxBytes > 0 ? cfg.maxBytes : Infinity
  const rolle = (await rechteVon(u)).maxDateiMb
  const m = Math.min(frei, inst, rolle ? Math.round(rolle * 1024 ** 2) : Infinity)
  return m === Infinity ? 0 : m > 0 ? m : -1
}

/** Instanz- und Rollen-Grenze für die Dateigröße (ohne Kontingent), Infinity = keine */
export async function dateiGroesseMax(u: Nutzer): Promise<number> {
  const cfg = await getUploads()
  const rolle = (await rechteVon(u)).maxDateiMb
  return Math.min(cfg.maxBytes > 0 ? cfg.maxBytes : Infinity, rolle ? Math.round(rolle * 1024 ** 2) : Infinity)
}
