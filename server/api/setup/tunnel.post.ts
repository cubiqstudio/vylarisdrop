import { z } from 'zod'
import { requireSetupToken } from '../../utils/setup'
import { tunnelStarten } from '../../utils/tunnel'

const Body = z.discriminatedUnion('aktion', [
  z.object({
    aktion: z.literal('token'),
    tunnelToken: z.string().max(4000),
    domain: z.string().trim().toLowerCase().max(253)
  }),
  z.object({
    aktion: z.literal('auto'),
    apiToken: z.string().trim().max(200),
    domain: z.string().trim().toLowerCase().max(253),
    ueberschreiben: z.boolean().default(false)
  })
])

export default defineEventHandler(async (event) => {
  const roh = await readBody(event)
  await requireSetupToken(event, roh?.token)
  const p = Body.safeParse(roh)
  if (!p.success) throw fehler(400, 'Ungültige Eingabe.', 'Invalid input.')
  const b = p.data
  const t = await tunnelStarten(
    b.aktion === 'token' ? { aktion: 'token', token: b.tunnelToken, domain: b.domain } : b,
    'einrichtung'
  )
  return { ok: true, domain: t.domain }
})
