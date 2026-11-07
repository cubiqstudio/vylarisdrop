import { q1 } from '../../../../utils/db'
import { currentUser } from '../../../../utils/auth'
import { slugParam } from '../../../../utils/abruf'
import { statZaehlen } from '../../../../utils/statistik'
import { inQuarantaene } from '../../../../utils/virenscan'
import {
  abgelaufen,
  aufrufZaehlen,
  basisUrl,
  dateiPerSlug,
  erloschen,
  freigegeben,
  links,
  vorschauToken
} from '../../../../utils/dateien'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const f = await dateiPerSlug(slugParam(event))
  if (!f || abgelaufen(f)) throw fehler(404, 'Diese Datei gibt es nicht (mehr).', 'This file does not exist (anymore).')
  if (inQuarantaene(f))
    throw fehler(451, 'Diese Datei wurde vom Virenscan gesperrt.', 'This file was blocked by the virus scan.')
  const ich = await currentUser(event)
  const besitzer = !!ich && ich.id === f.user_id
  const basis = await basisUrl(event)
  if (!(await freigegeben(event, f, ich?.id))) return { gesperrt: true, name: f.name, art: f.art }
  if (!besitzer) {
    const bot =
      /discordbot|telegrambot|whatsapp|twitterbot|slackbot|facebookexternalhit|linkedinbot|skypeuripreview|mastodon|matrix|embedly|redditbot/i.test(
        String(getRequestHeader(event, 'user-agent') || '')
      )
    // Link-Vorschau-Bots und zaehlen=0 zählen nur bei Dateien OHNE Aufruf-Grenze nicht (beides steuert der Aufrufer selbst). Die Antwort
    // enthält ein Vorschau-Token (= Abruf ohne Zählung): bei Dateien mit Aufruf-Grenze gibt es das darum nur zusammen mit einem gezählten Aufruf.
    const zaehlen = (getQuery(event).zaehlen !== '0' && !bot) || f.max_views != null
    if (erloschen(f) || (zaehlen && !(await aufrufZaehlen(f))))
      throw fehler(404, 'Diese Datei gibt es nicht (mehr).', 'This file does not exist (anymore).')
    if (zaehlen) statZaehlen(event, f.id)
  }
  const von = await q1<{ username: string; prefs: any }>('SELECT username, prefs FROM users WHERE id = $1', [f.user_id])
  const l = links(basis, f)
  const t = await vorschauToken(f)
  return {
    gesperrt: false,
    besitzer,
    datei: {
      slug: f.slug,
      name: f.name,
      mime: f.mime,
      art: f.art,
      size: Number(f.size),
      width: f.width,
      height: f.height,
      duration_ms: f.duration_ms,
      created_at: f.created_at,
      expires_at: f.expires_at,
      max_views: f.max_views,
      views: f.views + (besitzer ? 0 : 1),
      passwort: !!f.password_hash,
      sha256: f.sha256,
      wellen: f.wellen,
      streifen: f.streifen,
      verschluesselt: !!f.verschluesselt
    },
    von: von?.username || '',
    embed: von?.prefs?.embed || null,
    links: l,
    medium: `${l.direkt}?t=${encodeURIComponent(t)}`,
    vorschau: f.vorschau ? `${l.vorschau}?t=${encodeURIComponent(t)}` : null,
    streifenUrl: f.streifen ? `${l.streifen}?t=${encodeURIComponent(t)}` : null,
    live: f.live && l.live ? `${l.live}?t=${encodeURIComponent(t)}` : null,
    ansicht: !!f.ansicht
  }
})
