import { q } from './db'
import type { Nutzer } from './auth'
import { fuerPanel, type DateiZeile } from './dateien'
import { meineTeams, ordnerRecht } from './teams'

const SORT: Record<string, string> = {
  neu: 'f.created_at DESC',
  alt: 'f.created_at ASC',
  gross: 'f.size DESC',
  name: 'lower(f.name) ASC',
  aufrufe: 'f.views DESC'
}
export interface ListenFilter {
  seite?: unknown
  pro?: unknown
  art?: unknown
  ordner?: unknown
  tag?: unknown
  team?: unknown
  suche?: unknown
  favoriten?: unknown
  sort?: unknown
}

export async function dateienListe(u: Nutzer, p: ListenFilter, basis: string) {
  const pro = Math.min(200, Math.max(1, Number(p.pro) || 48))
  const seite = Math.max(1, Number(p.seite) || 1)
  const wo: string[] = ['f.user_id = $1']
  const w: unknown[] = [u.id]
  const neu = (v: unknown) => {
    w.push(v)
    return `$${w.length}`
  }
  let leitung = false
  if (['bild', 'video', 'audio', 'text', 'datei'].includes(String(p.art))) wo.push(`f.art = ${neu(String(p.art))}`)
  if (p.ordner === 'ohne') wo.push('f.folder_id IS NULL')
  else if (Number(p.ordner) > 0) {
    const r = await ordnerRecht(u.id, Number(p.ordner))
    if (!r) throw fehler(404, 'Ordner nicht gefunden.', 'Folder not found.')
    if (r.team_id) wo[0] = '$1::int > 0'
    leitung = !!r.leitung
    wo.push(`f.folder_id = ${neu(Number(p.ordner))}`)
  } else if (Number(p.team) > 0) {
    const m = (await meineTeams(u.id)).find((t) => t.team_id === Number(p.team))
    if (!m) throw fehler(404, 'Team nicht gefunden.', 'Team not found.')
    leitung = m.rolle === 'leitung'
    wo[0] = `$1::int > 0 AND f.folder_id IN (SELECT id FROM folders WHERE team_id = ${neu(m.team_id)})`
  }
  if (Number(p.tag) > 0)
    wo.push(`EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id AND ft.tag_id = ${neu(Number(p.tag))})`)
  if (p.favoriten === '1' || p.favoriten === true) wo.push('f.favorite')
  const suche = String(p.suche || '')
    .trim()
    .slice(0, 100)
  if (suche)
    wo.push(`(f.name ILIKE ${neu('%' + suche.replace(/[%_\\]/g, (m) => '\\' + m) + '%')} OR f.slug = ${neu(suche)})`)
  const ordnung = SORT[String(p.sort)] || SORT.neu
  const zeilen = await q<DateiZeile & { gesamt: string; von: string }>(
    `SELECT f.*, u.username AS von, count(*) OVER () AS gesamt FROM files f JOIN users u ON u.id = f.user_id
    WHERE ${wo.join(' AND ')} ORDER BY ${ordnung}, f.id DESC LIMIT ${pro} OFFSET ${(seite - 1) * pro}`,
    w
  )
  const ids = zeilen.map((z) => z.id)
  const tags = ids.length
    ? await q<{ file_id: string; id: number; name: string; color: string }>(
        'SELECT ft.file_id, t.id, t.name, t.color FROM file_tags ft JOIN tags t ON t.id = ft.tag_id WHERE ft.file_id = ANY($1::bigint[])',
        [ids]
      )
    : []
  return {
    gesamt: Number(zeilen[0]?.gesamt || 0),
    seite,
    pro,
    files: zeilen.map((z) => ({
      ...fuerPanel(
        basis,
        z,
        tags.filter((t) => t.file_id === z.id).map(({ id, name, color }) => ({ id, name, color }))
      ),
      ...(z.user_id !== u.id
        ? { von: z.von, eigen: false, darf_aendern: leitung }
        : { eigen: true, darf_aendern: true })
    }))
  }
}
