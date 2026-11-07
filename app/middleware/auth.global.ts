// Seiten, die nicht jeder angemeldete Nutzer öffnen darf. Die Navigation blendet sie nur aus; hier wird der Zugriff
// tatsächlich verweigert (auch bei direkter Adresseingabe). Die zugehörigen API-Routen prüfen die Rolle zusätzlich selbst.
const NUR_INHABER = ['/lizenzen', '/sso']
const NUR_ADMIN = ['/nutzer', '/speicher/ziele', '/pro', '/server', '/teams', '/marke', '/sicherung', '/system']
const unter = (pfad: string, liste: string[]) => liste.some((x) => pfad === x || pfad.startsWith(x + '/'))
// Der Router löst /Nutzer, /NUTZER oder /%4eutzer auf dieselbe Seite auf wie /nutzer (Groß-/Kleinschreibung zählt nicht):
// darum wird der Pfad vor jedem Vergleich dekodiert, kleingeschrieben und von doppelten Schrägstrichen befreit.
const normal = (pfad: string) => {
  let p = pfad
  try {
    p = decodeURIComponent(pfad)
  } catch {
    /* ungültige Kodierung: so lassen */
  }
  return p.toLowerCase().replace(/\/{2,}/g, '/')
}

export default defineNuxtRouteMiddleware(async (to) => {
  const theme = useTheme()
  const requestFetch: any = import.meta.server ? useRequestFetch() : $fetch
  try {
    theme.value = await requestFetch('/api/public/theme')
  } catch {
    return
  }
  sprache.value = theme.value.lang === 'en' ? 'en' : 'de'

  const pfad = normal(to.path)
  if (!theme.value.setup) return pfad === '/setup' ? undefined : navigateTo('/setup')
  if (pfad === '/setup') return navigateTo('/login')
  if (pfad.startsWith('/v/') || pfad.startsWith('/a/') || pfad.startsWith('/g/')) return
  if (pfad === '/app/koppeln') return
  if (!theme.value.user && pfad !== '/login') return navigateTo('/login')
  if (theme.value.user && pfad === '/login') return navigateTo('/')
  const rolle = theme.value.user?.role
  if (theme.value.user) {
    if (unter(pfad, NUR_INHABER) && rolle !== 'owner') return navigateTo('/')
    if (unter(pfad, NUR_ADMIN) && rolle !== 'owner' && rolle !== 'admin') return navigateTo('/')
  }
})
