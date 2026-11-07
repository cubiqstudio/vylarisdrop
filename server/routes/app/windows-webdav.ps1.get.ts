import { windowsSkript } from '../../utils/windowsSkript'

// Windows-Skript fuer das WebDAV-Netzlaufwerk (hebt das Datei-Limit des WebClient an). Oeffentlich lesbar, enthaelt keine Geheimnisse.
// ?ansehen=1 zeigt den Text im Browser statt ihn herunterzuladen — bitte vor dem Ausfuehren lesen.
export default defineEventHandler(async (event) => {
  const s = await windowsSkript()
  if (!s) throw fehler(404, 'Das Skript ist auf diesem Server nicht hinterlegt.', 'The script is not available on this server.')
  const ansehen = getQuery(event).ansehen != null
  setResponseHeaders(event, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Disposition': ansehen ? 'inline' : 'attachment; filename="windows-webdav.ps1"',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  })
  return s.text
})
