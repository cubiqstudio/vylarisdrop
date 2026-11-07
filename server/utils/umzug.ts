import { q, q1 } from './db'
import { getSetting, setSetting, st } from './settings'
import { arbeitsPfad, lesen, loeschen, nebenLesen, nebenSchreiben, ortVon, schreiben, type Ort } from './speicher'
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

export async function umzugStarten(ziel: Ort): Promise<UmzugStand> {
  if (ziel === 's3' && !(await istPro('s3')))
    throw fehler(402, st('S3-Speicher ist Teil von VylarisCloud Pro.', 'S3 storage is part of VylarisCloud Pro.'))
  const r = await q1<{ n: string; s: string }>(
    `SELECT count(*) AS n, coalesce(sum(size), 0) AS s FROM files WHERE ${ziel === 's3' ? "ablage NOT LIKE 's3:%'" : "ablage LIKE 's3:%'"}`
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
export async function umzugSteuern(aktion: 'pausieren' | 'fortsetzen' | 'verwerfen'): Promise<void> {
  const s = await umzugStand()
  if (!s) return
  if (aktion === 'verwerfen') {
    if (s.status !== 'laeuft') await setSetting('umzug', null)
    return
  }
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
      const bed = s.ziel === 's3' ? "ablage NOT LIKE 's3:%'" : "ablage LIKE 's3:%'"
      const f = await q1<{
        id: string
        ablage: string
        size: string
        name: string
        vorschau: boolean
        streifen: number
        ansicht: boolean
        live: boolean
        live_mp4: boolean
      }>(
        `SELECT id, ablage, size, name, vorschau, streifen, ansicht, live, live_mp4 FROM files WHERE ${bed} AND NOT (id = ANY($1::bigint[])) ORDER BY id LIMIT 1`,
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
      }
      const jetzt = (await getSetting<UmzugStand | null>('umzug', null, true)) || s
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
