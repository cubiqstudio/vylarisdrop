import { z } from 'zod'
import { ereignis } from '../../../../utils/db'
import { clientIp, limit, requireAdmin } from '../../../../utils/auth'
import {
  FINGERABDRUCK,
  verschluesseln,
  ZielEingabe,
  zielAktualisieren,
  zielBelegung,
  zielLaden,
  zielOeffentlich,
  statusSetzen
} from '../../../../utils/sftpZiele'
import { sftpTesten, poolVerwerfen } from '../../../../utils/sftpClient'
import { testEingabe } from '../../../../utils/sftpVerwaltung'

const Body = ZielEingabe.partial().extend({ host_key: z.string().trim().regex(FINGERABDRUCK).optional() })

// Erweiterung ändern. Leere Zugangsdaten behalten den gespeicherten Wert. Verbindungsrelevante Änderungen werden getestet.
export default defineEventHandler(async (event) => {
  const ich = await requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  const alt = Number.isInteger(id) ? await zielLaden(id, true) : null
  if (!alt) throw fehler(404, 'Diese Speicher-Erweiterung gibt es nicht.', 'This storage add-on does not exist.')
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Bitte prüfe die Angaben.', 'Please check your input.')
  const b = p.data
  const neu = {
    name: b.name ?? alt.name,
    host: b.host ?? alt.host,
    port: b.port ?? alt.port,
    benutzer: b.benutzer ?? alt.benutzer,
    auth: b.auth ?? alt.auth,
    passwort: b.passwort,
    schluessel: b.schluessel,
    passphrase: b.passphrase,
    basis_pfad: b.basis_pfad ?? alt.basis_pfad,
    host_key: b.host_key ?? alt.host_key,
    schreibbar: b.schreibbar ?? alt.schreibbar,
    aktiv: b.aktiv ?? alt.aktiv
  }
  const t = await testEingabe(neu, alt)
  const verbindungGeaendert =
    t.host !== alt.host ||
    neu.port !== alt.port ||
    neu.benutzer !== alt.benutzer ||
    neu.auth !== alt.auth ||
    !!neu.passwort ||
    !!neu.schluessel?.trim() ||
    !!neu.passphrase ||
    neu.host_key !== alt.host_key ||
    t.basis !== alt.basis_pfad
  if (t.basis !== alt.basis_pfad) {
    const bel = (await zielBelegung()).get(id)
    if (bel && (bel.dateien || bel.korb))
      throw fehler(
        409,
        'Der Zielordner kann nicht geändert werden, solange Dateien dort liegen. Bitte zuerst alle Dateien umziehen.',
        'The target folder cannot be changed while files are stored there. Please move all files away first.'
      )
  }
  if (verbindungGeaendert) {
    if (limit('sftptest:' + ich.id, 20, 600))
      throw fehler(429, 'Zu viele Tests — bitte kurz warten.', 'Too many tests — please wait a moment.')
    const test = await sftpTesten(t.eingabe)
    if (!test.ok) throw fehler(400, test.meldung)
  }
  const aenderungen: Record<string, unknown> = {
    name: neu.name,
    host: t.host,
    port: neu.port,
    benutzer: neu.benutzer,
    auth: neu.auth,
    host_key: neu.host_key,
    basis_pfad: t.basis,
    aktiv: neu.aktiv,
    schreibbar: neu.schreibbar
  }
  if (neu.passwort || neu.schluessel?.trim() || neu.passphrase || neu.auth !== alt.auth)
    aenderungen.geheim = await verschluesseln(t.geheim)
  await zielAktualisieren(id, aenderungen)
  poolVerwerfen(id)
  if (verbindungGeaendert) await statusSetzen(id, { online: true, hostKeyGeaendert: false }, true)
  const geaendert = Object.keys(aenderungen).filter((k) => k !== 'geheim' && (aenderungen as any)[k] !== (alt as any)[k])
  if (aenderungen.geheim) geaendert.push('zugangsdaten')
  await ereignis('sftp_ziel_geaendert', ich.id, { id, name: neu.name, felder: geaendert }, clientIp(event))
  return { ok: true, ziel: zielOeffentlich((await zielLaden(id, true))!) }
})
