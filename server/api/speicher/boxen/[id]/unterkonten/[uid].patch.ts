import { z } from 'zod'
import { ereignis } from '../../../../../utils/db'
import { clientIp, requireUser } from '../../../../../utils/auth'
import { boxLaden, sshPruefen, unterkontoAendern, unterkontoLaden } from '../../../../../utils/boxen'
import { unterAnsicht } from '../../../../../utils/speicherAnsicht'

const Body = z.object({
  schreiben: z.boolean().optional(),
  notiz: z.string().trim().max(120).optional(),
  sshKeys: z.array(z.string().max(1500)).max(20).optional(),
  passwort: z.boolean().optional()
})
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const b = await boxLaden(Number(getRouterParam(event, 'id')), u)
  const k = await unterkontoLaden(b, Number(getRouterParam(event, 'uid')))
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Ungültige Angaben.', 'Invalid input.')
  const r = await unterkontoAendern(b, k, {
    schreiben: p.data.schreiben,
    notiz: p.data.notiz,
    ssh_keys: p.data.sshKeys !== undefined ? sshPruefen(p.data.sshKeys) : undefined,
    passwort: p.data.passwort
  })
  await ereignis(
    p.data.passwort ? 'unterkonto_passwort' : 'unterkonto_geaendert',
    u.id,
    { box: b.kennung, login: k.login },
    clientIp(event)
  )
  return { ok: true, konto: unterAnsicht(r.konto), passwort: r.passwort }
})
