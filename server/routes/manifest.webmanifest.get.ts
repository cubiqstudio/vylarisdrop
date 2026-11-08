import { getDesign } from '../utils/settings'
import { datenUrl, getMarke } from '../utils/marke'
import { istPro } from '../utils/lizenz'

// Web-App-Manifest (Installation auf dem Startbildschirm). Name, Farbe und Symbol folgen den Marken-Einstellungen
// (Eigenmarke ist Teil von Pro); ohne eigene Angaben gilt die Vorgabe. Bewusst öffentlich und ohne Service Worker:
// es wird nichts zwischengespeichert, Dateiauslieferung und Uploads bleiben unberührt.
const FARBE = /^#[0-9a-f]{6}$/i
const HINTERGRUND = '#0b0d11'

// Breite/Höhe eines PNG aus dem IHDR-Block (für die Größenangabe eigener Symbole); sonst null
function pngMasse(b: Buffer): number | null {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('ascii', 12, 16) !== 'IHDR') return null
  const w = b.readUInt32BE(16)
  const h = b.readUInt32BE(20)
  return w > 0 && w === h && w <= 4096 ? w : null
}

export default defineEventHandler(async (event) => {
  let name = 'VylarisCloud'
  let farbe = '#1e73be'
  let icons: Array<Record<string, string>> = [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
  ]
  try {
    const d = await getDesign()
    if (d.name?.trim()) name = d.name.trim().slice(0, 45)
    if (FARBE.test(d.color || '')) farbe = d.color
    if (await istPro('white-label')) {
      const m = await getMarke()
      const bild = datenUrl(m.icon || m.logo)
      if (bild) {
        const seite = bild.typ === 'image/png' ? pngMasse(bild.daten) : null
        icons = [
          {
            src: '/api/public/marke/icon',
            sizes: seite ? `${seite}x${seite}` : 'any',
            type: bild.typ === 'image/x-icon' ? 'image/vnd.microsoft.icon' : bild.typ,
            purpose: 'any'
          }
        ]
      }
    }
  } catch {
    // Datenbank nicht erreichbar oder Einrichtung offen: Vorgabe ausliefern
  }
  setResponseHeaders(event, {
    'Content-Type': 'application/manifest+json; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  })
  return {
    id: '/',
    name,
    short_name: name.length > 12 ? name.slice(0, 12).trim() : name,
    description: 'Dateien speichern, teilen und synchronisieren',
    lang: 'de',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: farbe,
    background_color: HINTERGRUND,
    icons
  }
})
