import { datenUrl, getMarke } from '../../../utils/marke'
import { istPro } from '../../../utils/lizenz'

export default defineEventHandler(async (event) => {
  const art = getRouterParam(event, 'art')
  if (art !== 'logo' && art !== 'icon') throw fehler(404, 'Nicht gefunden.', 'Not found.')
  const m = await getMarke()
  const d = (await istPro('white-label')) ? datenUrl(art === 'logo' ? m.logo : m.icon || m.logo) : null
  if (!d) return sendRedirect(event, '/icon.svg', 302)
  setResponseHeaders(event, {
    'Content-Type': d.typ,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    'Cache-Control': 'public, max-age=86400',
    'Cross-Origin-Resource-Policy': 'cross-origin'
  })
  return d.daten
})
