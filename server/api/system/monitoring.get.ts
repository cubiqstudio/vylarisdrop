import { requireAdmin } from '../../utils/auth'
import { istPro } from '../../utils/lizenz'
import { getMon, verlauf, zustand } from '../../utils/monitoring'
import { basisUrl } from '../../utils/dateien'

export default defineEventHandler(async (event) => {
  const u = await requireAdmin(event)
  const pro = await istPro('monitoring')
  if (!pro) return { pro }
  const st = [1, 6, 24, 168].includes(Number(getQuery(event).stunden)) ? Number(getQuery(event).stunden) : 1
  const m = await getMon()
  return {
    pro,
    stunden: st,
    zustand: await zustand(),
    verlauf: await verlauf(st),
    warnungen: m.warnungen,
    aus: m.aus,
    ...(u.role === 'owner' ? { token: m.token, metrikUrl: `${await basisUrl(event)}/metrics` } : {})
  }
})
