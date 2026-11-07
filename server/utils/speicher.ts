import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { getSpeicher, s3Groesse, s3Hochladen, s3Lesen, s3Loeschen, s3LoeschenPraefix } from './s3'
import { istPro } from './lizenz'
import { alsHttpFehler, zielLaden } from './sftpZiele'
import {
  loeschenVormerken,
  sftpBereit,
  sftpGroesse,
  sftpLesen,
  sftpLoeschen,
  sftpSchreiben
} from './sftpClient'

/** Speicherort einer Datei: lokal, S3 oder eine SFTP-Speicher-Erweiterung (`sftp<Ziel-ID>`). */
export type Ort = 'lokal' | 's3' | `sftp${number}`
export const datenordner = () =>
  useRuntimeConfig().dataDir ||
  process.env.NUXT_DATA_DIR ||
  (process.platform === 'win32' ? join(process.cwd(), 'data') : '/data')
const SCHLUESSEL = /^((s3|sftp[1-9][0-9]{0,8}):)?[0-9a-f]{32}$/
const UPLOAD_ID = /^[0-9a-f]{24}$/

export const ortVon = (ablage: string): Ort => {
  if (ablage.startsWith('s3:')) return 's3'
  const m = /^(sftp[1-9][0-9]{0,8}):/.exec(ablage)
  return m ? (m[1] as Ort) : 'lokal'
}
/** ID der SFTP-Erweiterung eines Ortes, sonst null. */
export const sftpId = (o: Ort | string): number | null => {
  const m = /^sftp([1-9][0-9]{0,8})$/.exec(o)
  return m ? Number(m[1]) : null
}
/** Prüft einen gespeicherten Ort-Text (z. B. Spalte uploads.speicher) und liefert sonst null. */
export const ortGueltig = (o: string): Ort | null => (o === 'lokal' || o === 's3' || sftpId(o) != null ? (o as Ort) : null)
const kern = (ablage: string) => {
  if (!SCHLUESSEL.test(ablage)) throw new Error('ungueltiger Speicher-Schluessel')
  return ablage.replace(/^(s3|sftp[0-9]+):/, '')
}
export type Neben = 'vorschau' | 'streifen' | 'ansicht' | 'live' | 'livemp4'
export const NEBEN: Record<Neben, { endung: string; typ: string }> = {
  vorschau: { endung: '.vorschau.webp', typ: 'image/webp' },
  streifen: { endung: '.streifen.webp', typ: 'image/webp' },
  ansicht: { endung: '.ansicht.jpg', typ: 'image/jpeg' },
  live: { endung: '.live', typ: 'application/octet-stream' },
  livemp4: { endung: '.live.mp4', typ: 'video/mp4' }
}
const ALLE_NEBEN = Object.keys(NEBEN) as Neben[]
const objekt = (ablage: string, neben?: Neben) => {
  const k = kern(ablage)
  return `dateien/${k.slice(0, 2)}/${k}${neben ? NEBEN[neben].endung : ''}`
}

export const neuerSchluessel = () => randomBytes(16).toString('hex')
export function pfadVon(ablage: string): string {
  if (ortVon(ablage) !== 'lokal') throw new Error('Datei liegt nicht lokal')
  const k = kern(ablage)
  return join(datenordner(), 'dateien', k.slice(0, 2), k)
}
export function nebenPfad(ablage: string, art: Neben): string {
  return `${pfadVon(ablage)}${NEBEN[art].endung}`
}
export function teilOrdner(uploadId: string): string {
  if (!UPLOAD_ID.test(uploadId)) throw new Error('ungueltige Upload-ID')
  return join(datenordner(), 'teile', uploadId)
}
export async function arbeitsPfad(endung = ''): Promise<string> {
  const d = join(datenordner(), 'tmp')
  await fs.mkdir(d, { recursive: true })
  return join(d, `vd-${randomBytes(8).toString('hex')}${endung}`)
}

export async function zielOrt(): Promise<Ort> {
  const w = await getSpeicher()
  if (w.art === 'pool') return poolWahl(w.mitglieder || ['lokal'], w.strategie === 'abwechselnd' ? 'abwechselnd' : 'frei')
  if (w.art === 'sftp' && w.sftpZiel) {
    // nur eine aktive, beschreibbare Erweiterung; sonst bleibt es lokal (die Oberfläche warnt davor)
    const z = await zielLaden(w.sftpZiel)
    return z?.aktiv && z.schreibbar ? (`sftp${z.id}` as Ort) : 'lokal'
  }
  return w.art === 's3' && !!w.s3?.bucket && (await istPro('s3')) ? 's3' : 'lokal'
}

/** Wie ablageBereit, für mehrere Dateien (je Speicherort nur einmal geprüft). */
export async function ablagenBereit(ablagen: string[]): Promise<void> {
  const gesehen = new Set<string>()
  for (const a of ablagen) {
    const o = ortVon(a)
    if (o === 'lokal' || o === 's3' || gesehen.has(o)) continue
    gesehen.add(o)
    await ablageBereit(a)
  }
}

/** Vorab-Prüfung vor dem Ausliefern: ist der Speicherort der Datei erreichbar? Wirft sonst 503/502 mit klarer Meldung. */
export async function ablageBereit(ablage: string): Promise<void> {
  const id = sftpId(ortVon(ablage))
  if (id == null) return
  try {
    await sftpBereit(id)
  } catch (e) {
    throw alsHttpFehler(e)
  }
}

export interface Geschrieben {
  schluessel: string
  size: number
  sha256: string
  kopf: Buffer
}

export async function schreiben(quelle: Readable, maxBytes: number, ort?: Ort): Promise<Geschrieben> {
  const wo = ort || (await zielOrt())
  const k = neuerSchluessel()
  const schluessel = wo === 'lokal' ? k : `${wo === 's3' ? 's3' : wo}:${k}`
  const hash = createHash('sha256')
  let size = 0
  let kopf = Buffer.alloc(0)
  const zaehler = new Transform({
    transform(chunk: Buffer, _e, cb) {
      size += chunk.length
      if (maxBytes !== 0 && size > maxBytes) return cb(Object.assign(new Error('zu gross'), { code: 'ZU_GROSS' }))
      if (kopf.length < 4100) kopf = Buffer.concat([kopf, chunk.subarray(0, 4100 - kopf.length)])
      hash.update(chunk)
      cb(null, chunk)
    }
  })
  if (wo === 's3') {
    quelle.on('error', (e) => zaehler.destroy(e))
    quelle.pipe(zaehler)
    try {
      await s3Hochladen(objekt(schluessel), zaehler)
    } catch (e: any) {
      if (size > maxBytes && maxBytes !== 0) throw Object.assign(new Error('zu gross'), { code: 'ZU_GROSS' })
      throw e
    }
    return { schluessel, size, sha256: hash.digest('hex'), kopf }
  }
  const sid = sftpId(wo)
  if (sid != null) {
    zaehler.on('error', () => {})
    quelle.on('error', (e) => zaehler.destroy(e))
    quelle.pipe(zaehler)
    try {
      await sftpSchreiben(sid, objekt(schluessel), zaehler)
    } catch (e: any) {
      quelle.unpipe(zaehler)
      zaehler.destroy()
      // Reste entfernen; ist der Server gerade weg, kommt der Rest auf die Wiederholungsliste (siehe Plugin sftp-ziele)
      void sftpNachLoeschen(schluessel).catch(() => loeschenVormerken(schluessel).catch(() => {}))
      if (e?.code === 'ZU_GROSS' || (maxBytes !== 0 && size > maxBytes))
        throw Object.assign(new Error('zu gross'), { code: 'ZU_GROSS' })
      throw alsHttpFehler(e)
    }
    return { schluessel, size, sha256: hash.digest('hex'), kopf }
  }
  const ziel = pfadVon(schluessel)
  await fs.mkdir(join(ziel, '..'), { recursive: true })
  try {
    await pipeline(quelle, zaehler, createWriteStream(ziel, { mode: 0o640 }))
  } catch (e) {
    await fs.rm(ziel, { force: true }).catch(() => {})
    throw e
  }
  return { schluessel, size, sha256: hash.digest('hex'), kopf }
}

export function lesen(ablage: string, bereich?: { start: number; end: number }): Readable {
  const ort = ortVon(ablage)
  if (ort === 's3') return s3Lesen(objekt(ablage), bereich)
  const sid = sftpId(ort)
  if (sid != null) return sftpLesen(sid, objekt(ablage), bereich)
  return createReadStream(pfadVon(ablage), bereich)
}
export async function loeschen(ablage: string): Promise<void> {
  if (ortVon(ablage) === 's3') {
    await s3Loeschen([objekt(ablage), ...ALLE_NEBEN.map((n) => objekt(ablage, n))]).catch((e) =>
      console.error('[vylariscloud] S3 löschen:', e?.message)
    )
    return
  }
  const sid = sftpId(ortVon(ablage))
  if (sid != null) {
    await sftpLoeschen(sid, [objekt(ablage), ...ALLE_NEBEN.map((n) => objekt(ablage, n))]).catch(async (e) => {
      // Erweiterung offline: später erneut versuchen, sonst bliebe die Datei dort liegen
      if (e?.code !== 'GELOESCHT') await loeschenVormerken(ablage).catch(() => {})
      console.error('[vylariscloud] SFTP löschen:', e?.message)
    })
    return
  }
  await fs.rm(pfadVon(ablage), { force: true }).catch(() => {})
  for (const n of ALLE_NEBEN) await fs.rm(nebenPfad(ablage, n), { force: true }).catch(() => {})
}
/** Löscht eine SFTP-Datei samt Nebendateien und wirft bei Verbindungsproblemen (für die Wiederholungsliste). */
export async function sftpNachLoeschen(ablage: string): Promise<void> {
  const sid = sftpId(ortVon(ablage))
  if (sid == null) return
  try {
    await sftpLoeschen(sid, [objekt(ablage), ...ALLE_NEBEN.map((n) => objekt(ablage, n))])
  } catch (e: any) {
    if (e?.code === 'GELOESCHT') return // Erweiterung wurde entfernt: nichts mehr zu löschen
    throw e
  }
}
export async function nebenLoeschen(ablage: string, art: Neben): Promise<void> {
  if (ortVon(ablage) === 's3') {
    await s3Loeschen([objekt(ablage, art)]).catch(() => {})
    return
  }
  const sid = sftpId(ortVon(ablage))
  if (sid != null) {
    await sftpLoeschen(sid, [objekt(ablage, art)]).catch(() => {})
    return
  }
  await fs.rm(nebenPfad(ablage, art), { force: true }).catch(() => {})
}
export async function vorhanden(ablage: string): Promise<boolean> {
  if (ortVon(ablage) === 's3') return (await s3Groesse(objekt(ablage)).catch(() => null)) != null
  const sid = sftpId(ortVon(ablage))
  if (sid != null) return (await sftpGroesse(sid, objekt(ablage)).catch(() => null)) != null
  return fs.stat(pfadVon(ablage)).then(
    () => true,
    () => false
  )
}

export async function lokaleKopie(ablage: string): Promise<{ pfad: string; weg: () => Promise<void> }> {
  if (ortVon(ablage) === 'lokal') return { pfad: pfadVon(ablage), weg: async () => {} }
  const pfad = await arbeitsPfad()
  try {
    await pipeline(lesen(ablage), createWriteStream(pfad))
  } catch (e) {
    await fs.rm(pfad, { force: true }).catch(() => {})
    throw e
  }
  return { pfad, weg: () => fs.rm(pfad, { force: true }).catch(() => {}) }
}

export async function nebenSchreiben(ablage: string, art: Neben, datei: string): Promise<void> {
  try {
    if (ortVon(ablage) === 's3') {
      const st = await fs.stat(datei)
      await s3Hochladen(objekt(ablage, art), createReadStream(datei), st.size, NEBEN[art].typ)
      return
    }
    const sid = sftpId(ortVon(ablage))
    if (sid != null) {
      await sftpSchreiben(sid, objekt(ablage, art), createReadStream(datei)).catch((e) => {
        throw alsHttpFehler(e)
      })
      return
    }
    const ziel = nebenPfad(ablage, art)
    await fs.rename(datei, ziel).catch(async () => {
      await fs.copyFile(datei, ziel)
    })
  } finally {
    await fs.rm(datei, { force: true }).catch(() => {})
  }
}
export async function nebenLesen(
  ablage: string,
  art: Neben,
  bereich?: (groesse: number) => { start: number; end: number } | null
): Promise<{ strom: Readable; groesse: number; bereich: { start: number; end: number } | null } | null> {
  if (ortVon(ablage) === 's3') {
    const n = await s3Groesse(objekt(ablage, art)).catch(() => null)
    if (n == null) return null
    const b = bereich?.(n) || null
    return { strom: s3Lesen(objekt(ablage, art), b || undefined), groesse: n, bereich: b }
  }
  const sid = sftpId(ortVon(ablage))
  if (sid != null) {
    const n = await sftpGroesse(sid, objekt(ablage, art)).catch((e) => {
      throw alsHttpFehler(e)
    })
    if (n == null) return null
    const b = bereich?.(n) || null
    return { strom: sftpLesen(sid, objekt(ablage, art), b || undefined), groesse: n, bereich: b }
  }
  const p = nebenPfad(ablage, art)
  const s = await fs.stat(p).catch(() => null)
  if (!s) return null
  const b = bereich?.(s.size) || null
  return { strom: createReadStream(p, b || undefined), groesse: s.size, bereich: b }
}
export async function nebenKopie(
  ablage: string,
  art: Neben
): Promise<{ pfad: string; weg: () => Promise<void> } | null> {
  if (ortVon(ablage) === 'lokal') {
    const p = nebenPfad(ablage, art)
    return (await fs.stat(p).catch(() => null)) ? { pfad: p, weg: async () => {} } : null
  }
  const n = await nebenLesen(ablage, art)
  if (!n) return null
  const pfad = await arbeitsPfad(NEBEN[art].endung.replace(/^.*(\.[a-z0-9]+)$/, '$1'))
  try {
    await pipeline(n.strom, createWriteStream(pfad))
  } catch (e) {
    await fs.rm(pfad, { force: true }).catch(() => {})
    throw e
  }
  return { pfad, weg: () => fs.rm(pfad, { force: true }).catch(() => {}) }
}

export async function teilSchreiben(
  uploadId: string,
  nr: number,
  quelle: Readable,
  soll: number,
  ort: Ort
): Promise<void> {
  let n = 0
  const zaehler = new Transform({
    transform(c: Buffer, _e, cb) {
      n += c.length
      if (n > soll) return cb(new Error('zu gross'))
      cb(null, c)
    }
  })
  if (ort === 's3') {
    const teile: Buffer[] = []
    await pipeline(quelle, zaehler, async function* (q: AsyncIterable<Buffer>) {
      for await (const c of q) teile.push(c)
    })
    if (n !== soll) throw new Error('unvollstaendig')
    await s3Hochladen(`teile/${uploadId}/${nr}`, Buffer.concat(teile))
    return
  }
  const ziel = join(teilOrdner(uploadId), String(nr))
  await fs.mkdir(teilOrdner(uploadId), { recursive: true })
  try {
    await pipeline(quelle, zaehler, createWriteStream(ziel + '.tmp'))
    if (n !== soll) throw new Error('unvollstaendig')
  } catch (e) {
    await fs.rm(ziel + '.tmp', { force: true }).catch(() => {})
    throw e
  }
  await fs.rename(ziel + '.tmp', ziel)
}
export function teilLesen(uploadId: string, nr: number, ort: Ort): Readable {
  if (!UPLOAD_ID.test(uploadId)) throw new Error('ungueltige Upload-ID')
  return ort === 's3' ? s3Lesen(`teile/${uploadId}/${nr}`) : createReadStream(join(teilOrdner(uploadId), String(nr)))
}
export async function teileLoeschen(uploadId: string, ort: Ort): Promise<void> {
  if (!UPLOAD_ID.test(uploadId)) return
  if (ort === 's3') {
    await s3LoeschenPraefix(`teile/${uploadId}/`).catch(() => {})
    return
  }
  await fs.rm(teilOrdner(uploadId), { recursive: true, force: true }).catch(() => {})
}

export async function platte(): Promise<{ frei: number; gesamt: number } | null> {
  try {
    const s: any = await (fs as any).statfs(datenordner())
    return { frei: Number(s.bavail) * Number(s.bsize), gesamt: Number(s.blocks) * Number(s.bsize) }
  } catch {
    return null
  }
}

// ===== Speicher-Pool: mehrere Speicher (dieser Server + SFTP-Ziele) wie ein Speicher =====
export interface PoolMitglied {
  ort: string
  name: string
  art: 'lokal' | 'sftp'
  /** Gesamt/frei/belegt in Byte; null = unbekannt (z. B. SFTP-Server ohne statvfs) */
  gesamt: number | null
  frei: number | null
  belegt: number | null
  online: boolean | null
  aktiv: boolean
  schreibbar: boolean
  /** nimmt neue Dateien an (aktiv, beschreibbar, nicht offline) */
  nutzbar: boolean
}
export interface PoolPlatz {
  mitglieder: PoolMitglied[]
  /** Summe nur über Mitglieder mit bekannter Größe */
  summe: { gesamt: number; frei: number; belegt: number; bekannt: number }
  unbekannt: number
}

const PLATZ_TTL = 30_000
let lokalPlatz: { bis: number; v: { frei: number; gesamt: number } | null } | null = null
async function lokalPlatzKurz() {
  if (lokalPlatz && lokalPlatz.bis > Date.now()) return lokalPlatz.v
  const v = await platte()
  lokalPlatz = { bis: Date.now() + PLATZ_TTL, v }
  return v
}
let reihum = 0

/** Mitglieder-Liste mit Platzangaben (kurz zwischengespeichert, kein Live-Abruf pro Upload). */
export async function poolPlatz(mitglieder?: string[]): Promise<PoolPlatz> {
  const w = mitglieder ? null : await getSpeicher()
  const liste = mitglieder || (w?.art === 'pool' ? w.mitglieder || ['lokal'] : ['lokal'])
  const out: PoolMitglied[] = []
  for (const m of liste) {
    if (m === 'lokal') {
      const p = await lokalPlatzKurz()
      out.push({
        ort: 'lokal',
        name: 'lokal',
        art: 'lokal',
        gesamt: p?.gesamt ?? null,
        frei: p?.frei ?? null,
        belegt: p ? Math.max(0, p.gesamt - p.frei) : null,
        online: true,
        aktiv: true,
        schreibbar: true,
        nutzbar: true
      })
      continue
    }
    const id = sftpId(m)
    if (id == null) continue
    const z = await zielLaden(id)
    if (!z) continue
    const pl = z.status?.platz
    const bekannt = !!pl && Number.isFinite(pl.gesamt) && pl.gesamt > 0
    out.push({
      ort: m,
      name: z.name,
      art: 'sftp',
      gesamt: bekannt ? pl!.gesamt : null,
      frei: bekannt ? pl!.frei : null,
      belegt: bekannt ? Math.max(0, pl!.gesamt - pl!.frei) : null,
      online: z.status?.online ?? null,
      aktiv: z.aktiv,
      schreibbar: z.schreibbar,
      nutzbar: z.aktiv && z.schreibbar && z.status?.online !== false
    })
  }
  const bek = out.filter((m) => m.gesamt != null)
  return {
    mitglieder: out,
    summe: {
      gesamt: bek.reduce((a, m) => a + (m.gesamt || 0), 0),
      frei: bek.reduce((a, m) => a + (m.frei || 0), 0),
      belegt: bek.reduce((a, m) => a + (m.belegt || 0), 0),
      bekannt: bek.length
    },
    unbekannt: out.length - bek.length
  }
}

/** Wählt für einen Upload ein nutzbares Pool-Mitglied; fällt alles aus, bleibt es `lokal`. */
async function poolWahl(mitglieder: string[], strategie: 'frei' | 'abwechselnd'): Promise<Ort> {
  const p = await poolPlatz(mitglieder)
  const ok = p.mitglieder.filter((m) => m.nutzbar)
  if (!ok.length) return 'lokal'
  if (strategie === 'frei') {
    const mitPlatz = ok.filter((m) => m.frei != null)
    if (mitPlatz.length) return mitPlatz.reduce((a, b) => (b.frei! > a.frei! ? b : a)).ort as Ort
  }
  return ok[reihum++ % ok.length]!.ort as Ort
}
