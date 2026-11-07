import { z } from 'zod'
import { ereignis } from '../../utils/db'
import { clientIp, requireOwner } from '../../utils/auth'
import { setSetting } from '../../utils/settings'
import { autoAbbauen, getTunnel, netzUmstellen, tunnelAnfragen, tunnelStarten } from '../../utils/tunnel'
import { dienstKann, dienstZuAlt } from '../../utils/update'

const Body = z.discriminatedUnion('aktion', [
  z.object({
    aktion: z.literal('token'),
    token: z.string().max(4000),
    domain: z.string().trim().toLowerCase().max(253)
  }),
  z.object({
    aktion: z.literal('auto'),
    apiToken: z.string().trim().max(200).optional(),
    domain: z.string().trim().toLowerCase().max(253),
    ueberschreiben: z.boolean().default(false)
  }),
  z.object({ aktion: z.literal('aus') }),
  z.object({ aktion: z.literal('abbauen') })
])

export default defineEventHandler(async (event) => {
  const ich = await requireOwner(event)
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Ungültige Eingabe.', 'Invalid input.')
  const b = p.data
  const alt = await getTunnel()
  const ip = clientIp(event)
  const dienstPruefen = async () => {
    if (!(await dienstKann('tunnel'))) throw dienstZuAlt()
  }

  if (b.aktion === 'token' || b.aktion === 'auto') {
    const neu = await tunnelStarten(b, ich.username)
    await ereignis('tunnel_an', ich.id, { modus: neu.modus, domain: neu.domain }, ip)
    return { ok: true, domain: neu.domain }
  }

  if (b.aktion === 'aus') {
    if (!alt?.an) return { ok: true }
    await dienstPruefen()
    await tunnelAnfragen(false, '', ich.username)
    await setSetting('tunnel', { ...(await netzUmstellen(alt, false)), an: false })
    await ereignis('tunnel_aus', ich.id, { domain: alt.domain }, ip)
    return { ok: true }
  }

  if (!alt?.auto)
    throw fehler(400, 'Es gibt keinen von VylarisCloud angelegten Tunnel.', 'There is no tunnel created by VylarisCloud.')
  if (alt.an) throw fehler(409, 'Bitte den Tunnel zuerst ausschalten.', 'Please turn the tunnel off first.')
  await autoAbbauen(alt.auto)
  await setSetting('tunnel', { an: false, modus: 'auto', domain: alt.domain, token: '', netVorher: null })
  await ereignis('tunnel_abgebaut', ich.id, { domain: alt.domain }, ip)
  return { ok: true }
})
