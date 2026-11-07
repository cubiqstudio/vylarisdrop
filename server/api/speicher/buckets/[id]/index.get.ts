import { q } from '../../../../utils/db'
import { requireUser } from '../../../../utils/auth'
import { bucketLaden, bucketMessen, type Schluessel } from '../../../../utils/buckets'
import { speicherVerlauf } from '../../../../utils/speicherMessung'
import { bucketAnsicht, schluesselAnsicht, speicherAdresse } from '../../../../utils/speicherAnsicht'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  let b = await bucketLaden(getRouterParam(event, 'id'), u)
  try {
    await bucketMessen(b)
    b = await bucketLaden(b.id, u)
  } catch {}
  const s = await q<Schluessel>('SELECT * FROM speicher_schluessel WHERE bucket_id = $1 ORDER BY created_at', [b.id])
  const tage = Number(getQuery(event).tage) || 30
  return {
    bucket: bucketAnsicht({ ...b, schluessel: s.length }),
    schluessel: s.map(schluesselAnsicht),
    verlauf: await speicherVerlauf('bucket', b.id, tage),
    adresse: await speicherAdresse(event)
  }
})
