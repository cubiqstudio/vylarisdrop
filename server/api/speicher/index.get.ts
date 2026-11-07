import { requireUser } from '../../utils/auth'
import { getSpeicherEinst, speicherStand } from '../../utils/speicherdienst'
import { budgetAnsicht } from '../../utils/speicherBudget'
import { darfAnlegen, speicherAdresse, speicherListen, speicherPlatte } from '../../utils/speicherAnsicht'

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
    // Budget des eigenen Kontos: Kontingent, belegt, für Boxen/Buckets reserviert, frei zum Einplanen
    budget: await budgetAnsicht(u, stand.konfiguriert),
    adresse: await speicherAdresse(event),
    platte: admin ? await speicherPlatte() : null,
    ...(stand.konfiguriert ? await speicherListen(u) : { boxen: [], buckets: [] })
  }
})
