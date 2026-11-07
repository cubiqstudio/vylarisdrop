import { z } from 'zod'
import { ereignis } from '../../../utils/db'
import { clientIp, limit, requireOwner } from '../../../utils/auth'
import {
  lizenzAktivieren,
  lizenzAnsicht,
  lizenzEntfernen,
  lizenzPruefen,
  offlineEinspielen
} from '../../../utils/lizenz'

const Body = z.discriminatedUnion('aktion', [
  z.object({ aktion: z.literal('aktivieren'), schluessel: z.string().min(5).max(80) }),
  z.object({ aktion: z.literal('pruefen') }),
  z.object({ aktion: z.literal('offline'), datei: z.string().min(10).max(30_000) }),
  z.object({ aktion: z.literal('entfernen') })
])

export default defineEventHandler(async (event) => {
  const ich = await requireOwner(event)
  if (limit('lizenz:' + ich.id, 20, 600))
    throw fehler(429, 'Zu viele Versuche — bitte kurz warten.', 'Too many attempts — please wait a moment.')
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Ungültige Anfrage.', 'Invalid request.')
  const b = p.data
  if (b.aktion === 'aktivieren') await lizenzAktivieren(b.schluessel)
  else if (b.aktion === 'pruefen') await lizenzPruefen(true)
  else if (b.aktion === 'offline') await offlineEinspielen(b.datei)
  else {
    const r = await lizenzEntfernen()
    await ereignis('lizenz_entfernt', ich.id, { freigegeben: r.freigegeben }, clientIp(event))
    return { ok: true, freigegeben: r.freigegeben, ...(await lizenzAnsicht()) }
  }
  await ereignis('lizenz_' + b.aktion, ich.id, {}, clientIp(event))
  return { ok: true, ...(await lizenzAnsicht()) }
})
