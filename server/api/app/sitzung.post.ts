import { q } from '../../utils/db'
import { sessionStart } from '../../utils/auth'
import { appNutzerInfo, requireAppToken } from '../../utils/app'

// Macht aus einem App-Token eine normale Web-Sitzung (Set-Cookie wie bei der Anmeldung), damit die WebView ohne neue Anmeldung
// eingeloggt ist. Nur fuer App-Token: ein normales Upload-Token (ShareX & Co.) bekommt hier 401. Die Sitzung merkt sich das
// Geraet — wird es widerrufen, endet die Sitzung sofort.
export default defineEventHandler(async (event) => {
  const t = await requireAppToken(event)
  await q('DELETE FROM sessions WHERE app_geraet = $1', [t.tokenId])
  await sessionStart(event, t.id, t.tokenId)
  return { ok: true, nutzer: appNutzerInfo({ id: t.id, username: t.username, role: t.role }) }
})
