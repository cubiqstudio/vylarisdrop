export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  telemetry: false,
  sourcemap: { server: false, client: false },
  css: ['~/assets/fonts.css', '~/assets/main.css'],
  nitro: { minify: true, preset: 'node-server' },
  app: {
    head: {
      htmlAttrs: { lang: 'de' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'color-scheme', content: 'dark light' }
      ]
    }
  },
  runtimeConfig: {
    dbUrl: '',
    dataDir: ''
  },
  typescript: { strict: true }
})
