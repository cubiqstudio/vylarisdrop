import { basisUrl } from '../../utils/dateien'
import { openapi } from '../../utils/openapi'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'public, max-age=300')
  return openapi(await basisUrl(event))
})
