import { z } from 'zod'
import { setSetting } from '../../utils/settings'
import { ereignis } from '../../utils/db'
import { clientIp, requireOwner } from '../../utils/auth'
import { clamStatus, scanArbeiten } from '../../utils/virenscan'
import { dienstKann, virenscanAnfragen } from '../../utils/update'

const Body = z.object({ an: z.boolean() })
export default defineEventHandler(async (event) => {
  const ich = await requireOwner(event)
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Ungültige Eingabe.', 'Invalid input.')
  const { an } = p.data
  const c = await clamStatus()
  let dienst: 'angefragt' | 'laeuft-schon' | 'manuell' = 'laeuft-schon'
  if (an !== c.erreichbar) {
    if (await dienstKann('virenscan')) {
      await virenscanAnfragen(an, ich.username)
      dienst = 'angefragt'
    } else dienst = 'manuell'
  }
  await setSetting('virenscan', { an })
  await ereignis('settings_changed', ich.id, { virenscan: an }, clientIp(event))
  if (an && c.erreichbar) void scanArbeiten().catch(() => {})
  return { an, dienst }
})
