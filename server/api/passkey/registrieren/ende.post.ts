import { ereignis } from '../../../utils/db'
import { clientIp, requireUser } from '../../../utils/auth'
import { geraetName, registrierenEnde } from '../../../utils/passkeys'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const b = await readBody(event)
  const name =
    String(b?.name || '')
      .replace(/[\u0000-\u001f]/g, '')
      .trim() || geraetName(String(getRequestHeader(event, 'user-agent') || ''))
  const r = await registrierenEnde(event, u.id, b?.antwort, name)
  await ereignis('passkey_angelegt', u.id, { name: name.slice(0, 60) }, clientIp(event))
  return { ok: true, ...r }
})
