import { requireAdmin } from '../../utils/auth'
import { cacheGroesse } from '../../utils/bildvarianten'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return await cacheGroesse()
})
