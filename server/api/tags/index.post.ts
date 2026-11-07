import { q } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { istHex } from '../../utils/settings'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const b = await readBody(event)
  const name = String(b?.name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9äöüß_-]/g, '')
    .slice(0, 30)
  if (!name)
    throw fehler(
      400,
      'Bitte einen Namen eingeben (Buchstaben, Ziffern, - und _).',
      'Please enter a name (letters, digits, - and _).'
    )
  const color = istHex(b?.color) ? b.color.toLowerCase() : '#1e73be'
  const r = await q(
    'INSERT INTO tags (user_id, name, color) VALUES ($1, $2, $3) ON CONFLICT (user_id, name) DO UPDATE SET color = EXCLUDED.color RETURNING id, name, color',
    [u.id, name, color]
  )
  return { ok: true, tag: { ...r[0], anzahl: 0 } }
})
