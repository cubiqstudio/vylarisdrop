/**
 * Verpackt einen Abruf für die Live-Aktualisierung (zusammen mit useLive):
 * - nie zwei Abrufe gleichzeitig; kommt währenddessen ein neuer Auslöser, läuft danach genau ein weiterer (nachholen statt stapeln)
 * - zwischen zwei Starts liegen mindestens `abstandMs` (bei Massenvorgängen entstehen so nur wenige Anfragen)
 * - Fehler werden still verworfen (kein Toast-Regen) und mit wachsendem Abstand (4 s, 10 s, 30 s, 60 s) erneut versucht, damit
 *   die Seite nach einem Netzausfall von selbst aufholt, auch wenn kein neuer Auslöser kommt; kehrt das Netz zurück, sofort
 * - nach dem Verlassen der Seite startet nichts mehr
 * Muss im setup() der Seite aufgerufen werden.
 */
const WIEDER = [4000, 10_000, 30_000, 60_000]

export function liveDrosseln(fn: () => Promise<unknown>, abstandMs = 1500): () => Promise<void> {
  let laeuft = false
  let nochmal = false
  let letzter = 0
  let weg = false
  let fehlversuche = 0
  let wiederTimer: ReturnType<typeof setTimeout> | null = null

  const lauf = async (): Promise<void> => {
    if (weg) return
    if (laeuft) {
      nochmal = true
      return
    }
    laeuft = true
    if (wiederTimer) clearTimeout(wiederTimer)
    wiederTimer = null
    try {
      do {
        const warte = letzter + abstandMs - Date.now()
        if (letzter && warte > 0) await new Promise((r) => setTimeout(r, warte))
        if (weg) return
        nochmal = false
        letzter = Date.now()
        try {
          await fn()
          fehlversuche = 0
        } catch {
          fehlversuche++
          if (fehlversuche <= WIEDER.length * 2 && !wiederTimer)
            wiederTimer = setTimeout(
              () => {
                wiederTimer = null
                void lauf()
              },
              WIEDER[Math.min(fehlversuche, WIEDER.length) - 1]
            )
        }
      } while (nochmal && !weg)
    } finally {
      laeuft = false
    }
  }

  if (getCurrentInstance()) {
    const online = () => {
      if (fehlversuche) void lauf()
    }
    onMounted(() => window.addEventListener('online', online))
    onBeforeUnmount(() => {
      weg = true
      if (wiederTimer) clearTimeout(wiederTimer)
      window.removeEventListener('online', online)
    })
  }
  return lauf
}
