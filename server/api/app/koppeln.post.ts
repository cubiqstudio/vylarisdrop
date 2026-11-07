import { q1 } from '../../utils/db'
import { clientIp } from '../../utils/auth'
import {
  appCodeEinloesen,
  appCodeNormal,
  appGeraetAntwort,
  appGeraetName,
  appKoppelnFehlversuch,
  appKoppelnGesperrt
} from '../../utils/app'

// Die App tauscht einen Kopplungscode gegen ein App-Token. Ohne Anmeldung erreichbar — der Code ist der Beweis.
// Falsche Codes zaehlen je IP (und insgesamt) als Fehlversuch; unbekannt, abgelaufen und benutzt sehen gleich aus (404).
export default defineEventHandler(async (event) => {
  const ip = clientIp(event)
  if (appKoppelnGesperrt(ip)) {
    setResponseHeader(event, 'Retry-After', 600)
    throw fehler(
      429,
      'Zu viele Fehlversuche. Bitte warte 10 Minuten.',
      'Too many failed attempts. Please wait 10 minutes.'
    )
  }
  const b = await readBody(event).catch(() => null)
  if (!b || typeof b !== 'object' || Array.isArray(b))
    throw fehler(400, 'Ungültige Anfrage.', 'Invalid request.')
  const code = appCodeNormal((b as any).code)
  const uid = code ? await appCodeEinloesen(code) : null
  const nutzer = uid
    ? await q1<{ id: number; username: string; role: string }>('SELECT id, username, role FROM users WHERE id = $1', [uid])
    : null
  if (!nutzer) {
    appKoppelnFehlversuch(ip)
    throw fehler(
      404,
      'Der Code ist unbekannt, abgelaufen oder wurde schon benutzt.',
      'The code is unknown, expired or has already been used.'
    )
  }
  return appGeraetAntwort(event, nutzer, appGeraetName((b as any).geraet), 'koppeln')
})
