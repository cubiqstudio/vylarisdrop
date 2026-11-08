<script setup lang="ts">
// Speicher-Analyse & Aufräumen: was belegt den Speicher, welche Dateien sind doppelt, groß oder lange nicht genutzt — und weg damit (Papierkorb)
useHead({ title: () => t('Aufräumen', 'Clean up') })
const { ok, fehler } = useToast()

type TabId = 'uebersicht' | 'duplikate' | 'gross' | 'alt'
const tab = ref<TabId>('uebersicht')
const team = ref(true)
const tage = ref(180)

const ARTEN = [
  { k: 'bild', c: '#1e73be', de: 'Bilder', en: 'Images' },
  { k: 'video', c: '#f59e0b', de: 'Videos', en: 'Videos' },
  { k: 'audio', c: '#3b82f6', de: 'Audio', en: 'Audio' },
  { k: 'dokument', c: '#22c55e', de: 'Dokumente', en: 'Documents' },
  { k: 'archiv', c: '#a855f7', de: 'Archive', en: 'Archives' },
  { k: 'sonst', c: 'var(--text3)', de: 'Sonstiges', en: 'Other' }
]

// ---------- Daten ----------
const uebersicht = ref<any>(null)
const ladeFehler = ref('')
const daten = reactive<{ ordner: any; gross: any; alt: any; dup: any }>({ ordner: null, gross: null, alt: null, dup: null })
const laedt = reactive({ uebersicht: true, ordner: false, gross: false, alt: false, dup: false, dupMehr: false })
const ausw = reactive<{ gross: string[]; alt: string[]; dup: string[] }>({ gross: [], alt: [], dup: [] })
const dupSeite = ref(1)
const teamParam = () => (team.value ? '1' : '0')
// Antworten veralteter Abfragen (Filter inzwischen gewechselt) verwerfen
let generation = 0

async function ladeUebersicht() {
  const g = generation
  laedt.uebersicht = true
  try {
    const r = await api(`/api/aufraeumen/uebersicht?tage=${tage.value}&team=${teamParam()}`)
    if (g === generation) {
      uebersicht.value = r
      ladeFehler.value = ''
    }
  } catch (e: any) {
    if (g === generation) ladeFehler.value = e.message
  } finally {
    if (g === generation) laedt.uebersicht = false
  }
}
async function lade(k: 'ordner' | 'gross' | 'alt' | 'dup') {
  const g = generation
  laedt[k] = true
  try {
    const url = {
      ordner: `/api/aufraeumen/ordner?team=${teamParam()}`,
      gross: `/api/aufraeumen/groesste?team=${teamParam()}`,
      alt: `/api/aufraeumen/alt?tage=${tage.value}&team=${teamParam()}`,
      dup: `/api/aufraeumen/duplikate?team=${teamParam()}&seite=1`
    }[k]
    const r = await api(url)
    if (g !== generation) return
    daten[k] = r
    if (k === 'dup') {
      dupSeite.value = 1
      ausw.dup = vorschlag(r.gruppen)
    }
    ladeFehler.value = ''
  } catch (e: any) {
    if (g === generation) ladeFehler.value = e.message
  } finally {
    if (g === generation) laedt[k] = false
  }
}
async function dupMehr() {
  const g = generation
  laedt.dupMehr = true
  try {
    const r = await api(`/api/aufraeumen/duplikate?team=${teamParam()}&seite=${dupSeite.value + 1}`)
    if (g !== generation) return
    const da = new Set(daten.dup.gruppen.map((x: any) => x.sha256 + x.size))
    const neu = r.gruppen.filter((x: any) => !da.has(x.sha256 + x.size))
    daten.dup = { ...r, gruppen: [...daten.dup.gruppen, ...neu] }
    dupSeite.value++
    ausw.dup = [...new Set([...ausw.dup, ...vorschlag(neu)])]
  } catch (e: any) {
    fehler(e.message)
  } finally {
    laedt.dupMehr = false
  }
}
/** Standard-Auswahl: je Gruppe die ungeteilten, überzähligen Kopien (die empfohlene Kopie bleibt, geteilte nie) */
const vorschlag = (gruppen: any[]) => gruppen.flatMap((g) => g.kopien.filter((k: any) => k.empfehlung === 'loeschen').map((k: any) => k.id))

function tabLaden(k: TabId) {
  if (k === 'uebersicht' && !daten.ordner && !laedt.ordner) void lade('ordner')
  if (k === 'duplikate' && !daten.dup && !laedt.dup) void lade('dup')
  if (k === 'gross' && !daten.gross && !laedt.gross) void lade('gross')
  if (k === 'alt' && !daten.alt && !laedt.alt) void lade('alt')
}
function alleNeuLaden(nurAktuell = false) {
  generation++
  const aktuell = tab.value
  if (!nurAktuell) {
    daten.ordner = daten.gross = daten.alt = daten.dup = null
    ausw.gross = []
    ausw.alt = []
    ausw.dup = []
  }
  void ladeUebersicht()
  tabLaden(aktuell)
}
watch([team, tage], () => alleNeuLaden())
watch(tab, (k) => tabLaden(k))
onMounted(() => {
  void ladeUebersicht()
  tabLaden(tab.value)
})

// ---------- Anzeige ----------
const u = computed(() => uebersicht.value)
const gesamtArt = computed(() => ARTEN.reduce((a, x) => a + Number(u.value?.proArt?.[x.k]?.bytes || 0), 0))
const segmente = computed(() => [
  ...ARTEN.map((a) => ({ bytes: Number(u.value?.proArt?.[a.k]?.bytes || 0), farbe: a.c })),
  { bytes: Number(u.value?.belegt?.papierkorb || 0), farbe: '', muster: true }
])
const nichtsZuTun = computed(() => !!u.value && !u.value.duplikate.gruppen && !u.value.alt.anzahl)
const maxOrdner = computed(() => Math.max(1, ...(daten.ordner?.ordner || []).map((o: any) => o.bytes)))
const anteil = (b: number) => (gesamtArt.value ? Math.round((b / gesamtArt.value) * 1000) / 10 : 0)

const TABS = computed<Array<{ k: TabId; text: string; zahl?: number }>>(() => [
  { k: 'uebersicht', text: t('Übersicht', 'Overview') },
  { k: 'duplikate', text: t('Duplikate', 'Duplicates'), zahl: u.value?.duplikate?.gruppen },
  { k: 'gross', text: t('Größte Dateien', 'Largest files') },
  { k: 'alt', text: t('Lange nicht genutzt', 'Not used for a long time'), zahl: u.value?.alt?.anzahl }
])
function tabTaste(e: KeyboardEvent) {
  const liste = TABS.value.map((x) => x.k)
  const i = liste.indexOf(tab.value)
  let n = i
  if (e.key === 'ArrowRight') n = (i + 1) % liste.length
  else if (e.key === 'ArrowLeft') n = (i - 1 + liste.length) % liste.length
  else if (e.key === 'Home') n = 0
  else if (e.key === 'End') n = liste.length - 1
  else return
  e.preventDefault()
  tab.value = liste[n]!
  nextTick(() => (document.getElementById('auf-tab-' + liste[n]) as HTMLElement | null)?.focus())
}

// ---------- Auswahl & Löschen ----------
const aktiveListe = computed<'dup' | 'gross' | 'alt' | null>(() =>
  tab.value === 'duplikate' ? 'dup' : tab.value === 'gross' ? 'gross' : tab.value === 'alt' ? 'alt' : null
)
const alleEintraege = computed<any[]>(() => {
  const k = aktiveListe.value
  if (k === 'dup') return (daten.dup?.gruppen || []).flatMap((g: any) => g.kopien)
  if (k === 'gross') return daten.gross?.dateien || []
  if (k === 'alt') return daten.alt?.dateien || []
  return []
})
const gewaehlteDateien = computed(() => {
  const k = aktiveListe.value
  if (!k) return []
  const s = new Set(ausw[k])
  return alleEintraege.value.filter((e) => s.has(e.id))
})
const gewaehltBytes = computed(() => gewaehlteDateien.value.reduce((a, e) => a + e.size, 0))
const gewaehltGeteilt = computed(() => gewaehlteDateien.value.filter((e) => e.geteilt?.irgendwie))

const bestaetigung = ref(false)
const arbeitet = ref(false)
const ergebnis = ref<null | { geloescht: number; bytes: number; papierkorb: string[]; uebersprungen: number; zurueck?: boolean; wieder?: number }>(null)

function fragen() {
  if (gewaehlteDateien.value.length) bestaetigung.value = true
}
async function loeschen() {
  const k = aktiveListe.value
  if (!k || arbeitet.value) return
  const ids = gewaehlteDateien.value.map((e) => e.id)
  arbeitet.value = true
  try {
    const r = await api('/api/aufraeumen/loeschen', { method: 'POST', body: { dateien: ids, modus: k === 'dup' ? 'duplikate' : 'frei' } })
    ergebnis.value = { geloescht: r.geloescht, bytes: r.bytes, papierkorb: r.papierkorb.map((p: any) => p.id), uebersprungen: r.uebersprungen.length }
    bestaetigung.value = false
    ausw[k] = []
    ok(t(`${r.geloescht} Dateien im Papierkorb`, `${r.geloescht} files moved to trash`))
    void refreshNuxtData(['stats', 'quota-me', 'papierkorb'])
    // Listen neu laden: die gelöschten Dateien sind weg, Gruppen schrumpfen oder verschwinden
    generation++
    daten.ordner = daten.gross = daten.alt = daten.dup = null
    ausw.gross = []
    ausw.alt = []
    void ladeUebersicht()
    tabLaden(tab.value)
  } catch (e: any) {
    bestaetigung.value = false
    fehler(e.message)
  } finally {
    arbeitet.value = false
  }
}
async function rueckgaengig() {
  const e = ergebnis.value
  if (!e || arbeitet.value || !e.papierkorb.length) return
  arbeitet.value = true
  try {
    const r = await api('/api/aufraeumen/rueckgaengig', { method: 'POST', body: { papierkorb: e.papierkorb } })
    ergebnis.value = { ...e, zurueck: true, wieder: r.wiederhergestellt }
    ok(t(`${r.wiederhergestellt} Dateien wiederhergestellt`, `${r.wiederhergestellt} files restored`))
    void refreshNuxtData(['stats', 'quota-me', 'papierkorb'])
    alleNeuLaden()
  } catch (er: any) {
    fehler(er.message)
  } finally {
    arbeitet.value = false
  }
}
const tageText = (n: number) => t(`${n} Tage`, `${n} days`)
</script>

<template>
  <section class="rein">
    <div class="kopf">
      <div>
        <div class="eyebrow"><Ico n="gauge" /> {{ t('Cloud', 'Cloud') }}</div>
        <h1>{{ t('Aufräumen', 'Clean up') }}</h1>
        <p>
          {{
            t(
              'Sieh, was deinen Speicher belegt, finde doppelte, große und lange nicht genutzte Dateien — alles landet zuerst im Papierkorb.',
              'See what takes up your storage, find duplicate, large and long-unused files — everything goes to the trash first.'
            )
          }}
        </p>
      </div>
      <label v-if="u?.teams" class="team-schalter">
        <button type="button" :class="['schalter', { an: team }]" role="switch" :aria-checked="team" @click="team = !team"></button>
        {{ t('Team-Dateien einbeziehen', 'Include team files') }}
      </label>
    </div>

    <p v-if="ladeFehler" class="meldung meldung-fehler" role="alert">{{ ladeFehler }}</p>

    <!-- Ergebnis der letzten Aktion -->
    <div v-if="ergebnis" class="meldung meldung-ok ergebnis" role="status">
      <div v-if="!ergebnis.zurueck" class="erg-text">
        <b>{{ t(`${zahl(ergebnis.geloescht)} Dateien im Papierkorb`, `${zahl(ergebnis.geloescht)} files moved to trash`) }}</b>
        <span>
          {{ t(`Ersparnis ${groesse(ergebnis.bytes)} — der Platz wird frei, sobald du den Papierkorb leerst (spätestens nach 30 Tagen).`, `Savings ${groesse(ergebnis.bytes)} — the space is freed once you empty the trash (after 30 days at the latest).`) }}
          <template v-if="ergebnis.uebersprungen">
            {{ t(`${ergebnis.uebersprungen} Dateien blieben stehen, weil sonst keine Kopie übrig geblieben wäre.`, `${ergebnis.uebersprungen} files were kept because no copy would have been left.`) }}
          </template>
        </span>
      </div>
      <div v-else class="erg-text">
        <b>{{ t(`${zahl(ergebnis.wieder || 0)} Dateien wiederhergestellt`, `${zahl(ergebnis.wieder || 0)} files restored`) }}</b>
      </div>
      <div class="reihe">
        <button v-if="!ergebnis.zurueck && ergebnis.papierkorb.length" type="button" class="knopf klein" :disabled="arbeitet" @click="rueckgaengig">
          <Ico n="undo" /> {{ t('Rückgängig', 'Undo') }}
        </button>
        <NuxtLink to="/papierkorb" class="knopf klein"><Ico n="trash" /> {{ t('Zum Papierkorb', 'Go to trash') }}</NuxtLink>
        <button type="button" class="knopf nur-icon" :aria-label="t('Hinweis schließen', 'Dismiss')" @click="ergebnis = null"><Ico n="x" /></button>
      </div>
    </div>

    <!-- Kennzahlen -->
    <div class="karten" :aria-busy="laedt.uebersicht">
      <template v-if="!u">
        <div v-for="i in 4" :key="i" class="block karte skel" aria-hidden="true"></div>
      </template>
      <template v-else>
        <div class="block karte">
          <h2 class="k-titel">{{ t('Belegt gesamt', 'Used in total') }}</h2>
          <div class="k-zahl zahl">{{ groesse(u.belegt.gesamt) }}</div>
          <VdQuotaBalken :used="u.belegt.gesamt" :limit="u.kontingent.limit" :segmente="segmente" :beschriftung="t('Speicherbelegung', 'Storage usage')" />
          <p class="k-text">
            <template v-if="u.kontingent.limit">{{ t('von', 'of') }} {{ groesse(u.kontingent.limit) }} · {{ zahl(u.kontingent.prozent || 0, 1) }} % · </template>
            {{ zahl(u.dateien) }} {{ t('Dateien', 'files') }} + {{ t('Papierkorb', 'trash') }} {{ groesse(u.belegt.papierkorb) }}
          </p>
        </div>
        <button type="button" class="block karte klick" :class="{ aktiv: tab === 'duplikate' }" @click="tab = 'duplikate'">
          <span class="k-titel">{{ t('Doppelte Dateien', 'Duplicate files') }}</span>
          <span class="k-zahl zahl">{{ groesse(u.duplikate.bytes) }}</span>
          <span class="k-text">
            {{ u.duplikate.gruppen
              ? t(`${zahl(u.duplikate.ueberzaehlig)} überzählige Kopien in ${zahl(u.duplikate.gruppen)} Gruppen`, `${zahl(u.duplikate.ueberzaehlig)} extra copies in ${zahl(u.duplikate.gruppen)} groups`)
              : t('Keine Duplikate gefunden', 'No duplicates found') }}
          </span>
        </button>
        <button type="button" class="block karte klick" :class="{ aktiv: tab === 'alt' }" @click="tab = 'alt'">
          <span class="k-titel">{{ t(`Seit ${u.alt.tage} Tagen nicht genutzt`, `Unused for ${tageText(u.alt.tage)}`) }}</span>
          <span class="k-zahl zahl">{{ groesse(u.alt.bytes) }}</span>
          <span class="k-text">{{ t(`${zahl(u.alt.anzahl)} Dateien`, `${zahl(u.alt.anzahl)} files`) }}</span>
        </button>
        <NuxtLink to="/papierkorb" class="block karte klick">
          <span class="k-titel">{{ t('Papierkorb', 'Trash') }}</span>
          <span class="k-zahl zahl">{{ groesse(u.belegt.papierkorb) }}</span>
          <span class="k-text">{{ t(`${zahl(u.belegt.papierkorbAnzahl)} Dateien — zählen zum Speicher, bis du leerst`, `${zahl(u.belegt.papierkorbAnzahl)} files — count towards storage until emptied`) }}</span>
        </NuxtLink>
      </template>
    </div>

    <div v-if="nichtsZuTun" class="leer-hinweis block alles-gut" role="status">
      <span class="leer-ic"><Ico n="check" /></span>
      <h3>{{ t('Nichts zu tun — dein Speicher ist aufgeräumt', 'Nothing to do — your storage is tidy') }}</h3>
      <p>{{ t('Keine Duplikate und keine lange nicht genutzten Dateien.', 'No duplicates and no long-unused files.') }}</p>
    </div>

    <!-- Reiter -->
    <div class="reiter" role="tablist" :aria-label="t('Bereiche', 'Sections')" @keydown="tabTaste">
      <button
        v-for="x in TABS"
        :id="'auf-tab-' + x.k"
        :key="x.k"
        type="button"
        role="tab"
        :class="{ an: tab === x.k }"
        :aria-selected="tab === x.k"
        :aria-controls="'auf-panel-' + x.k"
        :tabindex="tab === x.k ? 0 : -1"
        @click="tab = x.k"
      >
        {{ x.text }}<span v-if="x.zahl" class="zaehler zahl">{{ zahl(x.zahl) }}</span>
      </button>
    </div>

    <!-- Übersicht -->
    <div v-show="tab === 'uebersicht'" id="auf-panel-uebersicht" role="tabpanel" aria-labelledby="auf-tab-uebersicht" class="panel">
      <div class="block">
        <h3>{{ t('Verteilung nach Art', 'Distribution by type') }}</h3>
        <p class="leise k-sub">{{ t('Deine Dateien — ohne Papierkorb', 'Your files — without trash') }}</p>
        <div v-if="!u" class="skel zeile-skel" aria-hidden="true"></div>
        <table v-else class="verteilung">
          <caption class="versteckt">{{ t('Speicherbelegung nach Dateiart', 'Storage used by file type') }}</caption>
          <thead>
            <tr>
              <th scope="col">{{ t('Art', 'Type') }}</th>
              <th scope="col" class="r">{{ t('Dateien', 'Files') }}</th>
              <th scope="col" class="r">{{ t('Größe', 'Size') }}</th>
              <th scope="col" class="r">{{ t('Anteil', 'Share') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in ARTEN" :key="a.k" :class="{ leer: !u.proArt[a.k]?.bytes }">
              <th scope="row"><i :style="{ background: a.c }"></i>{{ lang() === 'en' ? a.en : a.de }}</th>
              <td class="r zahl">{{ zahl(u.proArt[a.k]?.anzahl || 0) }}</td>
              <td class="r zahl">{{ groesse(u.proArt[a.k]?.bytes || 0) }}</td>
              <td class="r zahl balken-z">
                <span class="mini" aria-hidden="true"><i :style="{ width: anteil(u.proArt[a.k]?.bytes || 0) + '%', background: a.c }"></i></span>
                {{ zahl(anteil(u.proArt[a.k]?.bytes || 0), 1) }} %
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="block">
        <h3>{{ t('Größte Ordner', 'Largest folders') }}</h3>
        <p class="leise k-sub">{{ t('Mit allen Unterordnern', 'Including all subfolders') }}</p>
        <div v-if="laedt.ordner || !daten.ordner" class="skel zeile-skel" aria-hidden="true"></div>
        <template v-else>
          <p v-if="!daten.ordner.ordner.length" class="leise">{{ t('Noch keine Dateien in Ordnern.', 'No files in folders yet.') }}</p>
          <table v-else class="verteilung ordner-tab">
            <caption class="versteckt">{{ t('Die größten Ordner', 'The largest folders') }}</caption>
            <thead>
              <tr>
                <th scope="col">{{ t('Ordner', 'Folder') }}</th>
                <th scope="col" class="r">{{ t('Dateien', 'Files') }}</th>
                <th scope="col" class="r">{{ t('Größe', 'Size') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in daten.ordner.ordner" :key="o.id">
                <th scope="row" class="o-name">
                  <NuxtLink :to="{ path: '/', query: { ordner: o.id } }" :title="o.pfad"><Ico n="folder" /> {{ o.pfad }}</NuxtLink>
                  <span v-if="o.galerie" class="chip warn"><Ico n="globe" /> {{ t('Galerie', 'Gallery') }}</span>
                  <span v-if="o.team" class="chip info" :style="o.team.farbe ? { color: o.team.farbe } : undefined"><Ico n="users" /> {{ o.team.name }}</span>
                  <span class="mini lang" aria-hidden="true"><i :style="{ width: Math.max(2, (o.bytes / maxOrdner) * 100) + '%' }"></i></span>
                </th>
                <td class="r zahl">{{ zahl(o.dateien) }}</td>
                <td class="r zahl"><b>{{ groesse(o.bytes) }}</b></td>
              </tr>
            </tbody>
          </table>
          <p v-if="daten.ordner.ohneOrdner.dateien" class="leise k-sub">
            {{ t(`Oberste Ebene (ohne Ordner): ${zahl(daten.ordner.ohneOrdner.dateien)} Dateien, ${groesse(daten.ordner.ohneOrdner.bytes)}`, `Top level (no folder): ${zahl(daten.ordner.ohneOrdner.dateien)} files, ${groesse(daten.ordner.ohneOrdner.bytes)}`) }}
          </p>
        </template>
      </div>
    </div>

    <!-- Duplikate -->
    <div v-show="tab === 'duplikate'" id="auf-panel-duplikate" role="tabpanel" aria-labelledby="auf-tab-duplikate" class="panel">
      <div v-if="laedt.dup || !daten.dup" class="block"><div class="skel zeile-skel" aria-hidden="true"></div><div class="skel zeile-skel" aria-hidden="true"></div></div>
      <div v-else-if="!daten.dup.gruppen.length" class="leer-hinweis block" role="status">
        <span class="leer-ic"><Ico n="check" /></span>
        <h3>{{ t('Nichts zu tun — dein Speicher ist aufgeräumt', 'Nothing to do — your storage is tidy') }}</h3>
        <p>{{ t('Es gibt keine Dateien, die mehrfach vorhanden sind.', 'There are no files that exist more than once.') }}</p>
      </div>
      <template v-else>
        <div class="block hinweis">
          <p class="leise" style="margin: 0">
            {{
              t(
                `Gefunden: ${zahl(daten.dup.summe.ueberzaehlig)} überzählige Kopien in ${zahl(daten.dup.summe.gruppen)} Gruppen — bis zu ${groesse(daten.dup.summe.bytes)} Ersparnis. Gleiche Dateien erkennst du an Prüfsumme und Größe. Vorausgewählt sind nur überzählige Kopien ohne Freigabe; je Gruppe bleibt immer eine Kopie.`,
                `Found: ${zahl(daten.dup.summe.ueberzaehlig)} extra copies in ${zahl(daten.dup.summe.gruppen)} groups — up to ${groesse(daten.dup.summe.bytes)} savings. Identical files are detected by checksum and size. Only extra copies without a share are preselected; one copy always stays in every group.`
              )
            }}
          </p>
        </div>
        <VdAufDuplikate v-model="ausw.dup" :gruppen="daten.dup.gruppen" />
        <div v-if="daten.dup.gruppen.length < daten.dup.summe.gruppen" class="mehr">
          <button type="button" class="knopf" :disabled="laedt.dupMehr" @click="dupMehr">
            <Ico v-if="laedt.dupMehr" n="loader" spin /> {{ t('Weitere Gruppen laden', 'Load more groups') }}
          </button>
        </div>
      </template>
    </div>

    <!-- Größte Dateien -->
    <div v-show="tab === 'gross'" id="auf-panel-gross" role="tabpanel" aria-labelledby="auf-tab-gross" class="panel">
      <div class="block">
        <h3>{{ t('Die 50 größten Dateien', 'The 50 largest files') }}</h3>
        <div v-if="laedt.gross || !daten.gross" class="skel zeile-skel" aria-hidden="true"></div>
        <p v-else-if="!daten.gross.dateien.length" class="leise">{{ t('Noch keine Dateien.', 'No files yet.') }}</p>
        <VdAufDateien v-else v-model="ausw.gross" :dateien="daten.gross.dateien" datum-art="erstellt" :beschriftung="t('Die 50 größten Dateien', 'The 50 largest files')" />
      </div>
    </div>

    <!-- Lange nicht genutzt -->
    <div v-show="tab === 'alt'" id="auf-panel-alt" role="tabpanel" aria-labelledby="auf-tab-alt" class="panel">
      <div class="block">
        <div class="reihe zw wrap">
          <div>
            <h3>{{ t('Lange nicht genutzt', 'Not used for a long time') }}</h3>
            <p class="leise k-sub">{{ t('Weder angesehen noch geändert seit …', 'Neither viewed nor modified for …') }}</p>
          </div>
          <div class="seg" role="group" :aria-label="t('Zeitraum', 'Period')">
            <button v-for="n in [90, 180, 365]" :key="n" type="button" :class="{ an: tage === n }" :aria-pressed="tage === n" @click="tage = n">{{ tageText(n) }}</button>
          </div>
        </div>
        <div v-if="laedt.alt || !daten.alt" class="skel zeile-skel" aria-hidden="true"></div>
        <div v-else-if="!daten.alt.dateien.length" class="leer-hinweis" role="status">
          <span class="leer-ic"><Ico n="check" /></span>
          <h3>{{ t('Nichts zu tun — dein Speicher ist aufgeräumt', 'Nothing to do — your storage is tidy') }}</h3>
          <p>{{ t(`Alle Dateien wurden in den letzten ${daten.alt.tage} Tagen genutzt.`, `All files were used within the last ${tageText(daten.alt.tage)}.`) }}</p>
        </div>
        <template v-else>
          <p class="leise k-sub">
            {{ t(`${zahl(daten.alt.anzahl)} Dateien, zusammen ${groesse(daten.alt.bytes)}. Angezeigt werden die ${daten.alt.dateien.length} größten.`, `${zahl(daten.alt.anzahl)} files, ${groesse(daten.alt.bytes)} in total. The ${daten.alt.dateien.length} largest are shown.`) }}
          </p>
          <VdAufDateien v-model="ausw.alt" :dateien="daten.alt.dateien" datum-art="zuletzt" :beschriftung="t('Lange nicht genutzte Dateien', 'Long-unused files')" />
        </template>
      </div>
    </div>

    <!-- Aktionsleiste -->
    <Transition name="auf-leiste">
      <div v-if="aktiveListe && gewaehlteDateien.length" class="auf-leiste" role="region" :aria-label="t('Auswahl', 'Selection')">
        <div class="l-text" role="status">
          <b class="zahl">{{ t(`${zahl(gewaehlteDateien.length)} markiert`, `${zahl(gewaehlteDateien.length)} selected`) }}</b>
          <span class="zahl">{{ t('Ersparnis', 'Savings') }} {{ groesse(gewaehltBytes) }}</span>
          <span v-if="gewaehltGeteilt.length" class="chip warn"><Ico n="link" /> {{ t(`${gewaehltGeteilt.length} geteilt`, `${gewaehltGeteilt.length} shared`) }}</span>
        </div>
        <div class="reihe">
          <button type="button" class="knopf" @click="ausw[aktiveListe!] = []">{{ t('Auswahl aufheben', 'Clear selection') }}</button>
          <button type="button" class="knopf rot" @click="fragen"><Ico n="trash" /> {{ t('In den Papierkorb', 'Move to trash') }}</button>
        </div>
      </div>
    </Transition>

    <VdModal v-if="bestaetigung" :titel="t('In den Papierkorb legen?', 'Move to trash?')" @zu="bestaetigung = false">
      <p class="leise" style="margin: 0 0 10px">
        {{
          t(
            `${zahl(gewaehlteDateien.length)} Dateien (${groesse(gewaehltBytes)}) kommen in den Papierkorb. Dort bleiben sie 30 Tage und lassen sich wiederherstellen; der Speicher wird erst beim Leeren frei.`,
            `${zahl(gewaehlteDateien.length)} files (${groesse(gewaehltBytes)}) will be moved to the trash. They stay there for 30 days and can be restored; the space is only freed when you empty it.`
          )
        }}
      </p>
      <div v-if="gewaehltGeteilt.length" class="meldung meldung-warn" role="alert">
        <b>{{ t(`${gewaehltGeteilt.length} davon sind geteilt.`, `${gewaehltGeteilt.length} of them are shared.`) }}</b>
        {{ t('Ihre Freigabe-Links (und Galerie-Einträge) funktionieren danach nicht mehr:', 'Their share links (and gallery entries) stop working afterwards:') }}
        <ul class="geteilt-liste">
          <li v-for="e in gewaehltGeteilt.slice(0, 5)" :key="e.id">{{ e.name }}</li>
          <li v-if="gewaehltGeteilt.length > 5">{{ t(`… und ${gewaehltGeteilt.length - 5} weitere`, `… and ${gewaehltGeteilt.length - 5} more`) }}</li>
        </ul>
      </div>
      <div class="modal-fuss">
        <button type="button" class="knopf" :disabled="arbeitet" @click="bestaetigung = false">{{ t('Abbrechen', 'Cancel') }}</button>
        <button type="button" class="knopf rot" :disabled="arbeitet" @click="loeschen"><Ico v-if="arbeitet" n="loader" spin /><Ico v-else n="trash" /> {{ t('In den Papierkorb', 'Move to trash') }}</button>
      </div>
    </VdModal>
  </section>
</template>

<style scoped>
.team-schalter {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  color: var(--text2);
  cursor: pointer;
}
.karten {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.karte {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 118px;
  text-align: left;
  font: inherit;
  color: inherit;
  text-decoration: none;
  margin: 0 !important;
}
.karte.klick {
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s var(--kurve);
}
.karte.klick:hover,
.karte.aktiv {
  border-color: var(--a);
}
.karte.klick:active {
  transform: scale(0.99);
}
.k-titel {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0;
}
.k-zahl {
  font-family: var(--f-display);
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
}
.k-text {
  font-size: 12.5px;
  color: var(--text2);
  margin: 0;
}
.k-sub {
  font-size: 12.5px;
  margin: 0 0 10px;
}
.ergebnis {
  display: flex;
  gap: 10px 16px;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.erg-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  flex: 1 1 280px;
}
.alles-gut {
  margin-bottom: 16px;
}
.reiter {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--linie);
  margin: 6px 0 14px;
  overflow-x: auto;
  scrollbar-width: none;
}
.reiter::-webkit-scrollbar {
  display: none;
}
.reiter button {
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text2);
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  white-space: nowrap;
  display: inline-flex;
  gap: 8px;
  align-items: center;
}
.reiter button.an {
  color: var(--text);
  border-bottom-color: var(--a);
  font-weight: 600;
}
.reiter button:focus-visible {
  outline: 2px solid var(--a);
  outline-offset: -2px;
  border-radius: 6px;
}
.zaehler {
  font-size: 11px;
  background: var(--flaeche2);
  border-radius: 99px;
  padding: 1px 7px;
  color: var(--text2);
}
.panel {
  display: grid;
  gap: 14px;
  padding-bottom: 80px;
}
.panel > .block {
  margin: 0 !important;
}
.verteilung {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
}
.verteilung th,
.verteilung td {
  padding: 8px 6px;
  border-bottom: 1px solid var(--linie);
  text-align: left;
  font-weight: 400;
}
.verteilung thead th {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.verteilung tbody tr:last-child > * {
  border-bottom: 0;
}
.verteilung .r {
  text-align: right;
}
.verteilung tr.leer {
  opacity: 0.55;
}
.verteilung tbody th i {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  margin-right: 8px;
}
.balken-z {
  min-width: 150px;
}
.mini {
  display: inline-block;
  vertical-align: middle;
  width: 70px;
  height: 6px;
  border-radius: 99px;
  background: var(--flaeche2);
  margin-right: 8px;
  overflow: hidden;
}
.mini i {
  display: block;
  height: 100%;
  background: var(--a);
  border-radius: 99px;
}
.mini.lang {
  display: block;
  width: 100%;
  margin: 6px 0 0;
}
.o-name {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: center;
}
.o-name a {
  color: var(--text);
  text-decoration: none;
  font-weight: 500;
  display: inline-flex;
  gap: 6px;
  align-items: center;
  overflow-wrap: anywhere;
}
.o-name a:hover {
  color: var(--a);
}
.o-name a svg {
  width: 14px;
  height: 14px;
  color: var(--a);
  flex-shrink: 0;
}
.ordner-tab .o-name {
  display: table-cell;
}
.ordner-tab .o-name > * {
  vertical-align: middle;
}
.wrap {
  flex-wrap: wrap;
  align-items: flex-start;
  margin-bottom: 8px;
}
.mehr {
  display: flex;
  justify-content: center;
  margin-top: 4px;
}
.auf-leiste {
  position: fixed;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  width: min(720px, calc(100vw - 32px));
  z-index: 40;
  background: var(--flaeche);
  border: 1px solid var(--linie2);
  border-radius: 14px;
  box-shadow: var(--schatten), 0 18px 40px -14px rgba(0, 0, 0, 0.35);
  padding: 10px 14px;
  display: flex;
  gap: 10px 16px;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}
.l-text {
  display: flex;
  gap: 4px 14px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 13.5px;
}
.auf-leiste-enter-active,
.auf-leiste-leave-active {
  transition: opacity 0.2s, transform 0.25s var(--kurve);
}
.auf-leiste-enter-from,
.auf-leiste-leave-to {
  opacity: 0;
  transform: translate(-50%, 16px);
}
.geteilt-liste {
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: 12.5px;
}
.zeile-skel {
  height: 54px;
  border-radius: 10px;
  margin: 6px 0;
}
.skel {
  background: linear-gradient(90deg, var(--flaeche2), color-mix(in srgb, var(--flaeche2) 55%, var(--flaeche)), var(--flaeche2));
  background-size: 200% 100%;
  animation: auf-glanz 1.4s linear infinite;
}
@keyframes auf-glanz {
  to {
    background-position: -200% 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .skel {
    animation: none;
  }
  .auf-leiste-enter-active,
  .auf-leiste-leave-active {
    transition: none;
  }
}
.leer-ic {
  display: inline-grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: var(--ok-bg);
  color: var(--ok);
  margin-bottom: 10px;
}
.leer-ic svg {
  width: 24px;
  height: 24px;
}
@media (max-width: 640px) {
  .kopf h1 {
    font-size: 28px;
  }
  .auf-leiste {
    bottom: 8px;
  }
  .auf-leiste .reihe {
    width: 100%;
  }
  .auf-leiste .reihe .knopf {
    flex: 1;
  }
  .balken-z .mini {
    display: none;
  }
  .balken-z {
    min-width: 0;
  }
}
</style>
