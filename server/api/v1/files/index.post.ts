import { apiNutzer, alsApi } from '../../../utils/api'
import hochladen from '../../upload/index.post'

export default defineEventHandler(async (event) => {
  await apiNutzer(event, 'upload')
  const r: any = await hochladen(event)
  return { files: r.files.map(alsApi), ...(r.fehler ? { errors: r.fehler } : {}) }
})
