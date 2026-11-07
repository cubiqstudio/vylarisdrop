import { ereignis } from '../../../utils/db'
import { clientIp, currentUser, sessionStart } from '../../../utils/auth'
import { basisUrl } from '../../../utils/dateien'
import { getSso, kontoFuer, ssoRueckkehr } from '../../../utils/sso'
import { istPro } from '../../../utils/lizenz'
import { st } from '../../../utils/settings'

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '')
  const ip = clientIp(event)
  let verknuepfen = false
  try {
    if (!(await istPro('sso'))) throw new Error(st('SSO ist Teil von VylarisCloud Pro.', 'SSO is part of VylarisCloud Pro.'))
    const a = (await getSso()).anbieter.find((x) => x.id === id && x.aktiv)
    if (!a)
      throw new Error(
        st('Diesen Anmelde-Anbieter gibt es nicht (mehr).', 'This sign-in provider does not exist (anymore).')
      )
    const { id: ident, flug } = await ssoRueckkehr(event, a, await basisUrl(event))
    verknuepfen = !!flug.l
    if (flug.l && (await currentUser(event))?.id !== flug.l)
      throw new Error(st('Bitte erneut anmelden und dann verknüpfen.', 'Please sign in again and then link.'))
    const e = await kontoFuer(a, ident, flug.l)
    if (e.art === 'verknuepft') {
      await ereignis('sso_verknuepft', e.userId, { anbieter: a.id }, ip)
      return sendRedirect(event, '/einstellungen?reiter=konto&sso=verknuepft', 302)
    }
    await sessionStart(event, e.userId)
    await ereignis('login', e.userId, { sso: a.id, neu: e.neu }, ip)
    const ziel = flug.z && flug.z.startsWith('/') && !flug.z.startsWith('//') ? flug.z : '/'
    return sendRedirect(event, ziel, 302)
  } catch (e: any) {
    await ereignis('login_failed', null, { sso: id, grund: String(e?.message || '').slice(0, 120) }, ip)
    const text = encodeURIComponent(
      String(e?.message || st('Anmeldung fehlgeschlagen.', 'Sign-in failed.')).slice(0, 300)
    )
    return sendRedirect(
      event,
      verknuepfen ? `/einstellungen?reiter=konto&sso_fehler=${text}` : `/login?sso_fehler=${text}`,
      302
    )
  }
})
