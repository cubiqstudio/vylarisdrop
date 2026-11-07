import { ereignis } from '../../utils/db'
import { clientIp, limit, requireOwner } from '../../utils/auth'
import { updateAnfragen, updateStand, versionPruefen } from '../../utils/update'

export default defineEventHandler(async (event) => {
  const ich = await requireOwner(event)
  if (limit('update:' + ich.id, 20, 600))
    throw fehler(429, 'Zu viele Versuche — bitte kurz warten.', 'Too many attempts — please wait a moment.')
  const aktion = (await readBody(event))?.aktion
  if (aktion === 'pruefen') {
    await versionPruefen(true)
    return updateStand()
  }
  if (aktion === 'starten') {
    const s = await updateStand()
    await updateAnfragen(s.aktuell)
    await ereignis('update_angefragt', ich.id, { von: s.aktuell, zu: s.neueste?.version || '' }, clientIp(event))
    return updateStand()
  }
  throw fehler(400, 'Unbekannte Aktion.', 'Unknown action.')
})
