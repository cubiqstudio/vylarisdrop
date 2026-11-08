import { q1 } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { basisUrl } from '../../utils/dateien'
import { freierPlatz, kontingentVon } from '../../utils/hochladen'
import { davHost } from '../../utils/davHost'
import { windowsSkript } from '../../utils/windowsSkript'

// Angaben fuer die Seite /sync: WebDAV-Adresse, Benutzername und Speicher des Kontos
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const basis = await basisUrl(event)
  const url = new URL(basis)
  const belegt = await q1<{ s: string }>('SELECT coalesce(sum(size), 0) AS s FROM files WHERE user_id = $1', [u.id])
  const kontingent = await kontingentVon(u)
  const frei = await freierPlatz(u)
  const direkt = davHost()
  return {
    adresse: `${basis}/dav/`,
    // direkter Hostname fuer grosse Dateien (VD_DAV_HOST), sonst null; Cloudflare-Tunnel/-Proxy begrenzt Anfragen auf 100 MB
    grossAdresse: direkt ? `https://${direkt}/dav/` : null,
    grossBoxAdresse: direkt ? `https://${direkt}/webdav/` : null,
    grossHost: direkt || null,
    // kam diese Anfrage ueber Cloudflare (Tunnel/Proxy)? Dann gilt dort das 100-MB-Limit je Anfrage
    ueberCloudflare: !!getRequestHeader(event, 'cf-ray') || !!getRequestHeader(event, 'cf-connecting-ip'),
    windowsSkript: await windowsSkript().then((x) => (x ? { url: '/app/windows-webdav.ps1', sha256: x.sha256, groesse: x.groesse } : null)),
    host: url.host,
    https: url.protocol === 'https:',
    lokal: /^(localhost|127\.|\[::1\])/.test(url.hostname),
    benutzer: u.username,
    belegt: Number(belegt?.s || 0),
    kontingent,
    frei: Number.isFinite(frei) ? frei : null
  }
})
