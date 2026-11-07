import { setupDone } from '../../utils/settings'
import { serverIp } from '../../utils/netz'

export default defineEventHandler(async () => {
  const done = await setupDone()
  return { done, ip: done ? '' : await serverIp() }
})
