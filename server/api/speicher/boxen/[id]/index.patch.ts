import { z } from 'zod'
import { ereignis } from '../../../../utils/db'
import { clientIp, requireUser } from '../../../../utils/auth'
import { GiB, boxAendern, boxLaden, kontingentErlaubt, sshPruefen } from '../../../../utils/boxen'
import { boxAnsicht } from '../../../../utils/speicherAnsicht'

const Body = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  kontingentGb: z.number().min(0.001).max(1_000_000).optional(),
  sftp: z.boolean().optional(),
  webdav: z.boolean().optional(),
  sshKeys: z.array(z.string().max(1500)).max(20).optional()
})
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const b = await boxLaden(Number(getRouterParam(event, 'id')), u)
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Ungültige Angaben.', 'Invalid input.')
  const kontingent = p.data.kontingentGb !== undefined ? Math.round(p.data.kontingentGb * GiB) : undefined
  if (kontingent !== undefined) {
    if (kontingent < Number(b.belegt))
      throw fehler(
        400,
        'Das Kontingent darf nicht kleiner sein als die Belegung.',
        'The quota cannot be smaller than the space in use.'
      )
    await kontingentErlaubt(u, Number(b.kontingent), kontingent)
  }
  const z2 = await boxAendern(b, {
    name: p.data.name,
    kontingent,
    sftp: p.data.sftp,
    webdav: p.data.webdav,
    ssh_keys: p.data.sshKeys !== undefined ? sshPruefen(p.data.sshKeys) : undefined
  })
  await ereignis(
    'box_geaendert',
    u.id,
    { name: z2.name, kennung: z2.kennung, ...(kontingent !== undefined ? { gb: p.data.kontingentGb } : {}) },
    clientIp(event)
  )
  return { ok: true, box: boxAnsicht(z2) }
})
