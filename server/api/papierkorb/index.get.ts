import { q } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { TAGE } from '../../utils/papierkorb'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const alle = getQuery(event).alle === '1' && u.role !== 'user'
  const zeilen = await q<any>(
    `SELECT p.id, p.user_id, p.datei, p.geloescht_at, uv.username AS besitzer, ul.username AS von,
      p.geloescht_at + ($2 || ' days')::interval AS weg_am
    FROM papierkorb p JOIN users uv ON uv.id = p.user_id LEFT JOIN users ul ON ul.id = p.geloescht_von
    WHERE ($1::int IS NULL OR p.user_id = $1) ORDER BY p.geloescht_at DESC LIMIT 500`,
    [alle ? null : u.id, String(TAGE)]
  )
  return {
    tage: TAGE,
    dateien: zeilen.map((z) => ({
      id: z.id,
      name: z.datei.name,
      art: z.datei.art,
      mime: z.datei.mime,
      size: Number(z.datei.size),
      slug: z.datei.slug,
      geloescht_at: z.geloescht_at,
      weg_am: z.weg_am,
      besitzer: z.besitzer,
      von: z.von,
      eigen: z.user_id === u.id
    }))
  }
})
