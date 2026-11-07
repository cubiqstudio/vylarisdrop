import { q, q1 } from '../../../utils/db'
import { requireUser } from '../../../utils/auth'
import { teilSchreiben, type Ort } from '../../../utils/speicher'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = String(getRouterParam(event, 'id') || '')
  const nr = Number(getRouterParam(event, 'nr'))
  const up = await q1<{ teile: number; teil_groesse: number; size: string; speicher: Ort }>(
    'SELECT teile, teil_groesse, size, speicher FROM uploads WHERE id = $1 AND user_id = $2',
    [id, u.id]
  )
  if (!up) throw fehler(404, 'Upload nicht gefunden (abgelaufen?).', 'Upload not found (expired?).')
  if (!Number.isInteger(nr) || nr < 0 || nr >= up.teile)
    throw fehler(400, 'Ungültige Stück-Nummer.', 'Invalid chunk number.')
  const soll = nr === up.teile - 1 ? Number(up.size) - nr * up.teil_groesse : up.teil_groesse
  try {
    await teilSchreiben(id, nr, event.node.req, soll, up.speicher === 's3' ? 's3' : 'lokal')
  } catch (e: any) {
    if (e?.message === 'zu gross')
      throw fehler(400, 'Das Stück ist größer als erwartet.', 'The chunk is larger than expected.')
    if (e?.message === 'unvollstaendig') throw fehler(400, 'Das Stück ist unvollständig.', 'The chunk is incomplete.')
    throw e
  }
  await q(
    `UPDATE uploads SET erhalten = (SELECT to_jsonb(array_agg(DISTINCT x ORDER BY x)) FROM jsonb_array_elements_text(erhalten || to_jsonb($2::int)) AS t(x)) WHERE id = $1`,
    [id, nr]
  )
  return { ok: true }
})
