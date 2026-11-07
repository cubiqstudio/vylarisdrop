import { getNet, setupDone } from '../utils/settings'
import { istHttps } from '../utils/auth'
import { knotenGesperrt } from '../utils/knoten'

const OFFEN_VOR_SETUP = /^\/api\/(setup|public|internal)\//
const DATEI_ROUTE = /^\/(r|d|raw)\//

export default defineEventHandler(async (event) => {
  const pfad = (event.path || '/').split('?')[0]!
  setResponseHeaders(event, {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy':
      DATEI_ROUTE.test(pfad) || /^\/(v|g|embed)(\/|$)/.test(pfad)
        ? 'camera=(), microphone=(), geolocation=()'
        : 'camera=(self), microphone=(self), geolocation=()'
  })
  if (!DATEI_ROUTE.test(pfad) && !pfad.startsWith('/v/')) setResponseHeader(event, 'X-Frame-Options', 'DENY')
  if (pfad.startsWith('/api/internal/')) return
  if (knotenGesperrt() && pfad !== '/api/public/health') {
    setResponseStatus(event, 503)
    setResponseHeader(event, 'Retry-After', 300)
    throw fehler(
      503,
      'Mehrere Server gleichzeitig sind Teil von VylarisCloud Pro. Dieser zusätzliche Server pausiert — der erste läuft normal weiter.',
      'Running several servers at once is part of VylarisCloud Pro. This additional server is paused — the first one keeps running normally.'
    )
  }

  const https = istHttps(event)
  if (https) setResponseHeader(event, 'Strict-Transport-Security', 'max-age=31536000; includeSubDomains')

  let fertig = false
  try {
    fertig = await setupDone()
  } catch {
    return
  }

  // Der direkte DAV-Hostname (VD_DAV_HOST) wird nicht auf die Hauptdomain umgeleitet (siehe 00.davhost.ts: dort gilt nur WebDAV, nur HTTPS)
  if (fertig && process.env.VD_DISABLE_HTTPS_REDIRECT !== '1' && !event.context.davHost) {
    const net = await getNet()
    const host = String(getRequestHeader(event, 'host') || '')
      .split(':')[0]!
      .toLowerCase()
    const unverschluesselt = net.mode === 'domain' && net.https && !!net.domain && (!https || host !== net.domain)
    if (unverschluesselt) {
      if (event.method !== 'GET' && event.method !== 'HEAD')
        throw fehler(403, `HTTPS erforderlich: https://${net.domain}`, `HTTPS required: https://${net.domain}`)
      return sendRedirect(event, `https://${net.domain}${event.path || '/'}`, 301)
    }
  }

  if (pfad.startsWith('/api/')) {
    if (!fertig && !OFFEN_VOR_SETUP.test(pfad))
      throw fehler(503, 'Einrichtung noch nicht abgeschlossen', 'Setup not completed yet')
    const m = event.method
    if (m !== 'GET' && m !== 'HEAD') {
      const origin = getRequestHeader(event, 'origin')
      if (origin) {
        let ok = false
        try {
          ok = new URL(origin).host === getRequestHeader(event, 'host')
        } catch {
          ok = false
        }
        if (!ok) throw fehler(403, 'Anfrage von fremder Seite abgelehnt', 'Request from another site rejected')
      }
    }
  }
})
