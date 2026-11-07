import { q, q1 } from '../../../utils/db'
import { hashPw, requireUser } from '../../../utils/auth'
import { ablaufAus, basisUrl, fuerPanel, type DateiZeile } from '../../../utils/dateien'
import { istSlug } from '../../../utils/namen'
import { ablaufBegrenzen, dateiRecht, ordnerRecht } from '../../../utils/teams'
import { eindeutigerName, mitNamenssperre, sperrSchluessel } from '../../../utils/dateiNamen'
import { teamVonOrdner, verschiebenPruefen } from '../../../utils/quota'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = String(getRouterParam(event, 'id') || '')
  if (!/^\d{1,18}$/.test(id)) throw fehler(400, 'Ungültige ID.', 'Invalid ID.')
  const f = await dateiRecht<DateiZeile>(u.id, id, 'aendern')
  if (!f) throw fehler(404, 'Datei nicht gefunden.', 'File not found.')
  const b = await readBody(event)
  const set: string[] = []
  const w: unknown[] = [id]
  let verschieben: { ordner: number | null; von: number | null } | null = null
  const neu = (sp: string, v: unknown) => {
    w.push(v)
    set.push(`${sp} = $${w.length}`)
  }

  if (typeof b?.name === 'string') {
    const n = b.name
      .replace(/[\u0000-\u001f\\/]/g, '')
      .trim()
      .slice(0, 200)
    if (!n) throw fehler(400, 'Der Name darf nicht leer sein.', 'The name must not be empty.')
    neu('name', n)
  }
  if (typeof b?.slug === 'string' && b.slug !== f.slug) {
    if (!istSlug(b.slug))
      throw fehler(
        400,
        'Der Link-Name darf nur Buchstaben, Ziffern, - und _ enthalten (bis 80 Zeichen).',
        'The link name may only contain letters, digits, - and _ (up to 80 characters).'
      )
    if (await q1('SELECT 1 FROM files WHERE slug = $1', [b.slug]))
      throw fehler(409, 'Dieser Link-Name ist schon vergeben.', 'This link name is already taken.')
    neu('slug', b.slug)
  }
  if ('ordner' in (b || {})) {
    const o = b.ordner == null ? null : Number(b.ordner)
    if (o != null && !(await ordnerRecht(u.id, o))?.hineinladen)
      throw fehler(404, 'Ordner nicht gefunden.', 'Folder not found.')
    neu('folder_id', o)
    // Team-Kontingent: die Datei zählt im Ziel-Team (außer sie liegt dort schon)
    if (o !== f.folder_id) verschieben = { ordner: o, von: await teamVonOrdner(f.folder_id) }
  }
  if ('ablauf' in (b || {})) neu('expires_at', await ablaufBegrenzen(f.user_id, b.ablauf ? ablaufAus(b.ablauf) : null))
  if ('max_aufrufe' in (b || {})) {
    const m = b.max_aufrufe == null || b.max_aufrufe === '' ? null : Math.floor(Number(b.max_aufrufe))
    if (m != null && !(m > 0 && m <= 1_000_000))
      throw fehler(400, 'Max. Aufrufe: 1 bis 1.000.000 oder leer.', 'Max views: 1 to 1,000,000 or empty.')
    neu('max_views', m)
  }
  if (typeof b?.passwort === 'string') neu('password_hash', b.passwort ? await hashPw(b.passwort.slice(0, 200)) : '')
  if (typeof b?.favorit === 'boolean') neu('favorite', b.favorit)
  // Namen im Zielordner eindeutig halten, wenn Name oder Ordner wechseln (Cloud-Dateimanager)
  const neuerOrdner = 'ordner' in (b || {}) ? (b.ordner == null ? null : Number(b.ordner)) : f.folder_id
  const nameIdx = set.findIndex((x) => x.startsWith('name ='))
  const wunsch = nameIdx >= 0 ? String(w[nameIdx + 1]) : f.name
  if (wunsch !== f.name || neuerOrdner !== f.folder_id) {
    await mitNamenssperre(sperrSchluessel(f.user_id, neuerOrdner), async () => {
      const n = await eindeutigerName({ ordnerId: neuerOrdner, userId: f.user_id, name: wunsch, art: 'datei', ausser: f.id })
      if (nameIdx >= 0) w[nameIdx + 1] = n
      else if (n !== f.name) neu('name', n)
    })
  }
  if (set.length) {
    if (set.some((x) => /^(name|folder_id) =/.test(x))) set.push('geaendert_at = now()')
    const sql = `UPDATE files SET ${set.join(', ')} WHERE id = $1`
    if (verschieben) await verschiebenPruefen({ ordner: verschieben.ordner }, Number(f.size), verschieben.von, (x) => x(sql, w))
    else await q(sql, w)
  }

  if (Array.isArray(b?.tags)) {
    const ids = [...new Set(b.tags.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))].slice(0, 30)
    await q('DELETE FROM file_tags WHERE file_id = $1', [id])
    if (ids.length)
      await q(
        'INSERT INTO file_tags (file_id, tag_id) SELECT $1::bigint, t.id FROM tags t WHERE t.user_id = $2 AND t.id = ANY($3::int[]) ON CONFLICT DO NOTHING',
        [id, f.user_id, ids]
      )
  }
  const neuF = (await q1<DateiZeile>('SELECT * FROM files WHERE id = $1', [id]))!
  const tags = await q(
    'SELECT t.id, t.name, t.color FROM file_tags ft JOIN tags t ON t.id = ft.tag_id WHERE ft.file_id = $1',
    [id]
  )
  return { ok: true, file: fuerPanel(await basisUrl(event), neuF, tags) }
})
