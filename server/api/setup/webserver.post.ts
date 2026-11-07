import { z } from 'zod'
import { requireSetupToken } from '../../utils/setup'
import { webserverAnfragen } from '../../utils/webserver'
import { istDomain } from '../../utils/netz'

const Body = z.object({
  art: z.enum(['nginx', 'apache']),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .refine((d) => istDomain(d))
})

export default defineEventHandler(async (event) => {
  const roh = await readBody(event)
  await requireSetupToken(event, roh?.token)
  const p = Body.safeParse(roh)
  if (!p.success)
    throw fehler(
      400,
      'Bitte nginx oder Apache wählen und eine gültige Domain eingeben.',
      'Please choose nginx or Apache and enter a valid domain.'
    )
  const id = await webserverAnfragen(p.data.art, p.data.domain)
  console.log(`[vylariscloud] Einrichtung: Webserver (${p.data.art}) fuer ${p.data.domain} beim Dienst angefragt.`)
  return { ok: true, id }
})
