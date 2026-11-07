import { createWriteStream, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { requireUser } from '../../../utils/auth'
import { q1 } from '../../../utils/db'
import { importAblage, meinImport } from '../../../utils/importKern'
import { meinOrdner } from '../../../utils/knoten'

const TEIL = 8 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const imp = await meinImport(event, u)
  if (imp.status !== 'entwurf')
    throw fehler(
      409,
      'Dateien lassen sich nur vor der Analyse hinzufügen.',
      'Files can only be added before the analysis.'
    )
  if (imp.weg !== 'datei')
    throw fehler(400, 'Dieser Import liest keine hochgeladenen Dateien.', 'This import does not read uploaded files.')
  const qy = getQuery(event)
  const name = String(qy.name || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 150)
  const nr = Number(qy.nr),
    teile = Number(qy.teile)
  if (
    !name ||
    !Number.isSafeInteger(nr) ||
    !Number.isSafeInteger(teile) ||
    nr < 0 ||
    teile < 1 ||
    nr >= teile ||
    teile > 20_000
  )
    throw fehler(400, 'Ungültige Angaben zum Hochladen.', 'Invalid upload details.')
  const hier = await q1(
    `UPDATE importe SET daten_ordner = coalesce(daten_ordner, $2) WHERE id = $1 AND (daten_ordner IS NULL OR daten_ordner = $2) RETURNING id`,
    [imp.id, meinOrdner()]
  )
  if (!hier)
    throw fehler(
      409,
      'Dieser Import liegt auf einem anderen Server. Bitte im Lastverteiler die Sitzungsbindung (Sticky Sessions) einschalten oder einen gemeinsamen Datenordner nutzen.',
      'This import lives on another server. Please enable sticky sessions in the load balancer or use a shared data folder.'
    )
  const ordner = importAblage(imp.id)
  await fs.mkdir(ordner, { recursive: true })
  const dateien = (await fs.readdir(ordner)).filter((n) => !n.endsWith('.rdteil'))
  if (nr === 0 && dateien.length >= 40)
    throw fehler(400, 'Höchstens 40 Dateien je Import.', 'At most 40 files per import.')
  const teil = join(ordner, name + '.rdteil')
  const start = nr * TEIL
  const groesse = nr === 0 ? 0 : ((await fs.stat(teil).catch(() => null))?.size ?? -1)
  if (groesse !== start) {
    setResponseStatus(event, 409)
    return { ok: false, weiterAb: groesse < 0 ? 0 : Math.floor(groesse / TEIL) }
  }
  let n = 0
  const zaehler = new Transform({
    transform(c: Buffer, _e, cb) {
      n += c.length
      if (n > TEIL) return cb(new Error('Stück zu groß'))
      cb(null, c)
    }
  })
  try {
    await pipeline(event.node.req, zaehler, createWriteStream(teil, { flags: nr === 0 ? 'w' : 'r+', start }))
  } catch (e: any) {
    throw fehler(400, `Hochladen unterbrochen: ${e.message}`, `Upload interrupted: ${e.message}`)
  }
  if (nr < teile - 1 && n !== TEIL)
    throw fehler(400, 'Unvollständiges Stück — bitte erneut senden.', 'Incomplete chunk — please send it again.')
  if (nr === teile - 1) {
    await fs.rename(teil, join(ordner, name))
    return { ok: true, fertig: true }
  }
  return { ok: true, fertig: false }
})
