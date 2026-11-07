import { trafficSchreiben } from '../utils/traffic'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('close', async () => {
    await trafficSchreiben().catch(() => {})
  })
})
