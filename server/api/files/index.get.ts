import { requireUser } from '../../utils/auth'
import { basisUrl } from '../../utils/dateien'
import { dateienListe } from '../../utils/liste'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  return dateienListe(u, getQuery(event), await basisUrl(event))
})
