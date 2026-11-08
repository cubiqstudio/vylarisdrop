import { z } from 'zod'
import { ereignis } from '../../../../../utils/db'
import { clientIp, requireUser } from '../../../../../utils/auth'
import { bucketLaden, schluesselAnlegen } from '../../../../../utils/buckets'
import { schluesselAnsicht } from '../../../../../utils/speicherAnsicht'

const Body = z.object({ name: z.string().trim().min(1).max(60), schreiben: z.boolean().default(true) })
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const b = await bucketLaden(getRouterParam(event, 'id'), u)
  speicherRate(u.id, 'aendern')
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Bitte einen Namen angeben.', 'Please enter a name.')
  const { schluessel, secret } = await schluesselAnlegen(b, p.data.name, p.data.schreiben)
  await ereignis(
    'schluessel_angelegt',
    u.id,
    { bucket: b.name, name: schluessel.name, schreiben: schluessel.schreiben },
    clientIp(event)
  )
  return { ok: true, schluessel: { ...schluesselAnsicht(schluessel), secret } }
})
