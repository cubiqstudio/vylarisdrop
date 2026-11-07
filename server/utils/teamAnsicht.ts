import type { H3Event } from 'h3'
import { z } from 'zod'
import type pg from 'pg'
import { db, q, q1 } from './db'
import { limit, type Nutzer } from './auth'
import { istPro, requirePro } from './lizenz'
import { stufeVon, type QuotaStufe } from './quota'

// Team-Ansicht für Mitglieder: Speicher des eigenen Teams, Mitgliederliste und Mitgliederverwaltung durch die Team-Leitung.
// Mandantentrennung: Die Mitgliedschaft wird bei JEDER Anfrage aus der Datenbank gelesen (team_mitglieder), nie aus Angaben
// des Browsers. Wer nicht Mitglied ist (und kein Admin), bekommt für jedes Team 404 – egal, ob es das Team gibt.
// Rechte-Entscheidung: Mitglieder bekommen für Verwaltungsaktionen 403 (sie kennen das Team ja schon, eine ehrliche
// Meldung hilft), Nicht-Mitglieder 404. Nicht-Mitglieder und Mitglieder ohne Leitung erreichen die Namenssuche nie:
// die Rechteprüfung kommt VOR jeder Suche in der Konten-Tabelle, es gibt also kein Konten-Orakel für sie.
// Die Leitung darf wissen, ob ein Benutzername existiert (sie sieht es ohnehin in den Vorschlägen); trotzdem antwortet
// "hinzufügen" für "gibt es nicht" und "nicht hinzufügbar" (Admin-/Inhaber-Konten) mit derselben 404-Meldung, damit die
// Leitung über Admin-Konten nichts erfährt. Admin-Konten verwaltet nur ein Admin (Seite "Teams & Rollen" oder diese Routen).

export const ID_MAX = 2_147_483_647
export const MAX_MITGLIEDER = 200
export const MAX_TEAMS_ANSICHT = 50

export type TeamRolle = 'leitung' | 'mitglied'

/** Ganze Zahl im int4-Bereich aus einem Pfadparameter; sonst 400 (nie eine Datenbankabfrage mit Müll). */
export function idParam(event: H3Event, name: string): number {
  const roh = getRouterParam(event, name) ?? ''
  const n = /^[1-9]\d{0,9}$/.test(roh) ? Number(roh) : 0
  if (!n || n > ID_MAX) throw fehler(400, 'Ungültige Angabe.', 'Invalid value.')
  return n
}

/** Eingabe prüfen: Typverwechslung (Array/Objekt statt Text), Steuerzeichen und NUL werden abgewiesen. */
export function teamEingabe<T extends z.ZodTypeAny>(schema: T, roh: unknown): z.infer<T> {
  const p = schema.safeParse(roh)
  if (!p.success) throw fehler(400, 'Bitte prüfe die Angaben.', 'Please check your input.')
  return p.data
}
export const Benutzername = z
  .string()
  .trim()
  .min(1)
  .max(64)
  // eslint-disable-next-line no-control-regex
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s))

export interface TeamZugang {
  nutzer: Nutzer
  /** eigene Rolle im Team; null = kein Mitglied (nur Admins kommen so durch) */
  rolle: TeamRolle | null
  admin: boolean
  /** Leitung dieses Teams oder Admin des Systems */
  verwalten: boolean
}
const istAdmin = (n: Pick<Nutzer, 'role'>) => n.role === 'owner' || n.role === 'admin'

/** Prüft den Zugriff auf ein Team über die Datenbank. Wirft 404 für Nicht-Mitglieder (Admins ausgenommen). */
export async function teamZugang(nutzer: Nutzer, teamId: number): Promise<TeamZugang> {
  const admin = istAdmin(nutzer)
  const nicht = () => fehler(404, 'Team nicht gefunden.', 'Team not found.')
  if (!(await istPro('teams'))) {
    if (admin) await requirePro('teams')
    throw nicht()
  }
  const m = await q1<{ rolle: TeamRolle }>('SELECT rolle FROM team_mitglieder WHERE team_id = $1 AND user_id = $2', [
    teamId,
    nutzer.id
  ])
  if (m) return { nutzer, rolle: m.rolle, admin, verwalten: admin || m.rolle === 'leitung' }
  if (admin && (await q1('SELECT 1 FROM teams WHERE id = $1', [teamId])))
    return { nutzer, rolle: null, admin, verwalten: true }
  throw nicht()
}
export function nurVerwalten(z: TeamZugang): void {
  if (!z.verwalten)
    throw fehler(403, 'Das darf nur die Team-Leitung.', 'Only the team lead may do this.')
}
/** Rate-Limit je Nutzer; wirft 429 */
export function tempo(schluessel: string, max: number, fensterSek: number): void {
  if (limit(schluessel, max, fensterSek))
    throw fehler(429, 'Zu viele Anfragen – bitte kurz warten.', 'Too many requests – please wait a moment.')
}

/** Schreibvorgang auf Mitglieder eines Teams: eine Transaktion, die das Team sperrt (verhindert Rennen bei 200er-Grenze und letzter Leitung). */
export async function imTeamSchreiben<T>(teamId: number, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db().connect()
  try {
    await c.query('BEGIN')
    const t = await c.query('SELECT id FROM teams WHERE id = $1 FOR UPDATE', [teamId])
    if (!t.rowCount) throw fehler(404, 'Team nicht gefunden.', 'Team not found.')
    const r = await fn(c)
    await c.query('COMMIT')
    return r
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}

export interface TeamSpeicher {
  limit: number | null
  belegt: number
  frei: number | null
  prozent: number | null
  stufe: QuotaStufe
  ausgeschoepft: boolean
  /** Bytes in Team-Ordnern von Konten, die (nicht mehr) Mitglied sind */
  sonstige: number
}

export interface MitgliedAnsicht {
  /** nur für die Leitung (und für die eigene Zeile): für Aktionen nötig, sonst weggelassen */
  id?: number
  ich: boolean
  name: string
  rolle: TeamRolle
  beigetreten: string
  belegt: number
  /** nur gesetzt für die Leitung: dieses Konto ist Admin des Systems und nur von Admins änderbar */
  geschuetzt?: boolean
}

export interface TeamAnsicht {
  id: number
  name: string
  farbe: string
  beschreibung: string
  meineRolle: TeamRolle
  darfVerwalten: boolean
  ordner: number
  speicher: TeamSpeicher
  mitglieder: MitgliedAnsicht[]
  mitgliederZahl: number
}

/**
 * Belegung je Team und Konto: Dateien in allen Ordnern des Teams (inkl. Unterordner) plus deren Papierkorb – dieselbe
 * Rechnung wie utils/quota.ts (teamBelegt/teamBelegungen), nur nach Konto aufgeteilt. Eine Abfrage für alle Teams.
 */
async function belegungJeKonto(teamIds: number[]): Promise<Map<number, Map<number, number>>> {
  const r = await q<{ team: number; user_id: number; b: string }>(
    `WITH RECURSIVE tf(team, id) AS (
       SELECT team_id, id FROM folders WHERE team_id = ANY($1::int[])
       UNION SELECT tf.team, f.id FROM folders f JOIN tf ON f.parent_id = tf.id)
     SELECT team, user_id, sum(b)::bigint AS b FROM (
       SELECT tf.team, f.user_id, f.size AS b FROM files f JOIN tf ON tf.id = f.folder_id
       UNION ALL
       SELECT tf.team, p.user_id, coalesce((p.datei->>'size')::bigint, 0) FROM papierkorb p JOIN tf ON tf.id = (p.datei->>'folder_id')::int
     ) x GROUP BY team, user_id`,
    [teamIds]
  )
  const aus = new Map<number, Map<number, number>>()
  for (const x of r) {
    const m = aus.get(x.team) || new Map<number, number>()
    m.set(x.user_id, Number(x.b))
    aus.set(x.team, m)
  }
  return aus
}

/** Alle Teams des Nutzers mit Speicher und Mitgliedern (nur Teams, in denen er selbst Mitglied ist). */
export async function teamsAnsicht(nutzer: Nutzer): Promise<TeamAnsicht[]> {
  const teams = await q<any>(
    `SELECT t.id, t.name, t.farbe, t.beschreibung, t.quota_bytes, m.rolle,
       (SELECT count(*) FROM folders f WHERE f.team_id = t.id)::int AS ordner
     FROM team_mitglieder m JOIN teams t ON t.id = m.team_id
     WHERE m.user_id = $1 ORDER BY lower(t.name), t.id LIMIT ${MAX_TEAMS_ANSICHT}`,
    [nutzer.id]
  )
  if (!teams.length) return []
  const ids = teams.map((t) => t.id as number)
  const mitglieder = await q<any>(
    `SELECT m.team_id, m.user_id, m.rolle, m.created_at, u.username, u.role
     FROM team_mitglieder m JOIN users u ON u.id = m.user_id
     WHERE m.team_id = ANY($1::int[])
     ORDER BY m.team_id, (m.rolle = 'leitung') DESC, lower(u.username), u.id`,
    [ids]
  )
  const belegung = await belegungJeKonto(ids)
  const admin = istAdmin(nutzer)
  return teams.map((t): TeamAnsicht => {
    const verwalten = admin || t.rolle === 'leitung'
    const jeKonto = belegung.get(t.id) || new Map<number, number>()
    const gesamt = [...jeKonto.values()].reduce((a, b) => a + b, 0)
    const liste = mitglieder.filter((m) => m.team_id === t.id).slice(0, MAX_MITGLIEDER)
    const lim = Number(t.quota_bytes) > 0 ? Number(t.quota_bytes) : null
    const vonMitgliedern = liste.reduce((a, m) => a + (jeKonto.get(m.user_id) || 0), 0)
    return {
      id: t.id,
      name: t.name,
      farbe: t.farbe,
      beschreibung: t.beschreibung,
      meineRolle: t.rolle,
      darfVerwalten: verwalten,
      ordner: t.ordner,
      speicher: {
        limit: lim,
        belegt: gesamt,
        frei: lim == null ? null : Math.max(0, lim - gesamt),
        prozent: lim == null ? null : Math.round((gesamt / lim) * 1000) / 10,
        stufe: stufeVon(gesamt, lim),
        ausgeschoepft: lim != null && gesamt >= lim,
        sonstige: Math.max(0, gesamt - vonMitgliedern)
      },
      mitglieder: liste.map((m): MitgliedAnsicht => {
        const ich = m.user_id === nutzer.id
        const e: MitgliedAnsicht = {
          ich,
          name: m.username,
          rolle: m.rolle,
          beigetreten: new Date(m.created_at).toISOString(),
          belegt: jeKonto.get(m.user_id) || 0
        }
        if (verwalten || ich) e.id = m.user_id
        if (t.rolle === 'leitung' && !admin) e.geschuetzt = m.role === 'owner' || m.role === 'admin'
        return e
      }),
      mitgliederZahl: mitglieder.filter((m) => m.team_id === t.id).length
    }
  })
}
