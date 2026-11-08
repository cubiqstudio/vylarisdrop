<script setup lang="ts">
// Auswahlfeld für eine Liste (z. B. Konten, Ordner, Ziele): Auswahl + Chips zum Entfernen, optional mit Reihenfolge (hoch/runter)
const props = defineProps<{
  modelValue: Array<string | number>
  optionen: Array<{ v: string | number; t: string }>
  label: string
  platzhalter: string
  ordnung?: boolean
  max?: number
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: Array<string | number>): void }>()
const id = useId()
const text = (v: string | number) => props.optionen.find((o) => o.v === v)?.t ?? String(v)
const frei = computed(() => props.optionen.filter((o) => !props.modelValue.includes(o.v)))
const wahl = ref('')
function hinzu() {
  if (wahl.value === '') return
  const o = props.optionen.find((x) => String(x.v) === wahl.value)
  if (o && !props.modelValue.includes(o.v) && props.modelValue.length < (props.max || 50)) emit('update:modelValue', [...props.modelValue, o.v])
  wahl.value = ''
}
const weg = (v: string | number) => emit('update:modelValue', props.modelValue.filter((x) => x !== v))
function schieben(i: number, d: number) {
  const l = [...props.modelValue]
  const j = i + d
  if (j < 0 || j >= l.length) return
  ;[l[i], l[j]] = [l[j]!, l[i]!]
  emit('update:modelValue', l)
}
</script>

<template>
  <div class="al">
    <label :for="id" class="al-label">{{ label }}</label>
    <ul v-if="modelValue.length" class="al-chips" :aria-label="label">
      <li v-for="(v, i) in modelValue" :key="String(v)" class="chip neutral al-chip">
        <span class="al-t">{{ text(v) }}</span>
        <template v-if="ordnung">
          <button type="button" class="al-b" :disabled="i === 0" :aria-label="t('Nach oben', 'Move up') + ': ' + text(v)" @click="schieben(i, -1)"><Ico n="up" /></button>
          <button type="button" class="al-b" :disabled="i === modelValue.length - 1" :aria-label="t('Nach unten', 'Move down') + ': ' + text(v)" @click="schieben(i, 1)"><Ico n="down" /></button>
        </template>
        <button type="button" class="al-b" :aria-label="t('Entfernen', 'Remove') + ': ' + text(v)" @click="weg(v)"><Ico n="x" /></button>
      </li>
    </ul>
    <select :id="id" v-model="wahl" class="eingabe al-sel" :disabled="!frei.length" @change="hinzu">
      <option value="">{{ frei.length ? platzhalter : t('Nichts weiter zur Auswahl', 'Nothing else to choose') }}</option>
      <option v-for="o in frei" :key="String(o.v)" :value="String(o.v)">{{ o.t }}</option>
    </select>
  </div>
</template>

<style scoped>
.al {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.al-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text2);
}
.al-chips {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.al-chip {
  padding: 3px 4px 3px 10px;
  max-width: 100%;
}
.al-t {
  overflow: hidden;
  text-overflow: ellipsis;
}
.al-b {
  border: 0;
  background: transparent;
  color: var(--text2);
  cursor: pointer;
  padding: 3px;
  border-radius: 99px;
  display: inline-grid;
  place-items: center;
  min-width: 22px;
  min-height: 22px;
}
.al-b:hover:not(:disabled) {
  background: var(--flaeche);
  color: var(--text);
}
.al-b:disabled {
  opacity: 0.35;
  cursor: default;
}
.al-b:focus-visible {
  outline: 2px solid var(--a);
  outline-offset: 1px;
}
.al-sel {
  font-size: 13px;
  padding: 7px 10px;
}
</style>
