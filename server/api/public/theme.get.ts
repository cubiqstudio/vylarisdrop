import { getDesign, ladeSprache, setupDone } from '../../utils/settings'
import { proxyInfo } from '../../utils/netz'
import { currentUser } from '../../utils/auth'
import { markeFuerSeite } from '../../utils/marke'
import { ssoFuerLogin } from '../../utils/sso'
import { istPro } from '../../utils/lizenz'

export default defineEventHandler(async (event) => {
  const d = await getDesign()
  const setup = await setupDone()
  const lang = await ladeSprache()
  const u = setup ? await currentUser(event) : null
  return {
    setup,
    color: d.color,
    name: d.name || 'VylarisCloud',
    lang: u?.prefs?.lang === 'en' || u?.prefs?.lang === 'de' ? u.prefs.lang : lang,
    user: u
      ? {
          id: u.id,
          username: u.username,
          role: u.role,
          theme: u.prefs?.theme === 'light' ? 'light' : u.prefs?.theme === 'system' ? 'system' : 'dark'
        }
      : null,
    pro: setup ? await istPro() : false,
    marke: await markeFuerSeite(),
    sso: setup ? await ssoFuerLogin() : { anbieter: [], passwortAus: false },
    ...(setup ? {} : { proxy: proxyInfo() })
  }
})
