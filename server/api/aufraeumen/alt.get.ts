import { q } from '../../utils/db'
import { limit, requireUser } from '../../utils/auth'
import { eingabe } from '../../utils/cloudListe'
import { aufBereichLaden, aufEintraege, aufNaechster, AUF_SPALTEN, AufTageFrage, type AufDateiZeile } from '../../utils/aufraeumen'

/**
 * Dateien, die lange nicht angesehen oder geändert wurden (90/180/365 Tage): zuletzt = das Jüngste aus
 * letzter Ansicht (last_view_at), Änderung (geaendert_at) und Anlage (created_at). Liefert die größten 100 samt Summe.
 */
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (limit('aufraeumen:' + u.id, 90, 60)) throw fehler(429, 'Zu viele Anfragen — bitte kurz warten.', 'Too many requests — please wait a moment.')
  const f = eingabe(AufTageFrage, getQuery(event))
  const b = await aufBereichLaden(u, f.team === '1')
  const bed = `${b.sichtbar} AND GREATEST(f.last_view_at, f.geaendert_at, f.created_at) < now() - ($${aufNaechster(b)}::int * interval '1 day')`
  const p = [...b.params, f.tage]
  const [zeilen, summe] = await Promise.all([
    q<AufDateiZeile>(`SELECT ${AUF_SPALTEN} FROM files f WHERE ${bed} ORDER BY f.size DESC, f.id DESC LIMIT 100`, p),
    q<{ n: string; s: string }>(`SELECT count(*) AS n, coalesce(sum(f.size), 0) AS s FROM files f WHERE ${bed}`, p)
  ])
  return { tage: f.tage, anzahl: Number(summe[0]?.n || 0), bytes: Number(summe[0]?.s || 0), dateien: await aufEintraege(b, zeilen) }
})
