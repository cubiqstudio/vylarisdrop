<script setup lang="ts">
// Liste und Raster des Dateimanagers. Hält keinen Zustand, meldet alles an die Seite.
import type { CloudEintrag, CloudSortierung } from '~/composables/useCloud'

const props = defineProps<{
  eintraege: CloudEintrag[]
  darstellung: 'liste' | 'raster'
  auswahl: Set<string>
  fokus: string | null
  umbenennen: string | null
  zielKey: string | null
  zieht: string[]
  sort: CloudSortierung
  richtung: 'auf' | 'ab'
  mitPfad: boolean
}>()
const emit = defineEmits<{
  (e: 'klick', x: CloudEintrag, ev: MouseEvent): void
  (e: 'oeffnen', x: CloudEintrag): void
  (e: 'kontext', x: CloudEintrag | null, pos: { x: number; y: number }): void
  (e: 'sortieren', k: CloudSortierung): void
  (e: 'umbenannt', x: CloudEintrag, name: string | null): void
  (e: 'haken', x: CloudEintrag): void
  (e: 'favorit', x: CloudEintrag): void
  (e: 'alle'): void
  (e: 'leer'): void
  (e: 'ziehstart', x: CloudEintrag, ev: DragEvent): void
  (e: 'ziehende'): void
  (e: 'ueber', key: string, ev: DragEvent): void
  (e: 'weg', key: string): void
  (e: 'ablegen', key: string, ev: DragEvent): void
}>()

const wurzel = ref<HTMLElement | null>(null)
defineExpose({ wurzel })
const key = (e: CloudEintrag) => eintragKey(e)
const alleAn = computed(() => props.eintraege.length > 0 && props.auswahl.size >= props.eintraege.length)
const teilweise = computed(() => props.auswahl.size > 0 && !alleAn.value)

// ----- Umbenennen -----
const eingabe = ref<HTMLInputElement[] | HTMLInputElement | null>(null)
let fertig = false
watch(
  () => props.umbenennen,
  (k) => {
    if (!k) return
    fertig = false
    void nextTick(() => {
      const el = Array.isArray(eingabe.value) ? eingabe.value[0] : eingabe.value
      const e = props.eintraege.find((x) => key(x) === k)
      if (!el || !e) return
      el.focus()
      // Der Name ohne Endung ist markiert; mit Umschalt+Pfeil lässt sich die Endung dazunehmen
      el.setSelectionRange(0, stammLaenge(e.name, e.typ === 'ordner'))
    })
  }
)
function bestaetigen(e: CloudEintrag, ev: Event) {
  if (fertig) return
  fertig = true
  emit('umbenannt', e, (ev.target as HTMLInputElement).value)
}
function abbrechen(e: CloudEintrag) {
  fertig = true
  emit('umbenannt', e, null)
}

// ----- Langes Drücken (Touch) öffnet das Kontextmenü -----
let druckTimer: any = null
let druckStart = { x: 0, y: 0 }
let letztesMenue = 0
function druckAn(e: CloudEintrag, ev: PointerEvent) {
  if (ev.pointerType !== 'touch') return
  druckStart = { x: ev.clientX, y: ev.clientY }
  clearTimeout(druckTimer)
  druckTimer = setTimeout(() => {
    letztesMenue = Date.now()
    navigator.vibrate?.(12)
    emit('kontext', e, { x: druckStart.x, y: druckStart.y })
  }, 520)
}
function druckBewegt(ev: PointerEvent) {
  if (Math.hypot(ev.clientX - druckStart.x, ev.clientY - druckStart.y) > 10) clearTimeout(druckTimer)
}
const druckEnde = () => clearTimeout(druckTimer)
function menue(e: CloudEintrag | null, ev: MouseEvent) {
  ev.preventDefault()
  if (Date.now() - letztesMenue < 900) return
  letztesMenue = Date.now()
  emit('kontext', e, { x: ev.clientX, y: ev.clientY })
}
function klicke(e: CloudEintrag, ev: MouseEvent) {
  if (Date.now() - letztesMenue < 900) return
  emit('klick', e, ev)
}
function punkteKnopf(e: CloudEintrag, ev: MouseEvent) {
  const r = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  emit('kontext', e, { x: r.right - 4, y: r.bottom + 4 })
}

// ----- Ziehen -----
const istOrdner = (e: CloudEintrag) => e.typ === 'ordner'
function ueber(e: CloudEintrag, ev: DragEvent) {
  if (!istOrdner(e)) return
  emit('ueber', key(e), ev)
}
function ablegenAuf(e: CloudEintrag, ev: DragEvent) {
  if (!istOrdner(e)) return
  emit('ablegen', key(e), ev)
}

const groessenText = (e: CloudEintrag) =>
  e.typ === 'ordner'
    ? e.anzahl === 0
      ? t('leer', 'empty')
      : mehrzahl(e.anzahl, ['Element', 'Elemente'], ['item', 'items'])
    : groesse(e.size)
const datumText = (e: CloudEintrag) => (e.geaendert_at ? vorher(e.geaendert_at) : '—')
const datumLang = (e: CloudEintrag) => (e.geaendert_at ? zeitpunkt(e.geaendert_at) : '')
const SPALTEN: Array<{ k: CloudSortierung; de: string; en: string }> = [
  { k: 'name', de: 'Name', en: 'Name' },
  { k: 'groesse', de: 'Größe', en: 'Size' },
  { k: 'datum', de: 'Geändert', en: 'Modified' }
]
const ariaSort = (k: CloudSortierung) => (props.sort === k ? (props.richtung === 'auf' ? 'ascending' : 'descending') : 'none')
</script>

<template>
  <div
    ref="wurzel"
    class="cl"
    :class="[darstellung, { zieht: zieht.length > 0 }]"
    role="grid"
    aria-multiselectable="true"
    tabindex="0"
    :aria-label="t('Dateien und Ordner', 'Files and folders')"
    :aria-activedescendant="fokus ? 'cz-' + fokus : undefined"
    @click.self="emit('leer')"
    @contextmenu.self="menue(null, $event)"
  >
    <div v-if="darstellung === 'liste'" class="kopfzeile" role="row">
      <span class="c-haken" role="columnheader">
        <button
          type="button"
          class="haken"
          :class="{ an: alleAn, teil: teilweise }"
          role="checkbox"
          :aria-checked="teilweise ? 'mixed' : alleAn"
          :aria-label="t('Alle auswählen', 'Select all')"
          @click="emit('alle')"
        >
          <Ico n="check" />
        </button>
      </span>
      <button
        v-for="s in SPALTEN"
        :key="s.k"
        type="button"
        role="columnheader"
        class="spalte"
        :class="['c-' + s.k, { an: sort === s.k }]"
        :aria-sort="ariaSort(s.k)"
        @click="emit('sortieren', s.k)"
      >
        {{ t(s.de, s.en) }}
        <Ico v-if="sort === s.k" :n="richtung === 'auf' ? 'up' : 'down'" />
      </button>
      <span class="c-akt"></span>
    </div>

    <div
      v-for="e in eintraege"
      :id="'cz-' + key(e)"
      :key="key(e)"
      class="zeile"
      :class="{
        gewaehlt: auswahl.has(key(e)),
        fokus: fokus === key(e),
        ziel: zielKey === key(e),
        gezogen: zieht.includes(key(e)),
        ordner: e.typ === 'ordner'
      }"
      role="row"
      :aria-selected="auswahl.has(key(e))"
      :data-key="key(e)"
      :data-ziel="e.typ === 'ordner' ? key(e) : undefined"
      :draggable="umbenennen !== key(e)"
      @click="klicke(e, $event)"
      @dblclick="emit('oeffnen', e)"
      @contextmenu="menue(e, $event)"
      @pointerdown="druckAn(e, $event)"
      @pointermove="druckBewegt"
      @pointerup="druckEnde"
      @pointercancel="druckEnde"
      @dragstart="emit('ziehstart', e, $event)"
      @dragend="emit('ziehende')"
      @dragover="ueber(e, $event)"
      @dragleave="e.typ === 'ordner' && emit('weg', key(e))"
      @drop="ablegenAuf(e, $event)"
    >
      <span class="c-haken" role="gridcell">
        <button
          type="button"
          class="haken"
          :class="{ an: auswahl.has(key(e)) }"
          role="checkbox"
          :aria-checked="auswahl.has(key(e))"
          :aria-label="t(`„${e.name}“ auswählen`, `Select “${e.name}”`)"
          tabindex="-1"
          @click.stop="emit('haken', e)"
          @dblclick.stop
        >
          <Ico n="check" />
        </button>
      </span>

      <div v-if="darstellung === 'raster'" class="vorschau" role="gridcell">
        <VdCloudSymbol :e="e" gross />
      </div>

      <div class="c-name" role="gridcell">
        <VdCloudSymbol v-if="darstellung === 'liste'" :e="e" />
        <div class="text">
          <input
            v-if="umbenennen === key(e)"
            ref="eingabe"
            class="eingabe umb"
            :value="e.name"
            :maxlength="e.typ === 'ordner' ? 80 : 200"
            :aria-label="t('Neuer Name', 'New name')"
            spellcheck="false"
            autocomplete="off"
            draggable="false"
            @click.stop
            @dblclick.stop
            @keydown.enter.prevent.stop="bestaetigen(e, $event)"
            @keydown.esc.prevent.stop="abbrechen(e)"
            @keydown.stop
            @blur="bestaetigen(e, $event)"
          />
          <span v-else class="name" :title="e.name">{{ e.name }}</span>
          <small v-if="mitPfad && e.pfad !== undefined" class="pfad"
            ><Ico n="folder" /> {{ e.pfad || t('Meine Dateien', 'My files') }}</small
          >
          <small class="meta">
            {{ groessenText(e) }} · {{ datumText(e) }}<template v-if="e.von"> · {{ e.von }}</template>
          </small>
        </div>
        <span v-if="e.team && darstellung === 'liste'" class="chip neutral team" :style="{ '--c': e.team.farbe }"
          ><i></i>{{ e.team.name }}</span
        >
      </div>
      <span v-if="darstellung === 'liste'" class="c-groesse sehrleise zahl" role="gridcell">{{ groessenText(e) }}</span>
      <span v-if="darstellung === 'liste'" class="c-datum sehrleise" role="gridcell" :title="datumLang(e)">{{
        datumText(e)
      }}</span>

      <span class="c-akt" role="gridcell">
        <button
          type="button"
          class="stern"
          :class="{ an: e.favorite }"
          :aria-pressed="e.favorite"
          :aria-label="e.favorite ? t('Favorit entfernen', 'Remove favourite') : t('Als Favorit merken', 'Mark as favourite')"
          tabindex="-1"
          @click.stop="emit('favorit', e)"
          @dblclick.stop
        >
          <Ico n="star" />
        </button>
        <button
          type="button"
          class="mehr"
          :aria-label="t('Weitere Aktionen', 'More actions')"
          aria-haspopup="menu"
          tabindex="-1"
          @click.stop="punkteKnopf(e, $event)"
          @dblclick.stop
        >
          <Ico n="more" />
        </button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.cl {
  outline: 0;
  border-radius: 14px;
  min-height: 120px;
  position: relative;
}
.cl:focus-visible {
  box-shadow: 0 0 0 2px rgba(var(--a-rgb), 0.45);
}

/* ---------- Liste ---------- */
.liste {
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 14px;
  overflow: hidden;
}
.liste .kopfzeile,
.liste .zeile {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 110px 130px 76px;
  align-items: center;
  column-gap: 8px;
  padding: 0 10px;
}
.kopfzeile {
  min-height: 38px;
  border-bottom: 1px solid var(--linie);
  font-size: 12px;
  color: var(--text3);
  background: var(--flaeche);
  position: sticky;
  top: 0;
  z-index: 2;
}
.spalte {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 8px 0;
  cursor: pointer;
  text-align: left;
}
.spalte:hover,
.spalte.an {
  color: var(--text);
}
.spalte svg {
  width: 12px;
  height: 12px;
}
.liste .zeile {
  min-height: 52px;
  border-bottom: 1px solid var(--linie);
  cursor: default;
  position: relative;
  content-visibility: auto;
  contain-intrinsic-size: auto 52px;
  user-select: none;
  -webkit-touch-callout: none;
  transition: background 0.12s;
}
.liste .zeile:last-child {
  border-bottom: 0;
}
.liste .zeile:hover {
  background: var(--flaeche2);
}
.liste .zeile.gewaehlt {
  background: rgba(var(--a-rgb), 0.12);
}
.liste .zeile.gewaehlt::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--a);
}
.liste .zeile.fokus {
  box-shadow: inset 0 0 0 2px rgba(var(--a-rgb), 0.5);
}
.c-name {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 7px 0;
}
.text {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}
.name {
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zeile.ordner .name {
  font-weight: 600;
}
.pfad {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--text3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pfad svg {
  width: 11px;
  height: 11px;
}
.meta {
  display: none;
  font-size: 12px;
  color: var(--text3);
}
.c-groesse,
.c-datum {
  font-size: 12.5px;
  white-space: nowrap;
}
.team {
  gap: 6px;
  flex-shrink: 0;
}
.team i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--c);
}
.c-akt {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
}
.stern,
.mehr {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  display: grid;
  place-items: center;
  cursor: pointer;
  color: var(--text3);
}
.stern svg,
.mehr svg {
  width: 16px;
  height: 16px;
}
.stern:hover,
.mehr:hover {
  background: var(--linie);
  color: var(--text);
}
.stern.an {
  color: #f59e0b;
}
.stern.an svg {
  fill: currentColor;
}
.zeile:not(:hover):not(.fokus):not(.gewaehlt) .stern:not(.an),
.zeile:not(:hover):not(.fokus):not(.gewaehlt) .mehr {
  opacity: 0;
}
.haken {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  border: 1.5px solid var(--linie2);
  background: var(--flaeche);
  display: grid;
  place-items: center;
  padding: 0;
  cursor: pointer;
  color: transparent;
}
.haken svg {
  width: 13px;
  height: 13px;
  stroke-width: 3;
}
.haken.an,
.haken.teil {
  background: var(--a);
  border-color: var(--a);
  color: #fff;
}
.haken.teil svg {
  display: none;
}
.haken.teil::after {
  content: '';
  width: 9px;
  height: 2px;
  border-radius: 2px;
  background: #fff;
}
.c-haken {
  display: grid;
  place-items: center;
}
.zeile:not(:hover):not(.fokus):not(.gewaehlt) .haken:not(.an) {
  opacity: 0.35;
}
.liste.zieht .zeile.ordner:not(.gezogen) {
  outline: 1px dashed var(--linie2);
  outline-offset: -3px;
}
.zeile.ziel {
  background: rgba(var(--a-rgb), 0.18) !important;
  box-shadow: inset 0 0 0 2px var(--a) !important;
}
.zeile.gezogen {
  opacity: 0.5;
}
.eingabe.umb {
  padding: 5px 9px;
  font-size: 14px;
  font-weight: 500;
}

/* ---------- Raster ---------- */
.raster {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 14px;
}
.raster .zeile {
  position: relative;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  content-visibility: auto;
  contain-intrinsic-size: auto 210px;
  user-select: none;
  -webkit-touch-callout: none;
  transition:
    border-color 0.12s,
    box-shadow 0.12s,
    transform 0.12s;
}
.raster .zeile:hover {
  border-color: var(--linie2);
}
.raster .zeile.gewaehlt {
  border-color: var(--a);
  box-shadow: 0 0 0 2px rgba(var(--a-rgb), 0.35);
}
.raster .zeile.fokus {
  box-shadow: 0 0 0 2px rgba(var(--a-rgb), 0.6);
}
.raster .vorschau {
  aspect-ratio: 4 / 3;
  display: block;
  overflow: hidden;
  background: var(--flaeche2);
}
.raster .zeile.ordner .vorschau {
  background: transparent;
}
.raster .c-name {
  padding: 10px 12px 12px;
  display: block;
}
.raster .text {
  gap: 2px;
}
.raster .meta {
  display: block;
}
.raster .pfad {
  display: none;
}
.raster .c-haken {
  position: absolute;
  left: 8px;
  top: 8px;
  z-index: 2;
}
.raster .c-akt {
  position: absolute;
  right: 6px;
  top: 6px;
  z-index: 2;
  border-radius: 10px;
  padding: 1px;
}
.raster .zeile:hover .c-akt,
.raster .zeile.fokus .c-akt,
.raster .zeile.gewaehlt .c-akt {
  background: color-mix(in srgb, var(--flaeche) 82%, transparent);
  backdrop-filter: blur(6px);
}
.raster .zeile .haken:not(.an) {
  background: color-mix(in srgb, var(--flaeche) 85%, transparent);
}
.raster .zeile:not(:hover):not(.fokus):not(.gewaehlt) .haken:not(.an) {
  opacity: 0;
}
.raster .c-groesse,
.raster .c-datum {
  display: none;
}

/* ---------- Handy ---------- */
@media (max-width: 720px) {
  .liste .kopfzeile,
  .liste .zeile {
    grid-template-columns: 34px minmax(0, 1fr) 34px 34px;
    column-gap: 4px;
    padding: 0 6px;
  }
  .kopfzeile .c-groesse,
  .kopfzeile .c-datum,
  .c-groesse,
  .c-datum,
  .team {
    display: none !important;
  }
  .liste .meta {
    display: block;
  }
  .kopfzeile .c-name {
    grid-column: 2 / 5;
  }
  .stern,
  .mehr {
    width: 34px;
    height: 40px;
  }
  .liste .zeile .stern:not(.an),
  .liste .zeile .mehr {
    opacity: 1 !important;
  }
  .liste .zeile .haken:not(.an) {
    opacity: 0.6 !important;
  }
  .raster {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px;
  }
  .raster .zeile .haken:not(.an) {
    opacity: 0.85 !important;
  }
  .raster .zeile .mehr {
    opacity: 1 !important;
  }
  .raster .c-akt {
    background: color-mix(in srgb, var(--flaeche) 82%, transparent);
    backdrop-filter: blur(6px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .zeile {
    transition: none !important;
  }
}
</style>
