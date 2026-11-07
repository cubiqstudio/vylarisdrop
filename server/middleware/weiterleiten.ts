import { q1 } from '../utils/db'
import { altesZiel } from '../utils/importKern'

const EIGEN =
  /^\/(api|_nuxt|__nuxt|_ipx|v|r|d|raw|t|s|a|app|login|setup|ordner|werkzeuge|einstellungen|nutzer|embed|anfragen|import|pro|server|teams|sso|marke|papierkorb|protokoll|statistik|sicherung|webhooks|api-doku|regeln|system|metrics|paste|g|favicon\.ico|robots\.txt)(\/|$)/
let gibtEs: { wert: boolean; bis: number } = { wert: false, bis: 0 }

export default defineEventHandler(async (event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return
  const pfad = (event.path || '/').split('?')[0]!
  if (pfad === '/' || EIGEN.test(pfad)) return
  if (Date.now() > gibtEs.bis) {
    try {
      gibtEs = { wert: !!(await q1('SELECT 1 FROM alte_pfade LIMIT 1')), bis: Date.now() + 60_000 }
    } catch {
      return
    }
  }
  if (!gibtEs.wert) return
  const ziel = await altesZiel(pfad).catch(() => null)
  if (ziel) return sendRedirect(event, ziel, 301)
})
