import { ereignis } from '../../utils/db'
import { clientIp, limit, requireOwner } from '../../utils/auth'
import { dienstFehlerMelden, garageKapazitaetAbgleichen, speicherKonfiguriert } from '../../utils/speicherdienst'

/** Kapazität des Garage-Knotens im Cluster-Layout an die Größe der Daten-Platte anpassen (nur Inhaber). */
export default defineEventHandler(async (event) => {
  const u = await requireOwner(event)
  if (limit('garagekap:' + u.id, 10, 600))
    throw fehler(429, 'Zu viele Versuche — bitte kurz warten.', 'Too many attempts — please wait a moment.')
  if (!speicherKonfiguriert())
    throw fehler(409, 'Der Speicherdienst ist nicht eingeschaltet.', 'The storage service is not switched on.')
  let r
  try {
    r = await garageKapazitaetAbgleichen(false)
  } catch (e) {
    dienstFehlerMelden(e, 'Garage-Kapazität')
  }
  if (r.geaendert) await ereignis('settings_changed', u.id, { bereich: 'speicher-garage-kapazitaet', neu: r.neu }, clientIp(event))
  return { ok: true, ...r }
})
