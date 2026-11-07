import { z } from 'zod'
import { ereignis } from '../../utils/db'
import { clientIp, requireOwner } from '../../utils/auth'
import { requirePro } from '../../utils/lizenz'
import { getMon, monToken } from '../../utils/monitoring'
import { setSetting } from '../../utils/settings'

const Body = z.object({
  token_neu: z.boolean().optional(),
  aus: z.boolean().optional(),
  warnungen: z
    .object({
      platteProzent: z.number().min(1).max(50),
      fehlerProzent: z.number().min(0.1).max(100),
      warteschlange: z.number().int().min(10).max(1_000_000)
    })
    .optional()
})
export default defineEventHandler(async (event) => {
  const ich = await requireOwner(event)
  await requirePro('monitoring')
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Ungültige Eingabe.', 'Invalid input.')
  let token: string | undefined
  if (p.data.token_neu) {
    token = await monToken(true)
    await ereignis('settings_changed', ich.id, { monitoring: 'token' }, clientIp(event))
  }
  if (p.data.warnungen || p.data.aus !== undefined) {
    const m = await getMon()
    await setSetting('monitoring', {
      ...m,
      ...(token ? { token } : {}),
      ...(p.data.warnungen ? { warnungen: p.data.warnungen } : {}),
      ...(p.data.aus !== undefined ? { aus: p.data.aus } : {})
    })
  }
  return { ok: true, ...(token ? { token } : {}) }
})
