import { statfs } from 'node:fs/promises'
import type { H3Event } from 'h3'
import { q } from './db'
import type { Nutzer } from './auth'
import { basisUrl } from './dateien'
import { platte } from './speicher'
import type { Box, Unterkonto } from './boxen'
import type { Bucket, Schluessel } from './buckets'
import { BOXEN_APP, S3_REGION, getSpeicherEinst, sftpPort, speicherKonfiguriert } from './speicherdienst'

export const boxAnsicht = (b: Box & { besitzer?: string }) => ({
  id: b.id,
  name: b.name,
  kennung: b.kennung,
  kontingent: Number(b.kontingent),
  belegt: Number(b.belegt),
  dateien: Number(b.dateien),
  sftp: b.sftp,
  webdav: b.webdav,
  sshKeys: b.ssh_keys || [],
  zuletzt: b.zuletzt_login,
  angelegt: b.created_at,
  besitzer: b.besitzer || '',
  userId: b.user_id
})
export const unterAnsicht = (u: Unterkonto) => ({
  id: u.id,
  login: u.login,
  ordner: u.ordner,
  schreiben: u.schreiben,
  notiz: u.notiz,
  sshKeys: u.ssh_keys || [],
  zuletzt: u.zuletzt_login,
  angelegt: u.created_at
})
export const bucketAnsicht = (b: Bucket & { besitzer?: string; schluessel?: number }) => ({
  id: b.id,
  name: b.name,
  kontingent: Number(b.kontingent),
  belegt: Number(b.belegt),
  objekte: Number(b.objekte),
  angelegt: b.created_at,
  besitzer: b.besitzer || '',
  userId: b.user_id,
  schluessel: Number(b.schluessel || 0)
})
export const schluesselAnsicht = (s: Schluessel) => ({
  id: s.id,
  name: s.name,
  accessKey: s.access_key,
  schreiben: s.schreiben,
  angelegt: s.created_at
})

export async function speicherAdresse(event: H3Event) {
  const basis = await basisUrl(event)
  let host = ''
  try {
    host = new URL(basis).hostname
  } catch {
    host = ''
  }
  return { basis, host, sftpPort: sftpPort(), webdav: `${basis}/webdav/`, s3: basis, region: S3_REGION }
}

export async function speicherPlatte(): Promise<{ frei: number; gesamt: number } | null> {
  try {
    const s = await statfs(BOXEN_APP)
    return { frei: Number(s.bavail) * Number(s.bsize), gesamt: Number(s.blocks) * Number(s.bsize) }
  } catch {
    return platte()
  }
}

export async function darfAnlegen(u: Nutzer): Promise<boolean> {
  if (!speicherKonfiguriert()) return false
  return u.role !== 'user' || (await getSpeicherEinst()).wer === 'alle'
}

export async function speicherListen(u: Nutzer) {
  const alle = u.role !== 'user'
  const boxen = await q<Box & { besitzer: string }>(
    `SELECT b.*, u.username AS besitzer FROM speicher_boxen b JOIN users u ON u.id = b.user_id ${alle ? '' : 'WHERE b.user_id = $1'} ORDER BY b.created_at`,
    alle ? [] : [u.id]
  )
  const unter = boxen.length
    ? await q<{ box_id: number; n: string }>(
        'SELECT box_id, count(*) AS n FROM speicher_unterkonten WHERE box_id = ANY($1::int[]) GROUP BY box_id',
        [boxen.map((b) => b.id)]
      )
    : []
  const buckets = await q<Bucket & { besitzer: string; schluessel: number }>(
    `SELECT b.*, u.username AS besitzer, (SELECT count(*) FROM speicher_schluessel s WHERE s.bucket_id = b.id) AS schluessel
    FROM speicher_buckets b JOIN users u ON u.id = b.user_id ${alle ? '' : 'WHERE b.user_id = $1'} ORDER BY b.created_at`,
    alle ? [] : [u.id]
  )
  return {
    boxen: boxen.map((b) => ({ ...boxAnsicht(b), unterkonten: Number(unter.find((x) => x.box_id === b.id)?.n || 0) })),
    buckets: buckets.map(bucketAnsicht)
  }
}
