// Seiten, die nicht jeder angemeldete Nutzer öffnen darf. Die Navigation blendet sie nur aus; hier wird der Zugriff
// tatsächlich verweigert (auch bei direkter Adresseingabe). Die zugehörigen API-Routen prüfen die Rolle zusätzlich selbst.
const NUR_INHABER = ['/lizenzen', '/sso']
const NUR_ADMIN = ['/nutzer', '/speicher/ziele', '/pro', '/server', '/teams', '/marke', '/sicherung', '/system']
const unter = (pfad: string, liste: string[]) => liste.some((x) => pfad === x || pfad.startsWith(x + '/'))

export default defineNuxtRouteMiddleware(async (to) => {
  const theme = useTheme()
  const requestFetch: any = import.meta.server ? useRequestFetch() : $fetch
  try {
    theme.value = await requestFetch('/api/public/theme')
  } catch {
    return
  }
  sprache.value = theme.value.lang === 'en' ? 'en' : 'de'

  if (!theme.value.setup) return to.path === '/setup' ? undefined : navigateTo('/setup')
  if (to.path === '/setup') return navigateTo('/login')
  if (to.path.startsWith('/v/') || to.path.startsWith('/a/') || to.path.startsWith('/g/')) return
  if (to.path === '/app/koppeln') return
  if (!theme.value.user && to.path !== '/login') return navigateTo('/login')
  if (theme.value.user && to.path === '/login') return navigateTo('/')
  const rolle = theme.value.user?.role
  if (theme.value.user) {
    if (unter(to.path, NUR_INHABER) && rolle !== 'owner') return navigateTo('/')
    if (unter(to.path, NUR_ADMIN) && rolle !== 'owner' && rolle !== 'admin') return navigateTo('/')
  }
})
