<script setup lang="ts">
const props = defineProps<{ label: string; wert: string; leise?: boolean }>()
const ok = ref(false)
async function los() {
  if (await kopieren(props.wert)) {
    ok.value = true
    setTimeout(() => {
      ok.value = false
    }, 1400)
  }
}
</script>

<template>
  <div class="kz">
    <span>{{ label }}</span>
    <code :class="{ sehrleise: leise }" :title="wert">{{ wert }}</code>
    <slot
      ><button
        type="button"
        class="kopieren"
        :class="{ ok }"
        :aria-label="t(`${label} kopieren`, `Copy ${label}`)"
        @click="los"
      >
        <Ico :n="ok ? 'check' : 'copy'" /></button
    ></slot>
  </div>
</template>

<style scoped>
.kz {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 8px 8px 8px 12px;
  border-radius: 11px;
  background: var(--bg);
  border: 1px solid var(--linie);
  min-height: 42px;
}
.kz > span {
  color: var(--text3);
  font-size: 12px;
}
.kz code {
  font-family: var(--f-mono);
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kopieren {
  border: 0;
  background: transparent;
  color: var(--text3);
  cursor: pointer;
  padding: 6px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  transition:
    color 0.15s,
    background 0.15s;
}
.kopieren:hover {
  color: var(--text);
  background: var(--flaeche2);
}
.kopieren svg {
  width: 14px;
  height: 14px;
}
.kopieren.ok {
  color: var(--ok);
}
@media (max-width: 520px) {
  .kz {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .kz > span {
    grid-column: 1 / -1;
  }
}
</style>
