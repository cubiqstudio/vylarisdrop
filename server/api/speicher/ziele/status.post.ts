import { clientIp, limit, requireAdmin } from '../../../utils/auth'
import { alleZiele, zielOeffentlich } from '../../../utils/sftpZiele'
import { sftpPruefen } from '../../../utils/sftpClient'

// Status aller aktiven Erweiterungen jetzt prüfen (Erreichbarkeit, Latenz, Platz) — leichtgewichtig, ohne Schreibtest
export default defineEventHandler(async (event) => {
  const ich = await requireAdmin(event)
  if (limit('sftpstatus:' + ich.id, 30, 600) || limit('sftpstatus-ip:' + clientIp(event), 60, 600))
    throw fehler(429, 'Zu viele Prüfungen — bitte kurz warten.', 'Too many checks — please wait a moment.')
  const ziele = await alleZiele(true)
  await Promise.race([
    Promise.all(ziele.filter((z) => z.aktiv).map((z) => sftpPruefen(z.id).catch(() => {}))),
    new Promise((res) => setTimeout(res, 20_000))
  ])
  return { ziele: (await alleZiele(true)).map(zielOeffentlich) }
})
