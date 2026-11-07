import { limit, requireUser } from '../../utils/auth'
import { appGeraetAntwort, appGeraetName } from '../../utils/app'

// Neues App-Token fuer das Geraet, dessen WebView gerade angemeldet ist (normale Web-Anmeldung inkl. 2FA).
// Hoechstens 10 App-Geraete je Nutzer; beim elften wird das am laengsten ungenutzte ersetzt.
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (limit('app-token-user:' + u.id, 20, 600)) {
    setResponseHeader(event, 'Retry-After', 600)
    throw fehler(429, 'Zu viele Anfragen. Bitte warte kurz.', 'Too many requests. Please wait a moment.')
  }
  const b = await readBody(event).catch(() => null)
  return appGeraetAntwort(event, u, appGeraetName(b && typeof b === 'object' ? (b as any).geraet : ''), 'token')
})
