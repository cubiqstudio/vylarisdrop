import { basisUrl } from '../../../utils/dateien'
import { galerieDateien, galerieEintrag, galerieOrdner } from '../../../utils/galerie'

export default defineEventHandler(async (event) => {
  const o = await galerieOrdner(String(getRouterParam(event, 'token') || ''))
  if (!o) throw fehler(404, 'Diese Galerie gibt es nicht (mehr).', 'This gallery does not exist (anymore).')
  const dateien = await galerieDateien(o.id, o.galerie?.sortierung)
  const basis = await basisUrl(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return {
    titel: o.galerie?.titel || o.name,
    text: o.galerie?.text || '',
    von: o.username,
    download: o.galerie?.download !== false,
    dateien: await Promise.all(dateien.map((f) => galerieEintrag(basis, f))),
    groesse: dateien.reduce((a, f) => a + Number(f.size), 0)
  }
})
