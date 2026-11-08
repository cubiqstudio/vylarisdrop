import { q, q1, ereignis } from '../../utils/db'
import { clientIp, requireUser } from '../../utils/auth'
import { ablaufAus } from '../../utils/dateien'
import { ablaufBegrenzen, aenderbareDateien, ordnerRecht } from '../../utils/teams'
import { inPapierkorb } from '../../utils/papierkorb'
import { teamVonOrdner, verschiebenPruefen } from '../../utils/quota'
import { ablageUmstellenPruefen } from '../../utils/ablageRegeln'
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
      // Team-Kontingent: Dateien, die noch nicht im Ziel-Team liegen, zählen dort neu
      const ziel = o == null ? null : await teamVonOrdner(o)
      let zuwachs = 0
      if (ziel) {
        const gruppen = await q<{ folder_id: number | null; s: string }>(
          'SELECT folder_id, coalesce(sum(size), 0) AS s FROM files WHERE id = ANY($1::bigint[]) GROUP BY folder_id',
          [e]
        )
        for (const g of gruppen) if ((await teamVonOrdner(g.folder_id)) !== ziel) zuwachs += Number(g.s)
      }
      for (const fid of e) await ablageUmstellenPruefen(u, fid, { ordnerId: o })
      await verschiebenPruefen({ team: ziel }, zuwachs, null, (x) =>
        x('UPDATE files SET folder_id = $1 WHERE id = ANY($2::bigint[])', [o, e])
      )
      break
    }
    case 'ablauf': {
      // Die Rollengrenze „Löschen nach (Tagen)“ gilt je Dateibesitzer auch beim nachträglichen Ändern
      const wunsch = b.wert ? ablaufAus(b.wert) : null
      for (const besitzer of new Set(eigene.map((x) => x.user_id)))
        await q('UPDATE files SET expires_at = $1 WHERE id = ANY($2::bigint[])', [
          await ablaufBegrenzen(besitzer, wunsch),
          eigene.filter((x) => x.user_id === besitzer).map((x) => x.id)
        ])
      break
    }
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
