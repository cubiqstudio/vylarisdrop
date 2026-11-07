<script setup lang="ts">
const theme = useTheme()
const props = defineProps<{ anmeldung?: boolean }>()
const m = computed(() => theme.value.marke)
</script>

<template>
  <footer v-if="m?.fusszeile || m?.hinweis !== false" class="vd-fuss">
    <span v-if="m?.fusszeile">{{ m.fusszeile }}</span>
    <a
      v-if="m?.hinweis !== false"
      href="https://vylaris.eu"
      target="_blank"
      rel="noopener"
      class="hinweis"
      ><Ico n="cloud" />
      {{
        props.anmeldung ? t('Läuft mit VylarisCloud', 'Runs on VylarisCloud') : t('Mit VylarisCloud geteilt', 'Shared with VylarisCloud')
      }}</a
    >
  </footer>
</template>

<style scoped>
.vd-fuss {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  justify-content: center;
  align-items: center;
  padding: 26px 16px 22px;
  font-size: 12px;
  color: var(--text3);
  text-align: center;
}
.hinweis {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  color: var(--text3);
  transition: color 0.2s;
}
.hinweis:hover {
  color: var(--text);
}
.hinweis svg {
  width: 11px;
  height: 11px;
  color: var(--a);
}
</style>
