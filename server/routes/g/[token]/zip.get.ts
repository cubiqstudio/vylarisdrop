import yazl from 'yazl'
import { galerieDateien, galerieOrdner } from '../../../utils/galerie'
import { lesen } from '../../../utils/speicher'
import { limit, clientIp } from '../../../utils/auth'
import { gezaehlt, trafficPruefen } from '../../../utils/traffic'

export default defineEventHandler(async (event) => {
  const o = await galerieOrdner(String(getRouterParam(event, 'token') || ''))
  if (!o || o.galerie?.download === false)
    throw fehler(404, 'Diese Galerie gibt es nicht (mehr).', 'This gallery does not exist (anymore).')
  if (limit('galeriezip:' + clientIp(event), 10, 600))
    throw fehler(429, 'Zu viele Downloads — bitte kurz warten.', 'Too many downloads — please wait a moment.')
  await trafficPruefen(o.user_id)
  const dateien = await galerieDateien(o.id, o.galerie?.sortierung)
  const zip = new yazl.ZipFile()
  const vergeben = new Map<string, number>()
  for (const f of dateien) {
    let name = f.name.replace(/[\\/]/g, '_') || 'datei'
    const n = (vergeben.get(name.toLowerCase()) || 0) + 1
    vergeben.set(name.toLowerCase(), n)
    if (n > 1) name = name.replace(/(\.[^.]*)?$/, (m) => ` (${n})${m}`)
    const schon = ['bild', 'video', 'audio'].includes(f.art) || /zip|gzip|rar|7z/.test(f.mime)
    zip.addReadStream(await gezaehlt(lesen(f.ablage), f.user_id, f.id), name, {
      mtime: new Date(f.created_at),
      compress: !schon,
      size: Number(f.size)
    })
  }
  zip.end()
  const titel =
    (o.galerie?.titel || o.name)
      .replace(/[^\p{L}\p{N} ._-]+/gu, '')
      .trim()
      .slice(0, 80) || 'galerie'
  setResponseHeaders(event, {
    'Content-Type': 'application/zip',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(titel)}.zip`
  })
  return sendStream(event, zip.outputStream as any)
})
