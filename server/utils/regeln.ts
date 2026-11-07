import { q, q1, ereignis } from './db'
import { dateiLoeschen, type DateiZeile } from './dateien'
import { inPapierkorb } from './papierkorb'
import { eineVerschieben } from './umzug'
import { getSpeicher } from './s3'
import { istPro } from './lizenz'
import { webhookAusloesen } from './webhooks'

export type Aktion = 'papierkorb' | 'loeschen' | 'archiv'
export interface Bedingung {
  ordner_id?: number | null
  art?: string | null
  aelter_als_tage?: number | null
  ohne_aufruf_tage?: number | null
  groesser_als_mb?: number | null
}
export interface Regel {
  id: number
  user_id: number | null
  von: number
  name: string
  aktiv: boolean
  geltung: 'eigen' | 'alle'
  bedingung: Bedingung
  aktion: Aktion
  favoriten_schonen: boolean
}
const MAX_JE_LAUF = 5000

export async function archivMoeglich(): Promise<boolean> {
  const w = await getSpeicher()
  return !!w.s3?.bucket && (await istPro('s3'))
}

export function bedingungNorm(b: any): Bedingung {
  const zahl = (v: unknown, max: number) =>
    v === null || v === undefined || v === ''
      ? null
      : Number.isFinite(Number(v)) && Number(v) > 0
        ? Math.min(max, Math.floor(Number(v)))
        : null
  const n: Bedingung = {
    ordner_id: zahl(b?.ordner_id, 2_000_000_000),
    art: ['bild', 'video', 'audio', 'text', 'datei'].includes(b?.art) ? b.art : null,
    aelter_als_tage: zahl(b?.aelter_als_tage, 36500),
    ohne_aufruf_tage: zahl(b?.ohne_aufruf_tage, 36500),
    groesser_als_mb: b?.groesser_als_mb
      ? Math.min(10_000_000, Math.max(0.01, Number(b.groesser_als_mb) || 0)) || null
      : null
  }
  if (!n.aelter_als_tage && !n.ohne_aufruf_tage)
    throw fehler(
      400,
      'Bitte mindestens „älter als“ oder „nicht aufgerufen seit“ angeben.',
      'Please set at least “older than” or “not viewed for”.'
    )
  return n
}

function filter(r: Pick<Regel, 'user_id' | 'geltung' | 'bedingung' | 'aktion' | 'favoriten_schonen'>): {
  wo: string
  w: unknown[]
} {
  const w: unknown[] = []
  const p = (v: unknown) => {
    w.push(v)
    return `$${w.length}`
  }
  const wo: string[] = ["f.scan <> 'laeuft'"]
  if (r.geltung !== 'alle') wo.push(`f.user_id = ${p(r.user_id)}`)
  const b = r.bedingung
  if (b.ordner_id)
    wo.push(
      `f.folder_id IN (WITH RECURSIVE unter(id) AS (SELECT ${p(b.ordner_id)}::int UNION SELECT o.id FROM folders o JOIN unter ON o.parent_id = unter.id) SELECT id FROM unter)`
    )
  if (b.art) wo.push(`f.art = ${p(b.art)}`)
  if (b.aelter_als_tage) wo.push(`f.created_at < now() - (${p(String(b.aelter_als_tage))} || ' days')::interval`)
  if (b.ohne_aufruf_tage)
    wo.push(`coalesce(f.last_view_at, f.created_at) < now() - (${p(String(b.ohne_aufruf_tage))} || ' days')::interval`)
  if (b.groesser_als_mb) wo.push(`f.size > ${p(Math.round(b.groesser_als_mb * 1024 * 1024))}`)
  if (r.favoriten_schonen) wo.push('NOT f.favorite')
  if (r.aktion === 'archiv') wo.push("f.ablage NOT LIKE 's3:%'")
  return { wo: wo.join(' AND '), w }
}

export async function vorschau(r: Pick<Regel, 'user_id' | 'geltung' | 'bedingung' | 'aktion' | 'favoriten_schonen'>) {
  const { wo, w } = filter(r)
  const s = await q1<{ n: string; b: string }>(
    `SELECT count(*) AS n, coalesce(sum(f.size), 0) AS b FROM files f WHERE ${wo}`,
    w
  )
  const beispiele = await q<{
    id: string
    name: string
    size: string
    created_at: string
    last_view_at: string | null
    von: string
  }>(
    `SELECT f.id, f.name, f.size, f.created_at, f.last_view_at, u.username AS von FROM files f JOIN users u ON u.id = f.user_id WHERE ${wo} ORDER BY f.created_at LIMIT 20`,
    w
  )
  return {
    anzahl: Number(s?.n || 0),
    bytes: Number(s?.b || 0),
    beispiele: beispiele.map((x) => ({ ...x, size: Number(x.size) }))
  }
}

export async function ausfuehren(r: Regel): Promise<{ anzahl: number; bytes: number; fehler: number }> {
  if (r.aktion === 'archiv' && !(await archivMoeglich())) return { anzahl: 0, bytes: 0, fehler: 0 }
  const { wo, w } = filter(r)
  const treffer = await q<DateiZeile>(
    `SELECT f.* FROM files f WHERE ${wo} ORDER BY f.created_at LIMIT ${MAX_JE_LAUF}`,
    w
  )
  let anzahl = 0,
    bytes = 0,
    fehler = 0
  for (const f of treffer) {
    try {
      if (r.aktion === 'papierkorb') {
        if (!(await inPapierkorb(f, r.von))) continue
      } else if (r.aktion === 'loeschen') await dateiLoeschen(f)
      else await eineVerschieben(f, 's3')
      anzahl++
      bytes += Number(f.size)
    } catch (e: any) {
      fehler++
      console.warn('[vylariscloud] Regel', r.id, e?.message)
    }
  }
  await q('UPDATE regeln SET zuletzt_at = now(), zuletzt_anzahl = $2, zuletzt_bytes = $3 WHERE id = $1', [
    r.id,
    anzahl,
    bytes
  ])
  if (anzahl) {
    await ereignis('regel_lauf', r.von, { name: r.name.slice(0, 60), aktion: r.aktion, anzahl, bytes })
    webhookAusloesen(r.von, 'rule.applied', {
      rule: {
        id: r.id,
        name: r.name,
        action: { papierkorb: 'trash', loeschen: 'delete', archiv: 'archive' }[r.aktion]
      },
      files: anzahl,
      bytes
    })
  }
  return { anzahl, bytes, fehler }
}

export async function regelnAusfuehren(): Promise<void> {
  const alle = await q<Regel>('SELECT * FROM regeln WHERE aktiv ORDER BY id')
  for (const r of alle) await ausfuehren(r).catch((e) => console.warn('[vylariscloud] Regel', r.id, e?.message))
}
