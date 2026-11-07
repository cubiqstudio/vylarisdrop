import { requireSetupToken } from '../../utils/setup'
import { getTunnel, tunnelBereit, tunnelDienstStand } from '../../utils/tunnel'
import { dienstKann } from '../../utils/update'

export default defineEventHandler(async (event) => {
  const b = await readBody(event)
  await requireSetupToken(event, b?.token, 'setup-tunnel', 400)
  const t = await getTunnel()
  return {
    an: !!t?.an,
    domain: t?.domain || '',
    dienst: await dienstKann('tunnel'),
    zustand: await tunnelBereit(),
    lauf: await tunnelDienstStand()
  }
})
