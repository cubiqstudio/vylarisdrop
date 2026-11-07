// Speicher-Analyse & Aufräumen — gemeinsame Bausteine der Routen unter /api/aufraeumen/*
//
// Sichtbar sind die eigenen Dateien und (nur mit Pro "Teams") alle Dateien in Ordnern der Teams, in denen das Konto Mitglied ist.
// Gelöscht werden darf nur, was auch der Dateimanager löschen lässt (aenderbareDateien: eigene Dateien, Team-Dateien als Leitung).
// Die Übersicht "belegt" folgt utils/quota.ts (Dateien + Papierkorb des Kontos); Listen und Duplikate können Team-Dateien enthalten
// und kennzeichnen sie (team, eigen, darfLoeschen).
import { z } from 'zod'
import { q } from './db'
import type { Nutzer } from './auth'
import { meineTeams } from './teams'
import { vorschauToken } from './dateien'

export const AUF_ID_MAX = 2_147_483_647

export const AufTageFrage = z.object({
  tage: z.coerce.number().int().refine((n) => [90, 180, 365].includes(n)).default(180),
  team: z.enum(['0', '1']).default('1')
})
export const AufTeamFrage = z.object({ team: z.enum(['0', '1']).default('1') })
export const AufDuplikatFrage = z.object({
  team: z.enum(['0', '1']).default('1'),
  seite: z.coerce.number().int().min(1).max(1000).default(1),
  pro: z.coerce.number().int().min(1).max(50).default(25)
})

export interface AufOrdnerInfo {
  id: number
  parent_id: number | null
  name: string
  user_id: number
  team_id: number | null
  /** Galerie oder öffentlicher Ordner (gilt auch für alle Unterordner) */
  geteilt: boolean
}

export interface AufBereich {
  uid: number
  /** Teams des Kontos (nur mit Pro und wenn gewünscht) */
  teams: number[]
  leitung: number[]
  teamNamen: Map<number, { name: string; farbe: string }>
  ordner: Map<number, AufOrdnerInfo>
  /** SQL-Bedingung für sichtbare Dateien (Alias f); $1 = Konto, $2 = Team-IDs */
  sichtbar: string
  params: unknown[]
}

const SICHTBAR_EIGEN = 'f.user_id = $1'
const SICHTBAR_TEAM = '(f.user_id = $1 OR f.folder_id IN (SELECT id FROM folders WHERE team_id = ANY($2::int[])))'

export async function aufBereichLaden(u: Nutzer, mitTeam: boolean): Promise<AufBereich> {
  const alle = await meineTeams(u.id)
  const aktiv = mitTeam ? alle : []
  const teams = aktiv.map((t) => t.team_id)
  // Die Teamnamen und Leitungsrechte gelten auch bei abgeschaltetem Team-Filter (eigene Dateien in Team-Ordnern)
  const leitung = alle.filter((t) => t.rolle === 'leitung').map((t) => t.team_id)
  const alleIds = alle.map((t) => t.team_id)
  const zeilen = await q<{ id: number; parent_id: number | null; name: string; user_id: number; team_id: number | null; g: boolean }>(
    `SELECT id, parent_id, name, user_id, team_id, (galerie_token IS NOT NULL OR public) AS g FROM folders
    WHERE user_id = $1 OR team_id = ANY($2::int[]) LIMIT 200000`,
    [u.id, alleIds]
  )
  return {
    uid: u.id,
    teams,
    leitung,
    teamNamen: new Map(alle.map((t) => [t.team_id, { name: t.name, farbe: t.farbe }])),
    ordner: new Map(
      zeilen.map((o) => [o.id, { id: o.id, parent_id: o.parent_id, name: o.name, user_id: o.user_id, team_id: o.team_id, geteilt: o.g }])
    ),
    sichtbar: teams.length ? SICHTBAR_TEAM : SICHTBAR_EIGEN,
    params: teams.length ? [u.id, teams] : [u.id]
  }
}

/** Nächste freie Parameternummer nach den Bereichs-Parametern */
export const aufNaechster = (b: AufBereich) => b.params.length + 1

/** Ausgeschriebener Pfad eines Ordners ("Fotos / 2024") und ob er (oder ein Oberordner) öffentlich geteilt ist */
export function aufPfadVon(b: AufBereich, id: number | null, cache = new Map<number, { pfad: string; geteilt: boolean }>()): { pfad: string; geteilt: boolean } {
  if (id == null) return { pfad: '', geteilt: false }
  const hit = cache.get(id)
  if (hit) return hit
  const teile: string[] = []
  let geteilt = false
  let aktuell: number | null = id
  for (let i = 0; i < 100 && aktuell != null; i++) {
    const o = b.ordner.get(aktuell)
    if (!o) break
    teile.unshift(o.name)
    if (o.geteilt) geteilt = true
    aktuell = o.parent_id
  }
  const r = { pfad: teile.join(' / '), geteilt }
  cache.set(id, r)
  return r
}

/** Spalten einer Datei-Zeile für die Listen */
export const AUF_SPALTEN = `f.id::text AS id, f.name, f.size::bigint AS size, f.art, f.mime, f.folder_id, f.user_id, f.slug, f.created_at, f.geaendert_at,
  f.last_view_at, f.views, f.favorite, (f.password_hash <> '') AS passwort, f.expires_at, f.max_views, f.vorschau, f.verschluesselt,
  GREATEST(f.last_view_at, f.geaendert_at, f.created_at) AS zuletzt`

export interface AufDateiZeile {
  id: string
  name: string
  size: string | number
  art: string
  mime: string
  folder_id: number | null
  user_id: number
  slug: string
  created_at: string
  geaendert_at: string
  last_view_at: string | null
  views: number
  favorite: boolean
  passwort: boolean
  expires_at: string | null
  max_views: number | null
  vorschau: boolean
  verschluesselt: boolean
  zuletzt: string
}

export interface AufDateiEintrag {
  id: string
  name: string
  size: number
  art: string
  ordnerId: number | null
  /** Ordnerpfad, leer = oberste Ebene */
  pfad: string
  team: { id: number; name: string; farbe: string } | null
  eigen: boolean
  darfLoeschen: boolean
  erstellt: string
  geaendert: string
  zuletzt: string
  angesehen: string | null
  aufrufe: number
  favorit: boolean
  /** Kennzeichen der Freigabe: Link wurde aufgerufen, Passwort, Ablauf/Aufruf-Limit, Galerie */
  geteilt: { link: boolean; passwort: boolean; schutz: boolean; galerie: boolean; irgendwie: boolean }
  vorschau: string
  slug: string
}

/** Verwandelt Zeilen in Antworteinträge (Pfade, Rechte, Freigabe-Kennzeichen, Vorschau-URL) */
export async function aufEintraege(b: AufBereich, zeilen: AufDateiZeile[], mitVorschau = true): Promise<AufDateiEintrag[]> {
  const cache = new Map<number, { pfad: string; geteilt: boolean }>()
  const aus: AufDateiEintrag[] = []
  for (const z of zeilen) {
    const o = z.folder_id != null ? b.ordner.get(z.folder_id) : undefined
    const p = aufPfadVon(b, z.folder_id, cache)
    const team = o?.team_id != null ? b.teamNamen.get(o.team_id) : undefined
    const eigen = z.user_id === b.uid
    const darf = eigen || (o?.team_id != null && b.leitung.includes(o.team_id))
    const link = Number(z.views) > 0
    const schutz = z.expires_at != null || z.max_views != null
    const galerie = p.geteilt
    let vorschau = ''
    if (mitVorschau && z.vorschau && !z.verschluesselt) vorschau = `/t/${encodeURIComponent(z.slug)}?t=${encodeURIComponent(await vorschauToken({ id: z.id }))}`
    aus.push({
      id: String(z.id),
      name: z.name,
      size: Number(z.size),
      art: z.art,
      ordnerId: z.folder_id,
      pfad: p.pfad,
      team: o?.team_id != null && team ? { id: o.team_id, ...team } : null,
      eigen,
      darfLoeschen: darf,
      erstellt: z.created_at,
      geaendert: z.geaendert_at,
      zuletzt: z.zuletzt,
      angesehen: z.last_view_at,
      aufrufe: Number(z.views),
      favorit: !!z.favorite,
      geteilt: { link, passwort: !!z.passwort, schutz, galerie, irgendwie: link || !!z.passwort || schutz || galerie },
      vorschau,
      slug: z.slug
    })
  }
  return aus
}

/** Dateiart für die Verteilung: die Arten des Dateimanagers (bild, video, audio, text, datei), Text um PDF/Office zu "Dokumente"
 *  erweitert und "Sonstiges" um Archive abgespalten. */
export const AUF_KATEGORIE_SQL = `CASE
  WHEN f.art = 'bild' THEN 'bild' WHEN f.art = 'video' THEN 'video' WHEN f.art = 'audio' THEN 'audio'
  WHEN f.art = 'text' OR f.mime ~* '(pdf|msword|officedocument|opendocument|rtf|epub)' THEN 'dokument'
  WHEN f.mime ~* '(zip|rar|7z|x-tar|gzip|x-bzip|x-xz|zstd|compressed)' OR f.name ~* '\\.(zip|rar|7z|tar|gz|tgz|bz2|xz|zst)$' THEN 'archiv'
  ELSE 'sonst' END`

export const AUF_KATEGORIEN = ['bild', 'video', 'audio', 'dokument', 'archiv', 'sonst'] as const

/** Duplikat-Gruppen (gleicher sha256 und gleiche Größe, leerer sha256 und leere Dateien zählen nicht) */
const DUP_GRUPPEN = (b: AufBereich) =>
  `SELECT f.sha256, f.size, count(*) AS n FROM files f WHERE ${b.sichtbar} AND f.sha256 <> '' AND f.size > 0 GROUP BY f.sha256, f.size HAVING count(*) > 1`

export interface AufDuplikatSumme {
  gruppen: number
  kopien: number
  ueberzaehlig: number
  bytes: number
}

/** Eine Seite Duplikat-Gruppen (größte Ersparnis zuerst) samt Gesamtsumme — in einer einzigen Abfrage (ein Durchlauf über die Dateien) */
export async function aufDuplikatSeite(
  b: AufBereich,
  pro: number,
  versatz: number
): Promise<{ summe: AufDuplikatSumme; gruppen: Array<{ sha256: string; size: string; n: string }> }> {
  const n = aufNaechster(b)
  const z = await q<{ sha256: string; size: string; n: string; gruppen: string; kopien: string; ueberzaehlig: string; bytes: string }>(
    `WITH g AS (${DUP_GRUPPEN(b)})
    SELECT sha256, size, n, count(*) OVER () AS gruppen, sum(n) OVER () AS kopien, sum(n - 1) OVER () AS ueberzaehlig, sum(size * (n - 1)) OVER () AS bytes
    FROM g ORDER BY size * (n - 1) DESC, sha256 LIMIT $${n}::int OFFSET $${n + 1}::int`,
    [...b.params, pro, versatz]
  )
  const k = z[0]
  const summe = k
    ? { gruppen: Number(k.gruppen), kopien: Number(k.kopien), ueberzaehlig: Number(k.ueberzaehlig), bytes: Number(k.bytes) }
    : versatz > 0
      ? await aufDuplikatSumme(b)
      : { gruppen: 0, kopien: 0, ueberzaehlig: 0, bytes: 0 }
  return { summe, gruppen: z.map((x) => ({ sha256: x.sha256, size: x.size, n: x.n })) }
}

/** Zusammenfassung der Duplikate (Gruppen, Kopien, überzählige Bytes) */
export async function aufDuplikatSumme(b: AufBereich): Promise<AufDuplikatSumme> {
  const r = (
    await q<{ gruppen: string; kopien: string; ueberzaehlig: string; bytes: string }>(
      `WITH g AS (${DUP_GRUPPEN(b)})
      SELECT count(*) AS gruppen, coalesce(sum(n), 0) AS kopien, coalesce(sum(n - 1), 0) AS ueberzaehlig, coalesce(sum(size * (n - 1)), 0) AS bytes FROM g`,
      b.params
    )
  )[0]
  return {
    gruppen: Number(r?.gruppen || 0),
    kopien: Number(r?.kopien || 0),
    ueberzaehlig: Number(r?.ueberzaehlig || 0),
    bytes: Number(r?.bytes || 0)
  }
}
