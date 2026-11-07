import { getInstance } from '../../utils/settings'

export default defineEventHandler(async () => ({ ok: true, instance: (await getInstance()).id }))
