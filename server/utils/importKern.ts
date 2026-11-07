import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import { q, q1, ereignis } from './db'
import { arbeitBeginnt, arbeitEndet, KNOTEN_ID, meinOrdner, melde, NUR_WEB } from './knoten'
import { hashPw, type Nutzer } from './auth'
import { arbeitsPfad, datenordner, loeschen, nebenSchreiben, schreiben } from './speicher'
import { dateiAnlegen } from './dateien'
import { freierPlatz } from './hochladen'
import { sLang } from './settings'
import { APPLE_DATEI_HOST, icloudUrl, type IcloudQuelle } from './icloud'

export type ImportQuelle =
  'zipline' | 'xbackbone' | 'chibisafe' | 'sharex' | 'imgur' | 'takeout' | 'icloud' | 'tinyfilemanager' | 'ordner'
export type ImportWeg = 'live' | 'datei' | 'ordner' | 'konto'
export const QUELLEN: ImportQuelle[] = [
  'zipline',
  'xbackbone',
  'chibisafe',
  'sharex',
  'imgur',
  'takeout',
  'icloud',
  'tinyfilemanager',
  'ordner'
]
export const WEGE: Record<ImportQuelle, ImportWeg[]> = {
  zipline: ['live', 'datei', 'ordner'],
  xbackbone: ['ordner'],
  chibisafe: ['live', 'ordner'],
  sharex: ['datei', 'ordner'],
  imgur: ['live'],
  takeout: ['datei', 'ordner'],
  icloud: ['datei', 'live', 'konto', 'ordner'],
  tinyfilemanager: ['ordner', 'datei'],
  ordner: ['datei', 'ordner']
}

export type PostenQuelle =
  | { art: 'url'; url: string; mitZugang?: boolean }
  | { art: 'datei'; pfad: string }
  | { art: 'zip'; zip: string; eintrag: string }
  | IcloudQuelle

export interface ImportPosten {
  schluessel: string
  name: string
  quelle: PostenQuelle
  mime?: string
  groesse?: number
  slug?: string
  erstellt?: string | null
  ablauf?: string | null
  maxAufrufe?: number | null
  aufrufe?: number
  favorit?: boolean
  passwortHash?: string
  besitzer?: string
  ordner?: string[]
  tags?: string[]
  altePfade?: Array<{ pfad: string; ziel: 'seite' | 'direkt' | 'download' | 'raw' }>
  live?: PostenQuelle
}
export interface ImportNutzer {
  schluessel: string
  username: string
  email?: string
  passwortHash?: string
  admin?: boolean
  quotaBytes?: number | null
}
export interface ImportAnalyse {
  titel: string
  nutzer: ImportNutzer[]
  posten: ImportPosten[]
  hinweise: string[]
}
export interface ImportOptionen {
  konten: boolean
  linknamen: boolean
  weiterleiten: boolean
  grenzen: boolean
  aufrufe: boolean
  ordnerName: string
  zielNutzer: number
}
export interface ImportZeile {
  id: number
  user_id: number
  quelle: ImportQuelle
  weg: ImportWeg
  titel: string
  status: string
  optionen: ImportOptionen
  zugang: Record<string, any>
  plan: Record<string, any>
  gesamt: number
  erledigt: number
  fehlgeschlagen: number
  uebersprungen: number
  bytes: string
  bytes_gesamt: string
  protokoll: ProtokollZeile[]
  meldung: string
  created_at: string
  gestartet_at: string | null
  fertig_at: string | null
  knoten: string | null
  lease_bis: string | null
  daten_ordner: string | null
}
export interface ProtokollZeile {
  z: number
  t: string
  a: 'ok' | 'fehler' | 'info' | 'weg'
}

export const importWurzel = () =>
  resolve(process.env.VD_IMPORT_DIR || (process.platform === 'win32' ? join(process.cwd(), 'import') : '/import'))
export const importAblage = (id: number) => join(datenordner(), 'import', String(Math.floor(id)))

export async function innerhalb(wurzel: string, rel: string): Promise<string> {
  const ziel = resolve(
    wurzel,
    '.' +
      sep +
      String(rel || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
  )
  const echt = await fs.realpath(ziel).catch(() => ziel)
  const echteWurzel = await fs.realpath(wurzel).catch(() => wurzel)
  if (echt !== echteWurzel && !echt.startsWith(echteWurzel + sep))
    throw fehler(400, 'Dieser Pfad liegt außerhalb des Import-Ordners.', 'This path is outside the import folder.')
  return echt
}

export const ladeImport = (id: number) => q1<ImportZeile>('SELECT * FROM importe WHERE id = $1', [id])

export async function importMelden(id: number, text: string): Promise<void> {
  await q('UPDATE importe SET meldung = $2 WHERE id = $1', [id, text.slice(0, 300)])
}
async function protokollieren(id: number, zeilen: ProtokollZeile[]): Promise<void> {
  if (!zeilen.length) return
  await q(
    `UPDATE importe SET protokoll = (SELECT coalesce(jsonb_agg(x ORDER BY n), '[]') FROM (
      SELECT x, n FROM jsonb_array_elements(protokoll || $2::jsonb) WITH ORDINALITY AS t(x, n) ORDER BY n DESC LIMIT 80) s) WHERE id = $1`,
    [id, JSON.stringify(zeilen)]
  )
}

export async function analyseSpeichern(id: number, a: ImportAnalyse): Promise<void> {
  await q('DELETE FROM import_posten WHERE import_id = $1', [id])
  for (let i = 0; i < a.posten.length; i += 500) {
    const block = a.posten.slice(i, i + 500)
    await q(
      `INSERT INTO import_posten (import_id, schluessel, daten)
      SELECT $1, x->>'schluessel', x FROM jsonb_array_elements($2::jsonb) x ON CONFLICT (import_id, schluessel) DO NOTHING`,
      [id, JSON.stringify(block)]
    )
  }
  const ordner = new Set<string>()
  const tags = new Set<string>()
  const jeNutzer = new Map<string, { anzahl: number; bytes: number }>()
  let bytes = 0
  for (const p of a.posten) {
    bytes += p.groesse || 0
    if (p.ordner?.length)
      for (let k = 1; k <= p.ordner.length; k++) ordner.add((p.besitzer || '') + '/' + p.ordner.slice(0, k).join('/'))
    for (const t of p.tags || []) tags.add(t.toLowerCase())
    const n = jeNutzer.get(p.besitzer || '') || { anzahl: 0, bytes: 0 }
    n.anzahl++
    n.bytes += p.groesse || 0
    jeNutzer.set(p.besitzer || '', n)
  }
  const vorhanden = new Set(
    (
      await q<{ n: string }>('SELECT lower(username) AS n FROM users WHERE lower(username) = ANY($1)', [
        a.nutzer.map((u) => kontoName(u.username).toLowerCase())
      ])
    ).map((r) => r.n)
  )
  const plan = {
    dateien: a.posten.length,
    bytes,
    ordner: ordner.size,
    tags: tags.size,
    weiterleitungen: a.posten.reduce((s, p) => s + (p.altePfade?.length || 0), 0),
    mitLinkname: a.posten.filter((p) => p.slug).length,
    mitPasswort: a.posten.filter((p) => p.passwortHash).length,
    mitAblauf: a.posten.filter((p) => p.ablauf).length,
    nutzer: a.nutzer.map((u) => ({
      schluessel: u.schluessel,
      username: kontoName(u.username),
      admin: !!u.admin,
      passwort: !!u.passwortHash,
      vorhanden: vorhanden.has(kontoName(u.username).toLowerCase()),
      ...(jeNutzer.get(u.schluessel) || { anzahl: 0, bytes: 0 })
    })),
    hinweise: a.hinweise.slice(0, 20),
    beispiele: a.posten.slice(0, 8).map((p) => ({ name: p.name, groesse: p.groesse || 0, slug: p.slug || '' })),
    zuordnung: {} as Record<string, number>
  }
  await q(
    `UPDATE importe SET status = 'bereit', titel = $2, plan = $3::jsonb, gesamt = $4, bytes_gesamt = $5, meldung = '',
      erledigt = 0, fehlgeschlagen = 0, uebersprungen = 0, bytes = 0, zugang = jsonb_set(zugang, '{nutzer}', $6::jsonb) WHERE id = $1`,
    [id, a.titel.slice(0, 120), JSON.stringify(plan), a.posten.length, bytes, JSON.stringify(a.nutzer)]
  )
}

const laufend = new Map<number, { stop: boolean }>()
export const laeuftGerade = (imp: Pick<ImportZeile, 'lease_bis'>) =>
  !!imp.lease_bis && new Date(imp.lease_bis).getTime() > Date.now()

async function leaseHolen(id: number, status: 'laeuft' | 'analyse', minuten: number): Promise<boolean> {
  const r = await q1(
    `UPDATE importe SET knoten = $2, lease_bis = now() + ($4 || ' minutes')::interval,
      daten_ordner = CASE WHEN weg IN ('datei', 'ordner') THEN coalesce(daten_ordner, $3) ELSE daten_ordner END
    WHERE id = $1 AND status = $5 AND (knoten IS NULL OR knoten = $2 OR lease_bis IS NULL OR lease_bis < now()
      OR knoten NOT IN (SELECT id FROM knoten WHERE zuletzt_at > now() - interval '60 seconds'))
      AND (weg NOT IN ('datei', 'ordner') OR daten_ordner IS NULL OR daten_ordner = $3) RETURNING id`,
    [id, KNOTEN_ID, meinOrdner(), String(minuten), status]
  )
  return !!r
}
const leaseFrei = (id: number) =>
  q(`UPDATE importe SET knoten = NULL, lease_bis = NULL WHERE id = $1 AND knoten = $2`, [id, KNOTEN_ID]).catch(() => {})

export function importAnstossen(id: number): void {
  if (laufend.has(id) || NUR_WEB) {
    if (NUR_WEB) void melde('vd_arbeit', 'import')
    return
  }
  const steuerung = { stop: false }
  laufend.set(id, steuerung)
  ;(async () => {
    if (!(await leaseHolen(id, 'laeuft', 2))) {
      void melde('vd_arbeit', 'import')
      return
    }
    arbeitBeginnt('importe')
    const verlaengern = setInterval(() => {
      q(`UPDATE importe SET lease_bis = now() + interval '2 minutes' WHERE id = $1 AND knoten = $2 RETURNING id`, [
        id,
        KNOTEN_ID
      ])
        .then((r) => {
          if (!r.length) steuerung.stop = true
        })
        .catch(() => {})
    }, 30_000)
    try {
      await lauf(id, steuerung)
    } finally {
      clearInterval(verlaengern)
      await leaseFrei(id)
      arbeitEndet('importe')
    }
  })()
    .catch(async (e) => {
      console.error(`[vylariscloud] Import ${id}:`, e?.message)
      await q(`UPDATE importe SET status = 'fehler', meldung = $2 WHERE id = $1`, [
        id,
        String(e?.message || e).slice(0, 300)
      ]).catch(() => {})
    })
    .finally(() => laufend.delete(id))
}

export function analyseAnstossen(id: number, analysieren: (id: number) => Promise<void>): void {
  if (NUR_WEB) {
    void melde('vd_arbeit', 'import')
    return
  }
  ;(async () => {
    if (!(await leaseHolen(id, 'analyse', 5))) {
      void melde('vd_arbeit', 'import')
      return
    }
    const verlaengern = setInterval(() => {
      q(`UPDATE importe SET lease_bis = now() + interval '5 minutes' WHERE id = $1 AND knoten = $2`, [
        id,
        KNOTEN_ID
      ]).catch(() => {})
    }, 60_000)
    try {
      await analysieren(id)
    } finally {
      clearInterval(verlaengern)
      await leaseFrei(id)
    }
  })().catch((e) => console.error('[vylariscloud] Import-Analyse:', e?.message))
}

export async function importeNachholen(analysieren?: (id: number) => Promise<void>): Promise<void> {
  if (NUR_WEB) return
  await q(
    `UPDATE importe SET status = 'entwurf', knoten = NULL, lease_bis = NULL, meldung = $1 WHERE status = 'analyse' AND knoten IS NOT NULL AND knoten <> $2 AND (lease_bis < now()
      OR knoten NOT IN (SELECT id FROM knoten WHERE zuletzt_at > now() - interval '60 seconds'))`,
    [
      sLang() === 'en'
        ? 'The analysis was interrupted by a restart — please start it again.'
        : 'Die Analyse wurde durch einen Neustart unterbrochen — bitte erneut starten.',
      KNOTEN_ID
    ]
  )
  if (analysieren)
    for (const r of await q<{ id: number }>(
      `SELECT id FROM importe WHERE status = 'analyse' AND knoten IS NULL ORDER BY id`
    ))
      analyseAnstossen(r.id, analysieren)
  for (const r of await q<{
    id: number
  }>(`SELECT id FROM importe WHERE status = 'laeuft' AND (knoten IS NULL OR lease_bis IS NULL OR lease_bis < now()
      OR knoten NOT IN (SELECT id FROM knoten WHERE zuletzt_at > now() - interval '60 seconds')) ORDER BY id`))
    importAnstossen(r.id)
}

interface Kontext {
  imp: ImportZeile
  admin: boolean
  nutzer: Map<string, Nutzer>
  ziel: Nutzer
  ordner: Map<string, Promise<number | null>>
  tags: Map<string, Promise<number>>
  zips: Map<string, Promise<ZipArchiv>>
}

async function lauf(id: number, steuerung: { stop: boolean }): Promise<void> {
  let imp = await ladeImport(id)
  if (!imp || imp.status !== 'laeuft') return
  const starter = await q1<Nutzer>('SELECT id, username, email, role, quota_bytes, prefs FROM users WHERE id = $1', [
    imp.user_id
  ])
  if (!starter) throw new Error('Das Konto, das den Import gestartet hat, gibt es nicht mehr.')
  const ziel =
    (await q1<Nutzer>('SELECT id, username, email, role, quota_bytes, prefs FROM users WHERE id = $1', [
      imp.optionen.zielNutzer || starter.id
    ])) || starter
  const k: Kontext = {
    imp,
    admin: starter.role !== 'user',
    nutzer: new Map(),
    ziel,
    ordner: new Map(),
    tags: new Map(),
    zips: new Map()
  }
  await kontenZuordnen(k, starter)
  await q(
    `UPDATE importe i SET erledigt = s.ok, fehlgeschlagen = s.fehler, uebersprungen = s.weg, bytes = s.bytes FROM (
      SELECT count(*) FILTER (WHERE p.status = 'ok') AS ok, count(*) FILTER (WHERE p.status = 'fehler') AS fehler, count(*) FILTER (WHERE p.status = 'uebersprungen') AS weg,
        coalesce(sum(f.size) FILTER (WHERE p.status = 'ok'), 0) AS bytes
      FROM import_posten p LEFT JOIN files f ON f.id = p.file_id WHERE p.import_id = $1) s WHERE i.id = $1`,
    [id]
  )
  await protokollieren(id, [
    { z: Date.now(), t: sLang() === 'en' ? 'Transfer started' : 'Übertragung gestartet', a: 'info' }
  ])

  try {
    for (;;) {
      if (steuerung.stop) break
      const st = await q1<{ status: string; knoten: string | null }>(
        'SELECT status, knoten FROM importe WHERE id = $1',
        [id]
      )
      if (st?.status !== 'laeuft' || st.knoten !== KNOTEN_ID) break
      const block = await q<{ id: string; daten: ImportPosten }>(
        `SELECT id, daten FROM import_posten WHERE import_id = $1 AND status = 'offen' ORDER BY id LIMIT 12`,
        [id]
      )
      if (!block.length) {
        const r = await q1<ImportZeile>(
          `UPDATE importe SET status = 'fertig', fertig_at = now(), zugang = CASE WHEN fehlgeschlagen = 0 THEN '{}'::jsonb ELSE zugang END WHERE id = $1 AND status = 'laeuft' RETURNING *`,
          [id]
        )
        if (r) {
          await protokollieren(id, [
            {
              z: Date.now(),
              t: sLang() === 'en' ? `Done — ${r.erledigt} files imported` : `Fertig — ${r.erledigt} Dateien übernommen`,
              a: 'info'
            }
          ])
          await ereignis('import_fertig', imp.user_id, {
            quelle: imp.quelle,
            erledigt: r.erledigt,
            fehler: r.fehlgeschlagen
          })
          if (!r.fehlgeschlagen) await fs.rm(importAblage(id), { recursive: true, force: true }).catch(() => {})
        }
        break
      }
      await parallel(block, 3, async (p) => {
        if (
          steuerung.stop ||
          (await q1<{ status: string }>('SELECT status FROM importe WHERE id = $1', [id]))?.status !== 'laeuft'
        )
          return
        const r = await einePosition(k, p.daten).catch((e: any) => ({
          status: 'fehler' as const,
          meldung: fehlerText(e),
          bytes: 0,
          fileId: null
        }))
        const buchen = (meldung: string) =>
          q(
            `WITH p AS (UPDATE import_posten SET status = $2, meldung = $3, file_id = $4 WHERE id = $1 AND status = 'offen' RETURNING status)
          UPDATE importe SET erledigt = erledigt + (SELECT count(*) FROM p WHERE status = 'ok'), fehlgeschlagen = fehlgeschlagen + (SELECT count(*) FROM p WHERE status = 'fehler'),
            uebersprungen = uebersprungen + (SELECT count(*) FROM p WHERE status = 'uebersprungen'), bytes = bytes + (SELECT CASE WHEN count(*) > 0 THEN $6::bigint ELSE 0 END FROM p WHERE status = 'ok')
          WHERE id = $5`,
            [p.id, r.status, meldung.slice(0, 300), r.fileId, id, r.bytes]
          )
        await buchen(r.meldung).catch(() => buchen(latin(r.meldung)))
        const zeile: ProtokollZeile =
          r.status === 'ok'
            ? { z: Date.now(), t: p.daten.name, a: 'ok' }
            : { z: Date.now(), t: `${p.daten.name} — ${r.meldung}`, a: r.status === 'fehler' ? 'fehler' : 'weg' }
        await protokollieren(id, [zeile]).catch(() =>
          protokollieren(id, [{ ...zeile, t: latin(zeile.t) }]).catch(() => {})
        )
      })
    }
  } finally {
    for (const z of k.zips.values()) z.then((a) => a.zip.close()).catch(() => {})
  }
}

type Ergebnis = { status: 'ok' | 'fehler' | 'uebersprungen'; meldung: string; bytes: number; fileId: string | null }
const latin = (s: string) => s.replace(/[^\x20-\x7e\u00a0-\u00ff]/g, '?')
const de = () => sLang() !== 'en'

async function einePosition(k: Kontext, p: ImportPosten): Promise<Ergebnis> {
  const o = k.imp.optionen
  const weg = (meldung: string): Ergebnis => ({ status: 'uebersprungen', meldung, bytes: 0, fileId: null })
  const ablauf = o.grenzen && p.ablauf ? new Date(p.ablauf) : null
  if (ablauf && !Number.isNaN(ablauf.getTime()) && ablauf.getTime() < Date.now() + 60_000)
    return weg(de() ? 'war schon abgelaufen' : 'had already expired')
  const max = o.grenzen && p.maxAufrufe && p.maxAufrufe > 0 ? p.maxAufrufe : null
  const aufrufe = o.aufrufe ? Math.max(0, p.aufrufe || 0) : 0
  if (max && aufrufe >= max) return weg(de() ? 'Aufrufgrenze war schon erreicht' : 'view limit was already reached')

  const besitzer = (o.konten && p.besitzer ? k.nutzer.get(p.besitzer) : null) || k.ziel
  const frueher = await q1<{ id: string }>(
    `SELECT f.id FROM import_posten p JOIN importe i ON i.id = p.import_id JOIN files f ON f.id = p.file_id
      WHERE p.schluessel = $1 AND p.status = 'ok' AND i.quelle = $2 AND f.user_id = $3 LIMIT 1`,
    [p.schluessel, k.imp.quelle, besitzer.id]
  )
  if (frueher)
    return {
      status: 'uebersprungen',
      meldung: de() ? 'schon vorhanden' : 'already there',
      bytes: 0,
      fileId: frueher.id
    }
  const frei = await freierPlatz(besitzer)
  if (frei <= 0 || (p.groesse && p.groesse > frei))
    return {
      status: 'fehler',
      meldung: de() ? 'Speicher des Kontos ist voll' : 'account storage is full',
      bytes: 0,
      fileId: null
    }

  const strom = await oeffnen(k, p.quelle)
  const g = await schreiben(strom, frei === Infinity ? 0 : frei)
  if (!g.size && (p.groesse || 0) > 0) {
    await loeschen(g.schluessel)
    return { status: 'fehler', meldung: de() ? 'kam leer an' : 'arrived empty', bytes: 0, fileId: null }
  }
  let live = false,
    liveHinweis = ''
  if (p.live) {
    const tmp = await arbeitsPfad()
    try {
      await pipeline(await oeffnen(k, p.live), createWriteStream(tmp))
      await nebenSchreiben(g.schluessel, 'live', tmp)
      live = true
    } catch (e: any) {
      liveHinweis = de() ? ` (ohne Live-Video: ${fehlerText(e)})` : ` (without live video: ${fehlerText(e)})`
      await fs.rm(tmp, { force: true }).catch(() => {})
    }
  }
  const ordner = await ordnerFuer(k, besitzer.id, [...(o.ordnerName ? [o.ordnerName] : []), ...(p.ordner || [])])
  const erstellt = p.erstellt ? new Date(p.erstellt) : null
  const z = await dateiAnlegen(
    besitzer.id,
    g,
    p.name,
    p.mime || '',
    { ordner, maxAufrufe: max },
    besitzer.prefs?.lang === 'en' ? 'en' : 'de',
    {
      slug: o.linknamen ? p.slug : undefined,
      erstellt: erstellt && !Number.isNaN(erstellt.getTime()) ? erstellt : null,
      ablauf,
      aufrufe,
      favorit: o.aufrufe && !!p.favorit,
      passwortHash: o.grenzen ? p.passwortHash || '' : '',
      live
    }
  )
  for (const name of new Set((p.tags || []).map((t) => t.trim().slice(0, 40)).filter(Boolean))) {
    const tagId = await tagFuer(k, besitzer.id, name)
    await q('INSERT INTO file_tags (file_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [z.id, tagId])
  }
  if (o.weiterleiten) {
    for (const a of p.altePfade || []) {
      const pfad = normPfad(a.pfad)
      if (pfad)
        await q(
          'INSERT INTO alte_pfade (pfad, file_id, ziel) VALUES ($1, $2, $3) ON CONFLICT (pfad) DO UPDATE SET file_id = EXCLUDED.file_id, ziel = EXCLUDED.ziel',
          [pfad, z.id, a.ziel]
        )
    }
  }
  const umbenannt =
    p.slug && o.linknamen && z.slug !== p.slug
      ? de()
        ? ` (Linkname „${p.slug}“ war belegt → ${z.slug})`
        : ` (link name “${p.slug}” was taken → ${z.slug})`
      : ''
  return { status: 'ok', meldung: umbenannt + liveHinweis, bytes: g.size, fileId: z.id }
}

function fehlerText(e: any): string {
  if (e?.code === 'ZU_GROSS') return de() ? 'Speicher des Kontos ist voll' : 'account storage is full'
  if (e?.code === 'ENOENT') return de() ? 'Datei nicht gefunden' : 'file not found'
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError')
    return de() ? 'Zeitüberschreitung beim Herunterladen' : 'download timed out'
  return String(e?.data?.message || e?.message || e).slice(0, 200)
}

async function parallel<T>(liste: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, liste.length) }, async () => {
      while (i < liste.length) await fn(liste[i++]!)
    })
  )
}

const NAME_OK = /^[a-zA-Z0-9._-]{3,40}$/
function kontoName(s: string): string {
  let n = String(s || '')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  if (n.length < 3) n = (n + '-import').slice(0, 40)
  return NAME_OK.test(n) ? n : 'import-' + randomBytes(3).toString('hex')
}

async function kontenZuordnen(k: Kontext, starter: Nutzer): Promise<void> {
  const plan = k.imp.plan || {}
  const zuordnung: Record<string, number> = { ...(plan.zuordnung || {}) }
  if (!k.imp.optionen.konten || !k.admin) return
  const neu: ProtokollZeile[] = []
  for (const u of (k.imp.zugang?.nutzer || []) as ImportNutzer[]) {
    let id = zuordnung[u.schluessel]
    if (!id) {
      const name = kontoName(u.username)
      const da = await q1<{ id: number }>('SELECT id FROM users WHERE lower(username) = lower($1)', [name])
      if (da) {
        id = da.id
        neu.push({
          z: Date.now(),
          t: de()
            ? `Konto „${name}“ gibt es schon — Dateien kommen dorthin`
            : `Account “${name}” already exists — files go there`,
          a: 'info'
        })
      } else {
        const email =
          u.email && !(await q1('SELECT 1 FROM users WHERE lower(email) = lower($1)', [u.email]))
            ? u.email.slice(0, 200)
            : ''
        const rolle = u.admin && starter.role === 'owner' ? 'admin' : 'user'
        const pw =
          u.passwortHash && /^\$(argon2|2[aby]\$)/.test(u.passwortHash)
            ? u.passwortHash
            : await hashPw(randomBytes(24).toString('base64url'))
        const r = await q1<{ id: number }>(
          'INSERT INTO users (username, email, password, role, quota_bytes) VALUES ($1,$2,$3,$4,$5) RETURNING id',
          [name, email, pw, rolle, u.quotaBytes && u.quotaBytes > 0 ? u.quotaBytes : null]
        )
        id = r!.id
        neu.push({
          z: Date.now(),
          t:
            (de() ? `Konto „${name}“ angelegt` : `Account “${name}” created`) +
            (u.passwortHash
              ? ''
              : de()
                ? ' — ohne Passwort, bitte unter Nutzer eines setzen'
                : ' — no password, please set one under Users'),
          a: 'info'
        })
        await ereignis('user_created', starter.id, { username: name, role: rolle, import: k.imp.id })
      }
      zuordnung[u.schluessel] = id
    }
    const n = await q1<Nutzer>('SELECT id, username, email, role, quota_bytes, prefs FROM users WHERE id = $1', [id])
    if (n) k.nutzer.set(u.schluessel, n)
  }
  await q(
    `UPDATE importe SET plan = jsonb_set(plan, '{zuordnung}', $2::jsonb), zugang = zugang - 'nutzer' WHERE id = $1`,
    [k.imp.id, JSON.stringify(zuordnung)]
  )
  k.imp.plan = { ...plan, zuordnung }
  await protokollieren(k.imp.id, neu)
}

function ordnerFuer(k: Kontext, userId: number, pfad: string[]): Promise<number | null> {
  const teile = pfad
    .map((s) =>
      String(s)
        .replace(/[\u0000-\u001f]/g, '')
        .trim()
        .slice(0, 80)
    )
    .filter(Boolean)
  if (!teile.length) return Promise.resolve(null)
  const schl = `${userId}|${teile.join('\u0000')}`
  let p = k.ordner.get(schl)
  if (!p) {
    p = (async () => {
      const eltern = teile.length > 1 ? await ordnerFuer(k, userId, teile.slice(0, -1)) : null
      const name = teile[teile.length - 1]!
      const da = await q1<{ id: number }>(
        'SELECT id FROM folders WHERE user_id = $1 AND name = $2 AND parent_id IS NOT DISTINCT FROM $3 ORDER BY id LIMIT 1',
        [userId, name, eltern]
      )
      if (da) return da.id
      return (await q1<{ id: number }>(
        'INSERT INTO folders (user_id, parent_id, name) VALUES ($1, $2, $3) RETURNING id',
        [userId, eltern, name]
      ))!.id
    })()
    k.ordner.set(schl, p)
  }
  return p
}

function tagFuer(k: Kontext, userId: number, name: string): Promise<number> {
  const schl = `${userId}|${name.toLowerCase()}`
  let p = k.tags.get(schl)
  if (!p) {
    p = (async () => {
      const da = await q1<{ id: number }>('SELECT id FROM tags WHERE user_id = $1 AND lower(name) = lower($2)', [
        userId,
        name
      ])
      if (da) return da.id
      const r = await q1<{ id: number }>(
        'INSERT INTO tags (user_id, name) VALUES ($1, $2) ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id',
        [userId, name]
      )
      return r!.id
    })()
    k.tags.set(schl, p)
  }
  return p
}

const OHNE_ADMIN = /(^|\.)imgur\.com$/i
const erlaubtOhneAdmin = (host: string) => OHNE_ADMIN.test(host) || APPLE_DATEI_HOST.test(host)

async function oeffnen(k: Kontext, qu: PostenQuelle): Promise<Readable> {
  if (qu.art === 'url') return herunterladen(k, qu.url, !!qu.mitZugang)
  if (qu.art === 'icloud') {
    const url = await icloudUrl(
      {
        zugang: k.imp.zugang || {},
        speichern: (z) =>
          q('UPDATE importe SET zugang = $2::jsonb WHERE id = $1', [k.imp.id, JSON.stringify(z)]).then(() => {})
      },
      qu
    )
    return herunterladen(k, url, false)
  }
  if (qu.art === 'datei') {
    const pfad = await erlaubterPfad(k, qu.pfad)
    return createReadStream(pfad)
  }
  const archiv = await zipOeffnen(k, await erlaubterPfad(k, qu.zip))
  const eintrag = archiv.eintraege.get(qu.eintrag)
  if (!eintrag) throw Object.assign(new Error('nicht im Archiv'), { code: 'ENOENT' })
  return new Promise((res, rej) => archiv.zip.openReadStream(eintrag, (e, s) => (e || !s ? rej(e) : res(s))))
}

async function erlaubterPfad(k: Kontext, pfad: string): Promise<string> {
  const ablage = importAblage(k.imp.id)
  if (resolve(pfad).startsWith(resolve(ablage) + sep))
    return innerhalb(ablage, resolve(pfad).slice(resolve(ablage).length + 1))
  if (!k.admin)
    throw fehler(403, 'Server-Ordner dürfen nur Admins importieren.', 'Only admins can import server folders.')
  const w = importWurzel()
  return innerhalb(w, resolve(pfad).startsWith(w + sep) ? resolve(pfad).slice(w.length + 1) : pfad)
}

export async function herunterladen(
  k: { imp: ImportZeile; admin: boolean },
  url: string,
  mitZugang: boolean
): Promise<Readable> {
  let ziel = new URL(url)
  const basis = k.imp.zugang?.basis ? new URL(k.imp.zugang.basis) : null
  for (let sprung = 0; sprung < 6; sprung++) {
    if (!/^https?:$/.test(ziel.protocol))
      throw new Error(de() ? 'Nur http/https-Adressen' : 'Only http/https addresses')
    if (!k.admin && !erlaubtOhneAdmin(ziel.hostname))
      throw new Error(de() ? 'Adresse nicht erlaubt' : 'Address not allowed')
    const kopf: Record<string, string> = { 'user-agent': 'VylarisCloud-Import/1.0 (+https://vylaris.eu)' }
    if (mitZugang && basis && ziel.origin === basis.origin) Object.assign(kopf, k.imp.zugang.header || {})
    const ab = new AbortController()
    let uhr = setTimeout(() => ab.abort(), 60_000)
    const res = await fetch(ziel, { headers: kopf, redirect: 'manual', signal: ab.signal })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(uhr)
      ziel = new URL(res.headers.get('location')!, ziel)
      continue
    }
    if (res.status === 429) {
      clearTimeout(uhr)
      throw new Error(
        de()
          ? 'Die Quelle bremst (zu viele Anfragen) — später „Fehlgeschlagene wiederholen“'
          : 'The source is rate limiting — use “Retry failed” later'
      )
    }
    if (!res.ok || !res.body) {
      clearTimeout(uhr)
      throw new Error(`HTTP ${res.status}`)
    }
    const strom = Readable.fromWeb(res.body as any)
    const waechter = new Transform({
      transform(c, _e, cb) {
        clearTimeout(uhr)
        uhr = setTimeout(() => ab.abort(), 60_000)
        cb(null, c)
      },
      flush(cb) {
        clearTimeout(uhr)
        cb()
      }
    })
    strom.on('error', (e) => {
      clearTimeout(uhr)
      waechter.destroy(e)
    })
    waechter.on('close', () => clearTimeout(uhr))
    return strom.pipe(waechter)
  }
  throw new Error(de() ? 'Zu viele Weiterleitungen' : 'Too many redirects')
}

export async function quelleJson(k: { imp: ImportZeile; admin: boolean }, url: string): Promise<any> {
  const strom = await herunterladen(k, url, true).catch((e: any) => {
    const m = String(e?.message || '')
    if (/HTTP 401|HTTP 403/.test(m))
      throw fehler(
        400,
        'Der Zugang wurde abgelehnt — stimmt der API-Schlüssel?',
        'Access was denied — is the API key correct?'
      )
    if (/HTTP 404/.test(m)) throw fehler(400, `Nicht gefunden: ${url}`, `Not found: ${url}`)
    throw fehler(400, `Quelle nicht erreichbar: ${m}`, `Source not reachable: ${m}`)
  })
  const teile: Buffer[] = []
  let n = 0
  for await (const c of strom) {
    n += c.length
    if (n > 200 * 1024 * 1024) throw fehler(400, 'Antwort der Quelle ist zu groß.', 'The source response is too large.')
    teile.push(c)
  }
  try {
    return JSON.parse(Buffer.concat(teile).toString('utf8'))
  } catch {
    throw fehler(
      400,
      'Die Quelle hat kein JSON geliefert — stimmt die Adresse?',
      'The source did not return JSON — is the address correct?'
    )
  }
}

export interface ZipArchiv {
  zip: yauzl.ZipFile
  eintraege: Map<string, yauzl.Entry>
}

export function zipLesen(pfad: string): Promise<ZipArchiv> {
  return new Promise((res, rej) => {
    yauzl.open(pfad, { lazyEntries: true, autoClose: false, decodeStrings: true }, (e, zip) => {
      if (e || !zip) return rej(e || new Error('ZIP'))
      const eintraege = new Map<string, yauzl.Entry>()
      zip.on('entry', (en: yauzl.Entry) => {
        if (!/\/$/.test(en.fileName)) eintraege.set(en.fileName, en)
        zip.readEntry()
      })
      zip.on('end', () => res({ zip, eintraege }))
      zip.on('error', rej)
      zip.readEntry()
    })
  })
}
function zipOeffnen(k: Kontext, pfad: string): Promise<ZipArchiv> {
  let p = k.zips.get(pfad)
  if (!p) {
    p = zipLesen(pfad)
    k.zips.set(pfad, p)
  }
  return p
}
export function zipText(a: ZipArchiv, name: string, max = 50 * 1024 * 1024): Promise<string> {
  const en = a.eintraege.get(name)
  if (!en) return Promise.reject(new Error('nicht im Archiv: ' + name))
  if (en.uncompressedSize > max) return Promise.reject(new Error('zu gross: ' + name))
  return new Promise((res, rej) =>
    a.zip.openReadStream(en, async (e, s) => {
      if (e || !s) return rej(e)
      const teile: Buffer[] = []
      try {
        for await (const c of s) teile.push(c as Buffer)
        res(Buffer.concat(teile).toString('utf8'))
      } catch (x) {
        rej(x)
      }
    })
  )
}

export function normPfad(p: string): string {
  let s = String(p || '').trim()
  try {
    if (/^https?:\/\//i.test(s)) s = new URL(s).pathname
  } catch {
    return ''
  }
  s = s.split('?')[0]!.split('#')[0]!
  try {
    s = decodeURIComponent(s)
  } catch {}
  s = '/' + s.replace(/^\/+/, '').replace(/\/+$/, '')
  return s.length > 1 && s.length <= 500 ? s : ''
}

const ZIEL_ROUTE = { seite: 'v', direkt: 'r', download: 'd', raw: 'raw' } as const
export async function altesZiel(pfad: string): Promise<string | null> {
  const n = normPfad(pfad)
  if (!n) return null
  const r = await q1<{ slug: string; ziel: keyof typeof ZIEL_ROUTE; name: string }>(
    'SELECT f.slug, a.ziel, f.name FROM alte_pfade a JOIN files f ON f.id = a.file_id WHERE a.pfad = $1',
    [n]
  )
  if (!r) return null
  const ext = /\.([a-z0-9]{1,10})$/i.exec(r.name)?.[1]
  const route = ZIEL_ROUTE[r.ziel] || 'r'
  return `/${route}/${encodeURIComponent(r.slug)}${route === 'r' && ext ? '.' + ext.toLowerCase() : ''}`
}

export async function meinImport(event: import('h3').H3Event, u: Nutzer): Promise<ImportZeile> {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(id) || id <= 0) throw fehler(400, 'Ungültige ID.', 'Invalid ID.')
  const imp = await ladeImport(id)
  if (!imp || (imp.user_id !== u.id && u.role === 'user'))
    throw fehler(404, 'Import nicht gefunden.', 'Import not found.')
  return imp
}

const kontoMaske = (s: string) =>
  s.replace(
    /^(.)([^@]*)(@.*)?$/,
    (_m, a: string, b: string, c?: string) => a + '•'.repeat(Math.min(6, b.length)) + (c || '')
  )

export function importAnsicht(imp: ImportZeile) {
  const { zugang, ...rest } = imp
  return {
    ...rest,
    bytes: Number(imp.bytes),
    bytes_gesamt: Number(imp.bytes_gesamt),
    laeuftHier: laeuftGerade(imp),
    zugang: {
      url: zugang?.url || '',
      ordner: zugang?.ordner || '',
      hatToken: !!(zugang?.token || zugang?.apiKey || zugang?.accessToken || zugang?.clientId),
      alben: zugang?.alben || '',
      inhalt: zugang?.inhalt || '',
      icloud: zugang?.icloud
        ? {
            schritt: zugang.icloud.schritt,
            konto: kontoMaske(String(zugang.icloud.appleId || '')),
            sms: !!zugang.icloud.sms
          }
        : null
    }
  }
}
