import { apiNutzer, ordnerAlsApi } from '../../../utils/api'
import { basisUrl } from '../../../utils/dateien'
import ordnerListe from '../../folders/index.get'

export default defineEventHandler(async (event) => {
  await apiNutzer(event, 'lesen')
  const r: any = await ordnerListe(event)
  const basis = await basisUrl(event)
  return { folders: r.ordner.map((o: any) => ordnerAlsApi(o, basis)) }
})
