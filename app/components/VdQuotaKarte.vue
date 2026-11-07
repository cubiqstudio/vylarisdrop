<script setup lang="ts">
// Eigene Belegung im Detail: Balken nach Dateiart, Papierkorb, Kontingent-Quelle und Kontingente der eigenen Teams
const { data } = await (useFetch as any)('/api/quota/me', { key: 'quota-me' })
// Live: Belegung nach Dateiart und Papierkorb aktualisieren sich bei Änderungen von überall (gemeinsam gebündelt, still bei Fehlern)
useLiveDaten({ daten: [{ schluessel: 'quota-me', url: '/api/quota/me' }], themen: ['dateien', 'papierkorb'], mind: 2000 })
const q = computed(() => data.value)
const ARTEN = [
  { k: 'bild', c: '#1e73be', de: 'Bilder', en: 'Images' },
  { k: 'video', c: '#f59e0b', de: 'Videos', en: 'Videos' },
  { k: 'audio', c: '#3b82f6', de: 'Audio', en: 'Audio' },
  { k: 'text', c: '#22c55e', de: 'Text', en: 'Text' },
  { k: 'datei', c: 'var(--text3)', de: 'Sonstiges', en: 'Other' }
]
const zeilen = computed(() => [
  ...ARTEN.map((a) => ({
    k: a.k,
    farbe: a.c,
    text: lang() === 'en' ? a.en : a.de,
    bytes: Number(q.value?.proArt?.[a.k]?.bytes || 0),
    anzahl: Number(q.value?.proArt?.[a.k]?.anzahl || 0),
    muster: false
  })),
  { k: 'korb', farbe: '', text: t('Papierkorb', 'Trash'), bytes: Number(q.value?.papierkorb || 0), anzahl: 0, muster: true }
])
const segmente = computed(() => zeilen.value.map((z) => ({ bytes: z.bytes, farbe: z.farbe, muster: z.muster })))
const QUELLE: Record<string, [string, string]> = {
  konto: ['Eigenes Limit an deinem Konto', 'Limit set on your account'],
  rolle: ['Limit deiner Rolle', 'Limit of your role'],
  standard: ['Standard-Kontingent dieser Installation', 'Default quota of this installation'],
  keins: ['Kein Limit', 'No limit']
}
</script>

<template>
  <section v-if="q" class="qk block" aria-labelledby="qk-titel">
    <div class="reihe zw">
      <h3 id="qk-titel">{{ t('Dein Speicher', 'Your storage') }}</h3>
      <span v-if="q.limit" class="chip" :class="q.stufe === 'ok' ? 'neutral' : q.stufe === 'warn' ? 'warn' : 'rot'">
        {{ zahl(q.prozent || 0, 1) }} %
      </span>
      <span v-else class="chip neutral">{{ t('Kein Limit', 'No limit') }}</span>
    </div>
    <div class="gross">
      <b class="zahl">{{ groesse(q.used) }}</b>
      <span v-if="q.limit" class="leise">&nbsp;{{ t('von', 'of') }} {{ groesse(q.limit) }} {{ t('belegt', 'used') }} · {{ groesse(q.free ?? 0) }} {{ t('frei', 'free') }}</span>
      <span v-else class="leise">&nbsp;{{ t('belegt', 'used') }}</span>
    </div>
    <VdQuotaBalken :used="q.used" :limit="q.limit" :segmente="segmente" gross :beschriftung="t('Speicherbelegung', 'Storage usage')" />
    <ul class="legende">
      <li v-for="z in zeilen" :key="z.k" :class="{ leer: !z.bytes }">
        <i :class="{ muster: z.muster }" :style="z.farbe ? { background: z.farbe } : {}"></i>
        <span>{{ z.text }}</span>
        <b class="zahl">{{ groesse(z.bytes) }}</b>
      </li>
    </ul>
    <p class="sehrleise klein">
      {{ t(QUELLE[q.source]![0], QUELLE[q.source]![1]) }}.
      {{ t('Der Papierkorb zählt mit, bis du ihn leerst oder die Dateien nach 30 Tagen endgültig gelöscht werden.', 'The trash counts until you empty it or the files are deleted for good after 30 days.') }}
    </p>
    <div v-if="q.teams?.length" class="teams">
      <h4>{{ t('Deine Teams', 'Your teams') }}</h4>
      <div v-for="tm in q.teams" :key="tm.id" class="team">
        <div class="reihe zw klein">
          <b>{{ tm.name }}</b>
          <span class="leise">{{ groesse(tm.used) }} {{ t('von', 'of') }} {{ groesse(tm.limit) }}</span>
        </div>
        <VdQuotaBalken :used="tm.used" :limit="tm.limit" klein :beschriftung="tm.name" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.qk {
  margin-bottom: 18px;
  display: grid;
  gap: 12px;
}
.qk h3 {
  margin: 0;
}
.gross {
  font-size: 15px;
}
.gross b {
  font-size: 24px;
  font-family: var(--f-display);
  letter-spacing: -0.02em;
}
.klein {
  font-size: 12.5px;
  margin: 0;
}
.legende {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 6px 16px;
  font-size: 12.5px;
}
.legende li {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text2);
}
.legende li.leer {
  opacity: 0.55;
}
.legende li b {
  margin-left: auto;
  color: var(--text);
  font-weight: 600;
}
.legende i {
  width: 9px;
  height: 9px;
  border-radius: 3px;
  background: var(--text3);
  flex-shrink: 0;
}
.legende i.muster {
  background: repeating-linear-gradient(135deg, var(--text3) 0 2px, transparent 2px 4px);
  box-shadow: inset 0 0 0 1px var(--text3);
}
.teams {
  display: grid;
  gap: 8px;
  border-top: 1px solid var(--linie);
  padding-top: 12px;
}
.teams h4 {
  margin: 0;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text3);
  font-weight: 600;
}
.team {
  display: grid;
  gap: 6px;
}
</style>
