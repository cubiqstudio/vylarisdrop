import yazl from 'yazl'
import type { H3Event } from 'h3'
import { q } from './db'
import type { Nutzer } from './auth'
import { dateiRecht, meineTeams, ordnerRecht } from './teams'
import { freierName } from './dateiNamen'
import { ablagenBereit, lesen, vorhanden } from './speicher'
import { gezaehlt } from './traffic'
import { unterbaum } from './cloudAktionen'
import type { DateiZeile } from './dateien'

const MAX_EINTRAEGE = 100_000

/** Ein Pfadbestandteil für das ZIP: keine Trenner, keine Steuerzeichen, nie "." oder "..". */
export function zipTeil(roh: string, ersatz: string): string {
  const n = String(roh || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 200)
  return !n || n === '.' || n === '..' ? ersatz : n
}

const LISTE = (s: unknown) =>
  [
    ...new Set(
      String(s || '')
        .split(',')
        .map((x) => x.trim())
        .filter((x) => /^\d{1,18}$/.test(x))
    )
  ].slice(0, 20_000)

interface ZipDatei {
  pfad: string
  f: DateiZeile
}

export async function zipAusliefern(event: H3Event, u: Nutzer, query: { dateien?: unknown; ordner?: unknown; name?: unknown }) {
  const dIds = LISTE(query.dateien)
  const oIds = LISTE(query.ordner).map(Number)
  if (!dIds.length && !oIds.length) throw fehler(400, 'Nichts ausgewählt.', 'Nothing selected.')
  const teamIds = (await meineTeams(u.id)).map((t) => t.team_id)

  const dateien: ZipDatei[] = []
  let ersterOrdner = ''
  const leereOrdner: string[] = []
  // Namen je Verzeichnis eindeutig machen (ohne Groß-/Kleinschreibung), wie es Entpacker auf Windows/macOS brauchen
  const belegt = new Map<string, Set<string>>()
  const vergeben = (verz: string, name: string, art: 'datei' | 'ordner') => {
    let s = belegt.get(verz)
    if (!s) belegt.set(verz, (s = new Set()))
    const n = freierName(name, art, s)
    s.add(n.toLowerCase())
    return n
  }

  for (const id of dIds) {
    const f = await dateiRecht<DateiZeile>(u.id, id, 'lesen')
    if (!f) throw fehler(404, 'Datei nicht gefunden.', 'File not found.')
    if (f.scan === 'fund') continue
    dateien.push({ pfad: vergeben('', zipTeil(f.name, 'datei'), 'datei'), f })
  }

  if (oIds.length) {
    for (const id of oIds) if (!(await ordnerRecht(u.id, id))) throw fehler(404, 'Ordner nicht gefunden.', 'Folder not found.')
    const baum = await unterbaum(oIds)
    const ordnerIds = [...new Set(baum.map((o) => o.id))]
    const dateienAlle = await q<DateiZeile & { team: number | null }>(
      `SELECT f.*, o.team_id AS team FROM files f JOIN folders o ON o.id = f.folder_id
      WHERE f.folder_id = ANY($1::int[]) AND (f.user_id = $2 OR o.team_id = ANY($3::int[])) AND f.scan <> 'fund' ORDER BY f.id`,
      [ordnerIds, u.id, teamIds]
    )
    if (baum.length + dateienAlle.length + dateien.length > MAX_EINTRAEGE)
      throw fehler(400, 'Zu viele Einträge für ein ZIP.', 'Too many entries for one ZIP.')
    for (const wurzel of oIds) {
      const teil = baum.filter((o) => o.wurzel === wurzel)
      const start = teil.find((o) => o.id === wurzel)!
      const pfade = new Map<number, string>()
      pfade.set(wurzel, vergeben('', zipTeil(start.name, 'ordner'), 'ordner'))
      ersterOrdner ||= pfade.get(wurzel)!
      let offen = teil.filter((o) => o.id !== wurzel)
      while (offen.length) {
        const bereit = offen.filter((o) => o.parent_id != null && pfade.has(o.parent_id))
        if (!bereit.length) break
        for (const o of bereit) {
          const eltern = pfade.get(o.parent_id!)!
          pfade.set(o.id, eltern + '/' + vergeben(eltern, zipTeil(o.name, 'ordner'), 'ordner'))
        }
        offen = offen.filter((o) => !pfade.has(o.id))
      }
      const mitDatei = new Set<number>()
      for (const f of dateienAlle) {
        const verz = f.folder_id != null ? pfade.get(f.folder_id) : undefined
        if (verz == null) continue
        mitDatei.add(f.folder_id!)
        dateien.push({ pfad: verz + '/' + vergeben(verz, zipTeil(f.name, 'datei'), 'datei'), f })
      }
      const mitKind = new Set(teil.map((o) => o.parent_id))
      for (const [oid, pfad] of pfade) if (!mitDatei.has(oid) && !mitKind.has(oid)) leereOrdner.push(pfad)
    }
  }

  // Speicherort nicht erreichbar (SFTP offline, Host-Schlüssel): sauberes 503/502 statt eines ZIP mit „Dateien fehlen“
  await ablagenBereit(dateien.map((d) => d.f.ablage))

  const einzigerOrdner = !dIds.length && oIds.length === 1
  let titel = String(query.name || '').trim()
  if (!titel) {
    if (einzigerOrdner) titel = ersterOrdner || 'Ordner'
    else titel = 'VylarisCloud'
  }
  titel = zipTeil(titel.replace(/\.zip$/i, ''), 'VylarisCloud').slice(0, 100)
  const ascii = titel.replace(/[^\x20-\x7e]+/g, '_').replace(/["\\]/g, '_') || 'download'
  setResponseHeaders(event, {
    'Content-Type': 'application/zip',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `attachment; filename="${ascii}.zip"; filename*=UTF-8''${encodeURIComponent(titel).replace(/['()]/g, escape)}.zip`
  })

  const zip = new yazl.ZipFile()
  let abgebrochen = false
  event.node.res.on('close', () => {
    abgebrochen = true;
    (zip.outputStream as any).destroy()
  })
  void (async () => {
    const fehlen: string[] = []
    try {
      for (const o of leereOrdner) zip.addEmptyDirectory(o)
      for (const { pfad, f } of dateien) {
        if (abgebrochen) return
        if (!(await vorhanden(f.ablage))) {
          fehlen.push(pfad)
          continue
        }
        const strom = await gezaehlt(lesen(f.ablage), f.user_id, f.id)
        const schon = ['bild', 'video', 'audio'].includes(f.art) || /zip|gzip|rar|7z|compressed/.test(f.mime)
        const fertig = new Promise<void>((res, rej) => {
          strom.once('end', () => res())
          strom.once('close', () => res())
          strom.once('error', rej)
        })
        zip.addReadStream(strom, pfad, {
          mtime: new Date((f as any).geaendert_at || f.created_at),
          compress: !schon
        })
        await fertig
      }
      if (fehlen.length)
        zip.addBuffer(
          Buffer.from(`Diese Dateien fehlen im Speicher und konnten nicht aufgenommen werden:\n${fehlen.join('\n')}\n`),
          '_fehlende-dateien.txt'
        )
      zip.end()
    } catch (e) {
      (zip.outputStream as any).destroy(e as Error)
    }
  })()
  return sendStream(event, zip.outputStream as any)
}
