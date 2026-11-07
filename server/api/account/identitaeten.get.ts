import { requireUser } from '../../utils/auth'
import { identitaetenVon, ssoFuerLogin } from '../../utils/sso'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  return { verknuepft: await identitaetenVon(u), verfuegbar: (await ssoFuerLogin()).anbieter }
})
