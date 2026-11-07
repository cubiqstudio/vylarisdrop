import { z } from 'zod'
import { ereignis } from '../../../../utils/db'
import { clientIp, requireUser } from '../../../../utils/auth'
import { GiB, kontingentErlaubt } from '../../../../utils/boxen'
import { bucketKontingent, bucketLaden } from '../../../../utils/buckets'
import { bucketAnsicht } from '../../../../utils/speicherAnsicht'

const Body = z.object({ kontingentGb: z.number().min(0.001).max(1_000_000) })
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const b = await bucketLaden(Number(getRouterParam(event, 'id')), u)
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Bitte ein gültiges Kontingent angeben.', 'Please enter a valid quota.')
  const neu = Math.round(p.data.kontingentGb * GiB)
  await kontingentErlaubt(u, Number(b.kontingent), neu)
  const z2 = await bucketKontingent(b, neu)
  await ereignis('bucket_geaendert', u.id, { name: b.name, gb: p.data.kontingentGb }, clientIp(event))
  return { ok: true, bucket: bucketAnsicht(z2) }
})
