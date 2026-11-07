<script setup lang="ts">
// Oeffentlich (ohne Anmeldung): Landeseite fuer den QR-Code / Link der Seite "Verbundene Geraete"
definePageMeta({ layout: 'leer' })
useHead(() => ({
  title: t('App verbinden', 'Connect app'),
  meta: [{ name: 'robots', content: 'noindex' }]
}))
const route = useRoute()
const theme = useTheme()
const requestFetch: any = import.meta.server ? useRequestFetch() : $fetch
const { data: info } = await useAsyncData<{ server: string; apk: boolean; groesse: number }>('app-koppeln-info', () =>
  requestFetch('/api/app/info').catch(() => ({ server: '', apk: false, groesse: 0 }))
)
const code = computed(() => {
  const c = String(route.query.c || '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
  return /^[2-9A-HJKMNP-Z]{8}$/.test(c) ? `${c.slice(0, 4)}-${c.slice(4)}` : ''
})
const basis = computed(() => String(info.value?.server || ''))
const schemaLink = computed(
  () => `vylariscloud://koppeln?s=${encodeURIComponent(basis.value)}&c=${encodeURIComponent(code.value)}`
)
const apk = computed(() => !!info.value?.apk)
</script>

<template>
  <div class="seite-k">
    <header class="oben"><VdMarke /></header>
    <div class="karte rein">
      <div class="eyebrow"><Ico n="laptop" /> {{ t('App verbinden', 'Connect app') }}</div>
      <h1>{{ t('Verbinde die VylarisCloud-App', 'Connect the VylarisCloud app') }}</h1>
      <p class="leise">
        {{
          t(
            `Mit diesem Code verbindet sich die App mit „${theme.name}“ — ohne dass du ein Passwort auf dem Handy eintippst.`,
            `This code connects the app to “${theme.name}” — without typing a password on your phone.`
          )
        }}
      </p>

      <div v-if="code" class="k-code" data-testid="code">
        <span class="sehrleise k-label">{{ t('Dein Kopplungscode', 'Your pairing code') }}</span>
        <span class="mono k-zeichen">{{ code }}</span>
        <span class="sehrleise k-klein">{{ t('gilt einmal, fünf Minuten lang', 'works once, for five minutes') }}</span>
      </div>
      <div v-else class="meldung meldung-warn" role="note">
        {{
          t(
            'Zu diesem Link gehört kein Code. Öffne auf einem angemeldeten Gerät „Verbundene Geräte“ und erzeuge einen neuen.',
            'This link carries no code. On a signed-in device, open “Connected devices” and generate a new one.'
          )
        }}
      </div>

      <a v-if="code" class="knopf rot k-gross" :href="schemaLink" data-testid="oeffnen"
        ><Ico n="right" /> {{ t('In der App öffnen', 'Open in app') }}</a
      >
      <a v-if="apk" class="knopf k-gross" href="/app/download" download data-testid="laden"
        ><Ico n="download" /> {{ t('App herunterladen', 'Download app') }}</a
      >
      <p v-else class="sehrleise k-klein" data-testid="ohne-apk">
        {{
          t(
            'Auf diesem Server ist noch keine App-Datei hinterlegt. Hast du die App schon, tippe auf „In der App öffnen“ oder gib den Code dort ein.',
            'No app file has been placed on this server yet. If you already have the app, tap “Open in app” or enter the code there.'
          )
        }}
      </p>

      <ol class="k-schritte">
        <li>{{ t('App installieren (falls noch nicht geschehen).', 'Install the app (if you have not yet).') }}</li>
        <li>{{ t('„In der App öffnen“ tippen — oder in der App den Code eingeben.', 'Tap “Open in app” — or enter the code in the app.') }}</li>
        <li>{{ t('Die App meldet sich selbst an und ist verbunden.', 'The app signs itself in and is connected.') }}</li>
      </ol>
      <div v-if="basis" class="sehrleise k-klein">
        {{ t('Server', 'Server') }}: <span class="mono">{{ basis }}</span>
      </div>
    </div>
    <VdFuss anmeldung />
  </div>
</template>

<style scoped>
.seite-k {
  position: relative;
  max-width: 520px;
  margin: 0 auto;
  padding: 18px 16px 60px;
}
.oben {
  margin-bottom: 24px;
}
.karte {
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 22px;
  padding: 26px;
  box-shadow: 0 40px 90px -40px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
h1 {
  font-family: var(--f-display);
  font-size: 26px;
  letter-spacing: -0.03em;
  line-height: 1.15;
}
.karte p {
  margin: 0;
}
.k-code {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 16px 12px;
  border-radius: 14px;
  background: rgba(var(--a-rgb), 0.06);
  border: 1px solid rgba(var(--a-rgb), 0.4);
}
.k-label {
  font-size: 11.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.k-zeichen {
  font-size: clamp(30px, 10vw, 42px);
  font-weight: 700;
  letter-spacing: 0.08em;
  user-select: all;
}
.k-klein {
  font-size: 12px;
  word-break: break-all;
}
.k-gross {
  justify-content: center;
  padding: 13px 18px;
  font-size: 15px;
}
.k-schritte {
  margin: 4px 0 0;
  padding-left: 20px;
  color: var(--text2);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
@media (max-width: 420px) {
  .karte {
    padding: 20px 16px;
  }
}
</style>
