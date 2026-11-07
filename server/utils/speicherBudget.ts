// Budget für Storage-Boxen und S3-Buckets — Selbstbedienung im Rahmen des Kontingents (VylarisCloud 1.1)
//
// ===== Regeln (verbindlich) =====
// Budget eines Nutzers = wirksames Kontingent des Kontos (quota.ts: Konto > Rolle > Standard).
//   frei zum Einplanen = Kontingent − belegt (Dateien + Papierkorb) − eingeplant (Summe der Kontingente aller Boxen + Buckets)
// Beim Anlegen und Vergrößern muss die neue Summe in das Budget passen. Die Prüfung läuft serverseitig und atomar unter
// derselben Sperre wie jeder Upload (mitKontingentSperre: Advisory-Lock je Konto), und die Zeile wird in derselben Sperre
// geschrieben. Parallele Anfragen (Anlegen + Anlegen, Anlegen + Upload) können das Budget dadurch nicht überziehen.
// Das Eingeplante zählt in quota.ts zur Belegung des Kontos (belegtVon): Uploads, Kopieren, WebDAV-PUT sehen es.
//
// Ohne wirksames Limit (unbegrenzt):
//   · Admin/Inhaber: keine Grenze (wie bisher), ihr Eingeplantes steht trotzdem in ihrer Anzeige.
//   · Rolle "user": nur im Rahmen der Einstellung grenzeGb (Summe aller Boxen + Buckets). Ist grenzeGb 0 (aus), ist Anlegen und
//     Vergrößern für sie nicht erlaubt.
// Die Einstellungen maxAnzahl und grenzeGb gelten zusätzlich als Obergrenzen für Selbstbedienung (Konto = Besitzer = Handelnder,
// Rolle "user"). Handelt ein Admin an der Box eines Nutzers, gilt immer das Kontingent des Besitzers, aber nicht maxAnzahl/grenzeGb
// (das ist eine bewusste Entscheidung des Admins).
// Verkleinern und Löschen sind immer erlaubt (ein Verkleinern nur, wenn die Belegung der Box/des Buckets ins neue Kontingent
// passt; das prüft boxen.ts/buckets.ts gegen eine frische Messung).
// Senkt der Admin das Kontingent unter belegt + eingeplant, wird nichts gelöscht: das Konto ist "überplant", neue Boxen,
// Buckets, Vergrößerungen und Uploads werden abgelehnt, Zahlen werden nie negativ angezeigt.
import { z } from 'zod'
import { limit } from './auth'
import { q1 } from './db'
import { getSpeicherEinst, type SpeicherEinst } from './speicherdienst'
import { groesseText, mitKontingentSperre, quotaNutzer, wirksamesKontingent, type Ausf, type QuotaNutzer } from './quota'

const GiB = 1024 ** 3
export const MIN_KONTINGENT = 1024 ** 2 // 1 MiB
export const MAX_KONTINGENT = 1_000_000 * GiB // 1.000.000 GB, weit unter 2^53

// ---------- Eingaben ----------
/** Name einer Box / eines Buckets-Schlüssels: sichtbarer Text, keine Steuerzeichen */
export const nameZ = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .refine((s) => !/[\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(s))

/** Kontingent in Bytes, ganze Zahl innerhalb der Grenzen; null, wenn weder Bytes noch GB angegeben sind */
const bytesZ = z.number().int().min(MIN_KONTINGENT).max(MAX_KONTINGENT)
const gbZ = z.number().finite().min(MIN_KONTINGENT / GiB).max(MAX_KONTINGENT / GiB)
/**
 * Felder für das Kontingent: `kontingentBytes` (ganze Zahl, genau) ODER `kontingentGb` (Kommazahl, wird abgerundet).
 * Beides gleichzeitig ist ein Fehler (sonst wäre unklar, was gilt).
 */
export const kontingentFelder = {
  kontingentBytes: bytesZ.optional(),
  kontingentGb: gbZ.optional()
}
export function kontingentBytesAus(d: { kontingentBytes?: number; kontingentGb?: number }): number | undefined {
  if (d.kontingentBytes !== undefined && d.kontingentGb !== undefined) return NaN
  if (d.kontingentBytes !== undefined) return d.kontingentBytes
  if (d.kontingentGb !== undefined) return Math.floor(d.kontingentGb * GiB)
  return undefined
}
export function kontingentPflicht(d: { kontingentBytes?: number; kontingentGb?: number }): number {
  const k = kontingentBytesAus(d)
  if (k === undefined || !Number.isSafeInteger(k) || k < MIN_KONTINGENT || k > MAX_KONTINGENT)
    throw fehler(
      400,
      'Bitte genau ein gültiges Kontingent angeben (mindestens 1 MB, ganze Bytes oder GB).',
      'Please give exactly one valid quota (at least 1 MB, whole bytes or GB).'
    )
  return k
}

// ---------- Rate-Limit ----------
/** Anlegen: 20 je 10 Minuten und Nutzer; Ändern/Schlüssel/Passwort: 60 je 10 Minuten und Nutzer */
export function speicherRate(userId: number, art: 'anlegen' | 'aendern'): void {
  const [max, fenster] = art === 'anlegen' ? [20, 600] : [60, 600]
  if (limit(`speicher-${art}:${userId}`, max, fenster))
    throw fehler(
      429,
      'Zu viele Aktionen im Speicher — bitte ein paar Minuten warten.',
      'Too many storage actions — please wait a few minutes.'
    )
}

// ---------- Stand ----------
export interface BudgetStand {
  /** Wirksames Kontingent in Bytes, null = unbegrenzt */
  limit: number | null
  quelle: 'kontingent' | 'grenze' | 'unbegrenzt' | 'gesperrt'
  /** Dateien + Papierkorb */
  belegt: number
  /** Summe der Kontingente aller Boxen und Buckets */
  eingeplant: number
  anzahl: number
  /** Davon Boxen / Buckets (für Anzeige) */
  /** Wie viel jetzt noch eingeplant werden darf, null = unbegrenzt (Admin/Inhaber ohne Limit) */
  frei: number | null
  /** Rest ohne Begrenzung auf 0 (kann negativ sein = überplant), null = unbegrenzt */
  rest: number | null
  ueberplant: boolean
  /** Selbstbedienung: Obergrenzen aus der Einstellung (0 = keine) */
  maxAnzahl: number
  grenzeBytes: number
  /** Anlegen gerade nicht möglich + Grund (für die Oberfläche) */
  gesperrt: null | 'dienst' | 'admins' | 'keinBudget' | 'anzahl' | 'voll' | 'ueberplant'
}

interface Zaehlung {
  n: number
  summe: number
  boxen: number
  buckets: number
}
async function zaehlen(userId: number, x?: Ausf): Promise<Zaehlung> {
  const sql = `SELECT (SELECT count(*) FROM speicher_boxen WHERE user_id = $1) AS nb, (SELECT count(*) FROM speicher_buckets WHERE user_id = $1) AS nk,
    (SELECT coalesce(sum(kontingent), 0) FROM speicher_boxen WHERE user_id = $1) + (SELECT coalesce(sum(kontingent), 0) FROM speicher_buckets WHERE user_id = $1) AS s`
  const r = x ? (await x(sql, [userId]))[0] : await q1<any>(sql, [userId])
  const nb = Number(r?.nb || 0),
    nk = Number(r?.nk || 0)
  return { n: nb + nk, summe: Number(r?.s || 0), boxen: nb, buckets: nk }
}
async function belegtOhneBoxen(userId: number, x?: Ausf): Promise<number> {
  const sql = `SELECT (SELECT coalesce(sum(size), 0) FROM files WHERE user_id = $1)
    + (SELECT coalesce(sum((datei->>'size')::bigint), 0) FROM papierkorb WHERE user_id = $1) AS s`
  const r = x ? (await x(sql, [userId]))[0] : await q1<any>(sql, [userId])
  return Number(r?.s || 0)
}

/**
 * Budget eines Kontos. `aktorId` = wer handelt (Selbstbedienungs-Obergrenzen gelten nur, wenn Besitzer = Handelnder und Rolle "user").
 * Innerhalb von mitKontingentSperre() mit `x` aufrufen, dann ist das Ergebnis verbindlich.
 */
export async function budgetStand(
  besitzer: QuotaNutzer,
  aktorId: number,
  e?: SpeicherEinst,
  x?: Ausf,
  vorgabeLimit?: number | null
): Promise<BudgetStand> {
  const einst = e || (await getSpeicherEinst())
  const k = vorgabeLimit !== undefined ? { limit: vorgabeLimit } : await wirksamesKontingent(besitzer)
  const [z, belegt] = await Promise.all([zaehlen(besitzer.id, x), belegtOhneBoxen(besitzer.id, x)])
  const selbst = besitzer.role === 'user' && aktorId === besitzer.id
  const grenzeBytes = selbst && einst.grenzeGb > 0 ? Math.round(einst.grenzeGb * GiB) : 0
  const maxAnzahl = selbst ? Math.max(0, einst.maxAnzahl) : 0
  let rest: number | null = k.limit == null ? null : k.limit - belegt - z.summe
  let quelle: BudgetStand['quelle'] = k.limit == null ? 'unbegrenzt' : 'kontingent'
  let kappe: number | null = grenzeBytes > 0 ? grenzeBytes - z.summe : null
  let gesperrt: BudgetStand['gesperrt'] = null
  if (k.limit == null && selbst) {
    // ohne Limit darf ein normales Konto nur im Rahmen von grenzeGb einplanen; ist die aus, gar nicht
    if (grenzeBytes > 0) quelle = 'grenze'
    else {
      quelle = 'gesperrt'
      kappe = 0
      gesperrt = 'keinBudget'
    }
  }
  let frei: number | null = null
  for (const w of [rest, kappe]) if (w != null) frei = frei == null ? Math.max(0, w) : Math.min(frei, Math.max(0, w))
  const ueberplant = rest != null && rest < 0 && z.summe > 0
  if (!gesperrt) {
    if (maxAnzahl > 0 && z.n >= maxAnzahl) gesperrt = 'anzahl'
    else if (ueberplant) gesperrt = 'ueberplant'
    else if (frei != null && frei < MIN_KONTINGENT) gesperrt = 'voll'
  }
  return {
    limit: k.limit,
    quelle,
    belegt,
    eingeplant: z.summe,
    anzahl: z.n,
    frei,
    rest,
    ueberplant,
    maxAnzahl,
    grenzeBytes,
    gesperrt
  }
}

// ---------- Prüfung ----------
const en0 = (b: number) => groesseText(b, true)
const de0 = (b: number) => groesseText(b, false)

function budgetFehler(status: number, de: string, en: string, daten: Record<string, unknown>) {
  const f = fehler(status, de, en) as any
  f.data = { ...(f.data || {}), speicherBudget: true, ...daten }
  return f
}

/**
 * Prüft, ob `neu` Bytes (bei Neuanlage `alt` = 0) in das Budget des Besitzers passen. Wirft sonst eine verständliche Meldung.
 * Verkleinern (neu <= alt) ist immer erlaubt. MUSS innerhalb von mitKontingentSperre() laufen (`x` der Sperre).
 * `neueZeile` = Box/Bucket wird neu angelegt (zählt für maxAnzahl).
 */
export async function budgetPruefen(
  besitzer: QuotaNutzer,
  aktor: { id: number },
  alt: number,
  neu: number,
  neueZeile: boolean,
  x: Ausf
): Promise<BudgetStand> {
  const einst = await getSpeicherEinst()
  const s = await budgetStand(besitzer, aktor.id, einst, x)
  const delta = neu - alt
  if (delta <= 0 && !neueZeile) return s
  if (s.gesperrt === 'keinBudget')
    throw budgetFehler(
      403,
      'Für dein Konto ist kein Speicher für Boxen und Buckets freigegeben. Bitte den Admin, dir ein Kontingent zuzuweisen.',
      'No storage for boxes and buckets is enabled for your account. Please ask the admin to assign you a quota.',
      { grund: 'keinBudget', frei: 0 }
    )
  if (neueZeile && s.maxAnzahl > 0 && s.anzahl >= s.maxAnzahl)
    throw budgetFehler(
      400,
      `Höchstens ${s.maxAnzahl} Boxen und Buckets pro Konto.`,
      `At most ${s.maxAnzahl} boxes and buckets per account.`,
      { grund: 'anzahl', frei: s.frei ?? 0 }
    )
  if (s.ueberplant)
    throw budgetFehler(
      507,
      `Dein Konto ist überplant: Dateien, Papierkorb und reservierter Speicher (${de0(s.belegt + s.eingeplant)}) sind mehr als dein Kontingent (${de0(s.limit || 0)}). Gib Platz frei oder bitte den Admin um mehr Kontingent.`,
      `Your account is over-planned: files, trash and reserved storage (${en0(s.belegt + s.eingeplant)}) exceed your quota (${en0(s.limit || 0)}). Free up space or ask the admin for more quota.`,
      { grund: 'ueberplant', frei: 0 }
    )
  if (s.frei != null && delta > s.frei) {
    const grenzeBindet = s.grenzeBytes > 0 && (s.rest == null || s.grenzeBytes - s.eingeplant < s.rest)
    throw budgetFehler(
      507,
      grenzeBindet
        ? `Das geht nicht: Zusammen sind höchstens ${de0(s.grenzeBytes)} für Boxen und Buckets erlaubt, davon sind ${de0(s.eingeplant)} schon eingeplant (frei: ${de0(s.frei)}, gewünscht: ${de0(delta)}).`
        : `Das passt nicht in dein Budget: frei zum Einplanen sind ${de0(s.frei)} (Kontingent ${de0(s.limit || 0)}, belegt ${de0(s.belegt)}, für Boxen und Buckets reserviert ${de0(s.eingeplant)}), gewünscht sind ${de0(delta)}.`,
      grenzeBindet
        ? `Not possible: at most ${en0(s.grenzeBytes)} in total are allowed for boxes and buckets, ${en0(s.eingeplant)} are already planned (free: ${en0(s.frei)}, requested: ${en0(delta)}).`
        : `That does not fit your budget: ${en0(s.frei)} are free to plan (quota ${en0(s.limit || 0)}, used ${en0(s.belegt)}, reserved for boxes and buckets ${en0(s.eingeplant)}), you asked for ${en0(delta)}.`,
      { grund: 'budget', frei: s.frei, angefragt: delta }
    )
  }
  return s
}

/**
 * Darf der Handelnde Speicher anlegen/vergrößern? (Dienst eingeschaltet, "Wer darf?"). Wirft sonst 409/403.
 * Admins und Inhaber dürfen immer; für Nutzer muss die Einstellung "alle" sein.
 */
export async function speicherErlaubt(aktor: { role: string }, e?: SpeicherEinst): Promise<void> {
  if (aktor.role === 'user' && (e || (await getSpeicherEinst())).wer !== 'alle')
    throw fehler(403, 'Speicher legen hier nur Admins an.', 'Only admins create storage here.')
}

/** Besitzer-Konto (Kontingent-Sicht) laden; fehlt es, gilt die Zeile als nicht vorhanden */
export async function besitzerLaden(userId: number): Promise<QuotaNutzer> {
  const n = await quotaNutzer(userId)
  if (!n) throw fehler(404, 'Konto nicht gefunden.', 'Account not found.')
  return n
}

/** Alles unter der Konto-Sperre des Besitzers ausführen (dieselbe wie bei jedem Upload) */
export const mitBudgetSperre = <T>(besitzerId: number, fn: (x: Ausf) => Promise<T>): Promise<T> =>
  mitKontingentSperre(besitzerId, null, fn)

/** Für die Oberfläche: Budget-Karte */
export async function budgetAnsicht(u: QuotaNutzer & { id: number }, dienstAn: boolean) {
  const e = await getSpeicherEinst()
  const s = await budgetStand(u, u.id, e)
  let gesperrt = s.gesperrt
  if (!dienstAn) gesperrt = 'dienst'
  else if (u.role === 'user' && e.wer !== 'alle') gesperrt = 'admins'
  return {
    limit: s.limit,
    quelle: s.quelle,
    belegt: s.belegt,
    eingeplant: s.eingeplant,
    anzahl: s.anzahl,
    maxAnzahl: s.maxAnzahl,
    grenze: s.grenzeBytes,
    frei: s.frei,
    // negativ nie anzeigen: rest nur als Betrag der Überplanung
    ueberBytes: s.rest != null && s.rest < 0 ? -s.rest : 0,
    ueberplant: s.ueberplant,
    gesperrt: gesperrt,
    min: MIN_KONTINGENT,
    max: MAX_KONTINGENT
  }
}
