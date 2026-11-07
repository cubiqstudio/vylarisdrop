import { ereignis } from '../../../utils/db'
import { clientIp, requireOwner } from '../../../utils/auth'
import { requirePro } from '../../../utils/lizenz'
import { sicherungErstellen } from '../../../utils/sicherung'

export default defineEventHandler(async (event) => {
  const ich = await requireOwner(event)
  await requirePro('sicherung')
  const { strom, name } = await sicherungErstellen()
  await ereignis('sicherung', ich.id, { name }, clientIp(event))
  setResponseHeaders(event, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${name}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  return sendStream(event, strom as any)
})
