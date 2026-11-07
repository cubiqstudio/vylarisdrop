import { requireUser } from '../../utils/auth'
import { basisUrl } from '../../utils/dateien'
import { cloudListe, eingabe, ListenFrage } from '../../utils/cloudListe'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const p = eingabe(ListenFrage, getQuery(event))
  return cloudListe(u, p, await basisUrl(event))
})
