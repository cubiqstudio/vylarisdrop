import { z } from 'zod'
import { ereignis } from '../../../utils/db'
import { clientIp, requireUser } from '../../../utils/auth'
import { GiB } from '../../../utils/boxen'
import { bucketAnlegen, bucketLoeschen, schluesselAnlegen } from '../../../utils/buckets'
import { bucketAnsicht, schluesselAnsicht } from '../../../utils/speicherAnsicht'

const Body = z.object({
  name: z.string().trim().toLowerCase().min(3).max(63),
  kontingentGb: z.number().min(0.001).max(1_000_000),
  schluessel: z.object({ name: z.string().trim().max(60).default(''), schreiben: z.boolean().default(true) }).optional()
})
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Bitte Name und Kontingent angeben.', 'Please enter a name and a quota.')
  const b = await bucketAnlegen(u, p.data.name, Math.round(p.data.kontingentGb * GiB))
  let neu: Awaited<ReturnType<typeof schluesselAnlegen>> | null = null
  if (p.data.schluessel) {
    try {
      neu = await schluesselAnlegen(b, p.data.schluessel.name || 'Standard', p.data.schluessel.schreiben)
    } catch (e) {
      await bucketLoeschen(b).catch(() => {})
      throw e
    }
  }
  await ereignis('bucket_angelegt', u.id, { name: b.name, gb: p.data.kontingentGb }, clientIp(event))
  return {
    ok: true,
    bucket: bucketAnsicht(b),
    schluessel: neu ? { ...schluesselAnsicht(neu.schluessel), secret: neu.secret } : null
  }
})
