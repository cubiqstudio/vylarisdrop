import { currentUser } from '../../../utils/auth'
import { basisUrl } from '../../../utils/dateien'
import { getSso, ssoStart } from '../../../utils/sso'
import { istPro } from '../../../utils/lizenz'
import { st } from '../../../utils/settings'

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '')
  const fehlerZurueck = (text: string) => sendRedirect(event, `/login?sso_fehler=${encodeURIComponent(text)}`, 302)
  if (!(await istPro('sso'))) return fehlerZurueck(st('SSO ist Teil von VylarisCloud Pro.', 'SSO is part of VylarisCloud Pro.'))
  const a = (await getSso()).anbieter.find((x) => x.id === id && x.aktiv)
  if (!a)
    return fehlerZurueck(
      st('Diesen Anmelde-Anbieter gibt es nicht (mehr).', 'This sign-in provider does not exist (anymore).')
    )
  const ich = getQuery(event).verknuepfen === '1' ? await currentUser(event) : null
  try {
    return sendRedirect(
      event,
      await ssoStart(event, a, await basisUrl(event), ich?.id ?? null, ich ? '/einstellungen?reiter=konto' : '/'),
      302
    )
  } catch (e: any) {
    return fehlerZurueck(e.message)
  }
})
