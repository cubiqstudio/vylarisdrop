// Live-Aktualisierung: eine gemeinsame Event-Verbindung (/api/live) für alle Seiten. Der Server meldet nur, WAS sich
// geändert hat (Thema); die Seite holt ihre Daten danach selbst neu (ihre bestehende refresh-Funktion).
// Browser erlauben bei HTTP/1.1 nur 6 Verbindungen je Host, geteilt über alle Tabs: Pro Browser hält deshalb nur EIN Tab
// (der Führende, per Web Lock gewählt) die Verbindung und gibt die Meldungen per BroadcastChannel an die anderen weiter.
// Ohne diese Browser-Funktionen hält jeder Tab seine eigene Verbindung, schließt sie aber, solange er verborgen ist.
export type LiveThema = 'dateien' | 'ordner' | 'papierkorb' | 'anfragen' | 'teams'

interface Abo {
  themen: Set<string>
  fn: () => void | Promise<void>
  faellig: boolean
}
const abos = new Set<Abo>()
let quelle: EventSource | null = null
let wartezeit = 1000
let neuTimer: ReturnType<typeof setTimeout> | null = null
let bündelTimer: ReturnType<typeof setTimeout> | null = null
let schonVerbunden = false
let sichtbarHaken = false
let onlineHaken = false
let zuletzt = Date.now() // letzte Nachricht (auch Herzschlag) vom Server
let waechter: ReturnType<typeof setInterval> | null = null
const STILL_MS = 65_000 // der Server sendet alle 20 s einen Herzschlag
const LOCK_NAME = 'vd-live-fuehrung'
let fuehrend = false // dieser Tab hält die Verbindung (immer true ohne Web Locks)
let lockFrei: (() => void) | null = null // gibt die Führung ab
let lockWarten: AbortController | null = null // wartet auf die Führung
let kanal: BroadcastChannel | null = null
let abmeldeTimer: ReturnType<typeof setTimeout> | null = null
const mitFuehrung = () =>
  typeof navigator !== 'undefined' && 'locks' in navigator && typeof BroadcastChannel !== 'undefined'

function ausfuehren() {
  bündelTimer = null
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return // läuft beim Zurückkehren
  for (const a of abos) {
    if (!a.faellig) continue
    a.faellig = false
    try {
      void Promise.resolve(a.fn()).catch(() => {})
    } catch {}
  }
}
function vormerken(thema: string | null) {
  for (const a of abos) if (thema === null || a.themen.has(thema)) a.faellig = true
  if (!bündelTimer) bündelTimer = setTimeout(ausfuehren, 300)
}

/** Verbindung verwerfen und neu aufbauen (nach Standby, WLAN-Wechsel, stiller Unterbrechung). */
function neuVerbinden() {
  quelle?.close()
  quelle = null
  verbinden()
}
function verbinden() {
  if (!import.meta.client || quelle || !abos.size) return
  if (mitFuehrung() && !fuehrend) return
  const q = new EventSource('/api/live')
  quelle = q
  zuletzt = Date.now()
  // Eine still gestorbene Verbindung (kein TCP-Abbruch) meldet der Browser nicht: ohne Herzschlag neu aufbauen
  waechter ??= setInterval(() => {
    if (quelle && Date.now() - zuletzt > STILL_MS) neuVerbinden()
  }, 15_000)
  q.onopen = () => {
    zuletzt = Date.now()
    wartezeit = 1000
    // Nach einer Unterbrechung kann etwas verpasst worden sein: alles neu holen
    if (schonVerbunden) {
      vormerken(null)
      kanal?.postMessage({ t: null })
    }
    schonVerbunden = true
  }
  q.onmessage = (e) => {
    zuletzt = Date.now()
    try {
      const d = JSON.parse(e.data)
      if (!d || typeof d.t !== 'string' || d.t === 'herz') return
      // "alle": der Server hat Meldungen verpasst (Datenbank-Verbindung neu aufgebaut)
      const thema = d.t === 'alle' ? null : d.t
      vormerken(thema)
      kanal?.postMessage({ t: thema })
    } catch {}
  }
  q.onerror = () => {
    // Der Browser verbindet von selbst neu. Wurde die Verbindung endgültig geschlossen (z. B. abgemeldet), selbst mit Pause erneut versuchen.
    if (q.readyState === EventSource.CLOSED) {
      q.close()
      quelle = null
      if (neuTimer) clearTimeout(neuTimer)
      neuTimer = setTimeout(verbinden, wartezeit)
      wartezeit = Math.min(wartezeit * 2, 30_000)
    }
  }
}
function trennen() {
  if (neuTimer) clearTimeout(neuTimer)
  neuTimer = null
  if (waechter) clearInterval(waechter)
  waechter = null
  quelle?.close()
  quelle = null
  schonVerbunden = false
  // Führung abgeben bzw. nicht mehr darauf warten
  lockWarten?.abort()
  lockWarten = null
  fuehrend = false
  lockFrei?.()
  lockFrei = null
  if (kanal) kanal.onmessage = null
  kanal?.close()
  kanal = null
}

/** Dieser Tab übernimmt die Verbindung für alle Tabs. `nachfolger`: ein anderer Tab hat sie vorher gehalten, Meldungen können fehlen. */
function fuehren(nachfolger: boolean): Promise<void> {
  lockWarten = null
  if (!abos.size) return Promise.resolve()
  fuehrend = true
  schonVerbunden = nachfolger // erstes onopen holt dann alles neu und meldet es den anderen Tabs
  verbinden()
  return new Promise<void>((frei) => {
    lockFrei = frei
  })
}
/** Verbindung starten: je Browser hält nur ein Tab sie (Web Lock), die anderen hören auf den BroadcastChannel. */
function starten() {
  if (!mitFuehrung() || fuehrend) return verbinden()
  if (lockWarten) return
  if (!kanal) {
    kanal = new BroadcastChannel('vd-live')
    kanal.onmessage = (e) => {
      const t = e.data?.t
      if (t === null || typeof t === 'string') vormerken(t)
    }
  }
  navigator.locks
    .request(LOCK_NAME, { ifAvailable: true }, (lock) => {
      if (lock) return fuehren(false)
      // Ein anderer Tab führt: warten, bis er geht (Tab geschlossen)
      const warten = new AbortController()
      lockWarten = warten
      void navigator.locks
        .request(LOCK_NAME, { signal: warten.signal }, () => fuehren(true))
        .catch(() => {})
    })
    .catch(() => {
      // Web Locks verweigert (z. B. eingeschränkter Kontext): eigene Verbindung
      fuehrend = true
      verbinden()
    })
}

/**
 * Ruft `fn` (meist das Neuladen der Seitendaten) auf, sobald sich eines der Themen ändert — gebündelt, nur bei
 * sichtbarem Tab und nach einer Unterbrechung der Verbindung. Wird beim Verlassen der Seite automatisch abgemeldet.
 */
export function useLive(themen: LiveThema[], fn: () => void | Promise<void>) {
  if (!import.meta.client) return
  const abo: Abo = { themen: new Set(themen), fn, faellig: false }
  onMounted(() => {
    abos.add(abo)
    if (abmeldeTimer) clearTimeout(abmeldeTimer)
    abmeldeTimer = null
    if (!sichtbarHaken) {
      sichtbarHaken = true
      document.addEventListener('visibilitychange', () => {
        // Ohne gemeinsame Verbindung belegt jeder verborgene Tab einen der wenigen Sockets: schließen, beim Sichtbarwerden neu öffnen
        if (document.visibilityState === 'hidden' && !mitFuehrung()) {
          quelle?.close()
          quelle = null
        }
        if (document.visibilityState === 'visible') {
          if (!quelle && abos.size) starten()
          else if (quelle && Date.now() - zuletzt > STILL_MS) neuVerbinden() // lange im Hintergrund: Verbindung prüfen
          if ([...abos].some((a) => a.faellig) && !bündelTimer) bündelTimer = setTimeout(ausfuehren, 100)
        }
      })
    }
    if (!onlineHaken) {
      onlineHaken = true
      // Netz kommt zurück: Verbindung neu aufbauen und alles nachholen
      window.addEventListener('online', () => {
        if (!abos.size) return
        neuVerbinden()
        vormerken(null)
      })
    }
    starten()
  })
  onBeforeUnmount(() => {
    abos.delete(abo)
    // Kurz warten: beim Seitenwechsel ist die nächste Seite gleich wieder da, Verbindung und Führung bleiben dann bestehen
    if (!abos.size && !abmeldeTimer)
      abmeldeTimer = setTimeout(() => {
        abmeldeTimer = null
        if (!abos.size) trennen()
      }, 1500)
  })
}
