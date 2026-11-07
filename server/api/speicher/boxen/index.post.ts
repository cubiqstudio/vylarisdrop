import { z } from 'zod'
import { ereignis } from '../../../utils/db'
import { clientIp, requireUser } from '../../../utils/auth'
import { GiB, boxAnlegen } from '../../../utils/boxen'
import { boxAnsicht } from '../../../utils/speicherAnsicht'

const Body = z.object({ name: z.string().trim().min(1).max(60), kontingentGb: z.number().min(0.001).max(1_000_000) })
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Bitte Name und Kontingent angeben.', 'Please enter a name and a quota.')
  const { box, passwort } = await boxAnlegen(u, p.data.name, Math.round(p.data.kontingentGb * GiB))
  await ereignis(
    'box_angelegt',
    u.id,
    { name: box.name, kennung: box.kennung, gb: p.data.kontingentGb },
    clientIp(event)
  )
  return { ok: true, box: boxAnsicht(box), passwort }
})
