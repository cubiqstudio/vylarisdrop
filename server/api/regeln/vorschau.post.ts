import { z } from 'zod'
import { requireUser } from '../../utils/auth'
import { bedingungNorm, vorschau } from '../../utils/regeln'

const Body = z.object({
  name: z.string().trim().max(80).default(''),
  aktiv: z.boolean().default(true),
  geltung: z.enum(['eigen', 'alle']).default('eigen'),
  bedingung: z.record(z.string(), z.any()),
  aktion: z.enum(['papierkorb', 'loeschen', 'archiv']),
  favoriten_schonen: z.boolean().default(true)
})
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Ungültige Regel.', 'Invalid rule.')
  if (p.data.geltung === 'alle' && u.role === 'user') throw fehler(403, 'Nur für Admins.', 'Admins only.')
  return vorschau({
    user_id: u.id,
    geltung: p.data.geltung,
    bedingung: bedingungNorm(p.data.bedingung),
    aktion: p.data.aktion,
    favoriten_schonen: p.data.favoriten_schonen
  })
})
