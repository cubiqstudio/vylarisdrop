<script setup lang="ts">
// Kontingent bearbeiten: Einheitenwahl (MB/GB/TB), Voreinstellungen, "Standard (erben)" und "Unbegrenzt".
// Wert (v-model): null = erbt (bzw. "kein Limit" bei art="einfach"), -1 = unbegrenzt, > 0 = Bytes, undefined = Eingabe unvollständig.
const props = withDefaults(
  defineProps<{
    modelValue: number | null | undefined
    /** 'konto': erben / unbegrenzt / Limit · 'einfach': kein Limit / Limit (Team, Instanz-Standard) */
    art?: 'konto' | 'einfach'
    /** Hinweis unter "erben", z. B. "Erbt derzeit: 5 GB (Standard)" */
    erbtText?: string
    idPrefix?: string
  }>(),
  { art: 'konto', erbtText: '', idPrefix: 'qe' }
)
const emit = defineEmits<{ (e: 'update:modelValue', v: number | null | undefined): void }>()

const EINHEITEN = [
  { k: 'MB', f: 1024 ** 2 },
  { k: 'GB', f: 1024 ** 3 },
  { k: 'TB', f: 1024 ** 4 }
] as const
const VORGABEN = [5, 10, 50, 100, 500]
const faktor = (e: string) => EINHEITEN.find((x) => x.k === e)!.f

const modus = ref<'erben' | 'unbegrenzt' | 'limit'>('erben')
const einheit = ref<'MB' | 'GB' | 'TB'>('GB')
const eingabe = ref('')

let intern = false
function ausWert(v: number | null | undefined) {
  if (v === undefined) return
  intern = true
  void nextTick(() => (intern = false))
  if (v === null) return void (modus.value = 'erben')
  if (v < 0) return void (modus.value = 'unbegrenzt')
  modus.value = 'limit'
  const e = v >= 1024 ** 4 && v % 1024 ** 3 === 0 ? 'TB' : v >= 1024 ** 3 && v % 1024 ** 2 === 0 ? 'GB' : v >= 1024 ** 2 ? 'MB' : 'GB'
  einheit.value = e
  eingabe.value = String(Math.round((v / faktor(e)) * 1000) / 1000)
}
watch(() => props.modelValue, (v) => {
  // nur übernehmen, wenn der Wert von außen kommt (nicht unsere eigene Eingabe)
  if (v !== aktuell()) ausWert(v)
}, { immediate: true })

function aktuell(): number | null | undefined {
  if (modus.value === 'erben') return null
  if (modus.value === 'unbegrenzt') return -1
  const n = Number(String(eingabe.value).replace(',', '.'))
  if (!eingabe.value || !Number.isFinite(n) || n <= 0) return undefined
  return Math.round(n * faktor(einheit.value))
}
const senden = () => emit('update:modelValue', aktuell())
watch(einheit, () => {
  if (!intern) senden()
})

function waehle(m: 'erben' | 'unbegrenzt' | 'limit') {
  modus.value = m
  if (m === 'limit' && !eingabe.value) {
    eingabe.value = '10'
    einheit.value = 'GB'
  }
  senden()
}
function vorgabe(gb: number) {
  modus.value = 'limit'
  einheit.value = 'GB'
  eingabe.value = String(gb)
  senden()
}
const gewaehltGb = (gb: number) => modus.value === 'limit' && einheit.value === 'GB' && Number(eingabe.value) === gb
const idL = computed(() => props.idPrefix + '-limit')
const optionen = computed(() => [
  ...(props.art === 'konto'
    ? [
        { m: 'erben' as const, text: t('Standard (erben)', 'Default (inherit)') },
        { m: 'unbegrenzt' as const, text: t('Unbegrenzt', 'Unlimited') }
      ]
    : [{ m: 'erben' as const, text: t('Kein Limit', 'No limit') }]),
  { m: 'limit' as const, text: t('Eigenes Limit', 'Custom limit') }
])
</script>

<template>
  <div class="qe">
    <div class="seg" role="radiogroup" :aria-label="t('Kontingent', 'Quota')">
      <button
        v-for="o in optionen"
        :key="o.m"
        type="button"
        role="radio"
        :aria-checked="modus === o.m"
        :class="{ an: modus === o.m }"
        @click="waehle(o.m)"
      >
        {{ o.text }}
      </button>
    </div>
    <p v-if="modus === 'erben' && props.erbtText" class="sehrleise erkl">{{ props.erbtText }}</p>
    <p v-else-if="modus === 'unbegrenzt'" class="sehrleise erkl">
      {{ t('Dieses Konto ist nie eingeschränkt — auch nicht durch Rolle oder Standard.', 'This account is never restricted — not by role or default either.') }}
    </p>
    <template v-if="modus === 'limit'">
      <div class="zeile">
        <input
          :id="idL"
          v-model="eingabe"
          class="eingabe zahl-feld"
          type="number"
          inputmode="decimal"
          min="0"
          step="any"
          :aria-label="t('Menge', 'Amount')"
          @input="senden"
        />
        <VdAuswahl v-model="einheit" class="eingabe einh" :aria-label="t('Einheit', 'Unit')">
          <option v-for="e in EINHEITEN" :key="e.k" :value="e.k">{{ e.k }}</option>
        </VdAuswahl>
      </div>
      <div class="vorgaben" role="group" :aria-label="t('Voreinstellungen', 'Presets')">
        <button
          v-for="g in VORGABEN"
          :key="g"
          type="button"
          class="vorgabe"
          :class="{ an: gewaehltGb(g) }"
          @click="vorgabe(g)"
        >
          {{ g }} GB
        </button>
      </div>
      <p v-if="props.modelValue === undefined" class="fehl">{{ t('Bitte eine Zahl größer 0 eingeben.', 'Please enter a number greater than 0.') }}</p>
    </template>
  </div>
</template>

<style scoped>
.qe {
  display: grid;
  gap: 10px;
}
.erkl {
  margin: 0;
  font-size: 12px;
}
.zeile {
  display: grid;
  grid-template-columns: 1fr 96px;
  gap: 8px;
}
.vorgaben {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.vorgabe {
  border: 1px solid var(--linie);
  background: var(--flaeche);
  color: var(--text2);
  border-radius: 99px;
  padding: 4px 11px;
  font-size: 12px;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s,
    color 0.15s;
}
.vorgabe:hover {
  border-color: var(--linie2);
  color: var(--text);
}
.vorgabe.an {
  border-color: rgba(var(--a-rgb), 0.55);
  background: rgba(var(--a-rgb), 0.1);
  color: var(--a);
}
.vorgabe:focus-visible {
  outline: 2px solid var(--a);
  outline-offset: 2px;
}
.fehl {
  margin: 0;
  color: var(--rot);
  font-size: 12px;
}
</style>
