import { requireSetupToken } from '../../utils/setup'

export default defineEventHandler(async (event) => {
  const b = await readBody(event)
  await requireSetupToken(event, b?.token)
  return { ok: true }
})
