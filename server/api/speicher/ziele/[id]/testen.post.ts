import { ereignis } from '../../../../utils/db'
import { clientIp, limit, requireAdmin } from '../../../../utils/auth'
import { entschluesseln, zielLaden } from '../../../../utils/sftpZiele'
import { sftpTesten } from '../../../../utils/sftpClient'
import { statusAusTest } from '../../../../utils/sftpVerwaltung'

// Gespeicherte Erweiterung testen (mit dem gepinnten Host-Schlüssel) und die Statusanzeige aktualisieren
export default defineEventHandler(async (event) => {
  const ich = await requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  const z = Number.isInteger(id) ? await zielLaden(id, true) : null
  if (!z) throw fehler(404, 'Diese Speicher-Erweiterung gibt es nicht.', 'This storage add-on does not exist.')
  if (limit('sftptest:' + ich.id, 20, 600))
    throw fehler(429, 'Zu viele Tests — bitte kurz warten.', 'Too many tests — please wait a moment.')
  const r = await sftpTesten({
    host: z.host,
    port: z.port,
    benutzer: z.benutzer,
    geheim: await entschluesseln(z.geheim, z.name),
    name: z.name,
    basis: z.basis_pfad,
    pin: z.host_key,
    schreibbar: z.schreibbar
  })
  await statusAusTest(z.id, r)
  await ereignis('sftp_ziel_test', ich.id, { id: z.id, name: z.name, ok: r.ok, stufe: r.stufe }, clientIp(event))
  return r
})
