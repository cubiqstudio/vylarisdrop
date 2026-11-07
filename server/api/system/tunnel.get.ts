import { requireAdmin } from '../../utils/auth'
import { getTunnel, tunnelBereit, tunnelDienstStand, ZIEL_DIENST } from '../../utils/tunnel'
import { dienstKann } from '../../utils/update'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const t = await getTunnel()
  return {
    an: !!t?.an,
    modus: t?.modus || 'token',
    domain: t?.domain || '',
    hatToken: !!t?.token,
    auto: t?.auto ? { tunnelId: t.auto.tunnelId, eingerichtet: true } : null,
    zustand: await tunnelBereit(),
    dienst: await dienstKann('tunnel'),
    lauf: await tunnelDienstStand(),
    ziel: ZIEL_DIENST
  }
})
