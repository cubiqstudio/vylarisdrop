import { q } from '../../utils/db'
import { limit, requireUser } from '../../utils/auth'
import { eingabe } from '../../utils/cloudListe'
import { aufBereichLaden, aufEintraege, AUF_SPALTEN, AufTeamFrage, type AufDateiZeile } from '../../utils/aufraeumen'

/** Die 50 größten Dateien (mit Ordnerpfad) */
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  if (limit('aufraeumen:' + u.id, 90, 60)) throw fehler(429, 'Zu viele Anfragen — bitte kurz warten.', 'Too many requests — please wait a moment.')
  const f = eingabe(AufTeamFrage, getQuery(event))
  const b = await aufBereichLaden(u, f.team === '1')
  const zeilen = await q<AufDateiZeile>(
    `SELECT ${AUF_SPALTEN} FROM files f WHERE ${b.sichtbar} ORDER BY f.size DESC, f.id DESC LIMIT 50`,
    b.params
  )
  return { dateien: await aufEintraege(b, zeilen) }
})
