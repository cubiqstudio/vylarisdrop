import { q } from '../../../../utils/db'
import { requireUser } from '../../../../utils/auth'
import { boxLaden, boxMessen, type Unterkonto } from '../../../../utils/boxen'
import { speicherVerlauf } from '../../../../utils/speicherMessung'
import { boxAnsicht, speicherAdresse, unterAnsicht } from '../../../../utils/speicherAnsicht'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  let b = await boxLaden(getRouterParam(event, 'id'), u)
  try {
    await boxMessen(b)
    b = await boxLaden(b.id, u)
  } catch {}
  const unter = await q<Unterkonto>('SELECT * FROM speicher_unterkonten WHERE box_id = $1 ORDER BY nr', [b.id])
  const tage = Number(getQuery(event).tage) || 30
  return {
    box: boxAnsicht(b),
    unterkonten: unter.map(unterAnsicht),
    verlauf: await speicherVerlauf('box', b.id, tage),
    adresse: await speicherAdresse(event)
  }
})
