import type { H3Event } from 'h3'
import { currentUser, limit, userAusToken, type Nutzer, type TokenRecht } from './auth'

export async function apiNutzer(event: H3Event, recht: TokenRecht): Promise<Nutzer> {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const s = await currentUser(event)
  if (s) return s
  const t = await userAusToken(event)
  if (!t)
    throw fehler(
      401,
      'Token fehlt oder ist ungültig (Authorization: Bearer vd_…).',
      'Missing or invalid token (Authorization: Bearer vd_…).'
    )
  if (!t.tokenRechte.includes(recht)) {
    const name = { upload: 'upload', lesen: 'read', verwalten: 'manage' }[recht]
    throw fehler(403, `Diesem Token fehlt das Recht „${name}“.`, `This token lacks the "${name}" permission.`)
  }
  if (limit('api:' + t.tokenId, 600, 60)) {
    setResponseHeader(event, 'Retry-After', 60)
    throw fehler(
      429,
      'Zu viele Anfragen (höchstens 600 pro Minute und Token).',
      'Too many requests (at most 600 per minute and token).'
    )
  }
  const { tokenRechte: _r, tokenId: _i, ...u } = t
  event.context.nutzer = u
  return u
}

export function bodySetzen(event: H3Event, body: unknown) {
  ;(event.node.req as any)[Symbol.for('h3ParsedBody')] = body
}

const ART: Record<string, string> = { bild: 'image', video: 'video', audio: 'audio', text: 'text', datei: 'file' }
export const ART_ZURUECK: Record<string, string> = {
  image: 'bild',
  video: 'video',
  audio: 'audio',
  text: 'text',
  file: 'datei'
}
const SCAN: Record<string, string> = {
  '': 'unscanned',
  laeuft: 'scanning',
  ok: 'clean',
  frei: 'released',
  fund: 'infected',
  uebersprungen: 'skipped'
}

export function alsApi(f: any) {
  return {
    id: String(f.id),
    slug: f.slug,
    name: f.name,
    mime: f.mime,
    type: ART[f.art] || 'file',
    size: Number(f.size),
    folder_id: f.folder_id ?? null,
    created_at: f.created_at,
    expires_at: f.expires_at ?? null,
    max_views: f.max_views ?? null,
    views: f.views,
    password_protected: !!f.passwort,
    favorite: !!f.favorite,
    encrypted: !!f.verschluesselt,
    live_photo: !!f.live,
    width: f.width ?? null,
    height: f.height ?? null,
    duration_ms: f.duration_ms ?? null,
    tags: (f.tags || []).map((t: any) => ({ id: t.id, name: t.name, color: t.color })),
    scan: { status: SCAN[f.scan || ''] || 'unscanned', ...(f.scan === 'fund' ? { threat: f.scan_info } : {}) },
    urls: {
      page: f.links.seite,
      direct: f.links.direkt,
      download: f.links.download,
      raw: f.links.raw,
      ...(f.hat_vorschau ? { thumbnail: f.links.vorschau } : {}),
      ...(f.links.live ? { live_video: f.links.live } : {})
    }
  }
}
export function ordnerAlsApi(o: any, basis: string) {
  return {
    id: o.id,
    name: o.name,
    parent_id: o.parent_id ?? null,
    files: o.anzahl ?? 0,
    created_at: o.created_at,
    team: o.team ? { id: o.team_id, name: o.team.name } : null,
    gallery_url: o.galerie_token ? `${basis}/g/${o.galerie_token}` : null
  }
}
