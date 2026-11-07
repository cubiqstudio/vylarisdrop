import { createHash } from 'node:crypto'
import { PassThrough, type Readable } from 'node:stream'
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSetting, setSetting, st } from './settings'

export interface S3Ziel {
  endpoint: string
  region: string
  bucket: string
  zugang: string
  geheim: string
  pfadStil: boolean
  praefix: string
}
export interface SpeicherWahl {
  art: 'lokal' | 's3' | 'sftp' | 'pool'
  s3: S3Ziel | null
  /** Speicher-Erweiterung (SFTP), die für neue Uploads gilt, wenn `art` = 'sftp' */
  sftpZiel?: number | null
  /** Speicher-Pool (art = 'pool'): Mitglieder `lokal` und `sftp<ID>` */
  mitglieder?: string[]
  /** Verteilung neuer Dateien im Pool: `frei` = Mitglied mit dem meisten freien Platz, `abwechselnd` = reihum */
  strategie?: 'frei' | 'abwechselnd'
}

const LEER: SpeicherWahl = { art: 'lokal', s3: null }
export const ausUmgebung = () => !!process.env.VD_S3_BUCKET

export async function getSpeicher(): Promise<SpeicherWahl> {
  if (ausUmgebung()) {
    const e = process.env
    return {
      art: e.VD_STORAGE === 'local' ? 'lokal' : 's3',
      s3: {
        endpoint: e.VD_S3_ENDPOINT || '',
        region: e.VD_S3_REGION || 'auto',
        bucket: e.VD_S3_BUCKET || '',
        zugang: e.VD_S3_ACCESS_KEY || '',
        geheim: e.VD_S3_SECRET_KEY || '',
        pfadStil: e.VD_S3_PATH_STYLE === '1' || e.VD_S3_PATH_STYLE === 'true',
        praefix: praefixNorm(e.VD_S3_PREFIX || '')
      }
    }
  }
  return { ...LEER, ...(await getSetting<Partial<SpeicherWahl>>('speicher', {})) } as SpeicherWahl
}
export const setSpeicher = (w: SpeicherWahl) => setSetting('speicher', w)
export const praefixNorm = (p: string) => {
  const s = p.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  return s ? s + '/' : ''
}

let zwischen: { schl: string; client: S3Client; ziel: S3Ziel } | null = null
function clientFuer(z: S3Ziel): S3Client {
  const schl = createHash('sha256').update(JSON.stringify(z)).digest('hex')
  if (zwischen?.schl === schl) return zwischen.client
  const cfg: S3ClientConfig = {
    region: z.region || 'auto',
    forcePathStyle: z.pfadStil,
    credentials: { accessKeyId: z.zugang, secretAccessKey: z.geheim },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 4
  }
  if (z.endpoint) cfg.endpoint = z.endpoint
  zwischen?.client.destroy()
  zwischen = { schl, client: new S3Client(cfg), ziel: z }
  return zwischen.client
}
async function aktiv(): Promise<{ c: S3Client; z: S3Ziel }> {
  const w = await getSpeicher()
  if (!w.s3?.bucket) throw new Error(st('S3 ist nicht eingerichtet.', 'S3 is not configured.'))
  return { c: clientFuer(w.s3), z: w.s3 }
}

export async function s3Hochladen(
  schluessel: string,
  body: Readable | Buffer,
  laenge?: number,
  typ?: string
): Promise<void> {
  const { c, z } = await aktiv()
  const Key = z.praefix + schluessel
  if (Buffer.isBuffer(body)) {
    await c.send(
      new PutObjectCommand({ Bucket: z.bucket, Key, Body: body, ContentLength: body.length, ContentType: typ })
    )
    return
  }
  const up = new Upload({
    client: c,
    params: {
      Bucket: z.bucket,
      Key,
      Body: body,
      ContentType: typ,
      ...(laenge != null ? { ContentLength: laenge } : {})
    },
    partSize: 8 * 1024 * 1024,
    queueSize: 3,
    leavePartsOnError: false
  })
  await up.done()
}

export function s3Lesen(schluessel: string, bereich?: { start: number; end: number }): Readable {
  const aus = new PassThrough()
  void (async () => {
    try {
      const { c, z } = await aktiv()
      const r = await c.send(
        new GetObjectCommand({
          Bucket: z.bucket,
          Key: z.praefix + schluessel,
          ...(bereich ? { Range: `bytes=${bereich.start}-${bereich.end}` } : {})
        })
      )
      const b = r.Body as Readable
      b.on('error', (e) => aus.destroy(e))
      aus.on('close', () => {
        if (!b.destroyed) b.destroy()
      })
      b.pipe(aus)
    } catch (e: any) {
      aus.destroy(e)
    }
  })()
  return aus
}

export async function s3Groesse(schluessel: string): Promise<number | null> {
  const { c, z } = await aktiv()
  try {
    const r = await c.send(new HeadObjectCommand({ Bucket: z.bucket, Key: z.praefix + schluessel }))
    return Number(r.ContentLength ?? 0)
  } catch (e: any) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound' || e?.name === 'NoSuchKey') return null
    throw e
  }
}

export async function s3Loeschen(schluessel: string[]): Promise<void> {
  if (!schluessel.length) return
  const { c, z } = await aktiv()
  for (let i = 0; i < schluessel.length; i += 1000) {
    await c.send(
      new DeleteObjectsCommand({
        Bucket: z.bucket,
        Delete: { Objects: schluessel.slice(i, i + 1000).map((k) => ({ Key: z.praefix + k })), Quiet: true }
      })
    )
  }
}
export async function s3LoeschenPraefix(p: string): Promise<void> {
  const { c, z } = await aktiv()
  let token: string | undefined
  do {
    const r = await c.send(
      new ListObjectsV2Command({ Bucket: z.bucket, Prefix: z.praefix + p, ContinuationToken: token })
    )
    const keys = (r.Contents || []).map((o) => o.Key!).filter(Boolean)
    if (keys.length)
      await c.send(
        new DeleteObjectsCommand({ Bucket: z.bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } })
      )
    token = r.IsTruncated ? r.NextContinuationToken : undefined
  } while (token)
}

export async function s3Testen(z: S3Ziel): Promise<{ ok: boolean; meldung: string; ms: number }> {
  const t0 = Date.now()
  const c = new S3Client({
    region: z.region || 'auto',
    forcePathStyle: z.pfadStil,
    credentials: { accessKeyId: z.zugang, secretAccessKey: z.geheim },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 1,
    ...(z.endpoint ? { endpoint: z.endpoint } : {})
  })
  const Key = `${z.praefix}.vylariscloud-test-${Date.now()}`
  const inhalt = Buffer.from('VylarisCloud S3-Test 0123456789')
  try {
    await c.send(new PutObjectCommand({ Bucket: z.bucket, Key, Body: inhalt, ContentLength: inhalt.length }))
    const r = await c.send(new GetObjectCommand({ Bucket: z.bucket, Key, Range: 'bytes=8-9' }))
    const teil = Buffer.from(await (r.Body as any).transformToByteArray()).toString()
    await c.send(new DeleteObjectsCommand({ Bucket: z.bucket, Delete: { Objects: [{ Key }], Quiet: true } }))
    if (teil !== 'S3')
      return {
        ok: false,
        meldung: st(
          'Der Speicher liefert Teilbereiche falsch — Videos ließen sich nicht spulen.',
          'The storage returns byte ranges incorrectly — videos could not be seeked.'
        ),
        ms: Date.now() - t0
      }
    return {
      ok: true,
      meldung: st('Schreiben, Lesen und Löschen klappen.', 'Write, read and delete work.'),
      ms: Date.now() - t0
    }
  } catch (e: any) {
    return { ok: false, meldung: s3Fehlertext(e), ms: Date.now() - t0 }
  } finally {
    c.destroy()
  }
}

export function s3Fehlertext(e: any): string {
  const n = String(e?.name || e?.Code || ''),
    code = e?.$metadata?.httpStatusCode
  if (n === 'NoSuchBucket') return st('Diesen Bucket gibt es nicht.', 'This bucket does not exist.')
  if (n === 'InvalidAccessKeyId' || n === 'SignatureDoesNotMatch' || code === 403)
    return st(
      'Zugang abgelehnt — Schlüssel oder Rechte prüfen (Lesen, Schreiben, Löschen, Auflisten).',
      'Access denied — check the keys or permissions (read, write, delete, list).'
    )
  if (n === 'PermanentRedirect' || n === 'AuthorizationHeaderMalformed')
    return st('Falsche Region für diesen Bucket.', 'Wrong region for this bucket.')
  if (/ENOTFOUND|EAI_AGAIN/.test(String(e?.code || e?.message)))
    return st('Die Adresse (Endpoint) ist nicht erreichbar.', 'The endpoint cannot be reached.')
  if (/ECONNREFUSED|ETIMEDOUT|timeout/i.test(String(e?.code || e?.message)))
    return st('Keine Verbindung zum Endpoint.', 'No connection to the endpoint.')
  return st(`S3-Fehler: ${n || e?.message || 'unbekannt'}`, `S3 error: ${n || e?.message || 'unknown'}`)
}
