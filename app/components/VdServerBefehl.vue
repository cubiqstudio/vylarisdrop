<script setup lang="ts">
const props = defineProps<{ text?: string; befehl?: string }>()
const BEFEHL = computed(
  () =>
    props.befehl ||
    'curl -fsSL https://raw.githubusercontent.com/cubiqstudio/vylarisdrop/main/deploy/update.sh | sudo bash'
)
const kopiert = ref(false)
async function los() {
  if (await kopieren(BEFEHL.value)) {
    kopiert.value = true
    setTimeout(() => {
      kopiert.value = false
    }, 1600)
  }
}
</script>

<template>
  <div class="server-befehl">
    <p v-if="text" class="satz">
      <Ico n="server" /> <span>{{ text }}</span>
    </p>
    <div class="zeile">
      <code class="mono">{{ BEFEHL }}</code
      ><button
        type="button"
        class="knopf nur-icon klein"
        :aria-label="t('Befehl kopieren', 'Copy command')"
        @click="los"
      >
        <Ico :n="kopiert ? 'check' : 'copy'" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.server-befehl {
  display: grid;
  gap: 8px;
  margin: 10px 0;
}
.satz {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin: 0;
  font-size: 12.5px;
  color: var(--text3);
}
.satz > svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  margin-top: 2px;
}
.zeile {
  display: flex;
  gap: 6px;
  align-items: stretch;
  min-width: 0;
}
.zeile code {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  white-space: nowrap;
  font-size: 12px;
  padding: 9px 11px;
  border-radius: 9px;
  border: 1px solid var(--linie);
  background: var(--flaeche2);
}
.zeile button {
  flex-shrink: 0;
}
</style>
