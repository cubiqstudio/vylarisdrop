// Kontingente (Speicherplatz pro Nutzer und pro Team) — VylarisCloud 1.1
//
// ===== Semantik (verbindlich) =====
// Wirksames Kontingent eines Kontos, in dieser Reihenfolge:
//   1. users.quota_bytes > 0   → eigenes Limit am Konto                         (source 'konto')
//      users.quota_bytes < 0   → ausdrücklich "Unbegrenzt" (Konvention: -1)      (source 'konto', limit null)
//   2. Rolle (Pro "Teams & Rollen", rollen.rechte.kontingentGb), nur für normale Konten (role 'user')  (source 'rolle')
//   3. Instanz-Standard (Einstellung quota.standardGb, 0/leer = keins), nur für normale Konten         (source 'standard')
//   4. sonst unbegrenzt                                                          (source 'keins')
//   NULL und 0 in users.quota_bytes bedeuten "erbt" (Bestandswerte bleiben gültig).
//   Admin- und Inhaber-Konten sind nie durch Rolle oder Standard eingeschränkt (so war es schon immer),
//   nur durch ein ausdrücklich am Konto gesetztes Limit.
//
// Belegt = Summe files.size des Kontos PLUS Summe der Dateigrößen im Papierkorb (papierkorb.datei->>'size').
//   Der Papierkorb legt die Zeile aus `files` heraus in eine eigene Tabelle; der Inhalt bleibt im Speicher und belegt Platz,
//   bis der Papierkorb geleert wird (manuell oder nach 30 Tagen). Beim Löschen in den Papierkorb ändert sich die Summe
//   daher nicht, beim endgültigen Löschen sinkt sie. Jede Zeile zählt einzeln (Kopien zählen je Kopie), nichts doppelt:
//   eine Datei steht entweder in `files` oder in `papierkorb`. Wiederherstellen verschiebt nur zwischen beiden → Summe gleich.
//   Nicht enthalten: Speicher-Boxen und -Buckets (eigene Kontingente), Vorschau-/Nebendateien, angefangene Chunk-Uploads
//   (die werden beim Start nur als Reservierung für die Frühprüfung mitgerechnet).
//
// Team-Kontingent (teams.quota_bytes): begrenzt die Gesamtgröße aller Dateien in Ordnern des Teams (Wurzel-Team-Ordner und
//   alle Unterordner, egal wer hochgeladen hat; Papierkorb-Einträge aus diesen Ordnern zählen mit). Ein Upload in einen
//   Team-Ordner muss BEIDES bestehen: das Kontingent des Uploaders (die Datei zählt zu ihm) und das des Teams.
//   Team-Kontingente gelten nur, solange Pro "Teams" aktiv ist (genau wie die Team-Ordner selbst, siehe ordnerRecht).
//
// Durchsetzung:
//   · Frühprüfung (schnell scheitern): Upload-Start / Content-Length / maxFuer → freundliche Meldung mit Zahlen.
//   · Endgültige Prüfung nach dem Schreiben und VOR dem Anlegen der Datei: dateiAnlegen() ruft mitKontingentSperre() auf.
//     Das hält pro Nutzer (und pro Team) einen Postgres-Advisory-Lock, rechnet die Belegung neu und legt die Zeile in
//     derselben Sperre an. Parallele Uploads können das Limit dadurch nicht überschreiten (auch über mehrere Server-Knoten).
//     Ist das Konto unbegrenzt und kein Team-Limit im Spiel, entfällt die Sperre ganz.
//   · Fehlercode: HTTP 507 (Insufficient Storage); "Datei größer als erlaubt" (Instanz-/Rollen-Grenze) bleibt 413.
//
// Warnungen: bei >= 80 % und >= 100 % einmalig (users.quota_gewarnt = 0 | 80 | 100). Die Stufe fällt auf 0 zurück, sobald die
//   Belegung wieder unter 80 % liegt (oder das Konto unbegrenzt wird). Benachrichtigung: benachrichtigen.ts → quotaWarnen().
import type { PoolClient } from 'pg'
import { db, q, q1 } from './db'
import { rechteVon } from './teams'
import { istPro } from './lizenz'
import { getQuota, setSetting, sLang } from './settings'

export type QuotaQuelle = 'konto' | 'rolle' | 'standard' | 'keins'
export type QuotaStufe = 'ok' | 'warn' | 'kritisch' | 'voll'

export interface QuotaNutzer {
  id: number
  role: 'owner' | 'admin' | 'user'
  quota_bytes: number | string | null
  rolle_id?: number | null
}
export interface QuotaStand {
  /** Wirksames Limit in Bytes, null = unbegrenzt */
  limit: number | null
  used: number
  /** Freier Platz in Bytes, null = unbegrenzt */
  free: number | null
  source: QuotaQuelle
  /** true, wenn am Konto ausdrücklich "Unbegrenzt" steht */
  unbegrenzt: boolean
  /** Belegung in Prozent (0–100+), null = unbegrenzt */
  prozent: number | null
  stufe: QuotaStufe
  /** Davon im Papierkorb */
  papierkorb: number
}

export const UNBEGRENZT = -1
const GB = 1024 ** 3

// ---------- Einstellung ----------
export async function setQuotaStandard(gb: number | null): Promise<void> {
  await setSetting('quota', { standardGb: gb && gb > 0 ? gb : null })
}

// ---------- Formatierung für Meldungen ----------
const EINH = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
function zerlegen(b: number): { v: number; e: number } {
  let v = Math.max(0, Number(b) || 0)
  let e = 0
  while (v >= 1024 && e < EINH.length - 1) {
    v /= 1024
    e++
  }
  return { v, e }
}
function zahlText(v: number, en: boolean): string {
  const r = v < 10 ? Math.round(v * 10) / 10 : Math.round(v)
  const nk = r % 1 !== 0 ? 1 : 0
  return r.toLocaleString(en ? 'en-GB' : 'de-DE', { minimumFractionDigits: nk, maximumFractionDigits: nk })
}
/** "4,8 GB" (de) bzw. "4.8 GB" (en) — binäre Einheiten wie in der Oberfläche */
export function groesseText(b: number, en = sLang() === 'en'): string {
  const { v, e } = zerlegen(b)
  return `${zahlText(v, en)} ${EINH[e]}`
}
/** "4,8 von 5 GB" wenn beide in derselben Einheit, sonst "800 MB von 5 GB" */
export function paarText(used: number, limit: number, en = sLang() === 'en'): string {
  const a = zerlegen(used),
    l = zerlegen(limit)
  const von = en ? 'of' : 'von'
  if (a.e === l.e) return `${zahlText(a.v, en)} ${von} ${zahlText(l.v, en)} ${EINH[l.e]}`
  return `${groesseText(used, en)} ${von} ${groesseText(limit, en)}`
}

// ---------- Wirksames Kontingent ----------
interface Kontext {
  standardBytes: number | null
  proTeams: boolean
  rollen: Map<number, number | null>
}
async function kontext(rolleIds: Array<number | null | undefined>): Promise<Kontext> {
  const standardGb = (await getQuota()).standardGb
  const proTeams = await istPro('teams')
  const rollen = new Map<number, number | null>()
  const ids = [...new Set(rolleIds.filter((x): x is number => !!x))]
  if (proTeams && ids.length) {
    const r = await q<{ id: number; gb: string | null }>(
      `SELECT id, NULLIF(rechte->>'kontingentGb', '') AS gb FROM rollen WHERE id = ANY($1::int[])`,
      [ids]
    )
    for (const x of r) {
      const g = Number(x.gb)
      rollen.set(x.id, Number.isFinite(g) && g > 0 ? Math.round(g * GB) : null)
    }
  }
  return { standardBytes: standardGb ? Math.round(standardGb * GB) : null, proTeams, rollen }
}
function kontingentAus(u: QuotaNutzer, k: Kontext): { limit: number | null; source: QuotaQuelle; unbegrenzt: boolean } {
  const eigen = u.quota_bytes == null ? 0 : Number(u.quota_bytes)
  if (eigen > 0) return { limit: eigen, source: 'konto', unbegrenzt: false }
  if (eigen < 0) return { limit: null, source: 'konto', unbegrenzt: true }
  if (u.role === 'user') {
    const r = u.rolle_id ? k.rollen.get(u.rolle_id) : null
    if (r) return { limit: r, source: 'rolle', unbegrenzt: false }
    if (k.standardBytes) return { limit: k.standardBytes, source: 'standard', unbegrenzt: false }
  }
  return { limit: null, source: 'keins', unbegrenzt: false }
}

/** Wirksames Limit eines Kontos (ohne Belegung). rolle_id wird bei Bedarf nachgeladen. */
export async function wirksamesKontingent(u: QuotaNutzer) {
  let rid = u.rolle_id
  if (rid === undefined && u.role === 'user' && Number(u.quota_bytes || 0) === 0)
    rid = (await q1<{ rolle_id: number | null }>('SELECT rolle_id FROM users WHERE id = $1', [u.id]))?.rolle_id ?? null
  return kontingentAus(u, await kontext([rid]))
}

/**
 * Viele Konten auf einmal (Nutzerliste): lädt Rollen, Standard und Pro-Status nur einmal.
 * `erbt` = was das Konto bekäme, wenn am Konto selbst nichts eingestellt wäre (für den Hinweis "Erbt derzeit: …").
 */
export async function wirksameKontingente(konten: Array<QuotaNutzer & { rolle_id?: number | null }>): Promise<
  Map<
    number,
    { limit: number | null; source: QuotaQuelle; unbegrenzt: boolean; erbt: { limit: number | null; source: QuotaQuelle } }
  >
> {
  const k = await kontext(konten.map((u) => u.rolle_id))
  return new Map(
    konten.map((u) => {
      const e = kontingentAus({ ...u, quota_bytes: null }, k)
      return [u.id, { ...kontingentAus(u, k), erbt: { limit: e.limit, source: e.source } }]
    })
  )
}

// ---------- Belegung ----------
export type Ausf = (sql: string, params?: unknown[]) => Promise<any[]>
const normal: Ausf = (sql, params = []) => q(sql, params)

/** Belegung eines Kontos: Dateien + Papierkorb (siehe Kopfkommentar) */
export async function belegtVon(userId: number, x: Ausf = normal): Promise<{ dateien: number; papierkorb: number; gesamt: number }> {
  const r = (
    await x(
      `SELECT (SELECT coalesce(sum(size), 0) FROM files WHERE user_id = $1) AS d,
              (SELECT coalesce(sum((datei->>'size')::bigint), 0) FROM papierkorb WHERE user_id = $1) AS p`,
      [userId]
    )
  )[0]
  const dateien = Number(r?.d || 0),
    papierkorb = Number(r?.p || 0)
  return { dateien, papierkorb, gesamt: dateien + papierkorb }
}

export function stufeVon(used: number, limit: number | null): QuotaStufe {
  if (!limit) return 'ok'
  const p = (used / limit) * 100
  return p >= 100 ? 'voll' : p >= 95 ? 'kritisch' : p >= 80 ? 'warn' : 'ok'
}
function standAus(
  k: { limit: number | null; source: QuotaQuelle; unbegrenzt: boolean },
  b: { gesamt: number; papierkorb: number }
): QuotaStand {
  const used = b.gesamt
  return {
    limit: k.limit,
    used,
    free: k.limit == null ? null : Math.max(0, k.limit - used),
    source: k.source,
    unbegrenzt: k.unbegrenzt,
    prozent: k.limit == null ? null : Math.round((used / k.limit) * 1000) / 10,
    stufe: stufeVon(used, k.limit),
    papierkorb: b.papierkorb
  }
}
export async function quotaStand(u: QuotaNutzer, x: Ausf = normal): Promise<QuotaStand> {
  return standAus(await wirksamesKontingent(u), await belegtVon(u.id, x))
}

/** Belegung aller Konten (Dateien + Papierkorb) für Übersichten */
export async function belegungAllerKonten(): Promise<Map<number, { dateien: number; papierkorb: number; anzahl: number; gesamt: number }>> {
  const r = await q<{ id: number; d: string; p: string; n: string }>(
    `SELECT u.id,
      coalesce((SELECT sum(size) FROM files f WHERE f.user_id = u.id), 0)::bigint AS d,
      coalesce((SELECT sum((datei->>'size')::bigint) FROM papierkorb p WHERE p.user_id = u.id), 0)::bigint AS p,
      (SELECT count(*) FROM files f WHERE f.user_id = u.id)::int AS n
    FROM users u`
  )
  return new Map(
    r.map((x) => [x.id, { dateien: Number(x.d), papierkorb: Number(x.p), anzahl: Number(x.n), gesamt: Number(x.d) + Number(x.p) }])
  )
}

// ---------- Teams ----------
/** Zu welchem Team gehört ein Ordner? Läuft über parent_id nach oben (erstes gesetzte team_id). Nur mit Pro "Teams". */
export async function teamVonOrdner(ordnerId: number | null | undefined, x: Ausf = normal): Promise<number | null> {
  if (!ordnerId || !Number.isSafeInteger(ordnerId) || ordnerId <= 0) return null
  if (!(await istPro('teams'))) return null
  const r = (
    await x(
      `WITH RECURSIVE hoch(id, parent_id, team_id, tiefe) AS (
        SELECT id, parent_id, team_id, 0 FROM folders WHERE id = $1
        UNION ALL
        SELECT f.id, f.parent_id, f.team_id, h.tiefe + 1 FROM folders f JOIN hoch h ON f.id = h.parent_id WHERE h.team_id IS NULL AND h.tiefe < 64
      ) SELECT team_id FROM hoch WHERE team_id IS NOT NULL ORDER BY tiefe LIMIT 1`,
      [ordnerId]
    )
  )[0]
  return r?.team_id ?? null
}

export interface TeamStand {
  id: number
  name: string
  limit: number | null
  used: number
  free: number | null
  prozent: number | null
  stufe: QuotaStufe
}
const TEAM_ORDNER = `WITH RECURSIVE tf(id) AS (SELECT id FROM folders WHERE team_id = $1 UNION SELECT f.id FROM folders f JOIN tf ON f.parent_id = tf.id)`
export async function teamBelegt(teamId: number, x: Ausf = normal): Promise<number> {
  const r = (
    await x(
      `${TEAM_ORDNER}
      SELECT (SELECT coalesce(sum(size), 0) FROM files WHERE folder_id IN (SELECT id FROM tf))
           + (SELECT coalesce(sum((datei->>'size')::bigint), 0) FROM papierkorb WHERE (datei->>'folder_id')::int IN (SELECT id FROM tf)) AS s`,
      [teamId]
    )
  )[0]
  return Number(r?.s || 0)
}
export async function teamLimit(teamId: number, x: Ausf = normal): Promise<{ name: string; limit: number | null } | null> {
  const r = (await x('SELECT name, quota_bytes FROM teams WHERE id = $1', [teamId]))[0]
  if (!r) return null
  const l = Number(r.quota_bytes || 0)
  return { name: r.name, limit: l > 0 ? l : null }
}
export async function teamStand(teamId: number, x: Ausf = normal): Promise<TeamStand | null> {
  const t = await teamLimit(teamId, x)
  if (!t) return null
  const used = await teamBelegt(teamId, x)
  return {
    id: teamId,
    name: t.name,
    limit: t.limit,
    used,
    free: t.limit == null ? null : Math.max(0, t.limit - used),
    prozent: t.limit == null ? null : Math.round((used / t.limit) * 1000) / 10,
    stufe: stufeVon(used, t.limit)
  }
}
/** Belegung mehrerer Teams auf einmal (Teams-Seite) */
export async function teamBelegungen(): Promise<Map<number, number>> {
  const r = await q<{ id: number; s: string }>(
    `WITH RECURSIVE tf(team, id) AS (SELECT team_id, id FROM folders WHERE team_id IS NOT NULL UNION SELECT tf.team, f.id FROM folders f JOIN tf ON f.parent_id = tf.id)
    SELECT t.id,
      (coalesce((SELECT sum(f.size) FROM files f WHERE f.folder_id IN (SELECT id FROM tf WHERE team = t.id)), 0)
      + coalesce((SELECT sum((p.datei->>'size')::bigint) FROM papierkorb p WHERE (p.datei->>'folder_id')::int IN (SELECT id FROM tf WHERE team = t.id)), 0))::bigint AS s
    FROM teams t`
  )
  return new Map(r.map((x) => [x.id, Number(x.s)]))
}

// ---------- Fehler ----------
export type QuotaArt = 'konto' | 'team'
function quotaFehlerBauen(
  art: QuotaArt,
  d: {
    used: number
    limit: number
    bytes?: number
    ungefaehr?: boolean
    teamName?: string
    papierkorb?: number
    verschieben?: boolean
  }
) {
  const frei = Math.max(0, d.limit - d.used)
  const mit = (en: boolean) => {
    const was = d.verschieben ? (en ? 'the files need' : 'die Dateien brauchen') : en ? 'the file needs' : 'die Datei braucht'
    const bedarf =
      d.bytes && d.bytes > 0
        ? `${was} ${d.ungefaehr ? (en ? 'about ' : 'etwa ') : ''}${groesseText(d.bytes, en)}`
        : frei === 0
          ? en
            ? 'there is no space left'
            : 'es ist nichts mehr frei'
          : en
            ? `only ${groesseText(frei, en)} ${frei === 1 ? 'is' : 'are'} left`
            : `es sind nur noch ${groesseText(frei, en)} frei`
    const korb =
      art === 'konto' && d.papierkorb && d.papierkorb > 0
        ? en
          ? ` The trash holds ${groesseText(d.papierkorb, en)} — empty it to free up space.`
          : ` Der Papierkorb belegt ${groesseText(d.papierkorb, en)} — leere ihn, um Platz zu schaffen.`
        : ''
    if (art === 'team')
      return en
        ? `The quota of the team “${d.teamName}” is full: ${paarText(d.used, d.limit, true)} used, ${bedarf}.`
        : `Das Kontingent des Teams „${d.teamName}“ ist voll: ${paarText(d.used, d.limit, false)} belegt, ${bedarf}.`
    return en
      ? `Your storage is full: ${paarText(d.used, d.limit, true)} used, ${bedarf}.${korb}`
      : `Dein Speicher ist voll: ${paarText(d.used, d.limit, false)} belegt, ${bedarf}.${korb}`
  }
  const e = fehler(507, mit(false), mit(true)) as any
  e.data = { ...(e.data || {}), quota: art, limit: d.limit, used: d.used, free: frei }
  return e
}
/** true, wenn der Fehler ein Kontingent-Fehler aus diesem Modul ist (für Gast-Uploads, die keine Zahlen sehen sollen) */
export const istQuotaFehler = (e: any): boolean => !!e?.data?.quota

// ---------- Prüfungen ----------
export interface PruefOpt {
  /** Zielordner (für das Team-Kontingent) */
  ordner?: number | null
  /** Ziel-Team direkt angeben (überschreibt die Ermittlung über `ordner`), z. B. wenn ein Ordner einem Team zugewiesen wird */
  zielTeam?: number | null
  /** Bytes einer Datei, die ersetzt wird (Inhalt ersetzen): zählt nur die Differenz */
  ersetzt?: number
  /** Team der Datei VOR dem Verschieben (zählt dort schon mit; gleiches Team = kein Zuwachs) */
  vonTeam?: number | null
  /** Mehrere Dateien auf einmal (Meldung im Plural) */
  mehrere?: boolean
  /** Bytes, die schon fest eingeplant sind (z. B. laufende Chunk-Uploads) und zur Belegung zählen */
  zusatz?: number
  /** Ausführung auf einer bestimmten Verbindung (innerhalb der Sperre) */
  x?: Ausf
}
/**
 * Wirft eine freundliche 507-Meldung, wenn `bytes` (zusätzlich) nicht mehr hineinpassen — für das Konto und, falls der
 * Ordner zu einem Team gehört, für das Team. Rechnet frisch; innerhalb von mitKontingentSperre() ist das Ergebnis verbindlich.
 * `nutzer` null = nur das Team prüfen (z. B. beim Verschieben fremder Dateien in einen Team-Ordner).
 */
export async function kontingentPruefen(nutzer: QuotaNutzer | null, bytes: number, o: PruefOpt = {}): Promise<void> {
  const x = o.x || normal
  const delta = Math.max(0, bytes - Math.max(0, o.ersetzt || 0))
  if (nutzer) {
    const k = await wirksamesKontingent(nutzer)
    if (k.limit != null) {
      const b = await belegtVon(nutzer.id, x)
      const belegt = b.gesamt + (o.zusatz || 0)
      if (delta > 0 && belegt + delta > k.limit)
        throw quotaFehlerBauen('konto', { used: belegt, limit: k.limit, bytes: delta, papierkorb: b.papierkorb, verschieben: o.mehrere })
    }
  }
  const team = o.zielTeam !== undefined ? o.zielTeam : await teamVonOrdner(o.ordner, x)
  if (team && team !== o.vonTeam) {
    const t = await teamLimit(team, x)
    if (t?.limit != null) {
      const used = (await teamBelegt(team, x)) + (o.zusatz || 0)
      if (delta > 0 && used + delta > t.limit)
        throw quotaFehlerBauen('team', { used, limit: t.limit, bytes: delta, teamName: t.name, verschieben: o.mehrere })
    }
  }
}

export interface Grenzen {
  /** Höchstzahl Bytes für diesen Upload; 0 = ohne Grenze (Konvention von schreiben()) */
  max: number
  /** Welche Grenze die engste ist */
  ursache: 'keine' | 'konto' | 'team' | 'datei'
  stand?: QuotaStand
  team?: TeamStand | null
}
/**
 * Die engste Grenze für einen Upload (Kontingent des Kontos, des Teams, Instanz-Größtgrenze, Rollen-Dateigröße).
 * `dateiMax` ist die Instanz-/Rollen-Grenze in Bytes (Infinity = keine). Frühprüfung, nicht verbindlich.
 */
export async function uploadGrenzen(u: QuotaNutzer, ordner: number | null, dateiMax = Infinity): Promise<Grenzen> {
  const stand = await quotaStand(u)
  const team = await teamVonOrdner(ordner)
  const ts = team ? await teamStand(team) : null
  let max = Infinity,
    ursache: Grenzen['ursache'] = 'keine'
  if (dateiMax < max) ((max = dateiMax), (ursache = 'datei'))
  if (stand.free != null && stand.free <= max) ((max = stand.free), (ursache = 'konto'))
  if (ts?.free != null && ts.free < max) ((max = ts.free), (ursache = 'team'))
  return { max: max === Infinity ? 0 : max > 0 ? max : -1, ursache, stand, team: ts }
}
/** Der Fehler passend zur engsten Grenze (nach ZU_GROSS beim Streamen). `bytes` = Dateigröße, falls bekannt. */
export function grenzFehler(g: Grenzen, bytes?: number, ungefaehr = false) {
  if (g.ursache === 'konto' && g.stand?.limit != null)
    return quotaFehlerBauen('konto', { used: g.stand.used, limit: g.stand.limit, bytes, ungefaehr, papierkorb: g.stand.papierkorb })
  if (g.ursache === 'team' && g.team?.limit != null)
    return quotaFehlerBauen('team', { used: g.team.used, limit: g.team.limit, bytes, ungefaehr, teamName: g.team.name })
  return g.max > 0
    ? fehler(
        413,
        `Die Datei ist zu groß: erlaubt sind höchstens ${groesseText(g.max, false)}${bytes ? `, die Datei hat ${groesseText(bytes, false)}` : ''}.`,
        `The file is too large: at most ${groesseText(g.max, true)} are allowed${bytes ? `, the file has ${groesseText(bytes, true)}` : ''}.`
      )
    : fehler(413, 'Die Datei ist größer als erlaubt.', 'The file is larger than allowed.')
}

/**
 * Grobe Dateigröße aus Content-Length eines multipart-Uploads (abzüglich geschätztem Rahmen). undefined, wenn nicht
 * bekannt oder zu klein, um sinnvoll zu sein.
 */
export function nutzlastSchaetzen(laenge: number | undefined, contentType: string): number | undefined {
  if (!laenge || !Number.isFinite(laenge)) return undefined
  const b = /boundary=("?)([^";]+)\1/i.exec(contentType)?.[2]?.length || 40
  const n = laenge - (2 * b + 200)
  return n >= 1024 ? n : undefined
}

// ---------- Sperre ----------
const NS_KONTO = 7101,
  NS_TEAM = 7102
const ketten = new Map<string, Promise<void>>()
async function reihum(key: string): Promise<() => void> {
  const vorher = ketten.get(key) || Promise.resolve()
  let los!: () => void
  const mein = new Promise<void>((r) => (los = r))
  const kette = vorher.then(() => mein)
  ketten.set(key, kette)
  await vorher
  return () => {
    los()
    if (ketten.get(key) === kette) ketten.delete(key)
  }
}
/**
 * Führt `fn` unter einer Sperre für Konto (und Team) aus. Innerhalb von `fn` MUSS alles über `x` laufen (eigene Verbindung),
 * sonst droht bei vielen gleichzeitigen Uploads ein leerer Verbindungs-Pool. Reihenfolge der Sperren immer: Konto, dann Team.
 */
export async function mitKontingentSperre<T>(
  userId: number | null,
  teamId: number | null,
  fn: (x: Ausf) => Promise<T>
): Promise<T> {
  const frei: Array<() => void> = []
  if (userId) frei.push(await reihum('k' + userId))
  if (teamId) frei.push(await reihum('t' + teamId))
  let c: PoolClient | null = null
  let defekt: any = null
  try {
    c = await db().connect()
    const cl = c
    if (userId) await cl.query('SELECT pg_advisory_lock($1, $2)', [NS_KONTO, userId])
    if (teamId) await cl.query('SELECT pg_advisory_lock($1, $2)', [NS_TEAM, teamId])
    return await fn(async (sql, params = []) => (await cl.query(sql, params as any[])).rows)
  } finally {
    if (c) {
      try {
        await c.query('SELECT pg_advisory_unlock_all()')
      } catch (e) {
        defekt = e
      }
      c.release(defekt || undefined)
    }
    for (const f of frei.reverse()) f()
  }
}

/** Lädt die für Kontingente nötigen Spalten eines Kontos */
export async function quotaNutzer(userId: number): Promise<QuotaNutzer | null> {
  return q1<QuotaNutzer>('SELECT id, role, quota_bytes, rolle_id FROM users WHERE id = $1', [userId])
}

/**
 * Hat das Schreiben dieses Kontos (in diesen Ordner) überhaupt eine Grenze? Wenn nein, kann man die Sperre sparen.
 */
export async function hatGrenze(userId: number, ordner: number | null | undefined): Promise<{ nutzer: QuotaNutzer | null; team: number | null; begrenzt: boolean }> {
  const nutzer = await quotaNutzer(userId)
  const k = nutzer ? await wirksamesKontingent(nutzer) : { limit: null }
  const team = await teamVonOrdner(ordner ?? null)
  const tl = team ? await teamLimit(team) : null
  return { nutzer, team: tl?.limit != null ? team : null, begrenzt: k.limit != null || tl?.limit != null }
}

/**
 * Reservierung durch laufende Chunk-Uploads (nur für die Frühprüfung beim Upload-Start): Uploads, bei denen noch Stücke
 * fehlen und die jünger als 12 Stunden sind. Fertig hochgeladene (nur noch nicht abgeschlossene) zählen nicht mit.
 */
export async function reserviert(userId: number): Promise<number> {
  const r = await q1<{ s: string }>(
    `SELECT coalesce(sum(size), 0) AS s FROM uploads
      WHERE user_id = $1 AND created_at > now() - interval '12 hours' AND jsonb_array_length(erhalten) < teile`,
    [userId]
  )
  return Number(r?.s || 0)
}

/**
 * Verschieben in einen Team-Ordner (oder Zuweisen eines Ordners an ein Team): prüft unter der Team-Sperre, dass `bytes`
 * zusätzlich in das Team-Kontingent passen, und führt dann `run` aus (mit der Verbindung der Sperre).
 * `vonTeam` = Team, in dem die Dateien schon liegen (zählt dort bereits). Ohne Team-Limit läuft `run` ohne Sperre.
 */
export async function verschiebenPruefen<T>(
  ziel: { ordner?: number | null; team?: number | null },
  bytes: number,
  vonTeam: number | null,
  run: (x: Ausf) => Promise<T>
): Promise<T> {
  const team = ziel.team !== undefined ? ziel.team : await teamVonOrdner(ziel.ordner ?? null)
  const t = team && team !== vonTeam ? await teamLimit(team) : null
  if (!team || t?.limit == null) return run(normal)
  return mitKontingentSperre(null, team, async (x) => {
    await kontingentPruefen(null, bytes, { zielTeam: team, vonTeam, x, mehrere: true })
    return run(x)
  })
}

/** Bytes aller Dateien (und Papierkorb-Einträge) in einem Ordner und seinen Unterordnern */
export async function ordnerBaumBytes(ordnerId: number): Promise<number> {
  const r = await q1<{ s: string }>(
    `WITH RECURSIVE unter(id) AS (SELECT $1::int UNION SELECT f.id FROM folders f JOIN unter ON f.parent_id = unter.id)
    SELECT (SELECT coalesce(sum(size), 0) FROM files WHERE folder_id IN (SELECT id FROM unter))
         + (SELECT coalesce(sum((datei->>'size')::bigint), 0) FROM papierkorb WHERE (datei->>'folder_id')::int IN (SELECT id FROM unter)) AS s`,
    [ordnerId]
  )
  return Number(r?.s || 0)
}
