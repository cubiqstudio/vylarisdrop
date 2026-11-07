<script setup lang="ts">
const props = defineProps<{ d: any }>()
const emit = defineEmits<{ (e: 'datei', slug: string): void }>()
const tage = computed<Array<{ tag: string; bytes: number }>>(() => props.d?.tage || [])
const max = computed(() => Math.max(1, ...tage.value.map((x) => x.bytes)))
const datum = (k: string, voll = false) =>
  new Date(k + 'T12:00:00').toLocaleDateString(
    lang() === 'en' ? 'en-GB' : 'de-DE',
    voll ? { weekday: 'short', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'short' }
  )
const achse = computed(() => {
  const n = tage.value.length
  return n ? [0, Math.floor((n - 1) / 2), n - 1].map((i) => ({ i, text: datum(tage.value[i]!.tag) })) : []
})
const hover = ref<number | null>(null)
const anteil = computed(() => (props.d?.grenze ? Math.min(1, props.d.monat / props.d.grenze) : 0))
const stufe = computed(() => (anteil.value >= 1 ? 'voll' : anteil.value >= 0.8 ? 'warn' : ''))
const listeMax = (l: any[]) => Math.max(1, ...l.map((x) => x.bytes))
</script>

<template>
  <div class="traffic">
    <div class="kopfzahl">
      <div>
        <b class="mono">{{ groesse(d.gesamt) }}</b
        ><span>{{ t(`ausgeliefert in ${tage.length} Tagen`, `delivered in ${tage.length} days`) }}</span>
      </div>
      <div class="monat">
        <b class="mono"
          >{{ groesse(d.monat) }}<small v-if="d.grenze"> / {{ groesse(d.grenze) }}</small></b
        >
        <span>{{
          d.grenze ? t('diesen Monat', 'this month') : t('diesen Monat · ohne Grenze', 'this month · no limit')
        }}</span>
        <div
          v-if="d.grenze"
          :class="['leiste', stufe]"
          role="meter"
          :aria-valuenow="Math.round(anteil * 100)"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="t('Traffic-Verbrauch', 'Traffic usage')"
        >
          <i :style="{ width: anteil * 100 + '%' }"></i>
        </div>
      </div>
    </div>
    <p v-if="stufe === 'voll'" class="hinweis voll">
      <Ico n="alert" />
      {{
        t(
          'Das Kontingent ist aufgebraucht — deine Dateien werden bis Monatsende nicht mehr öffentlich ausgeliefert.',
          'The quota is used up — your files are no longer delivered publicly until the end of the month.'
        )
      }}
    </p>

    <div
      class="saeulen"
      role="img"
      :aria-label="
        t(`Traffic pro Tag, insgesamt ${groesse(d.gesamt)}`, `Traffic per day, ${groesse(d.gesamt)} in total`)
      "
      @mouseleave="hover = null"
    >
      <div
        v-for="(x, i) in tage"
        :key="x.tag"
        class="spalte"
        tabindex="0"
        @mouseenter="hover = i"
        @focus="hover = i"
        @blur="hover = null"
      >
        <i
          :class="{ leer: !x.bytes, an: hover === i }"
          :style="{ height: x.bytes ? Math.max(2, (x.bytes / max) * 100) + '%' : '2px' }"
        ></i>
      </div>
      <div
        v-if="hover != null && tage[hover]"
        class="tipp"
        :style="{ left: ((hover + 0.5) / tage.length) * 100 + '%' }"
      >
        <small>{{ datum(tage[hover]!.tag, true) }}</small
        ><b class="mono">{{ groesse(tage[hover]!.bytes) }}</b>
      </div>
    </div>
    <div class="xachse">
      <span v-for="a in achse" :key="a.i" :style="{ left: ((a.i + 0.5) / tage.length) * 100 + '%' }">{{ a.text }}</span>
    </div>

    <section v-if="d.top?.length" class="top">
      <h4>{{ t('Am meisten Traffic', 'Most traffic') }}</h4>
      <component
        :is="x.slug ? 'button' : 'div'"
        v-for="x in d.top"
        :key="x.id"
        type="button"
        :class="['zeile', { klickbar: x.slug }]"
        @click="x.slug && emit('datei', x.slug)"
      >
        <span class="name"
          ><Ico
            :n="({ bild: 'image', video: 'film', audio: 'music', text: 'text' } as any)[x.art] || 'file'"
            class="art"
          />{{ x.name || t('Gelöschte Datei', 'Deleted file') }}</span
        ><span class="mono zahl">{{ groesse(x.bytes) }}</span>
        <i class="balken" :style="{ width: (x.bytes / listeMax(d.top)) * 100 + '%' }"></i>
      </component>
    </section>
    <p v-else class="sehrleise klein">{{ t('Noch kein Traffic gezählt.', 'No traffic counted yet.') }}</p>
  </div>
</template>

<style scoped>
.kopfzahl {
  display: flex;
  gap: 32px;
  align-items: flex-end;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.kopfzahl b {
  display: block;
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.1;
  color: var(--text);
}
.kopfzahl b small {
  font-size: 15px;
  color: var(--text3);
  font-weight: 500;
  letter-spacing: 0;
}
.kopfzahl span {
  font-size: 12px;
  color: var(--text3);
}
.monat {
  min-width: 200px;
}
.leiste {
  height: 6px;
  border-radius: 99px;
  background: var(--linie2);
  margin-top: 7px;
  overflow: hidden;
}
.leiste i {
  display: block;
  height: 100%;
  background: var(--a);
  border-radius: inherit;
  transition: width 0.6s var(--kurve);
}
.leiste.warn i {
  background: var(--warn);
}
.leiste.voll i {
  background: var(--fehler, #ef4444);
}
.hinweis {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  border-radius: 10px;
  padding: 9px 12px;
  margin: 0 0 14px;
}
.hinweis.voll {
  background: var(--warn-bg);
  color: var(--warn);
}
.hinweis svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}
.saeulen {
  position: relative;
  height: 120px;
  display: flex;
  align-items: flex-end;
  border-bottom: 1px solid var(--linie2);
}
.spalte {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0 1px;
  outline: 0;
}
.spalte i {
  display: block;
  width: 100%;
  max-width: 22px;
  background: var(--a);
  border-radius: 4px 4px 0 0;
  opacity: 0.85;
  transition:
    filter 0.15s,
    opacity 0.15s;
}
.spalte i.leer {
  background: var(--linie2);
  opacity: 1;
}
.spalte i.an,
.spalte:focus-visible i {
  opacity: 1;
  filter: brightness(1.15);
}
.tipp {
  position: absolute;
  bottom: calc(100% + 6px);
  transform: translateX(-50%);
  background: var(--flaeche);
  border: 1px solid var(--linie2);
  border-radius: 10px;
  padding: 7px 10px;
  font-size: 12px;
  white-space: nowrap;
  box-shadow: 0 10px 30px -12px rgba(0, 0, 0, 0.35);
  pointer-events: none;
  z-index: 2;
}
.tipp small {
  display: block;
  color: var(--text3);
  font-size: 11px;
}
.tipp b {
  color: var(--text);
  font-size: 14px;
}
.xachse {
  position: relative;
  height: 20px;
  font-size: 10.5px;
  color: var(--text3);
}
.xachse span {
  position: absolute;
  top: 5px;
  transform: translateX(-50%);
  white-space: nowrap;
}
.xachse span:first-child {
  transform: none;
  left: 0 !important;
}
.xachse span:last-child {
  transform: translateX(-100%);
}
.top {
  margin-top: 18px;
}
h4 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text3);
  font-weight: 600;
  margin: 0 0 8px;
}
.zeile {
  position: relative;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px;
  font-size: 13px;
  border-radius: 8px;
  overflow: hidden;
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
  font: inherit;
}
.zeile + .zeile {
  margin-top: 3px;
}
.zeile .name {
  position: relative;
  z-index: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 7px;
}
.zeile .zahl {
  position: relative;
  z-index: 1;
  color: var(--text2);
  font-variant-numeric: tabular-nums;
}
.balken {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: rgba(var(--a-rgb), 0.14);
  border-radius: 8px;
}
.klickbar {
  cursor: pointer;
}
.klickbar:hover .balken {
  background: rgba(var(--a-rgb), 0.22);
}
.art {
  width: 14px;
  height: 14px;
  color: var(--text3);
  flex-shrink: 0;
}
.klein {
  font-size: 12.5px;
  margin: 14px 0 0;
}
</style>
