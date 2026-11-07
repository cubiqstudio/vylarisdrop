import { requireOwner } from '../../../utils/auth'
import { basisUrl } from '../../../utils/dateien'
import { getSso } from '../../../utils/sso'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const s = await getSso()
  return {
    passwortAus: s.passwortAus,
    basis: await basisUrl(event),
    anbieter: s.anbieter.map((a) => ({ ...a, clientSecret: '', hatGeheimnis: !!a.clientSecret }))
  }
})
