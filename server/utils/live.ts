import type { H3Event } from 'h3'
import { q } from './db'
import { hoeren } from './knoten'

// Live-Aktualisierung: Server-Sent Events je angemeldetem Nutzer. Die Datenbank meldet Aenderungen per NOTIFY
// (siehe Migration [cloud:live]); hier werden sie gebündelt und an die Verbindungen der betroffenen Nutzer
// (Besitzer plus Mitglieder gemeinsamer Teams) weitergegeben. Der Browser holt danach die Daten neu.
export type LiveThema = 'dateien' | 'ordner' | 'papierkorb' | 'anfragen'
const THEMEN = new Set<string>(['dateien', 'ordner', 'papierkorb', 'anfragen'])

interface Verbindung {
  id: number
  nutzer: number
  schreiben: (text: string) => void
  schliessen: () => void
}
const verbindungen = new Map<number, Set<Verbindung>>()
let zaehler = 0
const MAX_JE_NUTZER = 12
const MAX_GESAMT = 1000

// ===== Team-Genossen (kurz zwischengespeichert) =====
const genossenCache = new Map<number, { bis: number; ids: number[] }>()
async function genossen(nutzer: number): Promise<number[]> {
  const c = genossenCache.get(nutzer)
  if (c && c.bis > Date.now()) return c.ids
  let ids: number[] = []
  try {
    const r = await q<{ user_id: number }>(
      `SELECT DISTINCT m2.user_id FROM team_mitglieder m1 JOIN team_mitglieder m2 ON m2.team_id = m1.team_id
        WHERE m1.user_id = $1 AND m2.user_id <> $1`,
      [nutzer]
    )
    ids = r.map((x) => Number(x.user_id))
  } catch {
    ids = []
  }
  genossenCache.set(nutzer, { bis: Date.now() + 60_000, ids })
  if (genossenCache.size > 5000) genossenCache.clear()
  return ids
}

// ===== Bündeln: je Nutzer und Thema höchstens eine Nachricht pro 150 ms =====
const offen = new Map<string, { nutzer: number; thema: string }>()
let timer: ReturnType<typeof setTimeout> | null = null
function senden(nutzer: number, thema: string) {
  const v = verbindungen.get(nutzer)
  if (!v?.size) return
  const text = `data: ${JSON.stringify({ t: thema })}\n\n`
  for (const c of v) c.schreiben(text)
}
function leeren() {
  timer = null
  const stapel = [...offen.values()]
  offen.clear()
  for (const x of stapel) senden(x.nutzer, x.thema)
}
async function eingang(nutzer: number, thema: string) {
  if (!THEMEN.has(thema) || !Number.isInteger(nutzer) || nutzer < 0) return
  if (!verbindungen.size) return
  const ziele = new Set<number>()
  if (verbindungen.has(nutzer)) ziele.add(nutzer)
  // Teams: Mitglieder gemeinsamer Teams sehen Änderungen in Team-Ordnern; nur fragen, wenn jemand anderes verbunden ist
  if (verbindungen.size > (verbindungen.has(nutzer) ? 1 : 0))
    for (const g of await genossen(nutzer)) if (verbindungen.has(g)) ziele.add(g)
  for (const z of ziele) offen.set(`${z}|${thema}`, { nutzer: z, thema })
  if (offen.size && !timer) {
    timer = setTimeout(leeren, 150)
    timer.unref?.()
  }
}

let angemeldet = false
export function liveStarten() {
  if (angemeldet) return
  angemeldet = true
  // Nutzlast der Datenbank: "<Thema>|<Nutzer-ID>" (nach dem Knoten-Präfix "db|")
  hoeren('vd_live', (n) => {
    const [thema, uid] = String(n).split('|')
    void eingang(Number(uid), thema || '')
  })
  setInterval(() => {
    const jetzt = Date.now()
    for (const [k, v] of genossenCache) if (v.bis < jetzt) genossenCache.delete(k)
  }, 300_000).unref?.()
}

/** Öffnet die Event-Verbindung eines Nutzers. Gibt ein Promise zurück, das endet, wenn die Verbindung schließt. */
export function verbinden(event: H3Event, nutzer: number): Promise<void> {
  liveStarten()
  const res = event.node.res
  const req = event.node.req
  const eigene = verbindungen.get(nutzer)
  let gesamt = 0
  for (const s of verbindungen.values()) gesamt += s.size
  if ((eigene?.size || 0) >= MAX_JE_NUTZER || gesamt >= MAX_GESAMT) {
    // Älteste Verbindung des Nutzers schließen, sonst ablehnen
    const aelteste = eigene && [...eigene][0]
    if (aelteste && (eigene?.size || 0) >= MAX_JE_NUTZER) aelteste.schliessen()
    else throw fehler(429, 'Zu viele Live-Verbindungen.', 'Too many live connections.')
  }
  res.statusCode = 200
  res.setHeader('content-type', 'text/event-stream; charset=utf-8')
  res.setHeader('cache-control', 'no-cache, no-transform')
  res.setHeader('connection', 'keep-alive')
  res.setHeader('x-accel-buffering', 'no')
  res.flushHeaders?.()
  res.write('retry: 3000\n\n: ok\n\n')
  return new Promise<void>((fertig) => {
    let zu = false
    const c: Verbindung = {
      id: ++zaehler,
      nutzer,
      schreiben: (text) => {
        if (zu) return
        try {
          res.write(text)
        } catch {
          schliessen()
        }
      },
      schliessen: () => schliessen()
    }
    // Echte Nachricht statt Kommentar: nur so merkt der Browser (useLive-Wächter), dass die Verbindung noch lebt
    const herz = setInterval(() => c.schreiben('data: {"t":"herz"}\n\n'), 20_000)
    function schliessen() {
      if (zu) return
      zu = true
      clearInterval(herz)
      const s = verbindungen.get(nutzer)
      s?.delete(c)
      if (s && !s.size) verbindungen.delete(nutzer)
      try {
        res.end()
      } catch {}
      fertig()
    }
    const set = verbindungen.get(nutzer) || new Set<Verbindung>()
    set.add(c)
    verbindungen.set(nutzer, set)
    req.on('close', schliessen)
    res.on('close', schliessen)
    res.on('error', schliessen)
  })
}
