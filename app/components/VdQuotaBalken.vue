<script setup lang="ts">
// Belegungsbalken mit Warnfarben: ab 80 % gelb, ab 95 % rot, bei 100 % voll. Ohne Limit: neutrale Linie.
const props = defineProps<{
  used: number
  limit: number | null
  /** Aufteilung (z. B. nach Dateiart); bei Warnstufen wird stattdessen ein einheitlicher Füllbalken gezeigt */
  segmente?: Array<{ bytes: number; farbe: string; muster?: boolean }>
  klein?: boolean
  gross?: boolean
  beschriftung?: string
}>()
const prozent = computed(() => (props.limit ? (Number(props.used) / Number(props.limit)) * 100 : null))
const stufe = computed<'ok' | 'warn' | 'kritisch' | 'voll'>(() => {
  const p = prozent.value
  return p == null ? 'ok' : p >= 100 ? 'voll' : p >= 95 ? 'kritisch' : p >= 80 ? 'warn' : 'ok'
})
const basis = computed(() => Math.max(1, props.limit || Number(props.used) || 1))
const teile = computed(() => {
  if (props.segmente?.length && stufe.value === 'ok')
    return props.segmente
      .filter((s) => s.bytes > 0)
      .map((s) => ({ ...s, breite: Math.min(100, (s.bytes / basis.value) * 100) }))
  return [{ bytes: props.used, farbe: '', muster: false, breite: Math.min(100, Math.max(props.used > 0 ? 1 : 0, prozent.value ?? 0)) }]
})
</script>

<template>
  <div
    class="qb"
    :class="[stufe, { klein: props.klein, gross: props.gross, offen: props.limit == null }]"
    role="progressbar"
    :aria-label="props.beschriftung || t('Speicherbelegung', 'Storage usage')"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="prozent == null ? undefined : Math.min(100, Math.round(prozent))"
    :aria-valuetext="
      prozent == null
        ? t('Kein Limit', 'No limit')
        : t(`${Math.round(prozent)} % belegt`, `${Math.round(prozent)}% used`)
    "
  >
    <i
      v-for="(s, i) in teile"
      :key="i"
      :class="{ muster: s.muster }"
      :style="{ width: s.breite + '%', ...(s.farbe ? { background: s.farbe } : {}) }"
    ></i>
  </div>
</template>

<style scoped>
.qb {
  --qf: var(--a);
  display: flex;
  gap: 2px;
  height: 8px;
  border-radius: 99px;
  overflow: hidden;
  background: var(--flaeche2);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--linie) 60%, transparent);
}
.qb.klein {
  height: 6px;
}
.qb.gross {
  height: 12px;
}
.qb.warn {
  --qf: #f5b301;
}
.qb.kritisch,
.qb.voll {
  --qf: var(--rot);
}
.qb.offen {
  background: repeating-linear-gradient(135deg, var(--flaeche2) 0 6px, transparent 6px 12px);
}
.qb i {
  display: block;
  height: 100%;
  background: var(--qf);
  transform-origin: left;
  animation: wachsen 0.9s 0.15s var(--kurve) both;
  transition:
    width 0.6s var(--kurve),
    background-color 0.3s;
}
.qb i.muster {
  background: repeating-linear-gradient(135deg, var(--text3) 0 3px, transparent 3px 6px);
  opacity: 0.7;
}
.qb.voll i {
  animation:
    wachsen 0.9s 0.15s var(--kurve) both,
    pulsieren 2.4s 1s ease-in-out infinite;
}
@keyframes pulsieren {
  50% {
    opacity: 0.72;
  }
}
</style>
