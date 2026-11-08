import { z } from 'zod'
import { ereignis } from '../../utils/db'
import { clientIp, limit, requireUser } from '../../utils/auth'
import { eingabe } from '../../utils/cloudListe'
import { wiederherstellen } from '../../utils/papierkorb'
import { basisUrl, fuerPanel } from '../../utils/dateien'
import { webhookAusloesen } from '../../utils/webhooks'
import { alsApi } from '../../utils/api'
import { quotaStand } from '../../utils/quota'

const Body = z.object({
  papierkorb: z
    .array(z.string().regex(/^\d{1,18}$/))
    .min(1)
    .max(5000)
})

/** Rückgängig: Papierkorb-Einträge einer Aufräum-Aktion wiederherstellen (Rechte wie im Papierkorb: Besitzer oder wer gelöscht hat) */
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (limit('aufraeumen-loeschen:' + u.id, 30, 60)) throw fehler(429, 'Zu viele Aktionen — bitte kurz warten.', 'Too many actions — please wait a moment.')
  const b = eingabe(Body, await readBody(event))
  const ids = [...new Set(b.papierkorb)]
  const basis = await basisUrl(event)
  let ok = 0
  let fehlt = 0
  const arbeiter = async (liste: string[]) => {
    for (const id of liste) {
      const f = await wiederherstellen(id, u.id, false).catch(() => null)
      if (!f) {
        fehlt++
        continue
      }
      ok++
      webhookAusloesen(f.user_id, 'file.restored', { file: alsApi(fuerPanel(basis, f)) })
    }
  }
  await Promise.all(Array.from({ length: 4 }, (_, i) => arbeiter(ids.filter((_x, j) => j % 4 === i))))
  await ereignis('aufraeumen_rueckgaengig', u.id, { anzahl: ok }, clientIp(event))
  const stand = await quotaStand(u)
  return { ok: true, wiederhergestellt: ok, nichtGefunden: fehlt, belegt: { gesamt: stand.used, dateien: stand.used - stand.papierkorb, papierkorb: stand.papierkorb } }
})
