import type { H3Event } from 'h3'
import { q } from './db'
import { hoeren } from './knoten'

// Live-Aktualisierung: Server-Sent Events je angemeldetem Nutzer. Die Datenbank meldet Aenderungen per NOTIFY
// (siehe Migration [cloud:live]); hier werden sie gebündelt und an die Verbindungen der betroffenen Nutzer
// (Besitzer plus Mitglieder gemeinsamer Teams) weitergegeben. Der Browser holt danach die Daten neu.
export type LiveThema = 'dateien' | 'ordner' | 'papierkorb' | 'anfragen' | 'teams'
const THEMEN = new Set<string>(['dateien', 'ordner', 'papierkorb', 'anfragen', 'teams'])

interface Verbindung {
  id: number
  nutzer: number
  sitzung: string // Hash des Sitzungs-Cookies, mit dem die Verbindung geöffnet wurde
  schreiben: (text: string) => void
  schliessen: () => void
}
const verbindungen = new Map<number, Set<Verbindung>>()
let zaehler = 0
let herunterfahren = false
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
/** Meldet allen Verbindungen "alles neu laden" (nach verpassten Meldungen, z. B. Abriss der Datenbank-Hörverbindung). */
function allenMelden() {
  for (const v of verbindungen.values()) for (const c of [...v]) c.schreiben('data: {"t":"alle"}\n\n')
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

/** Thema 'teams': Mitgliedschaft/Kontingent eines Teams hat sich geändert. Ziel: alle aktuellen Mitglieder plus das betroffene Konto. */
async function teamEingang(team: number, nutzer: number) {
  if (!Number.isInteger(team) || team <= 0 || !Number.isInteger(nutzer) || nutzer < 0 || !verbindungen.size) return
  genossenCache.clear() // gemeinsame Teams haben sich geändert
  const ziele = new Set<number>()
  if (nutzer && verbindungen.has(nutzer)) ziele.add(nutzer)
  try {
    const r = await q<{ user_id: number }>('SELECT user_id FROM team_mitglieder WHERE team_id = $1', [team])
    for (const m of r) if (verbindungen.has(Number(m.user_id))) ziele.add(Number(m.user_id))
  } catch {}
  for (const z of ziele) offen.set(`${z}|teams`, { nutzer: z, thema: 'teams' })
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
    // "*": die Hörverbindung zur Datenbank war weg, Meldungen aus der Zwischenzeit fehlen
    if (n === '*') return allenMelden()
    const [thema, uid, uid2] = String(n).split('|')
    // "teams|<Team-ID>|<Nutzer-ID>": Team-Meldung (nicht an Nutzer-ID gebunden)
    if (thema === 'teams') return void teamEingang(Number(uid), Number(uid2 || 0))
    void eingang(Number(uid), thema || '')
  })
  setInterval(() => {
    const jetzt = Date.now()
    for (const [k, v] of genossenCache) if (v.bis < jetzt) genossenCache.delete(k)
  }, 300_000).unref?.()
  setInterval(() => void sitzungenPruefen(), 10_000).unref?.()
}

// ===== Sitzungen prüfen: abgemeldete, abgelaufene und widerrufene Sitzungen (und gelöschte Konten) verlieren den Stream =====
let pruefung = false
async function sitzungenPruefen() {
  if (pruefung || !verbindungen.size) return
  pruefung = true
  try {
    const geprueft = new Set<string>()
    for (const v of verbindungen.values()) for (const c of v) geprueft.add(c.sitzung)
    const r = await q<{ token_hash: string }>(
      `SELECT s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ANY($1) AND s.expires_at > now()`,
      [[...geprueft]]
    )
    const gueltig = new Set(r.map((x) => x.token_hash))
    // Nur Verbindungen schließen, deren Sitzung in dieser Abfrage enthalten war (neue sind ggf. später dazugekommen)
    for (const v of [...verbindungen.values()])
      for (const c of [...v]) if (geprueft.has(c.sitzung) && !gueltig.has(c.sitzung)) c.schliessen()
  } catch {
    // Datenbank kurz nicht erreichbar: Verbindungen bleiben, nächste Prüfung folgt
  } finally {
    pruefung = false
  }
}

/** Schließt alle Event-Verbindungen (Herunterfahren): sonst wartet der Server bis zum Zeitlimit auf die offenen Streams. */
export function liveSchliessen() {
  herunterfahren = true
  for (const v of [...verbindungen.values()]) for (const c of [...v]) c.schliessen()
}

/** Öffnet die Event-Verbindung eines Nutzers. Gibt ein Promise zurück, das endet, wenn die Verbindung schließt. */
export function verbinden(event: H3Event, nutzer: number, sitzung: string): Promise<void> {
  liveStarten()
  if (herunterfahren) throw fehler(503, 'Der Server fährt herunter.', 'The server is shutting down.')
  const res = event.node.res
  const req = event.node.req
  const eigene = verbindungen.get(nutzer)
  let gesamt = 0
  for (const s of verbindungen.values()) gesamt += s.size
  // Neue Verbindung ablehnen (der Browser stoppt dann und versucht es mit Pause neu): Verdrängte Verbindungen würden
  // sich nach retry sofort wieder anmelden und reihum endlos gegenseitig verdrängen
  if ((eigene?.size || 0) >= MAX_JE_NUTZER || gesamt >= MAX_GESAMT)
    throw fehler(429, 'Zu viele Live-Verbindungen.', 'Too many live connections.')
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
      sitzung,
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
