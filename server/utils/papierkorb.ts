import { q, q1 } from './db'
import { loeschen } from './speicher'
import { istSlug, neuerName } from './namen'
import type { DateiZeile } from './dateien'
import { variantenLoeschen } from './bildvarianten'

export const TAGE = 30

export async function inPapierkorb(f: Pick<DateiZeile, 'id'>, von: number | null): Promise<boolean> {
  const z = await q1<DateiZeile>('SELECT * FROM files WHERE id = $1', [f.id])
  if (!z) return false
  const tags = await q<{ tag_id: number }>('SELECT tag_id FROM file_tags WHERE file_id = $1', [f.id])
  const alt = await q<{ pfad: string; ziel: string }>('SELECT pfad, ziel FROM alte_pfade WHERE file_id = $1', [f.id])
  await q(
    'INSERT INTO papierkorb (user_id, datei, tags, alte_pfade, geloescht_von) VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5)',
    [z.user_id, JSON.stringify(z), JSON.stringify(tags.map((t) => t.tag_id)), JSON.stringify(alt), von]
  )
  await q('DELETE FROM files WHERE id = $1', [f.id])
  return true
}

export async function wiederherstellen(id: string, userId: number, admin: boolean): Promise<DateiZeile | null> {
  const p = await q1<{
    id: string
    user_id: number
    datei: DateiZeile
    tags: number[]
    alte_pfade: Array<{ pfad: string; ziel: string }>
  }>('SELECT * FROM papierkorb WHERE id = $1', [id])
  if (!p || (p.user_id !== userId && !admin)) return null
  const d = p.datei
  const ordner = d.folder_id && (await q1('SELECT 1 FROM folders WHERE id = $1', [d.folder_id])) ? d.folder_id : null
  let neu: DateiZeile | null = null
  for (let versuch = 0; versuch < 6 && !neu; versuch++) {
    const slug = versuch === 0 && istSlug(d.slug) ? d.slug : neuerName('zufall', { laenge: 8 + versuch })
    try {
      neu = await q1<DateiZeile>(
        `INSERT INTO files (user_id, folder_id, slug, name, original_name, mime, art, size, ablage, sha256, expires_at, max_views, views,
          password_hash, favorite, width, height, duration_ms, created_at, last_view_at, verarbeitung, vorschau, streifen, wellen, exif_entfernt, anfrage_id, von_gast,
          verschluesselt, scan, scan_info, ansicht, live, live_mp4, notiz)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34) RETURNING *`,
        [
          d.user_id,
          ordner,
          slug,
          d.name,
          d.original_name,
          d.mime,
          d.art,
          d.size,
          d.ablage,
          d.sha256,
          d.expires_at,
          d.max_views,
          d.views,
          d.password_hash,
          d.favorite,
          d.width,
          d.height,
          d.duration_ms,
          d.created_at,
          d.last_view_at,
          d.verarbeitung === 'laeuft' ? 'offen' : d.verarbeitung,
          d.vorschau,
          d.streifen,
          d.wellen ? JSON.stringify(d.wellen) : null,
          d.exif_entfernt,
          d.anfrage_id,
          d.von_gast || '',
          !!(d as any).verschluesselt,
          (d as any).scan || '',
          (d as any).scan_info || '',
          !!d.ansicht,
          !!d.live,
          !!d.live_mp4,
          d.notiz || ''
        ]
      )
    } catch (e: any) {
      if (e?.code !== '23505') throw e
    }
  }
  if (!neu) return null
  if (p.tags?.length)
    await q(
      'INSERT INTO file_tags (file_id, tag_id) SELECT $1, t.id FROM tags t WHERE t.id = ANY($2::int[]) AND t.user_id = $3 ON CONFLICT DO NOTHING',
      [neu.id, p.tags, d.user_id]
    )
  for (const a of p.alte_pfade || [])
    await q('INSERT INTO alte_pfade (pfad, file_id, ziel) VALUES ($1, $2, $3) ON CONFLICT (pfad) DO NOTHING', [
      a.pfad,
      neu.id,
      a.ziel
    ])
  await q('DELETE FROM papierkorb WHERE id = $1', [id])
  return neu
}

export async function endgueltig(where: { id?: string; userId?: number; aelterAls?: number }): Promise<number> {
  const bed: string[] = [],
    w: unknown[] = []
  if (where.id) {
    w.push(where.id)
    bed.push(`id = $${w.length}`)
  }
  if (where.userId) {
    w.push(where.userId)
    bed.push(`user_id = $${w.length}`)
  }
  if (where.aelterAls) {
    w.push(String(where.aelterAls))
    bed.push(`geloescht_at < now() - ($${w.length} || ' days')::interval`)
  }
  if (!bed.length) return 0
  const weg = await q<{ id: string; ablage: string; fid: string }>(
    `DELETE FROM papierkorb WHERE ${bed.join(' AND ')} RETURNING id, datei->>'ablage' AS ablage, datei->>'id' AS fid`,
    w
  )
  for (const x of weg) {
    if (x.ablage && !(await q1('SELECT 1 FROM files WHERE ablage = $1', [x.ablage]))) {
      await loeschen(x.ablage)
      if (x.fid) await variantenLoeschen(x.fid)
    }
  }
  return weg.length
}

export const papierkorbAufraeumen = () => endgueltig({ aelterAls: TAGE })
