import { q, q1, ereignis } from '../../utils/db'
import { clientIp, requireUser } from '../../utils/auth'
import { ablaufAus } from '../../utils/dateien'
import { aenderbareDateien, ordnerRecht } from '../../utils/teams'
import { inPapierkorb } from '../../utils/papierkorb'
import { webhookAusloesen } from '../../utils/webhooks'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const b = await readBody(event)
  const ids = [
    ...new Set((Array.isArray(b?.ids) ? b.ids : []).map(String).filter((s: string) => /^\d{1,18}$/.test(s)))
  ].slice(0, 500)
  if (!ids.length) throw fehler(400, 'Keine Dateien ausgewählt.', 'No files selected.')
  const eigene = await aenderbareDateien(u.id, ids as string[])
  const e = eigene.map((x) => x.id)
  switch (String(b?.aktion)) {
    case 'loeschen':
      for (const f of eigene) {
        const z = await q1<{ slug: string; name: string }>('SELECT slug, name FROM files WHERE id = $1', [f.id])
        if ((await inPapierkorb(f, u.id)) && z)
          webhookAusloesen(f.user_id, 'file.deleted', {
            file: { id: String(f.id), slug: z.slug, name: z.name },
            trashed: true,
            by: u.username
          })
      }
      await ereignis('files_deleted', u.id, { anzahl: eigene.length }, clientIp(event))
      break
    case 'verschieben': {
      const o = b.wert == null ? null : Number(b.wert)
      if (o != null && !(await ordnerRecht(u.id, o))?.hineinladen)
        throw fehler(404, 'Ordner nicht gefunden.', 'Folder not found.')
      await q('UPDATE files SET folder_id = $1 WHERE id = ANY($2::bigint[])', [o, e])
      break
    }
    case 'ablauf':
      await q('UPDATE files SET expires_at = $1 WHERE id = ANY($2::bigint[])', [b.wert ? ablaufAus(b.wert) : null, e])
      break
    case 'tag_dazu':
      await q(
        'INSERT INTO file_tags (file_id, tag_id) SELECT f, t.id FROM unnest($1::bigint[]) AS f, tags t WHERE t.id = $2 AND t.user_id = $3 ON CONFLICT DO NOTHING',
        [eigene.filter((x) => x.user_id === u.id).map((x) => x.id), Number(b.wert), u.id]
      )
      break
    case 'favorit':
      await q('UPDATE files SET favorite = $1 WHERE id = ANY($2::bigint[])', [!!b.wert, e])
      break
    default:
      throw fehler(400, 'Unbekannte Aktion.', 'Unknown action.')
  }
  return { ok: true, anzahl: eigene.length }
})
