<script setup lang="ts">
useHead({ title: () => t('Statistik', 'Statistics') })
const tage = ref(30)
const { data, pending } = await (useFetch as any)(() => `/api/statistik?tage=${tage.value}`, {
  key: 'statistik',
  watch: [tage]
})
const { data: traffic } = await (useFetch as any)(() => `/api/statistik/traffic?tage=${tage.value}`, {
  key: 'statistik-traffic',
  watch: [tage]
})
const theme = useTheme()
const istAdmin = computed(() => ['owner', 'admin'].includes(theme.value.user?.role || ''))
function oeffnen(slug: string) {
  window.open(`/v/${encodeURIComponent(slug)}`, '_blank', 'noopener')
}
</script>

<template>
  <section class="rein">
    <div class="kopf">
      <div>
        <div class="eyebrow"><Ico n="chart" /> {{ t('Bibliothek', 'Library') }}</div>
        <h1>{{ t('Statistik', 'Statistics') }}</h1>
        <p>
          {{
            t(
              'Wie oft deine Dateien aufgerufen werden — und woher.',
              'How often your files are viewed — and from where.'
            )
          }}
        </p>
      </div>
      <div class="zeitraum" role="group" :aria-label="t('Zeitraum', 'Period')">
        <button
          v-for="z in [7, 30, 90]"
          :key="z"
          type="button"
          :class="{ an: tage === z }"
          :aria-pressed="tage === z"
          @click="tage = z"
        >
          {{ t(`${z} Tage`, `${z} days`) }}
        </button>
      </div>
    </div>
    <div :class="['block', { laedt: pending }]">
      <VdStatistik v-if="data" :d="data" @datei="oeffnen" />
    </div>
    <div v-if="traffic?.pro" class="block">
      <h3 class="titel"><Ico n="download" /> Traffic</h3>
      <VdTraffic :d="traffic" @datei="oeffnen" />
    </div>
    <VdProSperre
      v-else-if="traffic && istAdmin"
      ic="download"
      :titel="t('Traffic-Statistik & Grenzen', 'Traffic statistics & limits')"
      :text="
        t(
          'Sieh, wie viele Daten deine Dateien ausliefern, und setze monatliche Grenzen pro Konto oder Rolle.',
          'See how much data your files deliver and set monthly limits per account or role.'
        )
      "
      :punkte="[
        t('Traffic pro Tag und Datei', 'Traffic per day and file'),
        t('Monatliche Grenzen mit Warnung bei 80 % und 100 %', 'Monthly limits with warnings at 80% and 100%'),
        t('Übersicht für alle Konten', 'Overview for all accounts')
      ]"
    />
  </section>
</template>

<style scoped>
.zeitraum {
  display: inline-flex;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 11px;
  padding: 3px;
  gap: 2px;
}
.zeitraum button {
  border: 0;
  background: transparent;
  color: var(--text2);
  font: inherit;
  font-size: 12.5px;
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
}
.zeitraum button.an {
  background: var(--flaeche2);
  color: var(--text);
  font-weight: 600;
}
.laedt {
  opacity: 0.6;
  transition: opacity 0.2s;
}
.block + .block,
.block + :deep(.sperre) {
  margin-top: 18px;
}
.titel {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0 0 14px;
  font-size: 15px;
}
.titel svg {
  width: 16px;
  height: 16px;
  color: var(--a);
}
</style>
