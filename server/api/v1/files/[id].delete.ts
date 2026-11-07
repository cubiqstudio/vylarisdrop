import { apiNutzer } from '../../../utils/api'
import loeschen from '../../files/[id]/index.delete'

export default defineEventHandler(async (event) => {
  await apiNutzer(event, 'verwalten')
  await loeschen(event)
  return { ok: true, trashed: true }
})
