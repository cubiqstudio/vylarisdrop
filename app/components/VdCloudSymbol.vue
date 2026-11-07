<script setup lang="ts">
// Symbol oder Vorschaubild eines Eintrags im Dateimanager
const props = defineProps<{ e: any; gross?: boolean }>()
const kaputt = ref(false)
const FARBE: Record<string, string> = {
  bild: '#1e73be',
  video: '#f59e0b',
  audio: '#3b82f6',
  text: '#22c55e',
  datei: 'var(--text3)'
}
const SYMBOL: Record<string, string> = { bild: 'image', video: 'film', audio: 'music', text: 'text', datei: 'file' }
const bild = computed(() => {
  const f = props.e
  if (f.typ !== 'datei' || kaputt.value || f.verschluesselt) return ''
  if (f.hat_vorschau) return f.links?.vorschau || ''
  if (f.art === 'bild' && !/hei[cf]/.test(f.mime) && f.mime !== 'image/svg+xml') return f.links?.direkt || ''
  return ''
})
const endung = computed(() => (/\.([a-z0-9]{1,5})$/i.exec(props.e.name)?.[1] || '').toUpperCase())
watch(
  () => props.e.links?.vorschau,
  () => (kaputt.value = false)
)
</script>

<template>
  <span class="sym" :class="{ gross, ordner: e.typ === 'ordner' }" aria-hidden="true">
    <template v-if="e.typ === 'ordner'">
      <Ico n="folder" class="ordner-ic" :style="e.team ? { color: e.team.farbe } : undefined" />
      <span v-if="e.galerie" class="plakette" :title="t('Öffentliche Galerie', 'Public gallery')"><Ico n="globe" /></span>
    </template>
    <img v-else-if="bild" :src="bild" alt="" loading="lazy" decoding="async" @error="kaputt = true" />
    <template v-else>
      <Ico :n="e.verschluesselt ? 'lock' : SYMBOL[e.art] || 'file'" :style="{ color: FARBE[e.art] || FARBE.datei }" />
      <b v-if="gross && endung" class="endung">{{ endung }}</b>
    </template>
  </span>
</template>

<style scoped>
.sym {
  position: relative;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--flaeche2);
  display: grid;
  place-items: center;
  flex-shrink: 0;
  overflow: hidden;
}
.sym svg {
  width: 18px;
  height: 18px;
}
.sym img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.sym.ordner {
  background: transparent;
  overflow: visible;
}
.sym .ordner-ic {
  width: 26px;
  height: 26px;
  color: var(--a);
  fill: rgba(var(--a-rgb), 0.16);
}
.sym.gross {
  width: 100%;
  height: 100%;
  border-radius: 0;
  background: var(--flaeche2);
  flex-direction: column;
  gap: 6px;
}
.sym.gross.ordner {
  background: transparent;
}
.sym.gross svg {
  width: 34px;
  height: 34px;
}
.sym.gross .ordner-ic {
  width: 64px;
  height: 64px;
}
.endung {
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--text3);
  font-weight: 600;
}
.plakette {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  display: grid;
  place-items: center;
  color: var(--a);
}
.plakette svg {
  width: 9px;
  height: 9px;
}
.gross .plakette {
  right: 28%;
  bottom: 18%;
  width: 22px;
  height: 22px;
}
.gross .plakette svg {
  width: 12px;
  height: 12px;
}
</style>
