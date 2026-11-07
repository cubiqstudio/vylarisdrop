import { q, q1 } from '../../utils/db'
import { limit, requireUser } from '../../utils/auth'
import { requireRecht } from '../../utils/teams'
import { QUELLEN, WEGE, type ImportQuelle, type ImportWeg } from '../../utils/importKern'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  await requireRecht(u, 'import')
  if (limit('import:' + u.id, 30, 3600))
    throw fehler(429, 'Zu viele neue Importe in kurzer Zeit.', 'Too many new imports in a short time.')
  const b = await readBody(event)
  const quelle = String(b?.quelle || '') as ImportQuelle
  const weg = String(b?.weg || '') as ImportWeg
  if (!QUELLEN.includes(quelle) || !WEGE[quelle].includes(weg))
    throw fehler(400, 'Unbekannte Quelle oder unbekannter Weg.', 'Unknown source or method.')
  if (
    u.role === 'user' &&
    (weg === 'ordner' || (weg === 'live' && quelle !== 'imgur' && quelle !== 'icloud') || quelle === 'zipline')
  )
    throw fehler(403, 'Diesen Weg dürfen nur Admins nutzen.', 'Only admins can use this method.')
  const offen = await q1<{ n: string }>(
    `SELECT count(*) AS n FROM importe WHERE user_id = $1 AND status IN ('entwurf', 'analyse', 'bereit')`,
    [u.id]
  )
  if (Number(offen?.n || 0) >= 10)
    throw fehler(
      429,
      'Es gibt schon zehn unfertige Importe — bitte erst welche starten oder löschen.',
      'There are already ten unfinished imports — please start or delete some first.'
    )
  const r = await q<{ id: number }>(
    `INSERT INTO importe (user_id, quelle, weg, status, optionen) VALUES ($1, $2, $3, 'entwurf', $4::jsonb) RETURNING id`,
    [u.id, quelle, weg, JSON.stringify({ zielNutzer: u.id })]
  )
  return { ok: true, id: r[0]!.id }
})
