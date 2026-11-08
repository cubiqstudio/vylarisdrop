import { q } from '../../utils/db'
import { appNutzerInfo, requireAppToken, appServerInfo } from '../../utils/app'

// Wer bin ich? Die App prueft damit, ob ihr Token noch gilt (401 = widerrufen). Aktualisiert "zuletzt benutzt".
export default defineEventHandler(async (event) => {
  const t = await requireAppToken(event)
  await q('UPDATE upload_tokens SET last_used_at = now() WHERE id = $1', [t.tokenId])
  return {
    nutzer: appNutzerInfo({ id: t.id, username: t.username, role: t.role }),
    geraet: { id: t.tokenId, name: t.tokenName },
    server: await appServerInfo()
  }
})
