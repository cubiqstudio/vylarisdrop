import { anfrageZaehlen } from '../utils/monitoring'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('request', (event) => {
    const t0 = performance.now()
    const pfad = (event.path || '/').split('?')[0]!
    event.node.res.once('finish', () =>
      anfrageZaehlen(pfad, event.node.res.statusCode, (performance.now() - t0) / 1000)
    )
  })
})
