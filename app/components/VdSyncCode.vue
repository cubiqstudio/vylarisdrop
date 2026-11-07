<script setup lang="ts">
const props = defineProps<{ code: string; titel?: string }>()
const ok = ref(false)
async function los() {
  if (await kopieren(props.code)) {
    ok.value = true
    setTimeout(() => {
      ok.value = false
    }, 1400)
  }
}
</script>

<template>
  <div class="sc">
    <div v-if="titel" class="sc-kopf">{{ titel }}</div>
    <div class="sc-zeile">
      <pre class="mono" tabindex="0"><code>{{ code }}</code></pre>
      <button
        type="button"
        class="sc-kopie"
        :class="{ ok }"
        :aria-label="t('Befehl kopieren', 'Copy command')"
        :title="t('Kopieren', 'Copy')"
        @click="los"
      >
        <Ico :n="ok ? 'check' : 'copy'" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.sc {
  margin: 8px 0 12px;
  min-width: 0;
}
.sc-kopf {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text3);
  margin-bottom: 4px;
}
.sc-zeile {
  position: relative;
  background: var(--bg);
  border: 1px solid var(--linie);
  border-radius: 11px;
}
.sc-zeile pre {
  margin: 0;
  padding: 11px 46px 11px 13px;
  font-size: 12.5px;
  line-height: 1.55;
  overflow-x: auto;
  white-space: pre;
  border-radius: 11px;
}
.sc-zeile pre code {
  font-family: inherit;
}
.sc-kopie {
  position: absolute;
  top: 6px;
  right: 6px;
  border: 0;
  background: var(--flaeche);
  color: var(--text3);
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  cursor: pointer;
  box-shadow: 0 0 0 1px var(--linie);
  transition:
    color 0.15s,
    background 0.15s;
}
.sc-kopie:hover {
  color: var(--text);
  background: var(--flaeche2);
}
.sc-kopie.ok {
  color: var(--ok);
}
.sc-kopie svg {
  width: 14px;
  height: 14px;
}
</style>
