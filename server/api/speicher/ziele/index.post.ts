import { ereignis } from '../../../utils/db'
import { clientIp, limit, requireAdmin } from '../../../utils/auth'
import { alleZiele, ZielEingabe, zielAnlegen, zielOeffentlich } from '../../../utils/sftpZiele'
import { testEingabe } from '../../../utils/sftpVerwaltung'
import { sftpTesten } from '../../../utils/sftpClient'

const MAX_ZIELE = 20

// Neue SFTP-Erweiterung anlegen: der Host-Schlüssel (Fingerabdruck) muss vorher bestätigt sein, die Verbindung wird erneut geprüft
export default defineEventHandler(async (event) => {
  const ich = await requireAdmin(event)
  const p = ZielEingabe.safeParse(await readBody(event))
  if (!p.success)
    throw fehler(
      400,
      'Bitte prüfe die Angaben (Name, Host, Port, Benutzer, Zielordner).',
      'Please check your input (name, host, port, user, target folder).'
    )
  const d = p.data
  if (!d.host_key)
    throw fehler(
      400,
      'Bitte zuerst die Verbindung testen und den Fingerabdruck des Servers bestätigen.',
      'Please test the connection first and confirm the server fingerprint.'
    )
  if (limit('sftptest:' + ich.id, 20, 600))
    throw fehler(429, 'Zu viele Tests — bitte kurz warten.', 'Too many tests — please wait a moment.')
  if ((await alleZiele(true)).length >= MAX_ZIELE)
    throw fehler(409, `Mehr als ${MAX_ZIELE} Erweiterungen sind nicht möglich.`, `More than ${MAX_ZIELE} add-ons are not possible.`)
  const t = await testEingabe(d, null)
  const test = await sftpTesten(t.eingabe)
  if (!test.ok) throw fehler(400, test.meldung)
  const z = await zielAnlegen(d, t.host, t.basis, t.geheim, {
    online: true,
    latenzMs: test.latenzMs ?? null,
    platz: test.platz ?? null,
    banner: test.banner || '',
    geprueft: new Date().toISOString()
  })
  await ereignis('sftp_ziel_angelegt', ich.id, { id: z.id, name: z.name, host: z.host, port: z.port }, clientIp(event))
  return { ok: true, ziel: zielOeffentlich(z) }
})
