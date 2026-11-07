import { z } from 'zod'
import { ereignis } from '../../../../utils/db'
import { clientIp, requireUser } from '../../../../utils/auth'
import { boxAendern, boxLaden, sshPruefen } from '../../../../utils/boxen'
import { boxAnsicht } from '../../../../utils/speicherAnsicht'
import { kontingentBytesAus, kontingentFelder, nameZ, speicherRate } from '../../../../utils/speicherBudget'

const Body = z.object({
  name: nameZ(60).optional(),
  ...kontingentFelder,
  sftp: z.boolean().optional(),
  webdav: z.boolean().optional(),
  sshKeys: z.array(z.string().max(1500)).max(20).optional()
})
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const b = await boxLaden(getRouterParam(event, 'id'), u)
  speicherRate(u.id, 'aendern')
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Ungültige Angaben.', 'Invalid input.')
  const kontingent = kontingentBytesAus(p.data)
  if (kontingent !== undefined && !Number.isSafeInteger(kontingent)) throw fehler(400, 'Ungültige Angaben.', 'Invalid input.')
  // Budget- und Belegungsprüfung (Vergrößern/Verkleinern) macht boxAendern unter der Konto-Sperre des Besitzers
  const z2 = await boxAendern(
    b,
    {
      name: p.data.name,
      kontingent,
      sftp: p.data.sftp,
      webdav: p.data.webdav,
      ssh_keys: p.data.sshKeys !== undefined ? sshPruefen(p.data.sshKeys) : undefined
    },
    u
  )
  await ereignis(
    'box_geaendert',
    u.id,
    { name: z2.name, kennung: z2.kennung, ...(kontingent !== undefined ? { bytes: kontingent } : {}), ...(b.user_id !== u.id ? { besitzer: b.user_id } : {}) },
    clientIp(event)
  )
  return { ok: true, box: boxAnsicht(z2) }
})
