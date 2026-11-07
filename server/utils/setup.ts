import { timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { getInstance, setupDone } from './settings'
import { clientIp, limit } from './auth'

export async function requireSetupToken(event: H3Event, token: unknown, zaehler = 'setup', max = 12): Promise<void> {
  if (await setupDone()) throw fehler(409, 'Die Einrichtung ist bereits abgeschlossen.', 'Setup is already complete.')
  if (limit(zaehler + ':' + clientIp(event), max, 600))
    throw fehler(429, 'Zu viele Versuche. Bitte warte 10 Minuten.', 'Too many attempts. Please wait 10 minutes.')
  const soll = Buffer.from((await getInstance()).setupToken)
  const ist = Buffer.from(
    String(token || '')
      .trim()
      .toUpperCase()
  )
  if (soll.length !== ist.length || !timingSafeEqual(soll, ist))
    throw fehler(403, 'Der Setup-Code stimmt nicht.', 'The setup code is not correct.')
}
