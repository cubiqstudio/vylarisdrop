import { basisUrl } from '../../utils/dateien'
import { apkInfo } from '../../utils/app'

// Oeffentlich (fuer die Seite /app/koppeln): Basis-Adresse dieses Servers und ob eine App zum Herunterladen hinterlegt ist
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const a = await apkInfo()
  return { server: await basisUrl(event), apk: a.vorhanden, groesse: a.groesse }
})
