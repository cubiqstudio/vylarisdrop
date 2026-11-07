import { DAV_PFAD, davHost, ueberDavHost } from '../utils/davHost'
import { istHttps } from '../utils/auth'

// Direkter DAV-Hostname (VD_DAV_HOST): dort ist NUR WebDAV (/dav, /webdav) erreichbar, alles andere ist 404 — auch dann,
// wenn der vorgeschaltete Caddy falsch eingestellt waere. Muss vor 00.speicher.ts laufen (Dateiname sortiert davor).
// Ohne VD_DAV_HOST tut diese Middleware nichts.
export default defineEventHandler((event) => {
  if (!davHost() || !ueberDavHost(event)) return
  event.context.davHost = true
  const pfad = (event.node.req.url || '/').split('?')[0]!
  if (!DAV_PFAD.test(pfad)) throw fehler(404, 'Nicht gefunden', 'Not found')
  // Anmeldedaten gehoeren nie unverschluesselt ueber diese Adresse (Caddy leitet http:// ohnehin um)
  if (!istHttps(event) && process.env.VD_DISABLE_HTTPS_REDIRECT !== '1')
    throw fehler(403, `HTTPS erforderlich: https://${davHost()}${pfad}`, `HTTPS required: https://${davHost()}${pfad}`)
})
