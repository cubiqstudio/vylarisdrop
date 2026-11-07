<script setup lang="ts">
const props = defineProps<{ d: any; kompakt?: boolean }>()
const emit = defineEmits<{ (e: 'datei', slug: string): void }>()
const tage = computed<Array<{ tag: string; n: number }>>(() => props.d?.tage || [])
const max = computed(() => Math.max(1, ...tage.value.map((x) => x.n)))
const oben = computed(() => {
  const m = max.value,
    p = 10 ** Math.floor(Math.log10(m))
  for (const f of [1, 2, 4, 5, 6, 8, 10]) if (f * p >= m) return f * p
  return 10 * p
})
const linien = computed(() =>
  [oben.value, oben.value / 2].filter(Number.isInteger).map((v) => ({ v, y: 100 - (v / oben.value) * 100 }))
)
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
const landName = (code: string) => {
  if (!code) return t('Unbekannt', 'Unknown')
  try {
    return new Intl.DisplayNames([lang()], { type: 'region' }).of(code) || code
  } catch {
    return code
  }
}
const quelleName = (q: string) =>
  q === 'direkt'
    ? t('Direkt / unbekannt', 'Direct / unknown')
    : q === 'intern'
      ? t('Von VylarisCloud selbst', 'From VylarisCloud itself')
      : q
const listeMax = (l: any[]) => Math.max(1, ...l.map((x) => x.n))
const tabelle = ref(false)
</script>

<template>
  <div class="stat">
    <div class="kopfzahl">
      <div>
        <b class="mono">{{ zahl(d.gesamt) }}</b
        ><span>{{ t(`Aufrufe in ${tage.length} Tagen`, `views in ${tage.length} days`) }}</span>
      </div>
      <div v-if="d.insgesamt != null">
        <b class="mono">{{ zahl(d.insgesamt) }}</b
        ><span>{{ t('insgesamt', 'all time') }}</span>
      </div>
      <button type="button" class="knopf klein ansicht" :aria-pressed="tabelle" @click="tabelle = !tabelle">
        <Ico :n="tabelle ? 'chart' : 'list'" /> {{ tabelle ? t('Diagramm', 'Chart') : t('Tabelle', 'Table') }}
      </button>
    </div>

    <div v-if="!tabelle" class="saeulen-box">
      <div class="gitter" aria-hidden="true">
        <div v-for="l in linien" :key="l.v" class="hlinie" :style="{ top: l.y + '%' }">
          <span class="mono">{{ zahl(l.v) }}</span>
        </div>
      </div>
      <div
        class="saeulen"
        role="img"
        :aria-label="t(`Aufrufe pro Tag, insgesamt ${d.gesamt}`, `Views per day, ${d.gesamt} in total`)"
        @mouseleave="hover = null"
      >
        <div
          v-for="(x, i) in tage"
          :key="x.tag"
          class="spalte"
          @mouseenter="hover = i"
          @focus="hover = i"
          @blur="hover = null"
          tabindex="0"
        >
          <i
            :class="{ leer: !x.n, an: hover === i }"
            :style="{ height: x.n ? Math.max(2, (x.n / oben) * 100) + '%' : '2px' }"
          ></i>
        </div>
        <div
          v-if="hover != null && tage[hover]"
          class="tipp"
          :style="{ left: ((hover + 0.5) / tage.length) * 100 + '%' }"
        >
          <small>{{ datum(tage[hover]!.tag, true) }}</small
          ><b class="mono">{{ zahl(tage[hover]!.n) }}</b>
          {{ tage[hover]!.n === 1 ? t('Aufruf', 'view') : t('Aufrufe', 'views') }}
        </div>
      </div>
      <div class="xachse">
        <span v-for="a in achse" :key="a.i" :style="{ left: ((a.i + 0.5) / tage.length) * 100 + '%' }">{{
          a.text
        }}</span>
      </div>
    </div>
    <div v-else class="tabelle-box">
      <table>
        <thead>
          <tr>
            <th>{{ t('Tag', 'Day') }}</th>
            <th class="r">{{ t('Aufrufe', 'Views') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in [...tage].reverse()" :key="x.tag">
            <td>{{ datum(x.tag, true) }}</td>
            <td class="r mono">{{ zahl(x.n) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div :class="['listen', { kompakt }]">
      <section>
        <h4>{{ t('Herkunft', 'Sources') }}</h4>
        <p v-if="!d.quellen?.length" class="sehrleise">{{ t('Noch keine Aufrufe.', 'No views yet.') }}</p>
        <div v-for="x in d.quellen" :key="x.name" class="zeile">
          <span class="name">{{ quelleName(x.name) }}</span
          ><span class="mono zahl">{{ zahl(x.n) }}</span>
          <i class="balken" :style="{ width: (x.n / listeMax(d.quellen)) * 100 + '%' }"></i>
        </div>
      </section>
      <section>
        <h4>{{ t('Länder', 'Countries') }}</h4>
        <p v-if="!d.laender?.length" class="sehrleise">{{ t('Noch keine Aufrufe.', 'No views yet.') }}</p>
        <div v-for="x in d.laender" :key="x.code" class="zeile">
          <span class="name"
            ><span class="kuerzel mono">{{ x.code || '??' }}</span
            >{{ landName(x.code) }}</span
          ><span class="mono zahl">{{ zahl(x.n) }}</span>
          <i class="balken" :style="{ width: (x.n / listeMax(d.laender)) * 100 + '%' }"></i>
        </div>
      </section>
      <section v-if="d.top?.length" class="breit">
        <h4>{{ t('Meistgesehen', 'Most viewed') }}</h4>
        <button v-for="x in d.top" :key="x.id" type="button" class="zeile klickbar" @click="emit('datei', x.slug)">
          <span class="name"
            ><Ico
              :n="({ bild: 'image', video: 'film', audio: 'music', text: 'text' } as any)[x.art] || 'file'"
              class="art"
            />{{ x.name }}</span
          ><span class="mono zahl">{{ zahl(x.n) }}</span>
          <i class="balken" :style="{ width: (x.n / listeMax(d.top)) * 100 + '%' }"></i>
        </button>
      </section>
    </div>
    <p class="quelle-hinweis sehrleise">
      {{
        t(
          'Gezählt werden nur Aufrufe von außen, ohne IP-Adressen. Länder:',
          'Only outside views are counted, without IP addresses. Countries:'
        )
      }}
      <a href="https://db-ip.com" target="_blank" rel="noopener">IP Geolocation by DB-IP</a>
    </p>
  </div>
</template>

<style scoped>
.kopfzahl {
  display: flex;
  gap: 26px;
  align-items: flex-end;
  margin-bottom: 16px;
}
.kopfzahl b {
  display: block;
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.1;
  color: var(--text);
}
.kopfzahl span {
  font-size: 12px;
  color: var(--text3);
}
.ansicht {
  margin-left: auto;
}
.saeulen-box {
  position: relative;
  padding-left: 34px;
}
.gitter {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 150px;
  pointer-events: none;
}
.hlinie {
  position: absolute;
  left: 34px;
  right: 0;
  border-top: 1px dashed var(--linie);
}
.hlinie span {
  position: absolute;
  left: -34px;
  top: -7px;
  width: 28px;
  text-align: right;
  font-size: 10px;
  color: var(--text3);
}
.saeulen {
  position: relative;
  height: 150px;
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
  cursor: default;
  outline: 0;
}
.spalte i {
  display: block;
  width: 100%;
  max-width: 22px;
  background: var(--a);
  border-radius: 4px 4px 0 0;
  transition:
    filter 0.15s,
    opacity 0.15s;
  opacity: 0.85;
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
.spalte:focus-visible i {
  outline: 2px solid var(--text);
  outline-offset: 1px;
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
  color: var(--text2);
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
.tabelle-box {
  max-height: 220px;
  overflow: auto;
  border: 1px solid var(--linie);
  border-radius: 10px;
}
.tabelle-box table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.tabelle-box th,
.tabelle-box td {
  padding: 6px 12px;
  border-bottom: 1px solid var(--linie);
  text-align: left;
}
.tabelle-box th {
  font-size: 11px;
  color: var(--text3);
  font-weight: 600;
  position: sticky;
  top: 0;
  background: var(--flaeche);
}
.r {
  text-align: right !important;
  font-variant-numeric: tabular-nums;
}
.listen {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px 26px;
  margin-top: 22px;
}
.listen.kompakt {
  margin-top: 16px;
}
.listen .breit {
  grid-column: 1 / -1;
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
  transition: width 0.6s var(--kurve);
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
.kuerzel {
  font-size: 10px;
  color: var(--text3);
  width: 18px;
  flex-shrink: 0;
}
.quelle-hinweis {
  font-size: 11px;
  margin: 18px 0 0;
}
.quelle-hinweis a {
  color: inherit;
}
@media (max-width: 640px) {
  .listen {
    grid-template-columns: 1fr;
  }
}
</style>
