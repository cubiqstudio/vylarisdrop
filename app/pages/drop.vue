<script setup lang="ts">
useHead({ title: () => t('Uploads & Links', 'Uploads & links') })
const route = useRoute()
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const { liste: uploads, neu, vorbereiten: hochladen, entfernen } = useUploads()

const art = ref(String(route.query.art || ''))
const tag = ref(Number(route.query.tag) || 0)
const sort = ref('neu')
const ordnerId = computed(() => String(route.query.ordner || ''))
const suche = computed(() => String(route.query.suche || ''))

const files = ref<any[]>([])
const gesamt = ref(0)
const seite = ref(1)
const laedt = ref(false)
const PRO = 48
// Zählt jeden regulären Ladevorgang: ein Live-Abgleich, der währenddessen lief, ist veraltet und wird verworfen
let ladeNr = 0
const filterQuery = () => ({
  art: art.value || undefined,
  tag: tag.value || undefined,
  ordner: ordnerId.value || undefined,
  suche: suche.value || undefined,
  sort: sort.value
})
async function laden(neuStart = true) {
  const nr = ++ladeNr
  laedt.value = true
  try {
    if (neuStart) seite.value = 1
    const r = await api('/api/files', { query: { seite: seite.value, pro: PRO, ...filterQuery() } })
    if (nr !== ladeNr) return // inzwischen neu gefiltert: das Ergebnis gehört nicht mehr zur Anzeige
    if (neuStart) files.value = r.files
    else {
      const da = new Set(files.value.map((f) => f.id)) // Verschiebungen durch neue Dateien dürfen nichts doppeln
      files.value = [...files.value, ...r.files.filter((f: any) => !da.has(f.id))]
    }
    gesamt.value = r.gesamt
  } catch (e: any) {
    if (nr === ladeNr) fehler(e.message)
  } finally {
    if (nr === ladeNr) laedt.value = false
  }
}
const { data: ordnerDaten, refresh: ordnerNeu } = await (useFetch as any)('/api/folders', { key: 'ordner' })
const { data: tagDaten, refresh: tagsNeu } = await (useFetch as any)('/api/tags', { key: 'tags' })
const ordner = computed<any[]>(() => ordnerDaten.value?.ordner || [])
const tags = computed<any[]>(() => tagDaten.value?.tags || [])
const aktOrdner = computed(() => ordner.value.find((o) => String(o.id) === ordnerId.value))
const { data: stats } = await (useFetch as any)('/api/files/stats', { key: 'stats' })
const anzahl = useHochzaehlen(() => Number(stats.value?.dateien || 0))

onMounted(() => laden())
watch([art, tag, sort, ordnerId, suche], () => laden())
watch(neu, () => liveListe()) // eigener Upload fertig: Liste still abgleichen (behält nachgeladene Seiten und Scrollposition)
function mehr() {
  seite.value++
  void laden(false)
}
const ARTEN = computed(() => [
  { v: '', text: t('Alle', 'All') },
  { v: 'bild', text: t('Bilder', 'Images') },
  { v: 'video', text: 'Videos' },
  { v: 'audio', text: 'Audio' },
  { v: 'text', text: 'Text' },
  { v: 'datei', text: t('Dateien', 'Files') }
])

const auswahl = ref<Set<string>>(new Set())
const auswahlModus = computed(() => auswahl.value.size > 0)
function waehlen(id: string) {
  const s = new Set(auswahl.value)
  s.has(id) ? s.delete(id) : s.add(id)
  auswahl.value = s
}
async function sammel(aktion: string, wert?: any) {
  const ids = [...auswahl.value]
  try {
    const r = await api('/api/files/bulk', { method: 'POST', body: { ids, aktion, wert } })
    ok(
      aktion === 'loeschen' ? t(`${r.anzahl} Datei(en) gelöscht`, `${r.anzahl} file(s) deleted`) : t('Erledigt', 'Done')
    )
    auswahl.value = new Set()
    await laden()
  } catch (e: any) {
    fehler(e.message)
  }
}
function sammelLoeschen() {
  bestaetigen(
    t('In den Papierkorb?', 'Move to trash?'),
    t(
      `${auswahl.value.size} Datei(en) kommen für 30 Tage in den Papierkorb.`,
      `${auswahl.value.size} file(s) go to the trash for 30 days.`
    ),
    t('In den Papierkorb', 'Move to trash'),
    () => sammel('loeschen')
  )
}
const verschiebenAuf = ref(false)
const ablaufAuf = ref(false)

const offen = ref<any>(null)
function geaendert(f: any) {
  files.value = files.value.map((x) => (x.id === f.id ? f : x))
  if (offen.value?.id === f.id) offen.value = f
  void ordnerNeu()
  void tagsNeu()
}
function geloescht(id: string) {
  files.value = files.value.filter((x) => x.id !== id)
  gesamt.value--
}

// ===== Live-Aktualisierung =====
// Dateiliste: die bisher geladenen Seiten still neu holen (kein Leer-Zustand, keine Ladeanzeige), unveränderte Karten behalten ihr Objekt
async function holeListe(n: number) {
  const q = filterQuery()
  const pro = Math.min(200, n)
  const alle: any[] = []
  let summe = 0
  for (let k = 1; k <= Math.ceil(n / pro); k++) {
    const r = await api('/api/files', { query: { seite: k, pro, ...q } })
    if (k === 1) summe = r.gesamt
    alle.push(...r.files)
    if (r.files.length < pro) break
  }
  return { files: alle.slice(0, n), gesamt: summe }
}
const gleich = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
async function offeneDateiAbgleichen(neueListe: any[]) {
  const id = offen.value?.id
  if (!id) return
  const inListe = neueListe.find((f) => f.id === id)
  if (inListe) {
    if (inListe !== offen.value && !gleich(inListe, offen.value)) offen.value = inListe
    return
  }
  // Nicht (mehr) in der angezeigten Liste: gelöscht/ohne Zugriff oder nur weggerückt (neue Dateien, Filter)? Die Einzelabfrage klärt es.
  try {
    const r = await api(`/api/files/${id}`)
    if (offen.value?.id !== id) return
    const neu = { ...offen.value, ...r.file }
    if (!gleich(neu, offen.value)) offen.value = neu
  } catch (e: any) {
    if (e.status === 404 && offen.value?.id === id) {
      offen.value = null
      ok(t('Die Datei wurde woanders gelöscht oder verschoben.', 'The file was deleted or moved elsewhere.'))
    }
  }
}
async function listeAbgleichen() {
  for (let i = 0; laedt.value && i < 50; i++) await new Promise((r) => setTimeout(r, 200)) // erst fertig laden lassen
  const start = ladeNr
  const r = await holeListe(Math.max(1, seite.value) * PRO)
  if (start !== ladeNr) return void liveListe() // währenddessen gefiltert oder nachgeladen: nochmal von vorn
  const alt = new Map(files.value.map((f) => [f.id, f]))
  const neueListe = r.files.map((f: any) => {
    const o = alt.get(f.id)
    return o && gleich(o, f) ? o : f
  })
  if (neueListe.length !== files.value.length || neueListe.some((f: any, i: number) => f !== files.value[i])) files.value = neueListe
  if (gesamt.value !== r.gesamt) gesamt.value = r.gesamt
  // Auswahl: Verschwundenes entfernen, der Rest bleibt
  if (auswahl.value.size) {
    const da = new Set(neueListe.map((f: any) => f.id))
    const rest = [...auswahl.value].filter((id) => da.has(id))
    if (rest.length !== auswahl.value.size) auswahl.value = new Set(rest)
  }
  await offeneDateiAbgleichen(neueListe)
}
const liveListe = liveDrosseln(listeAbgleichen)
// Ordnerliste (Auswahl beim Verschieben, Titel des geöffneten Ordners); ist der geöffnete Ordner weg, zurück zu „Alle Dateien“
async function ordnerAbgleichen() {
  const r = await api('/api/folders')
  if (!gleich(r, ordnerDaten.value)) ordnerDaten.value = r
  if (ordnerId.value && !(r.ordner || []).some((o: any) => String(o.id) === ordnerId.value)) {
    ok(t('Dieser Ordner wurde gelöscht.', 'This folder was deleted.'))
    await navigateTo({ path: '/drop', query: { ...route.query, ordner: undefined } }, { replace: true })
  }
}
const liveOrdner = liveDrosseln(ordnerAbgleichen)
// Zähler im Kopf (Dateien, Ordner, zuletzt hochgeladen) und die Speicheranzeige der Seitenleiste (gleicher Schlüssel „stats“)
async function statsAbgleichen() {
  const r = await api('/api/files/stats')
  if (!gleich(r, stats.value)) stats.value = r
}
const liveStats = liveDrosseln(statsAbgleichen, 2000)
useLive(['dateien'], liveListe)
useLive(['ordner'], liveOrdner)
useLive(['dateien', 'ordner', 'papierkorb'], liveStats)

const ablage = ref<HTMLElement | null>(null)
const ablageAn = ref(false)
function ablageMaus(e: MouseEvent) {
  const r = ablage.value!.getBoundingClientRect()
  ablage.value!.style.setProperty('--ax', e.clientX - r.left + 'px')
  ablage.value!.style.setProperty('--ay', e.clientY - r.top + 'px')
}
const dateiFeld = ref<HTMLInputElement | null>(null)
function gewaehlt(e: Event) {
  const f = (e.target as HTMLInputElement).files
  if (f?.length) hochladen(f, { ordner: Number(ordnerId.value) || null })
  ;(e.target as HTMLInputElement).value = ''
}

const neuerTag = ref('')
async function tagAnlegen() {
  if (!neuerTag.value.trim()) return
  try {
    await api('/api/tags', {
      method: 'POST',
      body: {
        name: neuerTag.value,
        color: ['#1e73be', '#f59e0b', '#ef4444', '#22c55e', '#a855f7', '#ec4899'][tags.value.length % 6]
      }
    })
    neuerTag.value = ''
    await tagsNeu()
  } catch (e: any) {
    fehler(e.message)
  }
}
</script>

<template>
  <section class="rein">
    <div class="kopf">
      <div>
        <div class="eyebrow">{{ aktOrdner ? t('Ordner', 'Folder') : 'Drop' }}</div>
        <h1>{{ aktOrdner ? aktOrdner.name : suche ? t(`Suche: „${suche}“`, `Search: “${suche}”`) : t('Uploads & Links', 'Uploads & links') }}</h1>
        <p><b class="zahl" style="font-weight:500;color:var(--text)">{{ zahl(Math.round(anzahl)) }}</b> {{ t('Dateien', 'files') }} · {{ zahl(stats?.ordner || 0) }} {{ t('Ordner', 'folders') }}<template v-if="stats?.zuletzt"> · {{ t('zuletzt hochgeladen', 'last upload') }} {{ vorher(stats.zuletzt) }}</template></p>
      </div>
      <div class="reihe">
        <NuxtLink v-if="aktOrdner" to="/drop" class="knopf klein"><Ico n="left" /> {{ t('Alle Dateien', 'All files') }}</NuxtLink>
        <VdAuswahl v-model="sort" class="eingabe sortierung" :aria-label="t('Sortierung', 'Sort')">
          <option value="neu">{{ t('Neueste zuerst', 'Newest first') }}</option><option value="alt">{{ t('Älteste zuerst', 'Oldest first') }}</option>
          <option value="gross">{{ t('Größte zuerst', 'Largest first') }}</option><option value="name">{{ t('Name A–Z', 'Name A–Z') }}</option><option value="aufrufe">{{ t('Meiste Aufrufe', 'Most views') }}</option>
        </VdAuswahl>
      </div>
    </div>

    <div ref="ablage" class="ablage" :class="{ zieht: ablageAn }" role="button" tabindex="0" @mousemove="ablageMaus" @mouseenter="ablageAn = true" @mouseleave="ablageAn = false" @click="dateiFeld?.click()" @keydown.enter="dateiFeld?.click()">
      <span class="welle"></span><span class="welle zwei"></span>
      <span class="kreis"><Ico n="upload" /></span>
      <div><h3>{{ t('Dateien hier ablegen', 'Drop files here') }}</h3><p>{{ t('oder klicken, oder mit Strg + V einfügen · große Dateien gehen in Stücken und setzen nach einem Abbruch fort', 'or click, or paste with Ctrl + V · large files go in chunks and resume after an interruption') }}</p></div>
      <div class="wege" @click.stop><NuxtLink to="/werkzeuge" class="knopf klein"><Ico n="download" /> ShareX</NuxtLink><NuxtLink to="/werkzeuge" class="knopf klein"><Ico n="camera" /> Flameshot</NuxtLink><NuxtLink to="/werkzeuge" class="knopf klein"><Ico n="terminal" /> curl</NuxtLink></div>
      <input ref="dateiFeld" type="file" multiple class="versteckt" @change="gewaehlt">
    </div>

    <TransitionGroup tag="div" name="hl" class="hochladen">
      <div v-for="u in uploads" :key="u.id" class="hl" :class="{ fertig: u.status === 'fertig', fehler: u.status === 'fehler' }" :data-upload="u.id">
        <span class="ic"><Ico :n="u.status === 'fertig' ? 'check' : u.status === 'fehler' ? 'alert' : 'upload'" /></span>
        <div style="min-width:0">
          <div class="name"><span class="nm">{{ u.name }}</span> <small>{{ groesse(u.size) }}</small></div>
          <div class="stuecke"><i v-for="n in Math.min(u.teile, 40)" :key="n" :class="{ fertig: (n - 1) < Math.round(u.fertig * Math.min(u.teile, 40) / u.teile), laeuft: u.status === 'laeuft' && (n - 1) === Math.round(u.fertig * Math.min(u.teile, 40) / u.teile) }"></i></div>
        </div>
        <span class="hl-status" :class="{ ok: u.status === 'fertig' }">
          <template v-if="u.status === 'fertig'">{{ t('fertig · Link kopiert', 'done · link copied') }}</template>
          <template v-else-if="u.status === 'fehler'">{{ u.fehler }}</template>
          <template v-else>{{ Math.round(u.fertig / u.teile * 100) }} %</template>
          <button v-if="u.status !== 'fertig'" class="knopf nur-icon" :aria-label="t('Abbrechen', 'Cancel')" @click="entfernen(u.id)"><Ico n="x" /></button>
        </span>
      </div>
    </TransitionGroup>

    <div class="werkzeuge">
      <div class="seg" role="tablist"><button v-for="a in ARTEN" :key="a.v" :class="{ an: art === a.v }" role="tab" :aria-selected="art === a.v" @click="art = a.v">{{ a.text }}</button></div>
      <button v-for="x in tags" :key="x.id" class="tag" :class="{ an: tag === x.id }" :style="{ '--c': x.color }" @click="tag = tag === x.id ? 0 : x.id"><i></i>{{ x.name }}</button>
      <form class="tag-neu" @submit.prevent="tagAnlegen"><input v-model="neuerTag" :placeholder="t('+ Tag', '+ tag')" maxlength="30" :aria-label="t('Neuer Tag', 'New tag')"></form>
    </div>

    <div v-if="files.length" class="raster">
      <DateiKarte v-for="(f, i) in files" :key="f.id" :f="f" :i="i" :gewaehlt="auswahl.has(f.id)" :auswahl-modus="auswahlModus" @oeffnen="offen = f" @waehlen="waehlen(f.id)" />
    </div>
    <div v-else-if="!laedt" class="leer-hinweis block">
      <h3>{{ suche || art || tag ? t('Nichts gefunden', 'Nothing found') : t('Noch keine Dateien', 'No files yet') }}</h3>
      <p>{{ suche || art || tag ? t('Versuch es mit einem anderen Filter.', 'Try a different filter.') : t('Zieh eine Datei hierher oder verbinde ShareX unter „Upload-Werkzeuge“.', 'Drag a file here or connect ShareX under “Upload tools”.') }}</p>
    </div>
    <div v-if="files.length < gesamt" class="mehr"><button class="knopf" :disabled="laedt" @click="mehr"><Ico v-if="laedt" n="loader" spin />{{ t('Mehr laden', 'Load more') }} ({{ zahl(gesamt - files.length) }})</button></div>

    <div class="aktionsleiste" :class="{ an: auswahlModus }" role="toolbar" :aria-label="t('Auswahl', 'Selection')">
      <b>{{ auswahl.size }} {{ t('ausgewählt', 'selected') }}</b>
      <div class="pop">
        <button @click="verschiebenAuf = !verschiebenAuf; ablaufAuf = false"><Ico n="folder" /> {{ t('Verschieben', 'Move') }}</button>
        <div v-if="verschiebenAuf" class="pop-liste">
          <button @click="sammel('verschieben', null); verschiebenAuf = false">{{ t('Ohne Ordner', 'No folder') }}</button>
          <button v-for="o in ordner" :key="o.id" @click="sammel('verschieben', o.id); verschiebenAuf = false">{{ o.name }}</button>
        </div>
      </div>
      <div class="pop">
        <button @click="ablaufAuf = !ablaufAuf; verschiebenAuf = false"><Ico n="clock" /> {{ t('Ablauf', 'Expiry') }}</button>
        <div v-if="ablaufAuf" class="pop-liste">
          <button v-for="a in [['1d', t('1 Tag', '1 day')], ['7d', t('7 Tage', '7 days')], ['30d', t('30 Tage', '30 days')], ['', t('Nie', 'Never')]]" :key="a[0]" @click="sammel('ablauf', a[0] || null); ablaufAuf = false">{{ a[1] }}</button>
        </div>
      </div>
      <button @click="sammel('favorit', true)"><Ico n="star" /> {{ t('Merken', 'Favourite') }}</button>
      <button class="weg" :aria-label="t('Löschen', 'Delete')" @click="sammelLoeschen"><Ico n="trash" /></button>
      <button :aria-label="t('Auswahl aufheben', 'Clear selection')" @click="auswahl = new Set()"><Ico n="x" /></button>
    </div>

    <DateiDetail v-if="offen" :f="offen" :ordner="ordner" :tags="tags" @zu="offen = null" @geaendert="geaendert" @geloescht="geloescht" />
  </section>
</template>

<style scoped>
.sortierung {
  width: auto;
  padding: 7px 10px;
  font-size: 13px;
}
.ablage {
  position: relative;
  border: 1.5px dashed var(--linie2);
  border-radius: 18px;
  padding: 22px 24px;
  display: flex;
  align-items: center;
  gap: 20px;
  background: var(--flaeche);
  overflow: hidden;
  transition:
    border-color 0.25s,
    background 0.25s,
    transform 0.25s;
  margin-bottom: 18px;
  cursor: pointer;
}
.ablage::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(360px circle at var(--ax, 50%) var(--ay, 50%), rgba(var(--a-rgb), 0.1), transparent 60%);
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
}
.ablage.zieht {
  border-color: var(--a);
  background: rgba(var(--a-rgb), 0.03);
}
.ablage.zieht::before {
  opacity: 1;
}
.ablage .kreis {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: rgba(var(--a-rgb), 0.1);
  color: var(--a);
  display: grid;
  place-items: center;
  flex-shrink: 0;
  position: relative;
}
.ablage .kreis svg {
  width: 21px;
  height: 21px;
  animation: tropfIdle 3.2s 1s ease-in-out infinite;
}
.ablage.zieht .kreis svg {
  animation: hopsen 0.7s ease-in-out infinite;
}
.ablage .welle {
  position: absolute;
  width: 52px;
  height: 52px;
  left: 24px;
  top: 50%;
  margin-top: -26px;
  border-radius: 14px;
  border: 2px solid var(--a);
  opacity: 0;
  pointer-events: none;
}
.ablage.zieht .welle {
  animation: welle 1.4s ease-out infinite;
}
.ablage.zieht .welle.zwei {
  animation-delay: 0.5s;
}
@keyframes welle {
  from {
    transform: scale(1);
    opacity: 0.5;
  }
  to {
    transform: scale(2.6);
    opacity: 0;
  }
}
@keyframes hopsen {
  50% {
    transform: translateY(-4px);
  }
}
@keyframes tropfIdle {
  0%,
  80%,
  100% {
    transform: translateY(0);
  }
  86% {
    transform: translateY(-5px);
  }
  92% {
    transform: translateY(1px) scale(1.06, 0.94);
  }
}
.ablage h3 {
  font-size: 15px;
  font-weight: 600;
}
.ablage p {
  margin: 2px 0 0;
  color: var(--text2);
  font-size: 13px;
}
.ablage .wege {
  margin-left: auto;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  position: relative;
}

.hochladen {
  display: grid;
  gap: 8px;
  margin-bottom: 22px;
}
.hl {
  display: grid;
  grid-template-columns: 38px 1fr auto;
  gap: 12px;
  align-items: center;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 12px;
  padding: 10px 14px;
  transition:
    border-color 0.3s,
    box-shadow 0.3s;
}
.hl.fertig {
  border-color: rgba(var(--a-rgb), 0.45);
  box-shadow: 0 0 0 6px rgba(var(--a-rgb), 0.06);
}
.hl.fehler {
  border-color: var(--rot);
}
.hl .ic {
  width: 38px;
  height: 38px;
  border-radius: 9px;
  background: var(--flaeche2);
  display: grid;
  place-items: center;
  color: var(--text2);
}
.hl.fertig .ic {
  color: var(--ok);
}
.hl .ic svg {
  width: 17px;
  height: 17px;
}
.hl .name {
  font-weight: 500;
  font-size: 13px;
  display: flex;
  gap: 8px;
  align-items: baseline;
  min-width: 0;
}
.hl .nm {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hl .name small {
  color: var(--text3);
  font-family: var(--f-mono);
  font-size: 11.5px;
  white-space: nowrap;
}
.stuecke {
  display: flex;
  gap: 3px;
  margin-top: 7px;
}
.stuecke i {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--flaeche2);
  position: relative;
  overflow: hidden;
  transition: background 0.3s;
}
.stuecke i.fertig {
  background: var(--a);
}
.stuecke i.laeuft::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--a);
  transform-origin: left;
  animation: stueck 1.2s ease-in-out infinite alternate;
}
@keyframes stueck {
  from {
    transform: scaleX(0.1);
  }
  to {
    transform: scaleX(0.9);
  }
}
.hl-status {
  font-size: 12px;
  color: var(--text2);
  font-family: var(--f-mono);
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 280px;
}
.hl-status.ok {
  color: var(--ok);
}
.hl-enter-active {
  transition:
    opacity 0.4s,
    transform 0.45s var(--kurve);
}
.hl-leave-active {
  transition:
    opacity 0.5s,
    transform 0.5s;
}
.hl-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
.hl-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.werkzeuge {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 99px;
  border: 1px solid var(--linie);
  background: var(--flaeche);
  color: var(--text2);
  cursor: pointer;
  transition:
    border-color 0.2s,
    color 0.2s;
}
.tag i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--c);
}
.tag.an {
  border-color: var(--text);
  color: var(--text);
}
.tag-neu input {
  border: 1px dashed var(--linie2);
  background: transparent;
  border-radius: 99px;
  padding: 5px 10px;
  font-size: 12px;
  width: 90px;
  color: var(--text);
  outline: 0;
}
.tag-neu input:focus {
  border-color: var(--a);
  width: 140px;
}
.raster {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(214px, 1fr));
  gap: 14px;
  perspective: 1100px;
}
.mehr {
  display: flex;
  justify-content: center;
  margin-top: 22px;
}

.aktionsleiste {
  position: fixed;
  left: 50%;
  bottom: calc(26px + env(safe-area-inset-bottom, 0px));
  transform: translate(-50%, calc(100% + 60px));
  display: flex;
  gap: 6px;
  align-items: center;
  background: #17171a;
  color: #f4f3f5;
  border-radius: 14px;
  padding: 7px 7px 7px 16px;
  box-shadow: 0 20px 50px -12px rgba(0, 0, 0, 0.6);
  transition: transform 0.45s cubic-bezier(0.2, 0.9, 0.2, 1.15);
  z-index: 40;
}
.aktionsleiste.an {
  transform: translate(-50%, 0);
}
.aktionsleiste b {
  font-size: 13px;
  font-weight: 600;
  margin-right: 10px;
  white-space: nowrap;
}
.aktionsleiste button {
  border: 0;
  background: rgba(255, 255, 255, 0.06);
  color: #f4f3f5;
  border-radius: 9px;
  padding: 7px 11px;
  cursor: pointer;
  font-size: 12.5px;
  display: inline-flex;
  gap: 7px;
  align-items: center;
  white-space: nowrap;
}
.aktionsleiste button svg {
  width: 14px;
  height: 14px;
}
.aktionsleiste button:hover {
  background: rgba(255, 255, 255, 0.12);
}
.aktionsleiste .weg {
  color: #fca5a5;
}
.pop {
  position: relative;
}
.pop-liste {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 0;
  background: #17171a;
  border-radius: 12px;
  padding: 6px;
  min-width: 180px;
  max-height: 260px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-shadow: 0 20px 40px -12px rgba(0, 0, 0, 0.6);
  animation: modalRein 0.25s var(--kurve) backwards;
}
.pop-liste button {
  justify-content: flex-start;
  background: transparent;
}
@media (max-width: 860px) {
  .ablage {
    flex-wrap: wrap;
  }
  .ablage .wege {
    margin-left: 0;
  }
  .aktionsleiste {
    left: max(12px, env(safe-area-inset-left, 0px));
    right: max(12px, env(safe-area-inset-right, 0px));
    transform: translate(0, calc(100% + 60px));
    overflow-x: auto;
  }
  .aktionsleiste.an {
    transform: none;
  }
}
</style>
