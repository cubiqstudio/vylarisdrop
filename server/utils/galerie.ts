import { randomBytes } from 'node:crypto'
import { q, q1 } from './db'
import { links, vorschauToken, type DateiZeile } from './dateien'

export interface GalerieEinstellung {
  titel?: string
  text?: string
  download?: boolean
  sortierung?: 'neu' | 'alt' | 'name'
  /** Konto, das die Galerie zuletzt eingestellt hat (ihm gehören die veröffentlichten Dateien oder es leitet das Team) */
  von?: number
}

export const neuesGalerieToken = () => randomBytes(16).toString('base64url')

export async function galerieOrdner(token: string) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return null
  return q1<{ id: number; user_id: number; name: string; galerie: GalerieEinstellung; username: string }>(
    `SELECT f.id, f.user_id, f.name, f.galerie, u.username FROM folders f JOIN users u ON u.id = f.user_id WHERE f.galerie_token = $1`,
    [token]
  )
}

export async function galerieDateien(
  ordnerId: number,
  sortierung: GalerieEinstellung['sortierung'] = 'neu'
): Promise<DateiZeile[]> {
  const ord =
    sortierung === 'alt' ? 'f.created_at ASC' : sortierung === 'name' ? 'lower(f.name) ASC' : 'f.created_at DESC'
  // Veröffentlicht werden nur Dateien dessen, der die Galerie eingestellt hat (ohne Angabe: Ersteller des Ordners). Dateien anderer
  // Mitglieder eines Team-Ordners nur, solange er Leitung dieses Teams ist: sonst könnte ein einfaches oder ausgeschiedenes Mitglied
  // fremde Dateien öffnen.
  // Dateien mit Aufruf-Grenze erscheinen nie (die Galerie gäbe sonst Vorschau-Token aus und zählte keinen Aufruf).
  return q<DateiZeile>(
    `WITH RECURSIVE unter(id) AS (SELECT $1::int UNION SELECT o.id FROM folders o JOIN unter ON o.parent_id = unter.id),
    wurzel AS (SELECT coalesce((galerie->>'von')::int, user_id) AS user_id FROM folders WHERE id = $1::int)
    SELECT f.* FROM files f, wurzel w WHERE f.folder_id IN (SELECT id FROM unter) AND f.password_hash = '' AND NOT f.verschluesselt AND f.scan <> 'fund'
      AND (f.expires_at IS NULL OR f.expires_at > now()) AND f.max_views IS NULL
      AND (f.user_id = w.user_id OR EXISTS (
        SELECT 1 FROM folders o JOIN team_mitglieder m ON m.team_id = o.team_id AND m.user_id = w.user_id AND m.rolle = 'leitung'
        WHERE o.id = f.folder_id))
    ORDER BY ${ord}, f.id DESC LIMIT 2000`,
    [ordnerId]
  )
}

export async function galerieEintrag(basis: string, f: DateiZeile) {
  const tk = await vorschauToken(f)
  const l = links(basis, f)
  return {
    slug: f.slug,
    name: f.name,
    art: f.art,
    mime: f.mime,
    size: Number(f.size),
    width: f.width,
    height: f.height,
    duration_ms: f.duration_ms,
    created_at: f.created_at,
    vorschau: f.vorschau ? `${l.vorschau}?t=${tk}` : null,
    medium: `${l.direkt}?t=${tk}`,
    seite: l.seite,
    live: f.live && l.live ? `${l.live}?t=${tk}` : null
  }
}
