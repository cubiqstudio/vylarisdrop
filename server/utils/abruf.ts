import { dateiCsp } from './dateiCsp'
import type { H3Event } from 'h3'
import { currentUser } from './auth'
import {
  abgelaufen,
  aufrufZaehlen,
  ausliefern,
  dateiPerSlug,
  erloschen,
  freigegeben,
  istErsterAbruf,
  vorschauTokenOk
} from './dateien'
import { nebenLesen, NEBEN, type Neben } from './speicher'
import type { DateiZeile } from './dateien'
import { altesZiel } from './importKern'
import { statZaehlen } from './statistik'
import { inQuarantaene } from './virenscan'
import { hotlinkPruefen } from './hotlink'
import { trafficPruefen, gezaehlt } from './traffic'
import { varianteAusliefern } from './bildvarianten'

export async function abrufen(event: H3Event, modus: 'inline' | 'download' | 'raw') {
  const roh = decodeURIComponent(String(getRouterParam(event, 'slug') || ''))
  const slug = roh.replace(/\.[A-Za-z0-9]{1,10}$/, '')
  const f = (await dateiPerSlug(slug)) || (slug !== roh ? await dateiPerSlug(roh) : null)
  if (!f) {
    const alt = await altesZiel((event.path || '').split('?')[0]!)
    if (alt && alt !== (event.path || '').split('?')[0]) return sendRedirect(event, alt, 301)
  }
  if (!f || abgelaufen(f)) throw fehler(404, 'Diese Datei gibt es nicht (mehr).', 'This file does not exist (anymore).')
  if (inQuarantaene(f))
    throw fehler(451, 'Diese Datei wurde vom Virenscan gesperrt.', 'This file was blocked by the virus scan.')
  const ich = await currentUser(event)
  const besitzer = !!ich && ich.id === f.user_id
  const eingebettet = await vorschauTokenOk(f, getQuery(event).t)
  if (!(await freigegeben(event, f, ich?.id)) && !eingebettet)
    return sendRedirect(event, `/v/${encodeURIComponent(f.slug)}`, 302)
  if (!besitzer && !eingebettet && modus !== 'download') await hotlinkPruefen(event)
  if (!besitzer) await trafficPruefen(f.user_id)
  if (!besitzer && !eingebettet && istErsterAbruf(event)) {
    if (erloschen(f) || !(await aufrufZaehlen(f)))
      throw fehler(404, 'Diese Datei gibt es nicht (mehr).', 'This file does not exist (anymore).')
    statZaehlen(event, f.id)
  }
  if (modus === 'inline') {
    const v = await varianteAusliefern(event, f)
    if (v) return v.antwort
    if (f.ansicht && getQuery(event).original === undefined) {
      const a = await nebenSenden(
        event,
        f,
        'ansicht',
        f.name.replace(/\.[^.]+$/, '') + '.jpg',
        f.password_hash || f.max_views != null ? 'private, no-store' : 'public, max-age=3600'
      )
      if (a !== null) return a
    }
  }
  return ausliefern(event, f, modus)
}

async function nebenSenden(
  event: H3Event,
  f: DateiZeile,
  art: Neben,
  name: string,
  cache: string,
  typ = NEBEN[art].typ
) {
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(getRequestHeader(event, 'range') || ''))
  let ungueltig = false
  const n = await nebenLesen(
    f.ablage,
    art,
    range
      ? (groesse) => {
          let start = range[1] ? Number(range[1]) : NaN,
            end = range[2] ? Number(range[2]) : NaN
          if (Number.isNaN(start)) {
            start = Math.max(0, groesse - (Number.isNaN(end) ? 0 : end))
            end = groesse - 1
          }
          if (Number.isNaN(end) || end >= groesse) end = groesse - 1
          if (start > end || start >= groesse) {
            ungueltig = true
            return { start: 0, end: 0 }
          }
          return { start, end }
        }
      : undefined
  )
  if (!n) return null
  setResponseHeaders(event, {
    'Content-Type': typ,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': dateiCsp(typ),
    'Cache-Control': cache,
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`
  })
  if (ungueltig) {
    n.strom.destroy()
    setResponseStatus(event, 416)
    setResponseHeader(event, 'Content-Range', `bytes */${n.groesse}`)
    return ''
  }
  if (n.bereich) {
    setResponseStatus(event, 206)
    setResponseHeader(event, 'Content-Range', `bytes ${n.bereich.start}-${n.bereich.end}/${n.groesse}`)
    setResponseHeader(event, 'Content-Length', n.bereich.end - n.bereich.start + 1)
  } else setResponseHeader(event, 'Content-Length', n.groesse)
  if (event.method === 'HEAD') {
    n.strom.destroy()
    return ''
  }
  return sendStream(event, (await gezaehlt(n.strom, f.user_id, f.id)) as any)
}

export async function nebenAbrufen(event: H3Event, art: 'vorschau' | 'streifen' | 'live') {
  const f = await dateiPerSlug(
    decodeURIComponent(String(getRouterParam(event, 'slug') || '')).replace(/\.(mp4|mov)$/i, '')
  )
  if (f && inQuarantaene(f))
    throw fehler(404, 'Diese Datei gibt es nicht (mehr).', 'This file does not exist (anymore).')
  if (!f || abgelaufen(f) || (art === 'vorschau' ? !f.vorschau : art === 'streifen' ? !f.streifen : !f.live))
    throw fehler(404, 'Keine Vorschau vorhanden.', 'No preview available.')
  const ich = await currentUser(event)
  const besitzer = !!ich && ich.id === f.user_id
  const token = await vorschauTokenOk(f, getQuery(event).t)
  if (!(await freigegeben(event, f, ich?.id)) && !token)
    throw fehler(404, 'Keine Vorschau vorhanden.', 'No preview available.')
  if (!besitzer && !token) await hotlinkPruefen(event)
  if (!besitzer) await trafficPruefen(f.user_id)
  if (art === 'live') {
    const cache = f.password_hash ? 'private, max-age=600' : 'public, max-age=86400'
    const stamm = f.name.replace(/\.[^.]+$/, '')
    if (f.live_mp4 && getQuery(event).original === undefined) {
      const a = await nebenSenden(event, f, 'livemp4', stamm + '.mp4', cache)
      if (a !== null) return a
    }
    const a = await nebenSenden(event, f, 'live', stamm + '.mov', cache, 'video/quicktime')
    if (a === null) throw fehler(404, 'Keine Vorschau vorhanden.', 'No preview available.')
    return a
  }
  const n = await nebenLesen(f.ablage, art)
  if (!n) throw fehler(404, 'Keine Vorschau vorhanden.', 'No preview available.')
  setResponseHeaders(event, {
    'Content-Type': 'image/webp',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': dateiCsp('image/webp'),
    'Cache-Control': f.password_hash ? 'private, max-age=600' : 'public, max-age=86400',
    'Cross-Origin-Resource-Policy': 'cross-origin'
  })
  setResponseHeader(event, 'Content-Length', n.groesse)
  return sendStream(event, (await gezaehlt(n.strom, f.user_id, f.id)) as any)
}
