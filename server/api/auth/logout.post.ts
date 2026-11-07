import { sessionEnd } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await sessionEnd(event)
  return { ok: true }
})
