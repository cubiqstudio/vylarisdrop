import { z } from 'zod'
import { clientIp, limit } from '../../../../utils/auth'
import { antworten, PRODUKT_ID, SCHLUESSEL_FORM, type Aktion } from '../../../../utils/lizenzAussteller'

const AKTIONEN: Aktion[] = ['activate', 'heartbeat', 'deactivate', 'validate']
const Body = z.object({
  key: z.string().max(80),
  product: z.string().max(40).default(PRODUKT_ID),
  hwid: z.string().min(1).max(200),
  name: z.string().max(120).default('')
})

// Lizenzserver-Schnittstelle für andere Installationen (VD_LIZENZ_SERVER = https://<diese Cloud>/lizenz).
// Öffentlich erreichbar, deshalb mit Rate-Limit.
export default defineEventHandler(async (event) => {
  const ip = clientIp(event)
  if (limit('lizenz-pub:' + ip, 120, 60) || limit('lizenz-fehl:' + ip, 600, 3600))
    throw fehler(429, 'Zu viele Anfragen.', 'Too many requests.')
  const aktion = String(getRouterParam(event, 'aktion') || '') as Aktion
  if (!AKTIONEN.includes(aktion)) throw fehler(404, 'Unbekannte Aktion.', 'Unknown action.')
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Ungültige Anfrage.', 'Invalid request.')
  const key = p.data.key.trim().toUpperCase().replace(/\s+/g, '')
  if (!SCHLUESSEL_FORM.test(key)) throw fehler(400, 'Ungültiger Schlüssel.', 'Invalid key.')
  setResponseHeader(event, 'cache-control', 'no-store')
  return antworten(aktion, key, p.data.product, p.data.hwid, p.data.name.slice(0, 80))
})
