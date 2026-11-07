import { z } from 'zod'
import { ereignis } from '../../../utils/db'
import { clientIp, limit, requireAdmin } from '../../../utils/auth'
import { ZielEingabe, zielLaden } from '../../../utils/sftpZiele'
import { testen } from '../../../utils/sftpVerwaltung'

const Body = ZielEingabe.extend({ id: z.number().int().positive().optional() })

// Verbindung testen (ohne zu speichern). Ohne `host_key` wird nur der Fingerabdruck des Servers geholt — es werden
// keine Zugangsdaten gesendet. Mit bestätigtem `host_key` folgen Anmeldung sowie Schreib-/Lese-/Löschtest.
export default defineEventHandler(async (event) => {
  const ich = await requireAdmin(event)
  const p = Body.safeParse(await readBody(event))
  if (!p.success)
    throw fehler(
      400,
      'Bitte prüfe die Angaben (Name, Host, Port, Benutzer, Zielordner).',
      'Please check your input (name, host, port, user, target folder).'
    )
  if (limit('sftptest:' + ich.id, 20, 600))
    throw fehler(429, 'Zu viele Tests — bitte kurz warten.', 'Too many tests — please wait a moment.')
  const { id, ...d } = p.data
  const alt = id ? await zielLaden(id, true) : null
  if (id && !alt) throw fehler(404, 'Diese Speicher-Erweiterung gibt es nicht.', 'This storage add-on does not exist.')
  const r = await testen(d, alt)
  await ereignis(
    'sftp_ziel_test',
    ich.id,
    { host: d.host.slice(0, 120), port: d.port, ok: r.ok, stufe: r.stufe },
    clientIp(event)
  )
  return r
})
