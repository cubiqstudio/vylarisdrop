import { requireAdmin } from '../../utils/auth'
import { clamStatus, getViren, MAX_SCAN, scanZahlen } from '../../utils/virenscan'
import { dienstKann, virenscanDienstStand } from '../../utils/update'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return {
    ...(await getViren()),
    clamav: await clamStatus(),
    zahlen: await scanZahlen(),
    dienst: await dienstKann('virenscan'),
    lauf: await virenscanDienstStand(),
    maxMb: MAX_SCAN / 1024 ** 2
  }
})
