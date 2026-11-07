// Live-Aktualisierung für Seitendaten, die mit useFetch(…, { key }) geladen werden.
// Baut auf useLive auf und ergänzt, was für ruhige Zähler und Belegungsanzeigen nötig ist:
//  - EINE gemeinsame Aktualisierung je Schlüssel (mehrere Seiten/Komponenten mit demselben Schlüssel ergeben eine Anfrage),
//  - Mindestabstand (Drosselung mit Nachholen): bei Massenvorgängen entstehen nur wenige Anfragen,
//  - nie zwei Anfragen gleichzeitig (nachholen statt stapeln),
//  - Fehler still: die bisherigen Daten bleiben stehen (useFetch().refresh() würde sie bei einem Fehler leeren), kein Toast;
//    der Versuch wird mit wachsender Pause (2 s … 30 s) und beim Wieder-Online-Gehen wiederholt,
//  - unveränderte Antworten lösen kein Neuzeichnen aus; eine Antwort, die von einer neueren Eigenaktualisierung der Seite
//    überholt wurde, wird verworfen und neu geholt,
//  - verborgener Tab: erst beim Zurückkehren.
import type { LiveThema } from './useLive'

export interface LiveDatum {
  /** Schlüssel des useFetch (key) */
  schluessel: string
  /** Adresse; als Funktion, wenn sie von Auswahlen der Seite abhängt */
  url: string | (() => string)
}

interface Stand {
  laeuft: boolean
  nochmal: boolean
  zuletzt: number
  fehler: number // Fehlversuche in Folge
  timer: ReturnType<typeof setTimeout> | null
  neuVersuchen: (() => void) | null // gesetzt, solange ein Fehlversuch auf seine Wiederholung wartet
}
const staende = new Map<string, Stand>()
const zurueckgestellt = new Map<string, () => void>() // wegen verborgenem Tab
let haken = false

const stand = (k: string): Stand => {
  let s = staende.get(k)
  if (!s) staende.set(k, (s = { laeuft: false, nochmal: false, zuletzt: 0, fehler: 0, timer: null, neuVersuchen: null }))
  return s
}

export interface LiveDatenOpt {
  daten: LiveDatum[]
  /** Themen, bei denen neu geholt wird (leer: nur manuell/Intervall) */
  themen?: LiveThema[]
  /** Mindestabstand zwischen zwei Anfragen je Schlüssel in ms (Standard 1500); als Funktion, wenn er sich ändern kann */
  mind?: number | (() => number)
  /** Solange false (z. B. kein Zugriff), wird gar nichts geholt */
  aktiv?: () => boolean
  /** Solange true (z. B. Dialog offen), wird nicht aktualisiert, sondern danach nachgeholt */
  pausiert?: () => boolean
  /** Zusätzlich alle … ms neu holen (nur bei sichtbarem Tab), für Änderungen, die keine Meldung auslösen */
  intervall?: number
}

export function useLiveDaten(opt: LiveDatenOpt) {
  if (!import.meta.client) return { aktualisieren: () => {} }
  const mind = () => (typeof opt.mind === 'function' ? opt.mind() : (opt.mind ?? 1500))
  const nuxtApp = useNuxtApp()
  const eintraege = opt.daten.map((d) => ({ ...d, ref: useNuxtData(d.schluessel).data }))
  type Eintrag = (typeof eintraege)[number]

  async function laden(e: Eintrag) {
    const vorher = e.ref.value
    const url = typeof e.url === 'function' ? e.url() : e.url
    const neu = await ($fetch as any)(url, { headers: { accept: 'application/json' }, retry: 0 })
    // Hat die Seite die Daten inzwischen selbst neu geholt, ist unsere Antwort evtl. veraltet: verwerfen und noch einmal
    if (e.ref.value !== vorher) {
      stand(e.schluessel).nochmal = true
      return
    }
    // Ein früherer Ladefehler (useFetch) ist mit gültigen Daten erledigt
    const ad = (nuxtApp as any)._asyncData?.[e.schluessel]
    if (ad?.error?.value) {
      ad.error.value = undefined
      ad.status.value = 'success'
    }
    if (JSON.stringify(neu) !== JSON.stringify(vorher)) e.ref.value = neu
  }

  function pruefen(e: Eintrag) {
    const s = stand(e.schluessel)
    if (!s.nochmal || s.laeuft || s.timer) return
    if (opt.aktiv && !opt.aktiv()) {
      s.nochmal = false
      return
    }
    if (document.visibilityState === 'hidden') {
      zurueckgestellt.set(e.schluessel, () => pruefen(e))
      return
    }
    const spaeter = (ms: number) => {
      s.timer = setTimeout(() => {
        s.timer = null
        pruefen(e)
      }, ms)
    }
    if (opt.pausiert?.()) return spaeter(1000)
    const warte = s.zuletzt + mind() - Date.now()
    if (warte > 0) return spaeter(warte)
    s.nochmal = false
    s.laeuft = true
    s.zuletzt = Date.now()
    laden(e)
      .then(() => {
        s.fehler = 0
      })
      .catch(() => {
        // still, aber nicht vergessen: wiederholen, auch wenn kein weiteres Ereignis kommt (z. B. kurz offline)
        s.fehler++
        s.nochmal = true
        s.neuVersuchen = () => {
          if (s.timer) clearTimeout(s.timer)
          s.timer = null
          s.neuVersuchen = null
          pruefen(e)
        }
        s.timer = setTimeout(() => s.neuVersuchen?.(), Math.min(30_000, 2000 * 2 ** (s.fehler - 1)))
      })
      .finally(() => {
        s.laeuft = false
        pruefen(e)
      })
  }

  function aktualisieren() {
    for (const e of eintraege) {
      stand(e.schluessel).nochmal = true
      pruefen(e)
    }
  }

  if (!haken) {
    haken = true
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      const fns = [...zurueckgestellt.values()]
      zurueckgestellt.clear()
      for (const f of fns) f()
    })
    // Netz ist zurück: wartende Wiederholungen sofort versuchen
    window.addEventListener('online', () => {
      for (const s of staende.values()) s.neuVersuchen?.()
    })
  }

  if (opt.themen?.length) useLive(opt.themen, aktualisieren)
  let uhr: ReturnType<typeof setInterval> | null = null
  onMounted(() => {
    if (opt.intervall) uhr = setInterval(aktualisieren, opt.intervall)
  })
  onBeforeUnmount(() => {
    if (uhr) clearInterval(uhr)
    for (const e of eintraege) {
      const s = stand(e.schluessel)
      if (s.timer) clearTimeout(s.timer)
      s.timer = null
      s.nochmal = false
      s.neuVersuchen = null
      zurueckgestellt.delete(e.schluessel)
    }
  })
  return { aktualisieren }
}
