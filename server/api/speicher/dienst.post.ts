import { z } from 'zod'
import { ereignis } from '../../utils/db'
import { clientIp, requireOwner } from '../../utils/auth'
import { speicherAnfragen } from '../../utils/speicherdienst'

const Body = z.object({ an: z.boolean(), port: z.number().int().min(1).max(65535).default(2222) })
export default defineEventHandler(async (event) => {
  const u = await requireOwner(event)
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Bitte einen gültigen Port angeben.', 'Please enter a valid port.')
  await speicherAnfragen(p.data.an, p.data.port, u.username)
  await ereignis(
    p.data.an ? 'speicher_an' : 'speicher_aus',
    u.id,
    p.data.an ? { port: p.data.port } : {},
    clientIp(event)
  )
  return { ok: true }
})
