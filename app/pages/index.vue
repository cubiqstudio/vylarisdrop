<script setup lang="ts">
// Cloud-Dateimanager ("Meine Dateien"): Ordner, Zuletzt, Favoriten, Team-Ordner. Das Hochladen und die Links des
// alten Systems bleiben unter /drop erhalten.
import type { CloudEintrag, CloudSortierung, MenuePunkt } from '~/composables/useCloud'

useHead({ title: () => t('Meine Dateien', 'My files') })
const theme = useTheme()
const bestaetigen = useBestaetigen()
const { fehler } = useToast()
const c = useCloud()
const up = useCloudUpload()
const { liste: uploads, entfernen: uploadEntfernen } = useUploads()
const {
  ordnerId, ansicht, suche, eintraege, meta, laedt, ladeFehler, auswahl, fokus, ausgewaehlt, darstellung, wirksam, detail, teilen
} = c

// ---------- Brotkrumen ----------
interface Krume {
  text: string
  ziel?: string // data-ziel (Ablegen)
  zu?: () => void
  versteckt?: Array<{ id: number; name: string }>
  aktuell?: boolean
}
const KRUMEN_MAX = 4
const krumen = computed<Krume[]>(() => {
  const m = meta.value
  const aus: Krume[] = []
  const team = m?.kontext === 'team'
  if (suche.value) {
    aus.push({ text: t(`Suche nach „${suche.value}“`, `Search for “${suche.value}”`), aktuell: true })
    return aus
  }
  if (ansicht.value === 'zuletzt') return [{ text: t('Zuletzt', 'Recent'), aktuell: true }]
  if (ansicht.value === 'favoriten') return [{ text: t('Favoriten', 'Favourites'), aktuell: true }]
  const pfad: Array<{ id: number; name: string }> = m?.pfad || []
  if (team)
    aus.push({ text: t('Team-Ordner', 'Team folders'), zu: () => c.gehZuAnsicht('team'), aktuell: !pfad.length })
  else aus.push({ text: t('Meine Dateien', 'My files'), ziel: 'wurzel', zu: () => c.gehZuOrdner(null), aktuell: !pfad.length })
  if (pfad.length > KRUMEN_MAX) {
    aus.push({ text: '…', versteckt: pfad.slice(0, pfad.length - 2) })
    for (const p of pfad.slice(-2)) aus.push(krumeFuer(p, p === pfad[pfad.length - 1]))
  } else for (const p of pfad) aus.push(krumeFuer(p, p === pfad[pfad.length - 1]))
  return aus
})
const krumeFuer = (p: { id: number; name: string }, aktuell: boolean): Krume => ({
  text: p.name,
  ziel: 'o' + p.id,
  zu: () => c.gehZuOrdner(p.id),
  aktuell
})

// ---------- Menüs ----------
interface MenueZustand {
  x: number
  y: number
  punkte: MenuePunkt[]
  art: 'eintrag' | 'neu' | 'sortieren' | 'krume' | 'leer'
  ziele?: any[]
  krumen?: Array<{ id: number; name: string }>
}
const menue = ref<MenueZustand | null>(null)
const einzel = computed(() => (ausgewaehlt.value.length === 1 ? ausgewaehlt.value[0]! : null))
const nurAenderbar = (l: CloudEintrag[]) => l.every((e) => e.darf_aendern !== false)

function punkteFuer(l: CloudEintrag[]): MenuePunkt[] {
  const aenderbar = nurAenderbar(l)
  const alleFav = l.every((e) => e.favorite)
  const ein = l.length === 1 ? l[0]! : null
  const p: MenuePunkt[] = []
  if (ein) {
    p.push({ k: 'oeffnen', text: ein.typ === 'ordner' ? t('Öffnen', 'Open') : t('Vorschau & Details', 'Preview & details'), ic: ein.typ === 'ordner' ? 'folder' : 'eye', kurz: 'Enter' })
    if (suche.value || ansicht.value !== 'alle') p.push({ k: 'ort', text: t('Speicherort öffnen', 'Show in folder'), ic: 'right' })
  }
  p.push({ k: 'laden', text: ein?.typ === 'datei' ? t('Herunterladen', 'Download') : t('Als ZIP herunterladen', 'Download as ZIP'), ic: 'download' })
  if (ein?.typ === 'datei') {
    p.push({ k: 'link', text: t('Link kopieren', 'Copy link'), ic: 'link' })
    p.push({ k: 'teilen', text: t('Teilen …', 'Share …'), ic: 'external' })
  }
  if (ein?.typ === 'ordner') p.push({ k: 'galerie', text: t('Galerie & Teilen (Drop) …', 'Gallery & sharing (Drop) …'), ic: 'external' })
  p.push({ k: 't1', text: '', trenner: true })
  if (ein) p.push({ k: 'umbenennen', text: t('Umbenennen', 'Rename'), ic: 'edit', kurz: 'F2', aus: !aenderbar })
  p.push({ k: 'verschieben', text: t('Verschieben nach …', 'Move to …'), ic: 'move', aus: !aenderbar, kurz: t('Strg X', 'Ctrl X') })
  p.push({ k: 'kopieren', text: t('Kopieren nach …', 'Copy to …'), ic: 'copy', kurz: t('Strg C', 'Ctrl C') })
  p.push({ k: 'favorit', text: alleFav ? t('Favorit entfernen', 'Remove favourite') : t('Als Favorit merken', 'Mark as favourite'), ic: 'star', aus: !aenderbar })
  p.push({ k: 't2', text: '', trenner: true })
  p.push({ k: 'loeschen', text: t('In den Papierkorb', 'Move to trash'), ic: 'trash', gefahr: true, aus: !aenderbar, kurz: t('Entf', 'Del') })
  return p
}

function eintragMenue(e: CloudEintrag | null, pos: { x: number; y: number }) {
  if (e) {
    if (!auswahl.value.has(eintragKey(e))) {
      c.auswaehlen([eintragKey(e)])
      c.anker.value = eintragKey(e)
    }
    fokus.value = eintragKey(e)
    menue.value = { ...pos, art: 'eintrag', punkte: punkteFuer(ausgewaehlt.value), ziele: [...ausgewaehlt.value] }
  } else {
    c.auswahlLeeren()
    const p: MenuePunkt[] = []
    if (c.kannHineinladen.value) {
      p.push({ k: 'neuordner', text: t('Neuer Ordner', 'New folder'), ic: 'folder', kurz: t('Strg ⇧ N', 'Ctrl ⇧ N') })
      p.push({ k: 'hochladen', text: t('Dateien hochladen', 'Upload files'), ic: 'upload' })
      p.push({ k: 'hochladenOrdner', text: t('Ordner hochladen', 'Upload folder'), ic: 'upload' })
      if (c.ablage.value) p.push({ k: 'einfuegen', text: t(`Einfügen (${c.ablage.value.anzahl})`, `Paste (${c.ablage.value.anzahl})`), ic: 'copy', kurz: t('Strg V', 'Ctrl V') })
      p.push({ k: 't1', text: '', trenner: true })
    }
    p.push({ k: 'alle', text: t('Alles auswählen', 'Select all'), ic: 'check', kurz: t('Strg A', 'Ctrl A'), aus: !eintraege.value.length })
    menue.value = { ...pos, art: 'leer', punkte: p }
  }
}
function neuMenue(ev: MouseEvent) {
  const r = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  const p: MenuePunkt[] = []
  if (ansicht.value === 'team' && !ordnerId.value) {
    if (meta.value?.kannTeamOrdner) p.push({ k: 'teamordner', text: t('Team-Ordner anlegen', 'Create team folder'), ic: 'folder' })
  } else {
    p.push({ k: 'neuordner', text: t('Neuer Ordner', 'New folder'), ic: 'folder', kurz: t('Strg ⇧ N', 'Ctrl ⇧ N') })
    p.push({ k: 'hochladen', text: t('Dateien hochladen', 'Upload files'), ic: 'upload' })
    p.push({ k: 'hochladenOrdner', text: t('Ordner hochladen', 'Upload folder'), ic: 'upload' })
  }
  menue.value = { x: r.left, y: r.bottom + 6, art: 'neu', punkte: p }
}
function sortMenue(ev: MouseEvent) {
  const r = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  const w = wirksam.value
  const haken = (k: string, an: boolean) => (an ? '✓ ' : '') + k
  menue.value = {
    x: Math.max(8, r.right - 220),
    y: r.bottom + 6,
    art: 'sortieren',
    punkte: [
      { k: 's:name', text: haken(t('Name', 'Name'), w.sort === 'name'), ic: 'text' },
      { k: 's:groesse', text: haken(t('Größe', 'Size'), w.sort === 'groesse'), ic: 'box' },
      { k: 's:datum', text: haken(t('Geändert', 'Modified'), w.sort === 'datum'), ic: 'clock' },
      { k: 't1', text: '', trenner: true },
      { k: 'r:auf', text: haken(t('Aufsteigend', 'Ascending'), w.richtung === 'auf'), ic: 'up' },
      { k: 'r:ab', text: haken(t('Absteigend', 'Descending'), w.richtung === 'ab'), ic: 'down' }
    ]
  }
}
function krumenMenue(k: Krume, ev: MouseEvent) {
  const r = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  menue.value = {
    x: r.left,
    y: r.bottom + 6,
    art: 'krume',
    krumen: k.versteckt,
    punkte: (k.versteckt || []).map((p) => ({ k: 'k:' + p.id, text: p.name, ic: 'folder' }))
  }
}

const dateiFeld = ref<HTMLInputElement | null>(null)
const ordnerFeld = ref<HTMLInputElement | null>(null)
function menueWahl(k: string) {
  const m = menue.value
  menue.value = null
  if (!m) return
  if (k.startsWith('s:')) return c.sortieren(k.slice(2) as CloudSortierung)
  if (k.startsWith('r:')) return c.sortieren(wirksam.value.sort, k.slice(2) as 'auf' | 'ab')
  if (k.startsWith('k:')) return void c.gehZuOrdner(Number(k.slice(2)))
  const l: CloudEintrag[] = m.ziele || ausgewaehlt.value
  const ein = l.length === 1 ? l[0]! : null
  switch (k) {
    case 'oeffnen':
      if (ein) c.oeffnen(ein)
      break
    case 'ort':
      if (ein) ortOeffnen(ein)
      break
    case 'laden':
      c.herunterladen(l)
      break
    case 'link':
      if (ein) void c.linkKopieren(ein)
      break
    case 'teilen':
      if (ein) teilen.value = ein
      break
    case 'galerie':
      void navigateTo('/ordner')
      break
    case 'umbenennen':
      if (ein) starteUmbenennen(ein)
      break
    case 'verschieben':
      baum.value = { modus: 'verschieben', items: l }
      break
    case 'kopieren':
      baum.value = { modus: 'kopieren', items: l }
      break
    case 'favorit':
      void c.favorit(l, !l.every((e) => e.favorite))
      break
    case 'loeschen':
      loeschenFrage(l)
      break
    case 'neuordner':
      neuerOrdnerOffen.value = true
      break
    case 'teamordner':
      teamOrdnerOffen.value = true
      break
    case 'hochladen':
      dateiFeld.value?.click()
      break
    case 'hochladenOrdner':
      ordnerFeld.value?.click()
      break
    case 'einfuegen':
      void c.einfuegen()
      break
    case 'alle':
      c.alleWaehlen()
      break
  }
}
function ortOeffnen(e: CloudEintrag) {
  const ziel = e.typ === 'ordner' ? e.parent_id : e.folder_id
  void c.zu({ ordner: ziel || null })
}

// ---------- Umbenennen ----------
const umbenennenKey = ref<string | null>(null)
function starteUmbenennen(e: CloudEintrag) {
  if (e.darf_aendern === false) return fehler(t('Das darfst du nicht umbenennen.', 'You may not rename this.'))
  c.auswaehlen([eintragKey(e)])
  umbenennenKey.value = eintragKey(e)
}
async function umbenannt(e: CloudEintrag, name: string | null) {
  umbenennenKey.value = null
  if (name != null) await c.umbenennen(e, name)
  void nextTick(() => liste.value?.wurzel?.focus({ preventScroll: true }))
}

// ---------- Löschen ----------
function loeschenFrage(l: CloudEintrag[]) {
  if (!l.length) return
  if (!nurAenderbar(l)) return fehler(t('Das darfst du nicht löschen.', 'You may not delete this.'))
  const ordner = l.filter((e) => e.typ === 'ordner')
  if (!ordner.length) return void c.loeschen(l)
  bestaetigen(
    t('Ordner löschen?', 'Delete folders?'),
    t(
      `${c.anzahlText(l)} wird gelöscht. Die enthaltenen Dateien kommen für 30 Tage in den Papierkorb; die Ordner selbst lassen sich nicht wiederherstellen.`,
      `${c.anzahlText(l)} will be deleted. The files inside go to the trash for 30 days; the folders themselves cannot be restored.`
    ),
    t('Löschen', 'Delete'),
    async () => {
      await c.loeschen(l)
    }
  )
}

// ---------- Neuer Ordner ----------
const neuerOrdnerOffen = ref(false)
const teamOrdnerOffen = ref(false)
const neuerName = ref('')
const teamAuswahl = ref<number | null>(null)
watch([neuerOrdnerOffen, teamOrdnerOffen], ([a, b]) => {
  if (a || b) neuerName.value = a ? t('Neuer Ordner', 'New folder') : ''
  if (b) teamAuswahl.value = (meta.value?.teams || []).find((x: any) => x.rolle === 'leitung')?.id ?? null
  if (a || b)
    void nextTick(() => {
      const el = document.getElementById('cz-neuer-name') as HTMLInputElement | null
      el?.focus()
      el?.select()
    })
})
async function ordnerSpeichern() {
  const name = neuerName.value.trim()
  if (!name) return
  const klappt = teamOrdnerOffen.value
    ? !!teamAuswahl.value && (await c.teamOrdnerAnlegen(name, teamAuswahl.value))
    : await c.ordnerAnlegen(name)
  if (klappt) neuerOrdnerOffen.value = teamOrdnerOffen.value = false
}

// ---------- Verschieben / Kopieren ----------
const baum = ref<{ modus: 'verschieben' | 'kopieren'; items: CloudEintrag[] } | null>(null)
async function baumOk(ziel: number | null) {
  const b = baum.value
  if (!b) return
  if (b.modus === 'verschieben') await c.verschieben(b.items, ziel)
  else await c.kopierenNach(b.items, ziel)
  baum.value = null
}

// ---------- Details ----------
const ordnerDaten = ref<any[]>([])
const tagDaten = ref<any[]>([])
watch(detail, async (d) => {
  if (!d) {
    ordnerDaten.value = [] // beim nächsten Öffnen frisch laden (Ordner können sich geändert haben)
    return
  }
  if (ordnerDaten.value.length) return
  try {
    const [o, tg] = await Promise.all([api('/api/folders'), api('/api/tags').catch(() => ({ tags: [] }))])
    const byId = new Map<number, any>((o.ordner || []).map((x: any) => [x.id, x]))
    const pfad = (x: any): string => (x.parent_id && byId.has(x.parent_id) ? pfad(byId.get(x.parent_id)) + ' / ' : '') + x.name
    ordnerDaten.value = (o.ordner || []).map((x: any) => ({ id: x.id, name: pfad(x) })).sort((a: any, b: any) => a.name.localeCompare(b.name))
    tagDaten.value = tg.tags || []
  } catch {}
})
function detailGeaendert(f: any) {
  const e = eintraege.value.find((x) => x.typ === 'datei' && String(x.id) === String(f.id))
  if (e) Object.assign(e, f)
  if (detail.value && String(detail.value.id) === String(f.id)) detail.value = { ...detail.value, ...f }
  void c.neuLaden()
}
function detailGeloescht(id: string) {
  eintraege.value = eintraege.value.filter((x) => !(x.typ === 'datei' && String(x.id) === String(id)))
  void c.neuLaden()
}
function teilenZuOptionen() {
  const f = teilen.value
  teilen.value = null
  if (f) detail.value = f
}

// ---------- Upload-Eingaben ----------
function dateienGewaehlt(ev: Event) {
  const el = ev.target as HTMLInputElement
  if (el.files?.length) void up.ausDateiliste(el.files, ordnerId.value)
  el.value = ''
}
const auchLaeuft = computed(() => uploads.value.filter((u) => u.status === 'warte' || u.status === 'laeuft'))
const panelOffen = ref(true)
const panelListe = computed(() => uploads.value.slice(0, 8))
const prozent = (u: any) => (u.status === 'fertig' ? 100 : u.teile ? Math.round((u.fertig / u.teile) * 100) : 0)

// ---------- Liste: Interaktion ----------
const liste = ref<any>(null)
function ueber(key: string, ev: DragEvent) {
  if (c.istIntern(ev) && c.zielErlaubt(key)) {
    ev.preventDefault()
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = ev.altKey ? 'copy' : 'move'
    c.ziel.value = key
  }
}
function weg(key: string) {
  if (c.ziel.value === key) c.ziel.value = null
}
function ablegenIntern(key: string, ev: DragEvent) {
  if (!c.istIntern(ev)) return
  ev.preventDefault()
  void c.ablegen(key, ev)
}
function leerKlick() {
  if (!menue.value) c.auswahlLeeren()
}
function haken(e: CloudEintrag) {
  c.umschalten(eintragKey(e))
}
function sternUm(e: CloudEintrag) {
  void c.favorit([e], !e.favorite)
}

// ---------- Äußere Dateien ablegen ----------
const extZieht = ref(false)
let extZaehler = 0
const hatDateien = (ev: DragEvent) => Array.from(ev.dataTransfer?.types || []).includes('Files')
function extRein(ev: DragEvent) {
  if (!hatDateien(ev)) return
  extZaehler++
  extZieht.value = true
}
function extRaus() {
  if (--extZaehler <= 0) {
    extZaehler = 0
    extZieht.value = false
    if (c.ziel.value) c.ziel.value = null
  }
}
function extUeber(ev: DragEvent) {
  if (!hatDateien(ev)) return
  const z = (ev.target as HTMLElement | null)?.closest?.('[data-ziel]') as HTMLElement | null
  const k = z?.dataset.ziel || null
  if (c.ziel.value !== k) c.ziel.value = k
}
function extAb(ev: DragEvent) {
  if (!hatDateien(ev)) return
  extZaehler = 0
  extZieht.value = false
  const z = (ev.target as HTMLElement | null)?.closest?.('[data-ziel]') as HTMLElement | null
  const k = z?.dataset.ziel || null
  c.ziel.value = null
  // Das eigene Hochladen übernimmt den Drop (auch ganze Ordner); die globale Anzeige des Layouts wird beendet
  ev.preventDefault()
  ev.stopImmediatePropagation()
  for (let i = 0; i < 40; i++) window.dispatchEvent(new Event('dragleave'))
  const ziel = k === 'wurzel' ? null : k ? Number(k.slice(1)) : ordnerId.value
  if (!k && !c.kannHineinladen.value)
    return fehler(
      ansicht.value === 'alle'
        ? t('In dieses Ergebnis kannst du nichts hochladen — öffne einen Ordner.', 'You cannot upload into search results — open a folder.')
        : t('Hier kannst du nichts ablegen — öffne zuerst einen Ordner unter „Alle Dateien“.', 'You cannot drop files here — first open a folder under “All files”.')
    )
  if (!ev.dataTransfer) return
  void up.ausDrop(ev.dataTransfer, ziel)
}

// ---------- Tastatur ----------
function spalten(): number {
  const el = liste.value?.wurzel as HTMLElement | undefined
  if (!el || darstellung.value !== 'raster') return 1
  return Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').length)
}
function bewegen(delta: number, ev: KeyboardEvent) {
  const l = eintraege.value
  if (!l.length) return
  const von = fokus.value ? c.indexVon(fokus.value) : -1
  const nach = von < 0 ? (delta > 0 ? 0 : l.length - 1) : Math.max(0, Math.min(l.length - 1, von + delta))
  const k = eintragKey(l[nach]!)
  fokus.value = k
  if (ev.ctrlKey || ev.metaKey) {
    // nur der Fokus wandert; Leertaste wählt
  } else if (ev.shiftKey) c.bereich(k, false)
  else {
    c.auswaehlen([k])
    c.anker.value = k
  }
  void nextTick(() => document.getElementById('cz-' + k)?.scrollIntoView({ block: 'nearest' }))
}
function nachOben() {
  const m = meta.value
  if (ansicht.value !== 'alle' || suche.value || !m?.ordner) return
  const p = m.ordner.parent_id
  if (m.kontext === 'team' && !p) return void c.gehZuAnsicht('team')
  void c.gehZuOrdner(p || null)
}
function offeneOberflaeche() {
  return !!document.querySelector('.modal-hg') || !!menue.value
}
function taste(ev: KeyboardEvent) {
  if (ev.defaultPrevented || offeneOberflaeche()) return
  const ziel = ev.target as HTMLElement | null
  if (ziel?.closest('input, textarea, select, [contenteditable="true"], .vd-wahl')) return
  const mod = ev.ctrlKey || ev.metaKey
  const k = ev.key
  const sp = spalten()
  if (mod && k.toLowerCase() === 'a') {
    ev.preventDefault()
    c.alleWaehlen()
  } else if (mod && ev.shiftKey && k.toLowerCase() === 'n') {
    ev.preventDefault()
    if (c.kannHineinladen.value) neuerOrdnerOffen.value = true
  } else if (mod && k.toLowerCase() === 'c' && ausgewaehlt.value.length) {
    ev.preventDefault()
    c.inAblage('kopieren', ausgewaehlt.value)
  } else if (mod && k.toLowerCase() === 'x' && ausgewaehlt.value.length) {
    ev.preventDefault()
    if (nurAenderbar(ausgewaehlt.value)) c.inAblage('verschieben', ausgewaehlt.value)
    else fehler(t('Das darfst du nicht verschieben.', 'You may not move this.'))
  } else if (mod && k.toLowerCase() === 'v' && c.ablage.value) {
    ev.preventDefault()
    void c.einfuegen()
  } else if (k === 'ArrowDown') {
    ev.preventDefault()
    bewegen(sp, ev)
  } else if (k === 'ArrowUp' && ev.altKey) {
    ev.preventDefault()
    nachOben()
  } else if (k === 'ArrowUp') {
    ev.preventDefault()
    bewegen(-sp, ev)
  } else if (k === 'ArrowRight' && darstellung.value === 'raster') {
    ev.preventDefault()
    bewegen(1, ev)
  } else if (k === 'ArrowLeft' && darstellung.value === 'raster') {
    ev.preventDefault()
    bewegen(-1, ev)
  } else if (k === 'Home') {
    ev.preventDefault()
    bewegen(-1e9, ev)
  } else if (k === 'End') {
    ev.preventDefault()
    bewegen(1e9, ev)
  } else if (k === 'Enter') {
    const e = einzel.value || (fokus.value ? eintraege.value[c.indexVon(fokus.value)] : null)
    if (e && !ziel?.closest('button, a')) {
      ev.preventDefault()
      c.oeffnen(e)
    }
  } else if (k === ' ' && fokus.value && !ziel?.closest('button, a')) {
    ev.preventDefault()
    c.umschalten(fokus.value)
  } else if (k === 'F2' && einzel.value) {
    ev.preventDefault()
    starteUmbenennen(einzel.value)
  } else if ((k === 'Delete' || (k === 'Backspace' && mod)) && ausgewaehlt.value.length) {
    ev.preventDefault()
    loeschenFrage(ausgewaehlt.value)
  } else if (k === 'Backspace' && !ausgewaehlt.value.length) {
    ev.preventDefault()
    nachOben()
  } else if (k === 'Escape') {
    if (ausgewaehlt.value.length) c.auswahlLeeren()
    else if (c.ablage.value) c.ablage.value = null
  }
}

// ---------- Mehr laden ----------
const sentinel = ref<HTMLElement | null>(null)
let beobachter: IntersectionObserver | null = null
onMounted(() => {
  document.addEventListener('keydown', taste)
  window.addEventListener('dragenter', extRein, true)
  window.addEventListener('dragleave', extRaus, true)
  window.addEventListener('dragover', extUeber, true)
  window.addEventListener('drop', extAb, true)
  beobachter = new IntersectionObserver((e) => e[0]?.isIntersecting && void c.mehrLaden(), { rootMargin: '700px' })
  watch(sentinel, (el, alt) => {
    if (alt) beobachter?.unobserve(alt)
    if (el) beobachter?.observe(el)
  }, { immediate: true, flush: 'post' })
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', taste)
  window.removeEventListener('dragenter', extRein, true)
  window.removeEventListener('dragleave', extRaus, true)
  window.removeEventListener('dragover', extUeber, true)
  window.removeEventListener('drop', extAb, true)
  beobachter?.disconnect()
})

// ---------- Anzeige ----------
const summeText = computed(() => {
  const s = meta.value?.summe
  if (!s) return ''
  const teile: string[] = []
  if (s.ordner) teile.push(mehrzahl(s.ordner, ['Ordner', 'Ordner'], ['folder', 'folders']))
  if (s.dateien) teile.push(mehrzahl(s.dateien, ['Datei', 'Dateien'], ['file', 'files']))
  if (s.bytes) teile.push(groesse(s.bytes))
  return teile.join(' · ')
})
const leerArt = computed(() => {
  if (suche.value) return 'suche'
  if (ansicht.value === 'zuletzt') return 'zuletzt'
  if (ansicht.value === 'favoriten') return 'favoriten'
  if (ansicht.value === 'team') return ordnerId.value ? 'ordner' : 'team'
  return ordnerId.value ? 'ordner' : 'wurzel'
})
const alleGeladenAusgewaehlt = computed(() => auswahl.value.size > 0 && auswahl.value.size === eintraege.value.length && meta.value?.mehr)
const suchfeldLeeren = () => {
  const el = document.querySelector<HTMLInputElement>('.suche input')
  if (el) {
    el.value = ''
    el.dispatchEvent(new Event('input', { bubbles: true }))
  } else void c.zu({})
}
const kannOben = computed(() => ansicht.value === 'alle' && !suche.value && !!ordnerId.value)
const istTeamWurzel = computed(() => ansicht.value === 'team' && !ordnerId.value && !suche.value)
const ordnerName = computed(() => meta.value?.ordner?.name || '')
</script>

<template>
  <section class="cloud" :class="{ 'ext-zieht': extZieht, mobil: false }">
    <h1 class="versteckt">{{ t('Meine Dateien', 'My files') }}</h1>

    <!-- Kopf: Brotkrumen und Werkzeuge -->
    <div class="band">
      <nav class="krumen" :aria-label="t('Ordnerpfad', 'Folder path')">
        <button v-if="kannOben" type="button" class="knopf nur-icon hoch" :title="t('Eine Ebene höher (Alt+↑)', 'Up one level (Alt+↑)')" :aria-label="t('Eine Ebene höher', 'Up one level')" @click="nachOben">
          <Ico n="up" />
        </button>
        <template v-for="(k, i) in krumen" :key="i">
          <Ico v-if="i > 0" n="chevron" class="trenn" />
          <button
            v-if="k.versteckt"
            type="button"
            class="krume"
            :aria-label="t('Weitere Ordner', 'More folders')"
            aria-haspopup="menu"
            @click="krumenMenue(k, $event)"
          >
            {{ k.text }}
          </button>
          <button
            v-else-if="k.zu && !k.aktuell"
            type="button"
            class="krume"
            :class="{ ziel: c.ziel.value === k.ziel }"
            :data-ziel="k.ziel"
            @click="k.zu()"
            @dragover="k.ziel && ueber(k.ziel, $event)"
            @dragleave="k.ziel && weg(k.ziel)"
            @drop="k.ziel && ablegenIntern(k.ziel, $event)"
          >
            {{ k.text }}
          </button>
          <span
            v-else
            class="krume jetzt"
            :class="{ ziel: c.ziel.value === k.ziel }"
            :data-ziel="k.ziel"
            aria-current="page"
            @dragover="k.ziel && ueber(k.ziel, $event)"
            @dragleave="k.ziel && weg(k.ziel)"
            @drop="k.ziel && ablegenIntern(k.ziel, $event)"
            >{{ k.text }}</span
          >
        </template>
        <button v-if="suche" type="button" class="knopf klein" @click="suchfeldLeeren">
          <Ico n="x" /> {{ t('Suche beenden', 'Clear search') }}
        </button>
      </nav>
      <div class="werkzeuge">
        <button v-if="meta && (c.kannHineinladen.value || (istTeamWurzel && meta.kannTeamOrdner))" type="button" class="knopf rot" aria-haspopup="menu" @click="neuMenue">
          <Ico n="plus" /> {{ t('Neu', 'New') }}
        </button>
        <button type="button" class="knopf" aria-haspopup="menu" :title="t('Sortierung', 'Sort order')" @click="sortMenue">
          <Ico n="list" /><span class="nur-gross">{{ { name: t('Name', 'Name'), groesse: t('Größe', 'Size'), datum: t('Geändert', 'Modified') }[wirksam.sort] }}</span>
          <Ico :n="wirksam.richtung === 'auf' ? 'up' : 'down'" />
        </button>
        <div class="seg" role="group" :aria-label="t('Darstellung', 'View')">
          <button type="button" :class="{ an: darstellung === 'liste' }" :aria-pressed="darstellung === 'liste'" :aria-label="t('Liste', 'List')" :title="t('Liste', 'List')" @click="darstellung = 'liste'">
            <Ico n="list" />
          </button>
          <button type="button" :class="{ an: darstellung === 'raster' }" :aria-pressed="darstellung === 'raster'" :aria-label="t('Raster', 'Grid')" :title="t('Raster', 'Grid')" @click="darstellung = 'raster'">
            <Ico n="grid" />
          </button>
        </div>
      </div>
    </div>

    <div class="zone">
    <div class="ansichten">
      <div class="seg" role="tablist" :aria-label="t('Bereiche', 'Areas')">
        <button
          v-for="a in ANSICHTEN"
          :key="a.k"
          type="button"
          role="tab"
          :class="{ an: ansicht === a.k && !suche }"
          :aria-selected="ansicht === a.k && !suche"
          @click="c.gehZuAnsicht(a.k)"
        >
          <Ico :n="a.ic" /> {{ t(a.de, a.en) }}
        </button>
      </div>
      <NuxtLink to="/drop" class="drop-link sehrleise"><Ico n="grid" /> {{ t('Uploads & Links (Drop)', 'Uploads & links (Drop)') }}</NuxtLink>
    </div>

    <Transition name="leiste">
      <div v-if="ausgewaehlt.length" class="auswahlleiste" role="toolbar" :aria-label="t('Aktionen für die Auswahl', 'Actions for the selection')">
        <button type="button" class="knopf nur-icon" :aria-label="t('Auswahl aufheben', 'Clear selection')" :title="t('Auswahl aufheben (Esc)', 'Clear selection (Esc)')" @click="c.auswahlLeeren()">
          <Ico n="x" />
        </button>
        <b class="anz">{{ t(`${ausgewaehlt.length} ausgewählt`, `${ausgewaehlt.length} selected`) }}</b>
        <span class="trennlinie"></span>
        <div class="aktionen">
        <button v-if="einzel" type="button" class="knopf klein" @click="c.oeffnen(einzel)">
          <Ico :n="einzel.typ === 'ordner' ? 'folder' : 'eye'" /><span>{{ t('Öffnen', 'Open') }}</span>
        </button>
        <button type="button" class="knopf klein" @click="c.herunterladen(ausgewaehlt)">
          <Ico n="download" /><span>{{ t('Download', 'Download') }}</span>
        </button>
        <button v-if="einzel?.typ === 'datei'" type="button" class="knopf klein" @click="teilen = einzel">
          <Ico n="link" /><span>{{ t('Teilen', 'Share') }}</span>
        </button>
        <button type="button" class="knopf klein" :disabled="!nurAenderbar(ausgewaehlt)" @click="baum = { modus: 'verschieben', items: [...ausgewaehlt] }">
          <Ico n="move" /><span>{{ t('Verschieben', 'Move') }}</span>
        </button>
        <button type="button" class="knopf klein" @click="baum = { modus: 'kopieren', items: [...ausgewaehlt] }">
          <Ico n="copy" /><span>{{ t('Kopieren', 'Copy') }}</span>
        </button>
        <button v-if="einzel" type="button" class="knopf klein" :disabled="einzel.darf_aendern === false" @click="starteUmbenennen(einzel)">
          <Ico n="edit" /><span>{{ t('Umbenennen', 'Rename') }}</span>
        </button>
        <button type="button" class="knopf klein" :disabled="!nurAenderbar(ausgewaehlt)" @click="c.favorit(ausgewaehlt, !ausgewaehlt.every((e) => e.favorite))">
          <Ico n="star" /><span>{{ ausgewaehlt.every((e) => e.favorite) ? t('Nicht mehr merken', 'Unfavourite') : t('Favorit', 'Favourite') }}</span>
        </button>
        <button type="button" class="knopf klein gefahr" :disabled="!nurAenderbar(ausgewaehlt)" @click="loeschenFrage(ausgewaehlt)">
          <Ico n="trash" /><span>{{ t('Löschen', 'Delete') }}</span>
        </button>
        </div>
      </div>
    </Transition>
    </div>

    <div v-if="c.ablage.value" class="ablage-hinweis">
      <Ico :n="c.ablage.value.modus === 'kopieren' ? 'copy' : 'move'" />
      <span>
        {{ c.ablage.value.modus === 'kopieren' ? t(`${c.ablage.value.anzahl} Element(e) zum Kopieren vorgemerkt`, `${c.ablage.value.anzahl} item(s) ready to copy`) : t(`${c.ablage.value.anzahl} Element(e) zum Verschieben vorgemerkt`, `${c.ablage.value.anzahl} item(s) ready to move`) }}
      </span>
      <button v-if="c.kannHineinladen.value" type="button" class="knopf klein rot" @click="c.einfuegen()">{{ t('Hier einfügen', 'Paste here') }}</button>
      <button type="button" class="knopf klein" @click="c.ablage.value = null">{{ t('Verwerfen', 'Discard') }}</button>
    </div>
    <p v-if="alleGeladenAusgewaehlt" class="alle-hinweis">
      {{ t(`Alle ${eintraege.length} geladenen Elemente sind ausgewählt.`, `All ${eintraege.length} loaded items are selected.`) }}
      <button type="button" class="link" :disabled="c.alleLaden.value" @click="c.alleWaehlenServer()">
        {{ t(`Alle ${zahl(meta?.gesamt || 0)} auswählen`, `Select all ${zahl(meta?.gesamt || 0)}`) }}
      </button>
    </p>

    <!-- Inhalt -->
    <div v-if="laedt && !eintraege.length" class="skelett" aria-busy="true" :aria-label="t('Lädt …', 'Loading …')">
      <div v-for="i in 7" :key="i" class="sk-zeile"><span class="sk sk-ic"></span><span class="sk sk-t" :style="{ width: 30 + ((i * 37) % 40) + '%' }"></span></div>
    </div>
    <div v-else-if="ladeFehler" class="leer-hinweis block">
      <span class="leer-ic"><Ico n="alert" /></span>
      <h3>{{ t('Das lässt sich nicht öffnen', 'This cannot be opened') }}</h3>
      <p>{{ ladeFehler }}</p>
      <div class="reihe" style="justify-content: center">
        <button type="button" class="knopf" @click="c.laden()"><Ico n="redo" /> {{ t('Erneut versuchen', 'Try again') }}</button>
        <button type="button" class="knopf rot" @click="c.zu({})"><Ico n="cloud" /> {{ t('Zu „Meine Dateien“', 'To “My files”') }}</button>
      </div>
    </div>
    <div v-else-if="!eintraege.length" class="leer-hinweis block">
      <span class="leer-ic"><Ico :n="leerArt === 'suche' ? 'search' : leerArt === 'favoriten' ? 'star' : leerArt === 'team' ? 'users' : leerArt === 'zuletzt' ? 'clock' : 'folder'" /></span>
      <template v-if="leerArt === 'suche'">
        <h3>{{ t('Nichts gefunden', 'Nothing found') }}</h3>
        <p>{{ t(`Zu „${suche}“ gibt es keine Dateien oder Ordner. Gesucht wird in Namen und Tags.`, `No files or folders match “${suche}”. Names and tags are searched.`) }}</p>
      </template>
      <template v-else-if="leerArt === 'zuletzt'">
        <h3>{{ t('Noch nichts Neues', 'Nothing recent yet') }}</h3>
        <p>{{ t('Hier erscheinen deine zuletzt geänderten und hochgeladenen Dateien.', 'Your recently changed and uploaded files show up here.') }}</p>
      </template>
      <template v-else-if="leerArt === 'favoriten'">
        <h3>{{ t('Noch keine Favoriten', 'No favourites yet') }}</h3>
        <p>{{ t('Markiere Dateien und Ordner mit dem Stern, dann findest du sie hier schneller.', 'Mark files and folders with the star to find them here faster.') }}</p>
      </template>
      <template v-else-if="leerArt === 'team'">
        <h3>{{ t('Keine Team-Ordner', 'No team folders') }}</h3>
        <p>{{ t('Team-Ordner teilst du mit deinem Team. Sie erscheinen hier, sobald dich jemand zu einem Team hinzufügt oder die Leitung einen Ordner anlegt (Teams sind Teil von Pro).', 'You share team folders with your team. They appear here as soon as you are added to a team or the lead creates one (teams are part of Pro).') }}</p>
        <div class="reihe" style="justify-content: center">
          <button v-if="meta?.kannTeamOrdner" type="button" class="knopf rot" @click="teamOrdnerOffen = true"><Ico n="plus" /> {{ t('Team-Ordner anlegen', 'Create team folder') }}</button>
          <NuxtLink v-if="theme.user?.role !== 'user'" to="/teams" class="knopf"><Ico n="users" /> {{ t('Teams verwalten', 'Manage teams') }}</NuxtLink>
        </div>
      </template>
      <template v-else-if="leerArt === 'ordner'">
        <h3>{{ t('Dieser Ordner ist leer', 'This folder is empty') }}</h3>
        <p>{{ c.kannHineinladen.value ? t('Ziehe Dateien oder ganze Ordner hierher, oder lege etwas Neues an.', 'Drag files or whole folders here, or create something new.') : t('Hier ist nichts abgelegt.', 'Nothing is stored here.') }}</p>
        <div v-if="c.kannHineinladen.value" class="reihe" style="justify-content: center">
          <button type="button" class="knopf rot" @click="dateiFeld?.click()"><Ico n="upload" /> {{ t('Hochladen', 'Upload') }}</button>
          <button type="button" class="knopf" @click="neuerOrdnerOffen = true"><Ico n="folder" /> {{ t('Neuer Ordner', 'New folder') }}</button>
        </div>
      </template>
      <template v-else>
        <h3>{{ t('Deine Cloud ist noch leer', 'Your cloud is still empty') }}</h3>
        <p>{{ t('Ziehe Dateien oder ganze Ordner hierher oder lade sie hoch. Mit Ordnern behältst du den Überblick.', 'Drag files or whole folders here or upload them. Folders keep things tidy.') }}</p>
        <div class="reihe" style="justify-content: center">
          <button type="button" class="knopf rot" @click="dateiFeld?.click()"><Ico n="upload" /> {{ t('Dateien hochladen', 'Upload files') }}</button>
          <button type="button" class="knopf" @click="ordnerFeld?.click()"><Ico n="folder" /> {{ t('Ordner hochladen', 'Upload folder') }}</button>
          <button type="button" class="knopf" @click="neuerOrdnerOffen = true"><Ico n="plus" /> {{ t('Neuer Ordner', 'New folder') }}</button>
        </div>
      </template>
    </div>
    <VdCloudListe
      v-else
      ref="liste"
      :eintraege="eintraege"
      :darstellung="darstellung"
      :auswahl="auswahl"
      :fokus="fokus"
      :umbenennen="umbenennenKey"
      :ziel-key="c.ziel.value"
      :zieht="c.zieht.value"
      :sort="wirksam.sort"
      :richtung="wirksam.richtung"
      :mit-pfad="!!suche"
      @klick="c.klick"
      @oeffnen="c.oeffnen"
      @kontext="eintragMenue"
      @sortieren="c.sortieren($event)"
      @umbenannt="umbenannt"
      @haken="haken"
      @favorit="sternUm"
      @alle="auswahl.size >= eintraege.length ? c.auswahlLeeren() : c.alleWaehlen()"
      @leer="leerKlick"
      @ziehstart="c.ziehStart"
      @ziehende="c.ziehEnde"
      @ueber="ueber"
      @weg="weg"
      @ablegen="ablegenIntern"
    />

    <div v-if="eintraege.length" class="fuss">
      <span class="sehrleise">{{ summeText }}<template v-if="meta?.mehr"> · {{ t(`${zahl(eintraege.length)} von ${zahl(meta.gesamt)} geladen`, `${zahl(eintraege.length)} of ${zahl(meta.gesamt)} loaded`) }}</template></span>
      <button v-if="meta?.mehr" type="button" class="knopf klein" :disabled="c.ladeMehr.value" @click="c.mehrLaden()">
        <Ico v-if="c.ladeMehr.value" n="loader" spin /> {{ t('Mehr laden', 'Load more') }}
      </button>
      <span v-if="meta?.gekappt" class="sehrleise">{{ t('Es werden nur die ersten Einträge berücksichtigt.', 'Only the first entries are considered.') }}</span>
    </div>
    <div ref="sentinel" class="sentinel" aria-hidden="true"></div>

    <div v-if="extZieht" class="ext-hinweis" aria-hidden="true">
      <Ico n="upload" />
      {{
        c.ziel.value && c.ziel.value !== 'wurzel'
          ? t('In den Ordner ablegen', 'Drop into the folder')
          : ordnerName
            ? t(`In „${ordnerName}“ ablegen`, `Drop into “${ordnerName}”`)
            : t('Zum Hochladen ablegen', 'Drop to upload')
      }}
    </div>

    <!-- Hochladen-Fenster -->
    <div v-if="uploads.length || up.stand.value.laeuft" class="up-panel" role="status" aria-live="polite">
      <button type="button" class="up-kopf" :aria-expanded="panelOffen" @click="panelOffen = !panelOffen">
        <Ico :n="auchLaeuft.length ? 'upload' : 'check'" />
        <b>
          {{
            up.stand.value.laeuft
              ? t(`Hochladen: ${up.stand.value.fertig + up.stand.value.fehler} von ${up.stand.value.gesamt}`, `Uploading: ${up.stand.value.fertig + up.stand.value.fehler} of ${up.stand.value.gesamt}`)
              : t('Uploads', 'Uploads')
          }}
        </b>
        <Ico n="chevron" class="pf" :style="{ transform: panelOffen ? 'none' : 'rotate(180deg)' }" />
      </button>
      <ul v-if="panelOffen" class="up-liste">
        <li v-for="u in panelListe" :key="u.id" :data-upload="u.id">
          <span class="up-name" :title="u.name">{{ u.name }}</span>
          <span v-if="u.status === 'fehler'" class="up-fehler" :title="u.fehler">{{ u.fehler }}</span>
          <span v-else class="up-balken"><i :style="{ width: prozent(u) + '%' }" :class="{ fertig: u.status === 'fertig' }"></i></span>
          <button type="button" class="up-x" :aria-label="t('Entfernen', 'Remove')" @click="uploadEntfernen(u.id)"><Ico n="x" /></button>
        </li>
      </ul>
    </div>

    <!-- Rückgängig -->
    <Transition name="snack">
      <div v-if="c.rueckgaengig.value" class="snack" role="status">
        <Ico n="trash" />
        <span>{{ c.rueckgaengig.value.text }}</span>
        <button v-if="c.rueckgaengig.value.papierkorb.length" type="button" class="knopf klein" @click="c.wiederherstellen()">
          <Ico n="undo" /> {{ t('Rückgängig', 'Undo') }}
        </button>
        <NuxtLink to="/papierkorb" class="snack-link">{{ t('Papierkorb', 'Trash') }}</NuxtLink>
        <button type="button" class="up-x" :aria-label="t('Schließen', 'Close')" @click="c.rueckgaengig.value = null"><Ico n="x" /></button>
      </div>
    </Transition>

    <input ref="dateiFeld" type="file" multiple class="versteckt" tabindex="-1" aria-hidden="true" @change="dateienGewaehlt" />
    <input ref="ordnerFeld" type="file" multiple webkitdirectory class="versteckt" tabindex="-1" aria-hidden="true" @change="dateienGewaehlt" />

    <VdCloudMenue
      v-if="menue"
      :x="menue.x"
      :y="menue.y"
      :punkte="menue.punkte"
      @waehle="menueWahl"
      @zu="menue = null"
    />

    <VdCloudBaum
      v-if="baum"
      :modus="baum.modus"
      :items="baum.items"
      :start="ordnerId"
      @zu="baum = null"
      @ok="baumOk"
    />

    <VdModal v-if="neuerOrdnerOffen || teamOrdnerOffen" :titel="teamOrdnerOffen ? t('Team-Ordner anlegen', 'Create team folder') : t('Neuer Ordner', 'New folder')" @zu="neuerOrdnerOffen = teamOrdnerOffen = false">
      <form @submit.prevent="ordnerSpeichern">
        <label v-if="teamOrdnerOffen" class="feld">
          <span>{{ t('Team', 'Team') }}</span>
          <select v-model="teamAuswahl" class="eingabe">
            <option v-for="x in (meta?.teams || []).filter((y: any) => y.rolle === 'leitung')" :key="x.id" :value="x.id">{{ x.name }}</option>
          </select>
        </label>
        <label class="feld">
          <span>{{ t('Name', 'Name') }}</span>
          <input id="cz-neuer-name" v-model="neuerName" class="eingabe" maxlength="80" autocomplete="off" spellcheck="false" />
          <small v-if="!teamOrdnerOffen && ordnerName">{{ t(`Wird in „${ordnerName}“ angelegt.`, `Will be created in “${ordnerName}”.`) }}</small>
        </label>
        <div class="modal-fuss">
          <button type="button" class="knopf" @click="neuerOrdnerOffen = teamOrdnerOffen = false">{{ t('Abbrechen', 'Cancel') }}</button>
          <button type="submit" class="knopf rot" :disabled="!neuerName.trim() || c.arbeit.value"><Ico v-if="c.arbeit.value" n="loader" spin />{{ t('Anlegen', 'Create') }}</button>
        </div>
      </form>
    </VdModal>

    <DateiDetail
      v-if="detail && detail.typ === 'datei'"
      :f="detail"
      :ordner="ordnerDaten"
      :tags="tagDaten"
      @zu="detail = null"
      @geaendert="detailGeaendert"
      @geloescht="detailGeloescht"
    />
    <VdCloudTeilen v-if="teilen" :f="teilen" @zu="teilen = null" @optionen="teilenZuOptionen" />
  </section>
</template>

<style>
/* Auf dieser Seite zeigt der Dateimanager selbst, wohin abgelegt wird; die allgemeine Anzeige des Layouts entfällt */
body:has(.cloud) .zieh-flaeche {
  display: none;
}
</style>

<style scoped>
.cloud {
  position: relative;
  padding-bottom: 80px;
  animation: rein 0.45s var(--kurve) backwards;
}
.band {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px 16px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.krumen {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1 1 280px;
  flex-wrap: wrap;
  font-family: var(--f-display);
}
.krume {
  border: 0;
  background: transparent;
  padding: 6px 10px;
  border-radius: 9px;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--text2);
  cursor: pointer;
  max-width: 40vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
button.krume:hover {
  background: var(--flaeche2);
  color: var(--text);
}
.krume.jetzt {
  color: var(--text);
  font-weight: 700;
  cursor: default;
}
.krume.ziel {
  background: rgba(var(--a-rgb), 0.2);
  box-shadow: 0 0 0 2px var(--a);
  color: var(--text);
}
.trenn {
  width: 13px;
  height: 13px;
  color: var(--text3);
  transform: rotate(-90deg);
}
.hoch {
  margin-right: 4px;
}
.werkzeuge {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.zone {
  position: relative;
  margin-bottom: 14px;
}
.ansichten {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  min-height: 40px;
}
.ansichten .seg {
  max-width: 100%;
}
.drop-link {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
}
.drop-link:hover {
  color: var(--a);
}
.drop-link svg {
  width: 14px;
  height: 14px;
}

.auswahlleiste {
  /* liegt über der Bereichsleiste, damit sich beim Auswählen nichts verschiebt (sonst trifft der zweite Klick eines Doppelklicks eine andere Zeile) */
  position: absolute;
  inset: -3px 0 auto 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 46px;
  background: var(--flaeche);
  border: 1px solid rgba(var(--a-rgb), 0.45);
  border-radius: 14px;
  padding: 6px 10px;
  box-shadow: var(--schatten);
}
.auswahlleiste .anz {
  font-size: 13px;
  padding: 0 4px;
  white-space: nowrap;
}
.aktionen {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
  overflow-x: auto;
  scrollbar-width: thin;
}
.aktionen .knopf {
  flex: 0 0 auto;
}
.trennlinie {
  width: 1px;
  height: 22px;
  background: var(--linie);
  margin: 0 4px;
}
.leiste-enter-active,
.leiste-leave-active {
  transition:
    opacity 0.18s,
    transform 0.18s;
}
.leiste-enter-from,
.leiste-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
.ablage-hinweis,
.alle-hinweis {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 13px;
  background: var(--info-bg);
  color: var(--info);
  border-radius: 12px;
  padding: 8px 12px;
  margin: 0 0 12px;
}
.ablage-hinweis svg {
  width: 15px;
  height: 15px;
}
.ablage-hinweis span {
  flex: 1;
  min-width: 160px;
}
.link {
  border: 0;
  background: transparent;
  color: var(--a);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
  padding: 0;
}
.nur-gross {
  display: inline;
}

.skelett {
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 14px;
  overflow: hidden;
}
.sk-zeile {
  display: flex;
  align-items: center;
  gap: 14px;
  height: 52px;
  padding: 0 16px;
  border-bottom: 1px solid var(--linie);
}
.sk {
  display: block;
  border-radius: 8px;
  background: linear-gradient(90deg, var(--flaeche2), var(--linie), var(--flaeche2));
  background-size: 200% 100%;
  animation: schimmer 1.4s linear infinite;
}
.sk-ic {
  width: 34px;
  height: 34px;
}
.sk-t {
  height: 12px;
}
@keyframes schimmer {
  to {
    background-position: -200% 0;
  }
}
.leer-ic {
  display: inline-grid;
  place-items: center;
  width: 60px;
  height: 60px;
  border-radius: 18px;
  background: var(--flaeche2);
  color: var(--text3);
  margin-bottom: 12px;
}
.leer-ic svg {
  width: 26px;
  height: 26px;
}
.leer-hinweis p {
  max-width: 460px;
  margin: 0 auto 16px;
  font-size: 14px;
}

.fuss {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 4px 0;
  font-size: 12.5px;
}
.sentinel {
  height: 1px;
}

.ext-hinweis {
  position: fixed;
  left: 50%;
  top: 84px;
  transform: translateX(-50%);
  z-index: 240;
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--a);
  color: #fff;
  padding: 10px 18px;
  border-radius: 99px;
  font-size: 14px;
  font-weight: 600;
  box-shadow: 0 14px 40px -12px rgba(var(--a-rgb), 0.8);
  pointer-events: none;
}
.ext-hinweis svg {
  width: 17px;
  height: 17px;
}
.ext-zieht :deep(.cl) {
  box-shadow: 0 0 0 2px var(--a);
  background: rgba(var(--a-rgb), 0.05);
}

.up-panel {
  position: fixed;
  left: 272px;
  bottom: 22px;
  width: min(360px, calc(100vw - 32px));
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 14px;
  box-shadow: 0 16px 40px -14px rgba(0, 0, 0, 0.45);
  z-index: 150;
  overflow: hidden;
}
.up-kopf {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: 0;
  background: transparent;
  padding: 11px 14px;
  cursor: pointer;
  font-size: 13px;
}
.up-kopf > svg:first-child {
  width: 16px;
  height: 16px;
  color: var(--a);
}
.up-kopf b {
  flex: 1;
  text-align: left;
  font-weight: 600;
}
.up-kopf .pf {
  width: 14px;
  height: 14px;
  color: var(--text3);
}
.up-liste {
  list-style: none;
  margin: 0;
  padding: 0 14px 10px;
  max-height: 220px;
  overflow-y: auto;
}
.up-liste li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 90px 24px;
  gap: 8px;
  align-items: center;
  padding: 5px 0;
  font-size: 12.5px;
}
.up-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.up-balken {
  height: 6px;
  border-radius: 99px;
  background: var(--flaeche2);
  overflow: hidden;
}
.up-balken i {
  display: block;
  height: 100%;
  background: var(--a);
  border-radius: 99px;
  transition: width 0.3s;
}
.up-balken i.fertig {
  background: var(--ok);
}
.up-fehler {
  color: var(--rot);
  font-size: 11.5px;
  grid-column: 2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.up-x {
  width: 24px;
  height: 24px;
  border: 0;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  display: grid;
  place-items: center;
  color: var(--text3);
}
.up-x:hover {
  background: var(--flaeche2);
  color: var(--text);
}
.up-x svg {
  width: 13px;
  height: 13px;
}

.snack {
  position: fixed;
  left: 50%;
  bottom: 26px;
  transform: translateX(-50%);
  z-index: 160;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--text);
  color: var(--bg);
  border-radius: 14px;
  padding: 10px 12px 10px 16px;
  font-size: 13px;
  box-shadow: 0 16px 40px -14px rgba(0, 0, 0, 0.55);
  max-width: calc(100vw - 24px);
}
.snack .knopf {
  background: transparent;
  border-color: color-mix(in srgb, var(--bg) 35%, transparent);
  color: var(--bg);
}
.snack svg {
  width: 15px;
  height: 15px;
}
.snack-link {
  color: var(--bg);
  text-decoration: underline;
  text-underline-offset: 2px;
  font-size: 12.5px;
  white-space: nowrap;
}
.snack .up-x {
  color: var(--bg);
}
.snack .up-x:hover {
  background: color-mix(in srgb, var(--bg) 20%, transparent);
  color: var(--bg);
}
.snack-enter-active,
.snack-leave-active {
  transition:
    opacity 0.25s,
    transform 0.25s var(--kurve);
}
.snack-enter-from,
.snack-leave-to {
  opacity: 0;
  transform: translate(-50%, 14px);
}

@media (max-width: 860px) {
  .up-panel {
    left: 16px;
  }
}
@media (max-width: 720px) {
  .krume {
    font-size: 16px;
    padding: 6px 8px;
    max-width: 52vw;
  }
  .nur-gross {
    display: none;
  }
  .drop-link {
    display: none;
  }
  .auswahlleiste {
    position: fixed;
    inset: auto 8px 8px 8px;
    min-height: 0;
    left: 8px;
    right: 8px;
    bottom: 8px;
    z-index: 140;
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-areas: 'x anz' 'akt akt';
    align-items: center;
    gap: 2px 8px;
    padding: 6px 8px 8px;
    border-radius: 16px;
    box-shadow: 0 -8px 40px -10px rgba(0, 0, 0, 0.5);
  }
  .auswahlleiste .knopf.nur-icon {
    grid-area: x;
    width: 30px;
    height: 30px;
  }
  .auswahlleiste .anz {
    grid-area: anz;
    font-size: 13px;
  }
  .auswahlleiste .trennlinie {
    display: none;
  }
  .auswahlleiste .aktionen {
    grid-area: akt;
    display: flex;
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .auswahlleiste .aktionen .knopf.klein {
    flex: 0 0 auto;
    flex-direction: column;
    gap: 3px;
    min-width: 62px;
    padding: 7px 4px;
    border-color: transparent;
    background: var(--flaeche2);
    font-size: 11px;
  }
  .leiste-enter-from,
  .leiste-leave-to {
    transform: translateY(10px);
  }
  .cloud {
    padding-bottom: 120px;
  }
  .up-panel {
    bottom: 84px;
  }
  .snack {
    bottom: 96px;
    flex-wrap: wrap;
  }
  .ext-hinweis {
    top: 70px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .cloud,
  .sk,
  .leiste-enter-active,
  .leiste-leave-active,
  .snack-enter-active,
  .snack-leave-active {
    animation: none;
    transition: none;
  }
}
</style>
