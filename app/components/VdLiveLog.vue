<script setup lang="ts">
const props = defineProps<{ text: string; laeuft?: boolean }>()
const box = ref<HTMLElement | null>(null)
const offen = ref(true)
let unten = true
function scrollen() {
  const b = box.value
  if (b) unten = b.scrollHeight - b.scrollTop - b.clientHeight < 24
}
const zeilen = computed(() =>
  props.text
    .split('\n')
    .filter((z, i, a) => z.trim() || i < a.length - 1)
    .map((z) => ({
      t: z,
      art:
        z.startsWith('==> Fehler') || z.startsWith('Fehler:') || /\b(error|fehler|failed)\b/i.test(z)
          ? 'fehler'
          : z.startsWith('==>')
            ? 'schritt'
            : ''
    }))
)
watch(
  () => props.text,
  async () => {
    await nextTick()
    if (unten && box.value) box.value.scrollTop = box.value.scrollHeight
  },
  { immediate: true }
)
</script>

<template>
  <div class="ll">
    <button type="button" class="ll-kopf" :aria-expanded="offen" @click="offen = !offen">
      <span :class="['ll-licht', { an: laeuft }]"></span>
      <span>{{ t('Live-Protokoll vom Server', 'Live log from the server') }}</span>
      <span class="ll-zahl">{{ zeilen.length }} {{ t('Zeilen', 'lines') }}</span>
      <Ico :n="offen ? 'up' : 'down'" />
    </button>
    <div v-if="offen" ref="box" class="ll-zeilen" data-lenis-prevent @scroll="scrollen">
      <div v-if="!zeilen.length" class="ll-leer">
        {{
          laeuft
            ? t(
                'Noch keine Ausgabe — sie erscheint hier, sobald der Server loslegt …',
                'No output yet — it shows up here as soon as the server starts …'
              )
            : t(
                'Noch keine Ausgabe — der Dienst holt den Auftrag gleich ab …',
                'No output yet — the service picks up the job in a moment …'
              )
        }}
      </div>
      <div v-for="(z, i) in zeilen" :key="i" :class="['ll-z', z.art]">{{ z.t }}</div>
      <div v-if="laeuft" class="ll-z ll-cursor">▍</div>
    </div>
  </div>
</template>

<style scoped>
.ll {
  width: 100%;
  padding: 0;
  height: auto;
  border: 1px solid var(--linie);
  border-radius: 12px;
  overflow: hidden;
  background: var(--flaeche);
  font: 13px/1.45 var(--f-text);
  color: var(--text);
}
.ll-kopf {
  all: unset;
  box-sizing: border-box;
  width: 100%;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 9px 12px;
  font: 600 12.5px/1.4 var(--f-text);
  color: var(--text2);
  cursor: pointer;
}
.ll-kopf:hover {
  color: var(--text);
}
.ll-zahl {
  margin-left: auto;
  font-weight: 400;
  color: var(--text3);
  font-variant-numeric: tabular-nums;
}
.ll-kopf svg {
  width: 14px;
  height: 14px;
}
.ll-kopf:focus-visible {
  outline: 2px solid var(--a);
  outline-offset: -2px;
}
.ll-licht {
  width: 8px;
  height: 8px;
  border-radius: 99px;
  background: var(--text3);
  flex-shrink: 0;
}
.ll-licht.an {
  background: #16a34a;
  box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.5);
  animation: ll-puls 1.6s infinite;
}
@keyframes ll-puls {
  70% {
    box-shadow: 0 0 0 7px rgba(22, 163, 74, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(22, 163, 74, 0);
  }
}
.ll-zeilen {
  max-height: 260px;
  overflow: auto;
  background: #0f1115;
  color: #c9d1d9;
  font: 11.5px/1.55 var(--f-mono);
  padding: 10px 12px;
  border-top: 1px solid var(--linie);
}
.ll-z {
  white-space: pre-wrap;
  word-break: break-all;
}
.ll-z.schritt {
  color: #7ee2a8;
  font-weight: 600;
  margin-top: 4px;
}
.ll-z.schritt:first-child {
  margin-top: 0;
}
.ll-z.fehler {
  color: #ff8a8a;
}
.ll-leer {
  color: #8b949e;
  font-style: italic;
}
.ll-cursor {
  color: #7ee2a8;
  animation: ll-blink 1s steps(2) infinite;
}
@keyframes ll-blink {
  50% {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ll-licht.an,
  .ll-cursor {
    animation: none;
  }
}
</style>
