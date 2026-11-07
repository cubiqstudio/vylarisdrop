// Live-Aktualisierung: eine gemeinsame Event-Verbindung (/api/live) für alle Seiten. Der Server meldet nur, WAS sich
// geändert hat (Thema); die Seite holt ihre Daten danach selbst neu (ihre bestehende refresh-Funktion).
export type LiveThema = 'dateien' | 'ordner' | 'papierkorb' | 'anfragen'

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
    if (schonVerbunden) vormerken(null)
    schonVerbunden = true
  }
  q.onmessage = (e) => {
    zuletzt = Date.now()
    try {
      const d = JSON.parse(e.data)
      if (d && typeof d.t === 'string') vormerken(d.t)
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
    if (!sichtbarHaken) {
      sichtbarHaken = true
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          if (!quelle && abos.size) verbinden()
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
    verbinden()
  })
  onBeforeUnmount(() => {
    abos.delete(abo)
    if (!abos.size) trennen()
  })
}
