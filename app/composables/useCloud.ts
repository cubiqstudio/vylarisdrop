// Zustand und Aktionen des Cloud-Dateimanagers (Seite "/"). Die Seite selbst hält nur Oberfläche und Tastatur.

export type CloudAnsicht = 'alle' | 'zuletzt' | 'favoriten' | 'team'
export type CloudSortierung = 'name' | 'groesse' | 'datum'

export interface CloudEintrag {
  typ: 'datei' | 'ordner'
  id: string | number
  name: string
  favorite: boolean
  geaendert_at?: string
  created_at?: string
  eigen?: boolean
  darf_aendern?: boolean
  team_id?: number | null
  pfad?: string
  [k: string]: any
}

export interface MenuePunkt {
  k: string
  text: string
  ic?: string
  gefahr?: boolean
  trenner?: boolean
  aus?: boolean
  kurz?: string
}

/** "1 Datei" / "3 Dateien" — Einzahl und Mehrzahl je Sprache */
export const mehrzahl = (n: number, de: [string, string], en: [string, string]) =>
  `${zahl(n)} ${lang() === 'en' ? (n === 1 ? en[0] : en[1]) : n === 1 ? de[0] : de[1]}`

export const eintragKey = (e: Pick<CloudEintrag, 'typ' | 'id'>) => (e.typ === 'ordner' ? 'o' : 'd') + e.id
export const endungVon = (name: string) => /\.([A-Za-z0-9]{1,10})$/.exec(name)?.[1]?.toLowerCase() || ''
export const stammLaenge = (name: string, ordner: boolean) => {
  if (ordner) return name.length
  const m = /^(.+?)((?:\.tar)?\.[A-Za-z0-9]{1,10})$/.exec(name)
  return m ? m[1]!.length : name.length
}

export const ANSICHTEN: Array<{ k: CloudAnsicht; de: string; en: string; ic: string }> = [
  { k: 'alle', de: 'Alle Dateien', en: 'All files', ic: 'cloud' },
  { k: 'zuletzt', de: 'Zuletzt', en: 'Recent', ic: 'clock' },
  { k: 'favoriten', de: 'Favoriten', en: 'Favourites', ic: 'star' },
  { k: 'team', de: 'Team-Ordner', en: 'Team folders', ic: 'users' }
]

const merk = (k: string): string | null => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const merkSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {}
}

export function useCloud() {
  const route = useRoute()
  const { ok, fehler } = useToast()
  const { neu: uploadNeu } = useUploads()

  // ---------- Ort in der URL ----------
  const ordnerId = computed<number | null>(() => (Number(route.query.ordner) > 0 ? Number(route.query.ordner) : null))
  const ansicht = computed<CloudAnsicht>(() =>
    ['zuletzt', 'favoriten', 'team'].includes(String(route.query.ansicht)) ? (String(route.query.ansicht) as CloudAnsicht) : 'alle'
  )
  const suche = computed(() => String(route.query.suche || '').trim())

  function zu(q: { ordner?: number | null; ansicht?: CloudAnsicht; suche?: string }) {
    const query: Record<string, string> = {}
    if (q.ordner) query.ordner = String(q.ordner)
    if (q.ansicht && q.ansicht !== 'alle') query.ansicht = q.ansicht
    if (q.suche) query.suche = q.suche
    return navigateTo({ path: '/', query })
  }
  const gehZuOrdner = (id: number | null) => zu({ ordner: id })
  const gehZuAnsicht = (a: CloudAnsicht) => zu({ ansicht: a })

  // ---------- Darstellung (im Browser gemerkt) ----------
  const darstellung = ref<'liste' | 'raster'>('liste')
  const sort = ref<CloudSortierung>('name')
  const richtung = ref<'auf' | 'ab'>('auf')
  const sortGewaehlt = ref(false)
  onMounted(() => {
    if (merk('vd_cloud_darstellung') === 'raster') darstellung.value = 'raster'
    const s = merk('vd_cloud_sort')
    if (s && /^(name|groesse|datum):(auf|ab)$/.test(s)) {
      sort.value = s.split(':')[0] as CloudSortierung
      richtung.value = s.split(':')[1] as 'auf' | 'ab'
      sortGewaehlt.value = true
    }
  })
  watch(darstellung, (v) => merkSet('vd_cloud_darstellung', v))
  const wirksam = computed(() =>
    ansicht.value === 'zuletzt' && !sortGewaehlt.value
      ? { sort: 'datum' as CloudSortierung, richtung: 'ab' as const }
      : { sort: sort.value, richtung: richtung.value }
  )
  function sortieren(k: CloudSortierung, r?: 'auf' | 'ab') {
    const jetzt = wirksam.value
    const neuR = r || (jetzt.sort === k ? (jetzt.richtung === 'auf' ? 'ab' : 'auf') : k === 'name' ? 'auf' : 'ab')
    sort.value = k
    richtung.value = neuR
    sortGewaehlt.value = true
    merkSet('vd_cloud_sort', `${k}:${neuR}`)
  }

  // ---------- Daten ----------
  const eintraege = ref<CloudEintrag[]>([])
  const meta = ref<any>(null)
  const laedt = ref(true)
  const ladeMehr = ref(false)
  const ladeFehler = ref('')
  const seite = ref(1)
  const pro = ref(200)
  let lauf = 0

  const abfrage = (s: number, p: number) =>
    api('/api/cloud/liste', {
      query: {
        ansicht: ansicht.value,
        ordner: ordnerId.value || undefined,
        suche: suche.value || undefined,
        sort: wirksam.value.sort,
        richtung: wirksam.value.richtung,
        seite: s,
        pro: p
      }
    })

  async function laden() {
    const n = ++lauf
    laedt.value = true
    ladeFehler.value = ''
    try {
      const r = await abfrage(1, 200)
      if (n !== lauf) return
      eintraege.value = r.eintraege
      meta.value = r
      seite.value = 1
      pro.value = 200
      auswahlBereinigen()
    } catch (e: any) {
      if (n !== lauf) return
      ladeFehler.value = e.message
      eintraege.value = []
      meta.value = null
    } finally {
      if (n === lauf) laedt.value = false
    }
  }

  /** Lädt still neu und behält so viele Einträge, wie schon geladen waren. */
  async function neuLaden() {
    const n = ++lauf
    const bisher = eintraege.value.length
    const p = bisher <= 200 ? 200 : 500
    const seiten = Math.max(1, Math.ceil(bisher / p))
    try {
      let alle: CloudEintrag[] = []
      let letzte: any = null
      for (let s = 1; s <= seiten; s++) {
        letzte = await abfrage(s, p)
        if (n !== lauf) return
        alle = alle.concat(letzte.eintraege)
        if (!letzte.mehr) break
      }
      eintraege.value = alle
      meta.value = letzte
      pro.value = p
      seite.value = Math.max(1, Math.min(seiten, Math.ceil(alle.length / p)))
      ladeFehler.value = ''
      auswahlBereinigen()
    } catch (e: any) {
      if (n === lauf) fehler(e.message)
    }
  }

  async function mehrLaden() {
    if (!meta.value?.mehr || ladeMehr.value || laedt.value) return
    const n = lauf
    ladeMehr.value = true
    try {
      const r = await abfrage(seite.value + 1, pro.value)
      if (n !== lauf) return
      const da = new Set(eintraege.value.map(eintragKey))
      eintraege.value = [...eintraege.value, ...r.eintraege.filter((e: CloudEintrag) => !da.has(eintragKey(e)))]
      seite.value++
      meta.value = r
    } catch (e: any) {
      fehler(e.message)
    } finally {
      ladeMehr.value = false
    }
  }
  const alleLaden = ref(false)

  let neuTimer: any = null
  const neuLadenSpaeter = (ms = 600) => {
    clearTimeout(neuTimer)
    neuTimer = setTimeout(() => void neuLaden(), ms)
  }
  watch(uploadNeu, () => neuLadenSpaeter())

  // Medien-Verarbeitung (Vorschaubilder) nachladen, solange etwas läuft
  let verarbeitungTimer: any = null
  let verarbeitungVersuche = 0
  watch(eintraege, (l) => {
    clearTimeout(verarbeitungTimer)
    if (l.some((f) => f.typ === 'datei' && (f.verarbeitung === 'offen' || f.verarbeitung === 'laeuft')) && verarbeitungVersuche < 20)
      verarbeitungTimer = setTimeout(() => {
        verarbeitungVersuche++
        void neuLaden()
      }, 3000)
    else verarbeitungVersuche = 0
  })

  watch([ordnerId, ansicht, suche], () => {
    auswahl.value = new Set()
    extra.value = []
    anker.value = null
    fokus.value = null
    // Der alte Inhalt gehört nicht mehr zum neuen Ort (Brotkrumen!) — Gerüst zeigen, bis der neue da ist
    eintraege.value = []
    meta.value = null
    void laden()
  })
  watch([() => wirksam.value.sort, () => wirksam.value.richtung], () => void laden())
  onBeforeUnmount(() => {
    clearTimeout(neuTimer)
    clearTimeout(verarbeitungTimer)
  })

  // ---------- Auswahl ----------
  const auswahl = ref<Set<string>>(new Set())
  const anker = ref<string | null>(null)
  const fokus = ref<string | null>(null)
  // Ausgewählt, aber nicht geladen (nach "Alle auswählen" über mehrere Seiten): nur Name und Schlüssel
  const extra = ref<CloudEintrag[]>([])
  const ausgewaehlt = computed(() => {
    const l = eintraege.value.filter((e) => auswahl.value.has(eintragKey(e)))
    if (!extra.value.length) return l
    return [...l, ...extra.value.filter((e) => auswahl.value.has(eintragKey(e)))]
  })
  const indexVon = (k: string) => eintraege.value.findIndex((e) => eintragKey(e) === k)
  function auswahlBereinigen() {
    const da = new Set([...eintraege.value, ...extra.value].map(eintragKey))
    const rest = [...auswahl.value].filter((k) => da.has(k))
    if (rest.length !== auswahl.value.size) auswahl.value = new Set(rest)
  }
  function auswaehlen(keys: string[], zusaetzlich = false) {
    auswahl.value = new Set(zusaetzlich ? [...auswahl.value, ...keys] : keys)
  }
  function umschalten(k: string) {
    const s = new Set(auswahl.value)
    s.has(k) ? s.delete(k) : s.add(k)
    auswahl.value = s
    anker.value = k
    fokus.value = k
  }
  function bereich(bis: string, zusaetzlich: boolean) {
    const von = anker.value ? indexVon(anker.value) : -1
    const nach = indexVon(bis)
    if (von < 0 || nach < 0) return auswaehlen([bis])
    const [a, b] = von < nach ? [von, nach] : [nach, von]
    auswaehlen(eintraege.value.slice(a, b + 1).map(eintragKey), zusaetzlich)
    fokus.value = bis
  }
  const grob = () => import.meta.client && matchMedia('(pointer: coarse)').matches
  function klick(e: CloudEintrag, ev: MouseEvent | KeyboardEvent) {
    const k = eintragKey(e)
    if (ev.shiftKey) return bereich(k, ev.ctrlKey || ev.metaKey)
    if (ev.ctrlKey || ev.metaKey) return umschalten(k)
    if (grob()) {
      if (auswahl.value.size) return umschalten(k)
      return oeffnen(e)
    }
    auswaehlen([k])
    anker.value = k
    fokus.value = k
  }
  function alleWaehlen() {
    extra.value = []
    auswaehlen(eintraege.value.map(eintragKey))
  }
  /** Wählt alles im aktuellen Ergebnis, auch Seiten, die noch nicht geladen sind (eine leichte Abfrage statt Nachladen) */
  async function alleWaehlenServer() {
    alleLaden.value = true
    try {
      const r = await api('/api/cloud/liste', {
        query: { ansicht: ansicht.value, ordner: ordnerId.value || undefined, suche: suche.value || undefined, ids: '1' }
      })
      const geladen = new Set(eintraege.value.map(eintragKey))
      const alle: CloudEintrag[] = r.ids.map((x: any) => ({ typ: x.typ, id: x.id, name: x.name, favorite: false }))
      extra.value = alle.filter((e) => !geladen.has(eintragKey(e)))
      auswahl.value = new Set(alle.map(eintragKey))
    } catch (e: any) {
      fehler(e.message)
    } finally {
      alleLaden.value = false
    }
  }
  function auswahlLeeren() {
    auswahl.value = new Set()
    extra.value = []
  }

  // ---------- Öffnen / Detail ----------
  const detail = ref<CloudEintrag | null>(null)
  const teilen = ref<CloudEintrag | null>(null)
  function oeffnen(e: CloudEintrag) {
    if (e.typ === 'ordner') return gehZuOrdner(Number(e.id))
    detail.value = e
  }

  // ---------- Hilfen für Aktionen ----------
  const teile = (l: CloudEintrag[]) => ({
    dateien: l.filter((e) => e.typ === 'datei').map((e) => String(e.id)),
    ordner: l.filter((e) => e.typ === 'ordner').map((e) => Number(e.id))
  })
  const anzahlText = (l: CloudEintrag[]) =>
    l.length === 1 ? `„${l[0]!.name}“` : t(`${l.length} Elemente`, `${l.length} items`)
  const aktuellerOrdner = computed(() => meta.value?.ordner || null)
  const kannHineinladen = computed(
    () => ansicht.value === 'alle' && !suche.value && (ordnerId.value ? !!aktuellerOrdner.value?.hineinladen : true)
  )

  // ---------- Aktionen ----------
  const arbeit = ref(false)
  async function aktion<T>(fn: () => Promise<T>): Promise<T | null> {
    arbeit.value = true
    try {
      return await fn()
    } catch (e: any) {
      fehler(e.message)
      return null
    } finally {
      arbeit.value = false
    }
  }

  async function ordnerAnlegen(name: string): Promise<boolean> {
    const r = await aktion(() =>
      api('/api/cloud/ordner', {
        method: 'POST',
        body: { name, ordner: ordnerId.value }
      })
    )
    if (!r) return false
    ok(t(`Ordner „${r.ordner.name}“ angelegt`, `Folder “${r.ordner.name}” created`))
    await neuLaden()
    auswaehlen([eintragKey(r.ordner)])
    fokus.value = eintragKey(r.ordner)
    return true
  }
  async function teamOrdnerAnlegen(name: string, team: number): Promise<boolean> {
    const r = await aktion(() => api('/api/cloud/ordner', { method: 'POST', body: { name, ordner: null, team } }))
    if (!r) return false
    ok(t(`Team-Ordner „${r.ordner.name}“ angelegt`, `Team folder “${r.ordner.name}” created`))
    await neuLaden()
    return true
  }

  async function umbenennen(e: CloudEintrag, name: string) {
    const neuName = name.trim()
    if (!neuName || neuName === e.name) return
    const r = await aktion(() => api('/api/cloud/umbenennen', { method: 'POST', body: { typ: e.typ, id: e.id, name: neuName } }))
    if (!r) return
    if (r.angepasst) ok(t(`Name war schon vergeben — gespeichert als „${r.name}“`, `Name was taken — saved as “${r.name}”`))
    e.name = r.name
    await neuLaden()
  }

  async function verschieben(l: CloudEintrag[], ziel: number | null): Promise<boolean> {
    if (!l.length) return false
    const r = await aktion(() => api('/api/cloud/verschieben', { method: 'POST', body: { ...teile(l), ziel } }))
    if (!r) return false
    if (r.verschoben)
      ok(
        r.umbenannt?.length
          ? t(`${mehrzahl(r.verschoben, ['Element', 'Elemente'], ['item', 'items'])} verschoben — ${r.umbenannt.length} umbenannt, weil der Name schon vergeben war`, `${mehrzahl(r.verschoben, ['item', 'items'], ['item', 'items'])} moved — ${r.umbenannt.length} renamed because the name was taken`)
          : t(`${mehrzahl(r.verschoben, ['Element', 'Elemente'], ['item', 'items'])} verschoben`, `${mehrzahl(r.verschoben, ['item', 'items'], ['item', 'items'])} moved`)
      )
    else ok(t('Schon dort', 'Already there'))
    auswahl.value = new Set()
    await neuLaden()
    return true
  }

  async function kopierenNach(l: CloudEintrag[], ziel: number | null): Promise<boolean> {
    if (!l.length) return false
    const r = await aktion(() => api('/api/cloud/kopieren', { method: 'POST', body: { ...teile(l), ziel } }))
    if (!r) return false
    if (r.fehler?.length) fehler(t(`${r.fehler.length} Datei(en) konnten nicht kopiert werden: ${r.fehler[0]}`, `${r.fehler.length} file(s) could not be copied: ${r.fehler[0]}`))
    ok(t(`${mehrzahl(r.kopiert, ['Datei', 'Dateien'], ['file', 'files'])} kopiert`, `${mehrzahl(r.kopiert, ['file', 'files'], ['file', 'files'])} copied`))
    await neuLaden()
    uploadNeu.value++
    return true
  }

  async function favorit(l: CloudEintrag[], wert: boolean) {
    const r = await aktion(() => api('/api/cloud/favorit', { method: 'POST', body: { ...teile(l), wert } }))
    if (!r) return
    if (r.uebersprungen) fehler(t(`${r.uebersprungen} Element(e) darfst du nicht ändern`, `You may not change ${r.uebersprungen} item(s)`))
    await neuLaden()
  }

  // Löschen → Papierkorb, mit "Rückgängig" für Dateien (nicht, wenn Ordner mitgelöscht wurden)
  const rueckgaengig = ref<{ text: string; papierkorb: Array<{ id: string; name: string }>; ordner: number } | null>(null)
  let rueckTimer: any = null
  async function loeschen(l: CloudEintrag[]): Promise<boolean> {
    if (!l.length) return false
    const r = await aktion(() => api('/api/cloud/loeschen', { method: 'POST', body: teile(l) }))
    if (!r) return false
    auswahl.value = new Set()
    const dat = mehrzahl(r.dateien, ['Datei', 'Dateien'], ['file', 'files'])
    const text = r.ordner
      ? t(`${dat} im Papierkorb, ${mehrzahl(r.ordner, ['Ordner', 'Ordner'], ['folder', 'folders'])} gelöscht`, `${dat} in the trash, ${mehrzahl(r.ordner, ['folder', 'folders'], ['folder', 'folders'])} deleted`)
      : r.dateien
        ? t(`${dat} im Papierkorb`, `${dat} in the trash`)
        : t('Gelöscht', 'Deleted')
    // Gelöschte Ordner kommen nicht zurück (nur ihre Dateien liegen im Papierkorb): dann kein "Rückgängig", das nur Dateien flach in die Wurzel legen würde
    rueckgaengig.value = { text, papierkorb: r.ordner ? [] : r.papierkorb, ordner: r.ordner }
    clearTimeout(rueckTimer)
    rueckTimer = setTimeout(() => (rueckgaengig.value = null), 9000)
    await neuLaden()
    uploadNeu.value++
    return true
  }
  async function wiederherstellen() {
    const r = rueckgaengig.value
    if (!r) return
    rueckgaengig.value = null
    clearTimeout(rueckTimer)
    let n = 0
    for (const p of r.papierkorb) {
      try {
        await api('/api/papierkorb', { method: 'POST', body: { aktion: 'wiederherstellen', id: p.id } })
        n++
      } catch (e: any) {
        fehler(`${p.name}: ${e.message}`)
      }
    }
    if (n) ok(t(`${mehrzahl(n, ['Datei', 'Dateien'], ['file', 'files'])} wiederhergestellt`, `${mehrzahl(n, ['file', 'files'], ['file', 'files'])} restored`))
    await neuLaden()
    uploadNeu.value++
  }
  onBeforeUnmount(() => clearTimeout(rueckTimer))

  // Herunterladen: eine Datei direkt, alles andere als ZIP
  function herunterladen(l: CloudEintrag[]) {
    if (!l.length) return
    if (l.length === 1 && l[0]!.typ === 'datei') return laden_(`/api/cloud/herunterladen?id=${l[0]!.id}`)
    const { dateien, ordner } = teile(l)
    if (dateien.length + ordner.length <= 300) {
      const q = new URLSearchParams()
      if (dateien.length) q.set('dateien', dateien.join(','))
      if (ordner.length) q.set('ordner', ordner.join(','))
      return laden_(`/api/cloud/zip?${q}`)
    }
    // Große Auswahl: Formular (POST), damit die Adresse nicht zu lang wird
    const f = document.createElement('form')
    f.method = 'POST'
    f.action = '/api/cloud/zip'
    f.style.display = 'none'
    for (const [k, v] of [['dateien', dateien.join(',')], ['ordner', ordner.join(',')]] as const) {
      const i = document.createElement('input')
      i.type = 'hidden'
      i.name = k
      i.value = v
      f.append(i)
    }
    document.body.append(f)
    f.submit()
    f.remove()
  }
  function laden_(url: string) {
    const a = document.createElement('a')
    a.href = url
    a.download = ''
    a.style.display = 'none'
    document.body.append(a)
    a.click()
    a.remove()
  }

  async function linkKopieren(e: CloudEintrag) {
    if (e.typ !== 'datei') return
    const link = e.verschluesselt ? '' : e.links?.seite
    if (!link) {
      teilen.value = e
      return
    }
    ok((await kopierenText(link)) ? t('Link kopiert', 'Link copied') : t('Kopieren nicht möglich — Link im Dialog', 'Copy failed — link in the dialog'))
  }

  // ---------- Zwischenablage (Strg+X / Strg+C / Strg+V) ----------
  const ablage = ref<{ modus: 'kopieren' | 'verschieben'; dateien: string[]; ordner: number[]; anzahl: number } | null>(null)
  function inAblage(modus: 'kopieren' | 'verschieben', l: CloudEintrag[]) {
    if (!l.length) return
    ablage.value = { modus, ...teile(l), anzahl: l.length }
    ok(
      modus === 'kopieren'
        ? t(`${l.length} Element(e) zum Kopieren vorgemerkt — mit Strg+V einfügen`, `${l.length} item(s) ready to copy — paste with Ctrl+V`)
        : t(`${l.length} Element(e) zum Verschieben vorgemerkt — mit Strg+V einfügen`, `${l.length} item(s) ready to move — paste with Ctrl+V`)
    )
  }
  async function einfuegen() {
    const a = ablage.value
    if (!a) return
    if (!kannHineinladen.value) return fehler(t('Hier kannst du nichts einfügen.', 'You cannot paste here.'))
    const fake = [
      ...a.dateien.map((id) => ({ typ: 'datei', id }) as CloudEintrag),
      ...a.ordner.map((id) => ({ typ: 'ordner', id }) as CloudEintrag)
    ]
    const klappt = a.modus === 'verschieben' ? await verschieben(fake, ordnerId.value) : await kopierenNach(fake, ordnerId.value)
    if (klappt && a.modus === 'verschieben') ablage.value = null
  }

  // ---------- Ziehen und Ablegen innerhalb der Seite ----------
  const zieht = ref<string[]>([])
  const ziel = ref<string | null>(null)
  const MIME = 'application/x-vd-cloud'
  function ziehStart(e: CloudEintrag, ev: DragEvent) {
    const k = eintragKey(e)
    if (!auswahl.value.has(k)) {
      auswaehlen([k])
      anker.value = k
    }
    zieht.value = [...auswahl.value]
    ev.dataTransfer?.setData(MIME, JSON.stringify(zieht.value))
    ev.dataTransfer?.setData('text/plain', ausgewaehlt.value.map((x) => x.name).join('\n'))
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copyMove'
    // Eigenes Ziehbild: Zahl der Elemente
    if (zieht.value.length > 1 && ev.dataTransfer) {
      const b = document.createElement('div')
      b.textContent = String(zieht.value.length)
      b.style.cssText =
        'position:fixed;top:-100px;left:-100px;padding:6px 12px;border-radius:99px;background:var(--a);color:#fff;font:600 13px Poppins,system-ui,sans-serif'
      document.body.append(b)
      ev.dataTransfer.setDragImage(b, 10, 10)
      setTimeout(() => b.remove(), 0)
    }
  }
  function ziehEnde() {
    zieht.value = []
    ziel.value = null
  }
  const istIntern = (ev: DragEvent) => Array.from(ev.dataTransfer?.types || []).includes(MIME)
  /** Darf auf dieses Ziel abgelegt werden? zielKey: 'o<ID>' oder 'wurzel' */
  function zielErlaubt(zielKey: string) {
    if (!zieht.value.length) return false
    if (zielKey === 'wurzel') return true
    return !zieht.value.includes(zielKey)
  }
  async function ablegen(zielKey: string, ev: DragEvent) {
    const roh = ev.dataTransfer?.getData(MIME)
    ziel.value = null
    if (!roh) return
    let keys: string[] = []
    try {
      keys = JSON.parse(roh)
    } catch {
      return
    }
    const zielId = zielKey === 'wurzel' ? null : Number(zielKey.slice(1))
    if (zielKey !== 'wurzel' && keys.includes(zielKey)) return
    const items = eintraege.value.filter((e) => keys.includes(eintragKey(e)))
    zieht.value = []
    if (!items.length) return
    // Beim Ziehen mit Alt/Option wird kopiert
    if (ev.altKey) await kopierenNach(items, zielId)
    else await verschieben(items, zielId)
  }

  onMounted(() => void laden())

  return {
    // Ort
    ordnerId, ansicht, suche, zu, gehZuOrdner, gehZuAnsicht,
    // Darstellung
    darstellung, wirksam, sortieren,
    // Daten
    eintraege, meta, laedt, ladeMehr, ladeFehler, laden, neuLaden, mehrLaden, alleLaden, aktuellerOrdner, kannHineinladen,
    // Auswahl
    auswahl, anker, fokus, ausgewaehlt, klick, umschalten, auswaehlen, alleWaehlen, alleWaehlenServer, auswahlLeeren, bereich, indexVon,
    // Öffnen
    detail, teilen, oeffnen,
    // Aktionen
    arbeit, ordnerAnlegen, teamOrdnerAnlegen, umbenennen, verschieben, kopierenNach, favorit, loeschen, wiederherstellen, rueckgaengig,
    herunterladen, linkKopieren, anzahlText,
    ablage, inAblage, einfuegen,
    // Ziehen
    zieht, ziel, ziehStart, ziehEnde, istIntern, zielErlaubt, ablegen
  }
}

async function kopierenText(s: string): Promise<boolean> {
  return kopieren(s)
}
