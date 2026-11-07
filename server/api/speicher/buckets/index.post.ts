import { z } from 'zod'
import { ereignis } from '../../../utils/db'
import { clientIp, requireUser } from '../../../utils/auth'
import { bucketAnlegen, bucketLoeschen, schluesselAnlegen } from '../../../utils/buckets'
import { bucketAnsicht, schluesselAnsicht } from '../../../utils/speicherAnsicht'
import { kontingentFelder, kontingentPflicht, nameZ, speicherRate } from '../../../utils/speicherBudget'

const Body = z.object({
  name: z.string().trim().toLowerCase().min(3).max(63),
  ...kontingentFelder,
  schluessel: z.object({ name: nameZ(60).default('Standard'), schreiben: z.boolean().default(true) }).optional()
})
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  speicherRate(u.id, 'anlegen')
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Bitte Name und Kontingent angeben.', 'Please enter a name and a quota.')
  const kontingent = kontingentPflicht(p.data)
  const b = await bucketAnlegen(u, p.data.name, kontingent)
  let neu: Awaited<ReturnType<typeof schluesselAnlegen>> | null = null
  if (p.data.schluessel) {
    try {
      neu = await schluesselAnlegen(b, p.data.schluessel.name || 'Standard', p.data.schluessel.schreiben)
    } catch (e) {
      await bucketLoeschen(b).catch(() => {})
      throw e
    }
  }
  await ereignis('bucket_angelegt', u.id, { name: b.name, bytes: kontingent }, clientIp(event))
  return {
    ok: true,
    bucket: bucketAnsicht(b),
    schluessel: neu ? { ...schluesselAnsicht(neu.schluessel), secret: neu.secret } : null
  }
})
