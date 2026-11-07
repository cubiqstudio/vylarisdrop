import { istDomain } from './netz'

// Optionaler direkter Hostname nur fuer WebDAV ("grosse Dateien"): DNS-only (graue Wolke), also NICHT ueber Cloudflare.
// Gesetzt per Umgebungsvariable VD_DAV_HOST (siehe deploy/compose.dav-direkt.yml und deploy/dav-direkt.sh).
export const DAV_PFAD = /^\/(dav|webdav)(\/|$)/

/** Der konfigurierte direkte DAV-Hostname (kleingeschrieben, ohne Schema/Pfad) oder '' wenn keiner gesetzt/gueltig ist. */
export function davHost(): string {
  const roh = String(process.env.VD_DAV_HOST || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
  return istDomain(roh) ? roh : ''
}

/** Kam die Anfrage ueber den direkten DAV-Hostnamen? Massgeblich ist nur der Host-Kopf (kein X-Forwarded-Host, der laesst sich faelschen). */
export function ueberDavHost(event: { node: { req: { headers: Record<string, any> } } }): boolean {
  const dh = davHost()
  if (!dh) return false
  const host = String(event.node.req.headers['host'] || '')
    .split(':')[0]!
    .toLowerCase()
  return host === dh
}
