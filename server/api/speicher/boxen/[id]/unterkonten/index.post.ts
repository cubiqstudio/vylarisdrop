import { z } from 'zod'
import { ereignis } from '../../../../../utils/db'
import { clientIp, requireUser } from '../../../../../utils/auth'
import { boxLaden, unterkontoAnlegen } from '../../../../../utils/boxen'
import { unterAnsicht } from '../../../../../utils/speicherAnsicht'

const Body = z.object({
  ordner: z.string().trim().min(1).max(63),
  schreiben: z.boolean().default(true),
  notiz: z.string().trim().max(120).default('')
})
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const b = await boxLaden(Number(getRouterParam(event, 'id')), u)
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Bitte einen Ordner angeben.', 'Please enter a folder.')
  const { konto, passwort } = await unterkontoAnlegen(b, p.data)
  await ereignis(
    'unterkonto_angelegt',
    u.id,
    { box: b.kennung, login: konto.login, ordner: konto.ordner, schreiben: konto.schreiben },
    clientIp(event)
  )
  return { ok: true, konto: unterAnsicht(konto), passwort }
})
