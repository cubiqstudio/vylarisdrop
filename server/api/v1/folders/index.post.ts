import { apiNutzer, bodySetzen, ordnerAlsApi } from '../../../utils/api'
import { basisUrl } from '../../../utils/dateien'
import ordnerNeu from '../../folders/index.post'

export default defineEventHandler(async (event) => {
  await apiNutzer(event, 'verwalten')
  const b = (await readBody(event)) || {}
  bodySetzen(event, { name: b.name, parent_id: b.parent_id ?? null })
  const r: any = await ordnerNeu(event)
  return ordnerAlsApi(r.ordner, await basisUrl(event))
})
