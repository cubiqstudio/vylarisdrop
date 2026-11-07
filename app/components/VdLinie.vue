<script setup lang="ts">
const props = defineProps<{
  punkte: Array<{ zeit: string; wert: number }>
  format?: (n: number) => string
  ton?: 'rot'
  hoehe?: number
  ausschnitt?: boolean
  leerText?: string
}>()
const H = computed(() => props.hoehe || 120)
const B = 600
const fmt = (n: number) => (props.format ? props.format(n) : zahl(n, n < 10 && n % 1 ? 1 : 0))
const spanne = computed(() => {
  const w = props.punkte.map((p) => p.wert)
  const lo = w.length ? Math.min(...w) : 0,
    hi = w.length ? Math.max(...w) : 0
  const d = hi - lo || Math.max(1, hi * 0.05)
  return { min: Math.max(0, lo - d * 0.3), max: hi + d * 0.2 }
})
const min = computed(() => (props.ausschnitt ? spanne.value.min : 0))
const max = computed(() => {
  if (props.ausschnitt) return spanne.value.max
  const m = Math.max(0, ...props.punkte.map((p) => p.wert))
  if (m <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(m))
  for (const f of [1, 2, 2.5, 4, 5, 8, 10]) if (f * p >= m) return f * p
  return 10 * p
})
const x = (i: number) => (props.punkte.length <= 1 ? B / 2 : (i / (props.punkte.length - 1)) * B)
const y = (v: number) => H.value - 4 - ((v - min.value) / Math.max(1e-9, max.value - min.value)) * (H.value - 12)
const linie = computed(() =>
  props.punkte.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.wert).toFixed(1)}`).join('')
)
const flaeche = computed(() =>
  props.punkte.length ? `${linie.value}L${x(props.punkte.length - 1).toFixed(1)},${H.value}L0,${H.value}Z` : ''
)
const hover = ref<number | null>(null)
const box = ref<HTMLElement | null>(null)
function bewegen(e: PointerEvent) {
  const r = box.value!.getBoundingClientRect()
  const anteil = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  hover.value = props.punkte.length ? Math.round(anteil * (props.punkte.length - 1)) : null
}
const zeitText = (z: string) =>
  new Date(z).toLocaleString(lang() === 'en' ? 'en-GB' : 'de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
const achse = computed(() => {
  const n = props.punkte.length
  return n ? [0, Math.floor((n - 1) / 2), n - 1].map((i) => ({ i, t: zeitText(props.punkte[i]!.zeit) })) : []
})
const id = `v${Math.random().toString(36).slice(2, 8)}`
</script>

<template>
  <div class="linie" :class="{ rot: ton === 'rot' }">
    <div
      ref="box"
      class="flaeche-box"
      :style="{ height: H + 'px' }"
      @pointermove="bewegen"
      @pointerleave="hover = null"
    >
      <div class="gitter" aria-hidden="true">
        <span v-for="v in [max, (max + min) / 2]" :key="v" :style="{ top: (y(v) / H) * 100 + '%' }"
          ><i class="mono">{{ fmt(v) }}</i></span
        >
      </div>
      <svg
        :viewBox="`0 0 ${B} ${H}`"
        preserveAspectRatio="none"
        role="img"
        :aria-label="punkte.length ? `${fmt(punkte[punkte.length - 1]!.wert)}` : ''"
      >
        <defs>
          <linearGradient :id="id" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="currentColor" stop-opacity=".22" />
            <stop offset="1" stop-color="currentColor" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path v-if="flaeche" :d="flaeche" :fill="`url(#${id})`" />
        <path
          v-if="linie"
          :d="linie"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          vector-effect="non-scaling-stroke"
          stroke-linejoin="round"
        />
        <line
          v-if="hover != null"
          :x1="x(hover)"
          :x2="x(hover)"
          y1="0"
          :y2="H"
          class="kreuz"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <i
        v-if="punkte.length && hover == null"
        class="punkt"
        :style="{
          left: (x(punkte.length - 1) / B) * 100 + '%',
          top: (y(punkte[punkte.length - 1]!.wert) / H) * 100 + '%'
        }"
      ></i>
      <i
        v-if="hover != null && punkte[hover]"
        class="punkt"
        :style="{ left: (x(hover) / B) * 100 + '%', top: (y(punkte[hover]!.wert) / H) * 100 + '%' }"
      ></i>
      <div
        v-if="hover != null && punkte[hover]"
        class="tipp"
        :class="{ rechts: hover > punkte.length / 2 }"
        :style="{ left: (x(hover) / B) * 100 + '%' }"
      >
        <small>{{ zeitText(punkte[hover]!.zeit) }}</small
        ><b class="mono">{{ fmt(punkte[hover]!.wert) }}</b>
      </div>
      <p v-if="!punkte.length" class="leer sehrleise">
        {{ leerText || t('Noch keine Messwerte — sie kommen jede Minute.', 'No data yet — it arrives every minute.') }}
      </p>
    </div>
    <div class="xachse">
      <span v-for="a in achse" :key="a.i" :style="{ left: (a.i / Math.max(1, punkte.length - 1)) * 100 + '%' }">{{
        a.t
      }}</span>
    </div>
  </div>
</template>

<style scoped>
.linie {
  color: var(--a);
}
.linie.rot {
  color: var(--rot);
}
.flaeche-box {
  position: relative;
  padding-left: 0;
}
svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.gitter span {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px dashed var(--linie);
}
.gitter i {
  position: absolute;
  left: 0;
  top: -8px;
  font-style: normal;
  font-size: 10px;
  line-height: 14px;
  color: var(--text3);
  background: var(--flaeche);
  padding: 0 6px 0 0;
  z-index: 1;
}
.kreuz {
  stroke: var(--linie2);
  stroke-width: 1;
}
.punkt {
  position: absolute;
  width: 9px;
  height: 9px;
  margin: -4.5px 0 0 -4.5px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 2px var(--flaeche);
  pointer-events: none;
}
.tipp {
  position: absolute;
  top: -6px;
  transform: translate(-50%, -100%);
  background: var(--flaeche);
  border: 1px solid var(--linie2);
  border-radius: 10px;
  padding: 6px 10px;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 10px 30px -12px rgba(0, 0, 0, 0.35);
  z-index: 2;
  color: var(--text);
}
.tipp small {
  display: block;
  font-size: 11px;
  color: var(--text3);
}
.tipp b {
  font-size: 14px;
}
.leer {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 12px;
  margin: 0;
}
.xachse {
  position: relative;
  height: 18px;
  font-size: 10.5px;
  color: var(--text3);
  margin-top: 4px;
}
.xachse span {
  position: absolute;
  transform: translateX(-50%);
  white-space: nowrap;
}
.xachse span:first-child {
  transform: none;
}
.xachse span:last-child {
  transform: translateX(-100%);
}
</style>
