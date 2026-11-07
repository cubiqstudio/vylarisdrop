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
})
