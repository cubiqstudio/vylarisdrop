import { requireAdmin } from '../../utils/auth'
import { getMarke, markeFuerSeite } from '../../utils/marke'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const m = await getMarke()
  return {
    ...m,
    logo: m.logo ? m.logo.slice(0, 40) + '…' : '',
    icon: m.icon ? m.icon.slice(0, 40) + '…' : '',
    hatLogo: !!m.logo,
    hatIcon: !!m.icon,
    seite: await markeFuerSeite()
  }
})
