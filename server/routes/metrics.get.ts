import { timingSafeEqual } from 'node:crypto'
import { istPro } from '../utils/lizenz'
import { getMon, prometheus } from '../utils/monitoring'

export default defineEventHandler(async (event) => {
  const m = await getMon()
  if (!m.token || !(await istPro('monitoring'))) throw createError({ statusCode: 404 })
  const kopf = String(getRequestHeader(event, 'authorization') || '').replace(/^Bearer\s+/i, '')
  const soll = Buffer.from(m.token),
    ist = Buffer.from(kopf)
  if (soll.length !== ist.length || !timingSafeEqual(soll, ist)) {
    setResponseHeader(event, 'WWW-Authenticate', 'Bearer')
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  setResponseHeaders(event, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' })
  return prometheus()
})
