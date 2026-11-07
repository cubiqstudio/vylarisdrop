import { z } from 'zod'
import { ereignis } from '../../../utils/db'
import { clientIp, requireAdmin } from '../../../utils/auth'
import { requirePro } from '../../../utils/lizenz'
import { ausUmgebung, getSpeicher, setSpeicher } from '../../../utils/s3'
import { zielLaden } from '../../../utils/sftpZiele'

const Mitglied = z.string().regex(/^(lokal|sftp[1-9][0-9]{0,8})$/)
const Body = z.object({
  art: z.enum(['lokal', 's3', 'sftp', 'pool']),
  ziel: z.number().int().positive().optional(),
  mitglieder: z.array(Mitglied).min(1).max(50).optional(),
  strategie: z.enum(['frei', 'abwechselnd']).optional()
})

// Speicherort für NEUE Uploads wählen: lokal, S3 oder eine aktive SFTP-Erweiterung (vorhandene Dateien bleiben liegen)
export default defineEventHandler(async (event) => {
  const ich = await requireAdmin(event)
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Bitte prüfe die Angaben.', 'Please check your input.')
  const b = p.data
  if (ausUmgebung())
    throw fehler(
      409,
      'Der Speicher ist über Umgebungsvariablen (VD_S3_*) festgelegt.',
      'Storage is set via environment variables (VD_S3_*).'
    )
  const alt = await getSpeicher()
  if (b.art === 'pool') {
    const m = b.mitglieder
    if (!m?.length) throw fehler(400, 'Bitte mindestens ein Pool-Mitglied wählen.', 'Please choose at least one pool member.')
    if (new Set(m).size !== m.length)
      throw fehler(400, 'Ein Pool-Mitglied ist doppelt gewählt.', 'A pool member is selected twice.')
    for (const x of m) {
      const id = Number(/^sftp(\d+)$/.exec(x)?.[1] || 0)
      if (id && !(await zielLaden(id, true)))
        throw fehler(404, 'Diese Speicher-Erweiterung gibt es nicht.', 'This storage add-on does not exist.')
    }
    await setSpeicher({ ...alt, art: 'pool', sftpZiel: null, mitglieder: m, strategie: b.strategie || 'frei' })
  } else if (b.art === 'sftp') {
    const z = b.ziel ? await zielLaden(b.ziel, true) : null
    if (!z) throw fehler(404, 'Diese Speicher-Erweiterung gibt es nicht.', 'This storage add-on does not exist.')
    if (!z.aktiv) throw fehler(409, 'Die Erweiterung ist deaktiviert.', 'The add-on is disabled.')
    if (!z.schreibbar) throw fehler(409, 'Die Erweiterung ist schreibgeschützt.', 'The add-on is write-protected.')
    if (z.status?.online === false)
      throw fehler(
        409,
        'Die Erweiterung ist gerade nicht erreichbar. Bitte zuerst die Verbindung prüfen.',
        'The add-on is currently unreachable. Please check the connection first.'
      )
    await setSpeicher({ ...alt, art: 'sftp', sftpZiel: z.id })
  } else if (b.art === 's3') {
    await requirePro('s3')
    if (!alt.s3?.bucket)
      throw fehler(
        400,
        'Bitte zuerst S3 einrichten (Speicher & Server).',
        'Please set up S3 first (Storage & servers).'
      )
    await setSpeicher({ ...alt, art: 's3', sftpZiel: null })
  } else {
    await setSpeicher({ ...alt, art: 'lokal', sftpZiel: null })
  }
  await ereignis('speicher_geaendert', ich.id, { art: b.art, ziel: b.ziel ?? null, mitglieder: b.mitglieder ?? null, strategie: b.strategie ?? null }, clientIp(event))
  return { ok: true }
})
