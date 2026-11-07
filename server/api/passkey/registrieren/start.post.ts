import { requireUser } from '../../../utils/auth'
import { registrierenStart } from '../../../utils/passkeys'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  return registrierenStart(event, u)
})
