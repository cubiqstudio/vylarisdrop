import { q, q1, ereignis } from '../../../utils/db'
import { clientIp, requireUser } from '../../../utils/auth'
import { loeschen, ortVon, schreiben } from '../../../utils/speicher'
import { ablageKontextFuer } from '../../../utils/ablageRegeln'
import { artVon, basisUrl, fuerPanel, typErkennen, type DateiZeile } from '../../../utils/dateien'
import { dateiGroesseMax, freierPlatz } from '../../../utils/hochladen'
import { quotaWarnen } from '../../../utils/benachrichtigen'
import { hatGrenze, kontingentPruefen, mitKontingentSperre } from '../../../utils/quota'
import { verarbeiten } from '../../../utils/medien'
import { variantenLoeschen } from '../../../utils/bildvarianten'

const MAX = 60 * 1024 ** 2
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = String(getRouterParam(event, 'id') || '')
  if (!/^\d{1,18}$/.test(id)) throw fehler(400, 'Ungültige ID.', 'Invalid ID.')
  const f = await q1<DateiZeile>('SELECT * FROM files WHERE id = $1 AND user_id = $2', [id, u.id])
  if (!f) throw fehler(404, 'Datei nicht gefunden.', 'File not found.')
  if (f.art !== 'bild')
    throw fehler(400, 'Nur Bilder lassen sich so ersetzen.', 'Only images can be replaced this way.')
  const frei = (await freierPlatz(u, f.folder_id)) + Number(f.size)
  // feste Grenze für Bilder, Instanz- und Rollengrenze für die Dateigröße (wie beim Hochladen) und freier Platz
  const grenze0 = Math.min(MAX, await dateiGroesseMax(u))
  let g: Awaited<ReturnType<typeof schreiben>>
  try {
    // Inhalt ersetzen bleibt am Ort der Datei (kein stilles Verschieben, Ziele können offline sein); es gelten nur Verbote
    const laenge = Number(getRequestHeader(event, 'content-length')) || null
    g = await schreiben(
      event.node.req,
      Math.min(grenze0, frei),
      ortVon(f.ablage),
      ablageKontextFuer(u, { name: f.name, mime: String(getRequestHeader(event, 'content-type') || ''), groesse: laenge, ordnerId: f.folder_id })
    )
  } catch (e: any) {
    if (e?.code === 'ZU_GROSS') {
      if (frei < grenze0) {
        // das Kontingent war die engere Grenze: freundliche Meldung mit Zahlen
        const laenge = Number(getRequestHeader(event, 'content-length')) || frei + 1
        await kontingentPruefen(u, laenge, { ordner: f.folder_id, ersetzt: Number(f.size) })
      }
      throw fehler(413, 'Das Bild ist zu groß.', 'The image is too large.')
    }
    throw e
  }
  const mime = typErkennen(g.kopf, f.name, String(getRequestHeader(event, 'content-type') || ''))
  if (artVon(mime, f.name) !== 'bild') {
    await loeschen(g.schluessel)
    throw fehler(400, 'Das ist kein Bild.', 'This is not an image.')
  }
  const ext = mime.split('/')[1]!.replace('jpeg', 'jpg')
  const name = f.name.replace(/\.[a-z0-9]{2,5}$/i, '') + '.' + ext
  // verbindliche Prüfung unter der Kontingent-Sperre: nur die Differenz zur alten Datei zählt. Die alte Größe und der alte
  // Speicherschlüssel werden erst hier gelesen (nicht schon oben), denn eine parallele Ersetzung kann sie inzwischen geändert haben.
  const grenze = await hatGrenze(u.id, f.folder_id)
  let alteAblage = f.ablage
  const setzen = async (x: (sql: string, p?: unknown[]) => Promise<any[]>) => {
    const jetzt = (await x('SELECT size FROM files WHERE id = $1', [id]))[0]
    if (!jetzt) {
      await loeschen(g.schluessel)
      throw fehler(404, 'Datei nicht gefunden.', 'File not found.')
    }
    if (grenze.begrenzt) {
      try {
        await kontingentPruefen(grenze.nutzer, g.size, { ordner: f.folder_id, ersetzt: Number(jetzt.size), x })
      } catch (e) {
        await loeschen(g.schluessel)
        throw e
      }
    }
    const r = await x(
      `UPDATE files SET ablage = $2, size = $3, sha256 = $4, mime = $5, name = $6, verarbeitung = 'offen', vorschau = false, streifen = 0, exif_entfernt = false, ansicht = false, live = false, live_mp4 = false, geaendert_at = now()
        FROM (SELECT ablage FROM files WHERE id = $1 FOR UPDATE) alt WHERE files.id = $1 RETURNING alt.ablage AS alte_ablage`,
      [id, g.schluessel, g.size, g.sha256, mime, name]
    )
    if (r[0]?.alte_ablage) alteAblage = String(r[0].alte_ablage)
  }
  if (grenze.begrenzt) await mitKontingentSperre(u.id, grenze.team, setzen)
  else await setzen((s, p = []) => q(s, p))
  await loeschen(alteAblage)
  await variantenLoeschen(f.id)
  verarbeiten(id)
  void quotaWarnen(u.id).catch(() => {})
  await ereignis('file_edited', u.id, { name }, clientIp(event))
  const neu = (await q1<DateiZeile>('SELECT * FROM files WHERE id = $1', [id]))!
  return { ok: true, file: fuerPanel(await basisUrl(event), neu) }
})
