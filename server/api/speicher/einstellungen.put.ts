import { z } from 'zod'
import { ereignis } from '../../utils/db'
import { clientIp, requireOwner } from '../../utils/auth'
import { setSetting } from '../../utils/settings'

const Body = z.object({
  wer: z.enum(['admins', 'alle']),
  grenzeGb: z.number().int().min(0).max(1_000_000),
  maxAnzahl: z.number().int().min(0).max(1000)
})
export default defineEventHandler(async (event) => {
  const u = await requireOwner(event)
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Ungültige Einstellungen.', 'Invalid settings.')
  await setSetting('speicherdienst', p.data)
  await ereignis('settings_changed', u.id, { bereich: 'speicher' }, clientIp(event))
  return { ok: true }
})
