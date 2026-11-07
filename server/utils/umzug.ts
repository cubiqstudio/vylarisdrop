import { q, q1 } from './db'
import { getSetting, setSetting, st } from './settings'
import { createHash } from 'node:crypto'
import {
  arbeitsPfad,
  lesen,
  loeschen,
  nebenLesen,
  nebenSchreiben,
  ortVon,
  schreiben,
  sftpId,
  type Ort
} from './speicher'
import { zielLaden } from './sftpZiele'
import { arbeitBeginnt, arbeitEndet, melde, mitSperre, NUR_WEB } from './knoten'
import { istPro } from './lizenz'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'

export interface UmzugStand {
  ziel: Ort
  status: 'laeuft' | 'pausiert' | 'fertig' | 'fehler'
  gesamt: number
  erledigt: number
  fehler: number
  bytes: number
  gestartet: string
  fertig: string | null
  meldung: string
  letzte: Array<{ ok: boolean; t: string }>
}
export const umzugStand = () => getSetting<UmzugStand | null>('umzug', null)

/** SQL-Bedingung: Dateien, die noch NICHT am Zielort liegen (Ziel kommt nur aus ortGueltig/sftpId, nie aus Nutzereingaben). */
export function nichtAmOrt(ziel: Ort): string {
  if (ziel === 's3') return "ablage NOT LIKE 's3:%'"
  const sid = sftpId(ziel)
  if (sid != null) return `ablage NOT LIKE 'sftp${sid}:%'`
  return "ablage ~ '^(s3|sftp[0-9]+):'"
}

export async function umzugStarten(ziel: Ort): Promise<UmzugStand> {
  if (ziel === 's3' && !(await istPro('s3')))
    throw fehler(402, st('S3-Speicher ist Teil von VylarisCloud Pro.', 'S3 storage is part of VylarisCloud Pro.'))
  const sid = sftpId(ziel)
  if (sid != null) {
    const z = await zielLaden(sid, true)
    if (!z) throw fehler(404, 'Diese Speicher-Erweiterung gibt es nicht.', 'This storage add-on does not exist.')
    if (!z.aktiv || !z.schreibbar)
      throw fehler(
        409,
        'Die Speicher-Erweiterung ist deaktiviert oder schreibgeschützt.',
        'The storage add-on is disabled or write-protected.'
      )
  }
  const r = await q1<{ n: string; s: string }>(
    `SELECT count(*) AS n, coalesce(sum(size), 0) AS s FROM files WHERE ${nichtAmOrt(ziel)}`
  )
  const neu: UmzugStand = {
    ziel,
    status: 'laeuft',
    gesamt: Number(r?.n || 0),
    erledigt: 0,
    fehler: 0,
    bytes: 0,
    gestartet: new Date().toISOString(),
    fertig: null,
    meldung: '',
    letzte: []
  }
  await setSetting('umzug', neu)
  void umzugNachholen()
  void melde('vd_arbeit', 'umzug')
  return neu
}
export async function umzugSteuern(aktion: 'pausieren' | 'fortsetzen' | 'verwerfen' | 'abbrechen'): Promise<void> {
  const s = await umzugStand()
  if (!s) return
  if (aktion === 'verwerfen') {
    if (s.status !== 'laeuft') await setSetting('umzug', null)
    return
  }
  if (aktion === 'abbrechen') {
    // Die gerade kopierte Datei wird noch sauber fertiggestellt, danach hört der Umzug auf.
    await setSetting('umzug', null)
    return
  }
  // nur sinnvolle Übergänge: pausieren während es läuft, fortsetzen nach Pause/Fehler (ein fertiger Umzug bleibt fertig)
  if (aktion === 'pausieren' && s.status !== 'laeuft') return
  if (aktion === 'fortsetzen' && s.status !== 'pausiert' && s.status !== 'fehler') return
  await setSetting('umzug', { ...s, status: aktion === 'pausieren' ? 'pausiert' : 'laeuft', meldung: '' })
  if (aktion === 'fortsetzen') {
    void umzugNachholen()
    void melde('vd_arbeit', 'umzug')
  }
}

export async function umzugNachholen(): Promise<void> {
  if (NUR_WEB) return
  const s = await umzugStand()
  if (!s || s.status !== 'laeuft') return
  await mitSperre('umzug', () => umzugLauf())
}

async function umzugLauf(): Promise<void> {
  arbeitBeginnt('umzug')
  const versucht = new Set<string>()
  try {
    for (;;) {
      const s = await getSetting<UmzugStand | null>('umzug', null, true)
      if (!s || s.status !== 'laeuft') return
      const bed = nichtAmOrt(s.ziel)
      const f = await q1<{
        id: string
        ablage: string
        size: string
        name: string
        sha256: string
        vorschau: boolean
        streifen: number
        ansicht: boolean
        live: boolean
        live_mp4: boolean
      }>(
        `SELECT id, ablage, size, name, sha256, vorschau, streifen, ansicht, live, live_mp4 FROM files WHERE ${bed} AND NOT (id = ANY($1::bigint[])) ORDER BY id LIMIT 1`,
        [[...versucht]]
      )
      if (!f) {
        await setSetting('umzug', { ...s, status: 'fertig', fertig: new Date().toISOString(), meldung: '' })
        return
      }
      versucht.add(f.id)
      let ok = true,
        text = ''
      try {
        await eineVerschieben(f, s.ziel)
      } catch (e: any) {
        ok = false
        text = String(e?.message || e).slice(0, 200)
        // Ziel/Quelle nicht erreichbar: nicht jede Datei einzeln scheitern lassen, sondern anhalten
        if (['OFFLINE', 'TIMEOUT', 'HOSTKEY', 'AUTH', 'DEAKTIVIERT', 'GELOESCHT', 'SCHREIBGESCHUETZT'].includes(e?.sftpCode || e?.code)) {
          const aktuell = await getSetting<UmzugStand | null>('umzug', null, true)
          if (aktuell) await setSetting('umzug', { ...aktuell, status: 'fehler', meldung: text })
          return
        }
      }
      const jetzt = await getSetting<UmzugStand | null>('umzug', null, true)
      if (!jetzt) return // zwischenzeitlich abgebrochen
      const zeile = ok ? f.name : `${f.name} — ${text}`
      await setSetting('umzug', {
        ...jetzt,
        erledigt: jetzt.erledigt + (ok ? 1 : 0),
        fehler: jetzt.fehler + (ok ? 0 : 1),
        bytes: jetzt.bytes + (ok ? Number(f.size) : 0),
        letzte: [{ ok, t: zeile.slice(0, 160) }, ...jetzt.letzte].slice(0, 12)
      })
    }
  } catch (e: any) {
    const s = await umzugStand()
    if (s) await setSetting('umzug', { ...s, status: 'fehler', meldung: String(e?.message || e).slice(0, 300) })
  } finally {
    arbeitEndet('umzug')
  }
}

export async function eineVerschieben(
  f: {
    id: string
    ablage: string
    size: string
    vorschau: boolean
    streifen: number
    sha256?: string
    ansicht?: boolean
    live?: boolean
    live_mp4?: boolean
  },
  ziel: Ort
): Promise<void> {
  if (ortVon(f.ablage) === ziel) return
  const g = await schreiben(lesen(f.ablage), 0, ziel)
  if (g.size !== Number(f.size)) {
    await loeschen(g.schluessel)
    throw new Error(st('Größe stimmt nach dem Kopieren nicht', 'Size mismatch after copying'))
  }
  // Prüfsumme: Die Quelle muss zur gespeicherten Prüfsumme passen ...
  if (f.sha256 && g.sha256 !== f.sha256) {
    await loeschen(g.schluessel)
    throw new Error(st('Prüfsumme der Quelle stimmt nicht — Datei bleibt unverändert', 'Source checksum mismatch — file left unchanged'))
  }
  // ... und die Kopie auf einer SFTP-Erweiterung wird zurückgelesen und gegengeprüft, bevor die Quelle gelöscht wird.
  if (sftpId(ziel) != null) {
    const h = createHash('sha256')
    let n = 0
    try {
      for await (const c of lesen(g.schluessel)) {
        h.update(c as Buffer)
        n += (c as Buffer).length
      }
    } catch (e) {
      await loeschen(g.schluessel)
      throw e
    }
    if (n !== g.size || h.digest('hex') !== g.sha256) {
      await loeschen(g.schluessel)
      throw new Error(st('Kopie stimmt nicht mit dem Original überein (Prüfsumme)', 'Copy does not match the original (checksum)'))
    }
  }
  const da = {
    vorschau: f.vorschau,
    streifen: !!f.streifen,
    ansicht: !!f.ansicht,
    live: !!f.live,
    livemp4: !!f.live_mp4
  }
  for (const art of ['vorschau', 'streifen', 'ansicht', 'live', 'livemp4'] as const) {
    if (!da[art]) continue
    const n = await nebenLesen(f.ablage, art).catch(() => null)
    if (!n) {
      if (art === 'live') {
        await loeschen(g.schluessel)
        throw new Error(st('Live-Video fehlt', 'Live video missing'))
      }
      continue
    }
    const tmp = await arbeitsPfad()
    await pipeline(n.strom, createWriteStream(tmp))
    await nebenSchreiben(g.schluessel, art, tmp)
  }
  const r = await q('UPDATE files SET ablage = $2 WHERE id = $1 AND ablage = $3 RETURNING id', [
    f.id,
    g.schluessel,
    f.ablage
  ])
  if (!r.length) {
    await loeschen(g.schluessel)
    return
  }
  await loeschen(f.ablage)
}
