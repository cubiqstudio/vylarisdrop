import {
  AbortMultipartUploadCommand,
  DeleteObjectsCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  S3Client
} from '@aws-sdk/client-s3'
import { q, q1 } from './db'
import type { Nutzer } from './auth'
import { st } from './settings'
import { anlegenErlaubt, idAus } from './boxen'
import { besitzerLaden, budgetPruefen, mitBudgetSperre, speicherErlaubt } from './speicherBudget'
import { DienstFehler, S3_REGION, S3_ZIEL, dienstFehlerMelden, garage, speicherKonfiguriert } from './speicherdienst'

export interface Bucket {
  id: number
  user_id: number
  name: string
  garage_id: string
  kontingent: string
  belegt: string
  objekte: string
  gewarnt: number
  created_at: string
}
export interface Schluessel {
  id: number
  bucket_id: number
  name: string
  access_key: string
  schreiben: boolean
  created_at: string
}
export const BUCKET_RE = /^(?!\d+\.\d+\.\d+\.\d+$)[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/
const MAX_SCHLUESSEL = 20

export async function bucketLaden(id: unknown, u: Nutzer): Promise<Bucket> {
  const n = idAus(id)
  const b = n ? await q1<Bucket>('SELECT * FROM speicher_buckets WHERE id = $1', [n]) : null
  if (!b || (b.user_id !== u.id && u.role === 'user'))
    throw fehler(404, st('Bucket nicht gefunden.', 'Bucket not found.'))
  return b
}

const quote = (kontingent: number) => ({ quotas: { maxSize: kontingent, maxObjects: null } })

const nameBelegt = () => fehler(409, st('Diesen Bucket-Namen gibt es schon.', 'This bucket name is already taken.'))

export async function bucketAnlegen(u: Nutzer, name: string, kontingent: number): Promise<Bucket> {
  if (!BUCKET_RE.test(name))
    throw fehler(
      400,
      st(
        'Bucket-Name: 3–63 Zeichen aus Kleinbuchstaben, Ziffern und Bindestrichen (nicht am Anfang oder Ende).',
        'Bucket name: 3–63 characters of lowercase letters, digits and hyphens (not at the start or end).'
      )
    )
  // Reservieren unter der Konto-Sperre: Budget prüfen und Zeile eintragen (garage_id noch leer), erst danach Garage
  const zeile = await mitBudgetSperre(u.id, async (x) => {
    await anlegenErlaubt(u, kontingent, x)
    if ((await x('SELECT 1 FROM speicher_buckets WHERE name = $1', [name])).length) throw nameBelegt()
    try {
      return (
        await x('INSERT INTO speicher_buckets (user_id, name, garage_id, kontingent) VALUES ($1,$2,$3,$4) RETURNING *', [
          u.id,
          name,
          '',
          kontingent
        ])
      )[0] as Bucket
    } catch (e: any) {
      if (e?.code === '23505') throw nameBelegt()
      throw e
    }
  })
  let garageId = ''
  try {
    const r = await garage('POST', 'CreateBucket', { globalAlias: name })
    garageId = String(r.json?.id || '')
    if (!garageId)
      throw fehler(
        409,
        st('Diesen Bucket-Namen gibt es in Garage schon.', 'This bucket name already exists in Garage.')
      )
    await garage('POST', `UpdateBucket?id=${encodeURIComponent(garageId)}`, quote(kontingent))
  } catch (e) {
    if (garageId) await garage('POST', `DeleteBucket?id=${encodeURIComponent(garageId)}`).catch(() => {})
    await q('DELETE FROM speicher_buckets WHERE id = $1', [zeile.id])
    if (e instanceof DienstFehler && e.status === 409) throw nameBelegt()
    dienstFehlerMelden(e, 'Bucket anlegen')
  }
  return (await q<Bucket>('UPDATE speicher_buckets SET garage_id = $2 WHERE id = $1 RETURNING *', [zeile.id, garageId]))[0]!
}

/**
 * Kontingent eines Buckets ändern. Alles unter der Konto-Sperre des Besitzers: Vergrößern nur im Budget, Verkleinern nur,
 * wenn der Bucket (frisch gemessen) ins neue Kontingent passt. Datenbank zuerst, dann Garage; bei einem Fehler zurückgerollt.
 */
export async function bucketKontingent(b: Bucket, kontingent: number, aktor: Nutzer): Promise<Bucket> {
  if (!speicherKonfiguriert())
    throw fehler(409, st('Der Speicherdienst ist nicht eingeschaltet.', 'The storage service is not switched on.'))
  return mitBudgetSperre(b.user_id, async (x) => {
    const alt = (await x('SELECT * FROM speicher_buckets WHERE id = $1', [b.id]))[0] as Bucket | undefined
    if (!alt) throw fehler(404, st('Bucket nicht gefunden.', 'Bucket not found.'))
    if (kontingent < Number(alt.kontingent)) {
      let belegt = 0
      try {
        belegt = (await bucketMessen(alt)).belegt
      } catch (e) {
        dienstFehlerMelden(e, 'Bucket messen')
      }
      if (belegt > kontingent)
        throw fehler(
          400,
          st(
            'Das Kontingent darf nicht kleiner sein als die Belegung.',
            'The quota cannot be smaller than the space in use.'
          )
        )
    } else if (kontingent > Number(alt.kontingent)) {
      await speicherErlaubt(aktor)
      await budgetPruefen(await besitzerLaden(alt.user_id), aktor, Number(alt.kontingent), kontingent, false, x)
    }
    const z = (
      await x('UPDATE speicher_buckets SET kontingent = $2, gewarnt = 0 WHERE id = $1 RETURNING *', [b.id, kontingent])
    )[0] as Bucket
    try {
      if (alt.garage_id) await garage('POST', `UpdateBucket?id=${encodeURIComponent(alt.garage_id)}`, quote(kontingent))
    } catch (e) {
      await x('UPDATE speicher_buckets SET kontingent = $2, gewarnt = $3 WHERE id = $1', [b.id, alt.kontingent, alt.gewarnt])
      dienstFehlerMelden(e, 'Kontingent setzen')
    }
    return z
  })
}

export async function schluesselAnlegen(
  b: Bucket,
  name: string,
  schreiben: boolean
): Promise<{ schluessel: Schluessel; secret: string }> {
  if (!b.garage_id)
    throw fehler(409, st('Der Bucket wird gerade angelegt.', 'The bucket is being created right now.'))
  // Zählen und Eintragen unter der Konto-Sperre: parallele Anfragen überschreiten MAX_SCHLUESSEL nicht
  return mitBudgetSperre(b.user_id, async (x) => {
    const n = (await x('SELECT count(*) AS n FROM speicher_schluessel WHERE bucket_id = $1', [b.id]))[0]
    if (Number(n?.n || 0) >= MAX_SCHLUESSEL)
      throw fehler(
        400,
        st(`Höchstens ${MAX_SCHLUESSEL} Schlüssel pro Bucket.`, `At most ${MAX_SCHLUESSEL} keys per bucket.`)
      )
    let key = '',
      secret = ''
    try {
      const r = await garage('POST', 'CreateKey', { name: `VylarisCloud ${b.name}: ${name}`.slice(0, 120) })
      key = String(r.json?.accessKeyId || '')
      secret = String(r.json?.secretAccessKey || '')
      if (!key || !secret) throw new Error('Garage hat keinen Schlüssel geliefert')
      await garage('POST', 'AllowBucketKey', {
        bucketId: b.garage_id,
        accessKeyId: key,
        permissions: { read: true, write: schreiben, owner: false }
      })
    } catch (e) {
      if (key) await garage('POST', `DeleteKey?id=${encodeURIComponent(key)}`).catch(() => {})
      dienstFehlerMelden(e, 'Schlüssel anlegen')
    }
    const s = (
      await x('INSERT INTO speicher_schluessel (bucket_id, name, access_key, schreiben) VALUES ($1,$2,$3,$4) RETURNING *', [
        b.id,
        name,
        key,
        schreiben
      ])
    )[0] as Schluessel
    return { schluessel: s, secret }
  })
}

export async function schluesselLoeschen(b: Bucket, id: unknown): Promise<Schluessel> {
  const n = idAus(id)
  const s = n
    ? await q1<Schluessel>('SELECT * FROM speicher_schluessel WHERE id = $1 AND bucket_id = $2', [n, b.id])
    : null
  if (!s) throw fehler(404, st('Schlüssel nicht gefunden.', 'Key not found.'))
  try {
    await garage('POST', `DeleteKey?id=${encodeURIComponent(s.access_key)}`)
  } catch (e) {
    dienstFehlerMelden(e, 'Schlüssel löschen')
  }
  await q('DELETE FROM speicher_schluessel WHERE id = $1', [s.id])
  return s
}

async function leeren(b: Bucket): Promise<void> {
  const r = await garage('POST', 'CreateKey', { name: `VylarisCloud: leeren ${b.name}` })
  const key = String(r.json?.accessKeyId || ''),
    secret = String(r.json?.secretAccessKey || '')
  try {
    await garage('POST', 'AllowBucketKey', {
      bucketId: b.garage_id,
      accessKeyId: key,
      permissions: { read: true, write: true, owner: true }
    })
    const s3 = new S3Client({
      endpoint: S3_ZIEL,
      region: S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: key, secretAccessKey: secret },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED'
    })
    let token: string | undefined
    do {
      const l = await s3.send(new ListObjectsV2Command({ Bucket: b.name, ContinuationToken: token, MaxKeys: 1000 }))
      const obj = (l.Contents || []).map((o) => ({ Key: o.Key! }))
      if (obj.length) await s3.send(new DeleteObjectsCommand({ Bucket: b.name, Delete: { Objects: obj, Quiet: true } }))
      token = l.IsTruncated ? l.NextContinuationToken : undefined
    } while (token)
    const m = await s3.send(new ListMultipartUploadsCommand({ Bucket: b.name })).catch(() => null)
    for (const up of m?.Uploads || [])
      await s3
        .send(new AbortMultipartUploadCommand({ Bucket: b.name, Key: up.Key!, UploadId: up.UploadId! }))
        .catch(() => {})
  } finally {
    await garage('POST', `DeleteKey?id=${encodeURIComponent(key)}`).catch(() => {})
  }
}

export async function bucketLoeschen(b: Bucket): Promise<void> {
  const keys = await q<{ access_key: string }>('SELECT access_key FROM speicher_schluessel WHERE bucket_id = $1', [
    b.id
  ])
  try {
    const da = b.garage_id ? await garage('GET', `GetBucketInfo?id=${encodeURIComponent(b.garage_id)}`) : { status: 404 }
    if (da.status !== 404) {
      await leeren(b)
      await garage('POST', `DeleteBucket?id=${encodeURIComponent(b.garage_id)}`)
    }
    for (const k of keys) await garage('POST', `DeleteKey?id=${encodeURIComponent(k.access_key)}`)
  } catch (e) {
    dienstFehlerMelden(e, 'Bucket löschen')
  }
  await q('DELETE FROM speicher_buckets WHERE id = $1', [b.id])
}

export async function bucketMessen(b: Bucket): Promise<{ belegt: number; objekte: number }> {
  if (!b.garage_id) return { belegt: Number(b.belegt), objekte: Number(b.objekte) }
  const r = await garage('GET', `GetBucketInfo?id=${encodeURIComponent(b.garage_id)}`)
  if (r.status === 404) return { belegt: Number(b.belegt), objekte: Number(b.objekte) }
  const belegt = Number(r.json?.bytes || 0) + Number(r.json?.unfinishedMultipartUploadBytes || 0),
    objekte = Number(r.json?.objects || 0)
  await q('UPDATE speicher_buckets SET belegt = $2, objekte = $3 WHERE id = $1', [b.id, belegt, objekte])
  // Durchsetzung: das Bucket-Kontingent in Garage muss dem in der Datenbank entsprechen (maßgeblich ist die Datenbank)
  const frisch = await q1<Bucket>('SELECT * FROM speicher_buckets WHERE id = $1', [b.id])
  if (frisch && Number(r.json?.quotas?.maxSize) !== Number(frisch.kontingent)) {
    console.error(`[vylariscloud] Speicher: Kontingent von Bucket ${b.id} in Garage weicht ab — wird neu gesetzt`)
    await garage('POST', `UpdateBucket?id=${encodeURIComponent(b.garage_id)}`, quote(Number(frisch.kontingent))).catch((e) =>
      console.error('[vylariscloud] Bucket-Abgleich:', e.message)
    )
  }
  return { belegt, objekte }
}
