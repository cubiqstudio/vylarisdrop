import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { getSpeicher, s3Groesse, s3Hochladen, s3Lesen, s3Loeschen, s3LoeschenPraefix } from './s3'
import { istPro } from './lizenz'

export type Ort = 'lokal' | 's3'
export const datenordner = () =>
  useRuntimeConfig().dataDir ||
  process.env.NUXT_DATA_DIR ||
  (process.platform === 'win32' ? join(process.cwd(), 'data') : '/data')
const SCHLUESSEL = /^(s3:)?[0-9a-f]{32}$/
const UPLOAD_ID = /^[0-9a-f]{24}$/

export const ortVon = (ablage: string): Ort => (ablage.startsWith('s3:') ? 's3' : 'lokal')
const kern = (ablage: string) => {
  if (!SCHLUESSEL.test(ablage)) throw new Error('ungueltiger Speicher-Schluessel')
  return ablage.replace(/^s3:/, '')
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
  return w.art === 's3' && !!w.s3?.bucket && (await istPro('s3')) ? 's3' : 'lokal'
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
  const schluessel = wo === 's3' ? `s3:${k}` : k
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
  return ortVon(ablage) === 's3' ? s3Lesen(objekt(ablage), bereich) : createReadStream(pfadVon(ablage), bereich)
}
export async function loeschen(ablage: string): Promise<void> {
  if (ortVon(ablage) === 's3') {
    await s3Loeschen([objekt(ablage), ...ALLE_NEBEN.map((n) => objekt(ablage, n))]).catch((e) =>
      console.error('[vylariscloud] S3 löschen:', e?.message)
    )
    return
  }
  await fs.rm(pfadVon(ablage), { force: true }).catch(() => {})
  for (const n of ALLE_NEBEN) await fs.rm(nebenPfad(ablage, n), { force: true }).catch(() => {})
}
export async function nebenLoeschen(ablage: string, art: Neben): Promise<void> {
  if (ortVon(ablage) === 's3') {
    await s3Loeschen([objekt(ablage, art)]).catch(() => {})
    return
  }
  await fs.rm(nebenPfad(ablage, art), { force: true }).catch(() => {})
}
export async function vorhanden(ablage: string): Promise<boolean> {
  if (ortVon(ablage) === 's3') return (await s3Groesse(objekt(ablage)).catch(() => null)) != null
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
