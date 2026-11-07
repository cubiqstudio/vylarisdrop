import { randomBytes } from 'node:crypto'
import { q } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { zielOrt } from '../../utils/speicher'
import { dateiGroesseMax } from '../../utils/hochladen'
import { groesseText, kontingentPruefen, reserviert, zielOrdnerPruefen } from '../../utils/quota'
import { requireRecht } from '../../utils/teams'

const TEIL = 8 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  await requireRecht(u, 'hochladen')
  const b = await readBody(event)
  const name = String(b?.name || 'datei').slice(0, 200)
  const size = Number(b?.size)
  if (!Number.isSafeInteger(size) || size <= 0) throw fehler(400, 'Ungültige Dateigröße.', 'Invalid file size.')
  const optionen = typeof b?.optionen === 'object' && b.optionen ? b.optionen : {}
  const ordner = Number(optionen.ordner) > 0 ? Number(optionen.ordner) : null
  const dateiMax = await dateiGroesseMax(u)
  if (size > dateiMax)
    throw fehler(
      413,
      `Die Datei ist zu groß: erlaubt sind höchstens ${groesseText(dateiMax, false)}, die Datei hat ${groesseText(size, false)}.`,
      `The file is too large: at most ${groesseText(dateiMax, true)} are allowed, the file has ${groesseText(size, true)}.`
    )
  // Das Konto muss in den Ordner hochladen dürfen, bevor Team-Kontingentzahlen in einer Fehlermeldung erscheinen
  await zielOrdnerPruefen(u.id, ordner)
  // Frühprüfung gegen Konto- und Team-Kontingent (laufende Chunk-Uploads sind eingeplant); verbindlich prüft dateiAnlegen()
  await kontingentPruefen(u, size, { ordner, zusatz: await reserviert(u.id) })
  const offen = await q<{ n: string }>('SELECT count(*) AS n FROM uploads WHERE user_id = $1', [u.id])
  if (Number(offen[0]?.n || 0) >= 20)
    throw fehler(
      429,
      'Zu viele unvollständige Uploads. Bitte zuerst abschließen oder abbrechen.',
      'Too many unfinished uploads. Please finish or cancel them first.'
    )
  const id = randomBytes(12).toString('hex')
  const teile = Math.ceil(size / TEIL)
  await q(
    'INSERT INTO uploads (id, user_id, name, size, mime, teile, teil_groesse, optionen, speicher) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)',
    [id, u.id, name, size, String(b?.mime || '').slice(0, 120), teile, TEIL, JSON.stringify(optionen), await zielOrt()]
  )
  return { id, teilGroesse: TEIL, teile }
})
