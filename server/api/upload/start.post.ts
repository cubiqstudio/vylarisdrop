import { randomBytes } from 'node:crypto'
import { q } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { zielOrt } from '../../utils/speicher'
import { maxFuer } from '../../utils/hochladen'
import { requireRecht } from '../../utils/teams'

const TEIL = 8 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  await requireRecht(u, 'hochladen')
  const b = await readBody(event)
  const name = String(b?.name || 'datei').slice(0, 200)
  const size = Number(b?.size)
  if (!Number.isSafeInteger(size) || size <= 0) throw fehler(400, 'Ungültige Dateigröße.', 'Invalid file size.')
  const max = await maxFuer(u)
  if (max !== 0 && size > max)
    throw fehler(
      413,
      'Die Datei ist zu groß oder dein Speicher ist voll.',
      'The file is too large or your storage is full.'
    )
  const offen = await q<{ n: string }>('SELECT count(*) AS n FROM uploads WHERE user_id = $1', [u.id])
  if (Number(offen[0]?.n || 0) >= 20)
    throw fehler(
      429,
      'Zu viele unvollständige Uploads. Bitte zuerst abschließen oder abbrechen.',
      'Too many unfinished uploads. Please finish or cancel them first.'
    )
  const id = randomBytes(12).toString('hex')
  const teile = Math.ceil(size / TEIL)
  const optionen = typeof b?.optionen === 'object' && b.optionen ? b.optionen : {}
  await q(
    'INSERT INTO uploads (id, user_id, name, size, mime, teile, teil_groesse, optionen, speicher) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)',
    [id, u.id, name, size, String(b?.mime || '').slice(0, 120), teile, TEIL, JSON.stringify(optionen), await zielOrt()]
  )
  return { id, teilGroesse: TEIL, teile }
})
