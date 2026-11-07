import { requireOwner } from '../../utils/auth'
import { oeffentlicherSchluessel } from '../../utils/lizenzAussteller'
import { listeLaden } from '../../utils/lizenzVerwaltung'
import { basisUrl } from '../../utils/dateien'
import { FUNKTIONEN } from '../../utils/lizenz'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  return {
    schluessel: await listeLaden(),
    funktionen: FUNKTIONEN,
    server: {
      url: (await basisUrl(event)) + '/lizenz',
      oeffentlich: (await oeffentlicherSchluessel()).replace(/\r?\n/g, '\\n')
    }
  }
})
