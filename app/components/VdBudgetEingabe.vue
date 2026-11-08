<script setup lang="ts">
// Kontingent eingeben (für Storage-Boxen und S3-Buckets): Schieber + Zahlenfeld mit Einheit. Der Höchstwert (`max`, in Bytes)
// ist das, was im Budget noch frei ist — die Eingabe wird nie darüber hinaus zugelassen oder angezeigt. Der Wert (`modelValue`)
// ist immer eine ganze Zahl in Bytes. Der Server prüft unabhängig davon noch einmal (Oberfläche ist nur Komfort).
const props = defineProps<{
  modelValue: number
  /** Kleinster erlaubter Wert in Bytes (z. B. aktuelle Belegung der Box) */
  min: number
  /** Größter erlaubter Wert in Bytes; null = kein Budget-Limit (Admin ohne Limit) */
  max: number | null
  beschriftung?: string
  hinweisId?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [number] }>()
const MiB = 1024 ** 2
const GiB = 1024 ** 3
const TiB = 1024 ** 4
const HOECHST = 1_000_000 * GiB

const untergrenze = computed(() => Math.max(MiB, Math.ceil(props.min / MiB) * MiB))
const obergrenze = computed(() => Math.max(untergrenze.value, Math.min(HOECHST, props.max ?? HOECHST)))
const einheit = ref<'MB' | 'GB' | 'TB'>(props.modelValue >= TiB ? 'TB' : props.modelValue < GiB ? 'MB' : 'GB')
const faktor = computed(() => (einheit.value === 'TB' ? TiB : einheit.value === 'MB' ? MiB : GiB))
const klammern = (b: number) => Math.min(obergrenze.value, Math.max(untergrenze.value, Math.floor(b)))

const feldId = 'be-' + useId()
const text = ref('')
function textAus(b: number) {
  const v = b / faktor.value
  return String(Math.round(v * 1000) / 1000)
}
watch(
  () => [props.modelValue, einheit.value],
  () => {
    if (typeof document === 'undefined' || document.activeElement?.id !== feldId) text.value = textAus(props.modelValue)
  },
  { immediate: true }
)
const abgeschnitten = ref(false)
function tippen(e: Event) {
  const roh = (e.target as HTMLInputElement).value.replace(',', '.')
  text.value = (e.target as HTMLInputElement).value
  const n = Number(roh)
  if (roh.trim() === '' || !Number.isFinite(n) || n < 0) return
  const b = Math.floor(n * faktor.value)
  abgeschnitten.value = b > obergrenze.value
  emit('update:modelValue', klammern(b))
}
function fertig() {
  abgeschnitten.value = false
  text.value = textAus(props.modelValue)
}
// Schrumpft das freie Budget, während der Dialog offen ist (z. B. durch einen parallelen Upload), wird der Wert nachgezogen
watch(obergrenze, (o) => {
  if (props.modelValue > o) emit('update:modelValue', o)
})
const sliderMax = computed(() => Math.floor(obergrenze.value / MiB))
const sliderMin = computed(() => Math.ceil(untergrenze.value / MiB))
const einheitFuer = (b: number) => (b >= TiB ? 'TB' : b < GiB ? 'MB' : 'GB')
function schieben(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  abgeschnitten.value = false
  const b = v >= sliderMax.value ? obergrenze.value : klammern(v * MiB)
  // die Einheit folgt dem Schieber, damit kleine Werte lesbar bleiben (1 MB statt 0,001 GB)
  einheit.value = einheitFuer(b)
  emit('update:modelValue', b)
}
const sliderWert = computed(() => Math.min(sliderMax.value, Math.max(sliderMin.value, Math.floor(props.modelValue / MiB))))
const anteil = computed(() => {
  const spanne = Math.max(1, sliderMax.value - sliderMin.value)
  return ((sliderWert.value - sliderMin.value) / spanne) * 100
})
const zeigeSchieber = computed(() => props.max != null && sliderMax.value > sliderMin.value)
</script>

<template>
  <div class="be">
    <div v-if="zeigeSchieber" class="be-schieber">
      <input
        type="range"
        :min="sliderMin"
        :max="sliderMax"
        step="1"
        :value="sliderWert"
        :style="{ '--p': anteil + '%' }"
        :aria-label="(beschriftung || t('Kontingent', 'Quota')) + ' — ' + t('Schieber', 'slider')"
        :aria-valuetext="groesse(modelValue)"
        :aria-describedby="hinweisId"
        @input="schieben"
      />
      <div class="be-skala" aria-hidden="true"><span>{{ groesse(untergrenze) }}</span><span>{{ groesse(obergrenze) }}</span></div>
    </div>
    <div class="be-feld">
      <input
        :id="feldId"
        class="eingabe mono"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        :value="text"
        :aria-label="(beschriftung || t('Kontingent', 'Quota')) + ' (' + einheit + ')'"
        :aria-describedby="hinweisId"
        @input="tippen"
        @blur="fertig"
      />
      <VdAuswahl v-model="einheit" class="eingabe" :aria-label="t('Einheit', 'Unit')">
        <option>MB</option>
        <option>GB</option>
        <option>TB</option>
      </VdAuswahl>
    </div>
    <p class="be-info" aria-live="polite">
      <b class="zahl">{{ groesse(modelValue) }}</b>
      <template v-if="max != null"> · {{ t('höchstens', 'at most') }} {{ groesse(obergrenze) }}</template>
      <span v-if="abgeschnitten" class="warn-text"> — {{ t('mehr ist nicht frei, auf den Höchstwert gesetzt', 'more is not free, set to the maximum') }}</span>
    </p>
  </div>
</template>

<style scoped>
.be {
  display: grid;
  gap: 8px;
}
.be-schieber input[type='range'] {
  width: 100%;
  height: 28px;
  margin: 0;
  background: transparent;
  accent-color: var(--a);
  cursor: pointer;
}
.be-skala {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text3);
  font-variant-numeric: tabular-nums;
}
.be-feld {
  display: flex;
  gap: 8px;
}
.be-feld .eingabe:first-child {
  flex: 1;
  min-width: 0;
}
.be-feld .vd-wahl {
  width: 90px;
  flex: none;
}
.be-info {
  margin: 0;
  font-size: 12.5px;
  color: var(--text2);
}
.be-info b {
  color: var(--text);
}
.warn-text {
  color: var(--warn);
}
</style>
