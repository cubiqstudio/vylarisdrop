import { z } from 'zod'
import { ereignis } from '../../../../utils/db'
import { clientIp, requireUser } from '../../../../utils/auth'
import { bucketKontingent, bucketLaden } from '../../../../utils/buckets'
import { bucketAnsicht } from '../../../../utils/speicherAnsicht'
import { kontingentFelder, kontingentPflicht, speicherRate } from '../../../../utils/speicherBudget'

const Body = z.object({ ...kontingentFelder })
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const b = await bucketLaden(getRouterParam(event, 'id'), u)
  speicherRate(u.id, 'aendern')
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Bitte ein gültiges Kontingent angeben.', 'Please enter a valid quota.')
  const neu = kontingentPflicht(p.data)
  const z2 = await bucketKontingent(b, neu, u)
  await ereignis(
    'bucket_geaendert',
    u.id,
    { name: b.name, bytes: neu, ...(b.user_id !== u.id ? { besitzer: b.user_id } : {}) },
    clientIp(event)
  )
  return { ok: true, bucket: bucketAnsicht(z2) }
})
