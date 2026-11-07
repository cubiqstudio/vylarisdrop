import { requireAdmin } from '../../utils/auth'
import { updateStand } from '../../utils/update'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return updateStand()
})
