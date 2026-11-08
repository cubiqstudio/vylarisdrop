import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  telemetry: false,
  sourcemap: { server: false, client: false },
  css: ['~/assets/fonts.css', '~/assets/main.css', '~/assets/mobil.css'],
  // Hover-Regeln nur für Geräte mit Maus (siehe scripts/postcss-hover-nur-maus.mjs)
  postcss: { plugins: { '~~/scripts/postcss-hover-nur-maus.mjs': {} } },
  nitro: {
    minify: true,
    preset: 'node-server',
    // das Windows-Skript aus deploy/ wird mitgebaut und unter /app/windows-webdav.ps1 ausgeliefert (eine Quelle, kein Duplikat)
    serverAssets: [{ baseName: 'deploy', dir: fileURLToPath(new URL('./deploy', import.meta.url)), pattern: '*.ps1' }]
  },
  app: {
    head: {
      htmlAttrs: { lang: 'de' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'color-scheme', content: 'dark light' },
        { name: 'format-detection', content: 'telephone=no' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'default' }
      ],
      // Name, Farbe und Symbol kommen dynamisch aus den Marken-Einstellungen (server/routes/manifest.webmanifest.get.ts)
      link: [{ rel: 'manifest', href: '/manifest.webmanifest' }]
    }
  },
  runtimeConfig: {
    dbUrl: '',
    dataDir: ''
  },
  typescript: { strict: true }
})
