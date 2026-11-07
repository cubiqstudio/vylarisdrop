import { requireUser } from '../../utils/auth'
import { getSpeicherEinst, speicherStand } from '../../utils/speicherdienst'
import { darfAnlegen, speicherAdresse, speicherListen, speicherPlatte, speicherPlatten } from '../../utils/speicherAnsicht'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const admin = u.role !== 'user'
  const stand = await speicherStand()
  return {
    admin,
    inhaber: u.role === 'owner',
    stand: admin
      ? stand
      : { konfiguriert: stand.konfiguriert, sftpgo: stand.sftpgo, garage: stand.garage, port: stand.port },
    einstellungen: await getSpeicherEinst(),
    darfAnlegen: await darfAnlegen(u),
    adresse: await speicherAdresse(event),
    platte: admin ? await speicherPlatte() : null,
    platten: admin ? await speicherPlatten() : null,
    ...(stand.konfiguriert ? await speicherListen(u) : { boxen: [], buckets: [] })
  }
})
