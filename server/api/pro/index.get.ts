import { requireUser } from '../../utils/auth'
import { lizenzAnsicht } from '../../utils/lizenz'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const a = await lizenzAnsicht()
  if (u.role === 'user') return { pro: a.pro, funktionen: a.funktionen }
  return a
})
