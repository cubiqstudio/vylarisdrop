import { z } from 'zod'
import { ereignis } from '../../../utils/db'
import { clientIp, requireUser } from '../../../utils/auth'
import { boxAnlegen } from '../../../utils/boxen'
import { boxAnsicht } from '../../../utils/speicherAnsicht'
import { kontingentFelder, kontingentPflicht, nameZ, speicherRate } from '../../../utils/speicherBudget'

// Kontingent: kontingentBytes (ganze Zahl, genau) ODER kontingentGb (Kommazahl, wird abgerundet). Das Budget prüft boxAnlegen unter der Sperre.
const Body = z.object({ name: nameZ(60), ...kontingentFelder })
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  speicherRate(u.id, 'anlegen')
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Bitte Name und Kontingent angeben.', 'Please enter a name and a quota.')
  const kontingent = kontingentPflicht(p.data)
  const { box, passwort } = await boxAnlegen(u, p.data.name, kontingent)
  await ereignis('box_angelegt', u.id, { name: box.name, kennung: box.kennung, bytes: kontingent }, clientIp(event))
  return { ok: true, box: boxAnsicht(box), passwort }
})
