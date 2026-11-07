import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomInt } from 'node:crypto'
import { q, q1 } from './db'
import { hashPw, type Nutzer } from './auth'
import { st } from './settings'
import {
  BOXEN_APP,
  BOXEN_SFTPGO,
  dienstFehlerMelden,
  fuerSftpgo,
  getSpeicherEinst,
  neuesPasswort,
  sftpgo,
  speicherKonfiguriert
} from './speicherdienst'

export const GiB = 1024 ** 3
const VOLL = ['list', 'download', 'upload', 'overwrite', 'delete', 'rename', 'create_dirs']
const LESEN = ['list', 'download']
const MAX_UNTER = 20

export interface Box {
  id: number
  user_id: number
  name: string
  kennung: string
  kontingent: string
  passwort_hash: string
  ssh_keys: string[]
  sftp: boolean
  webdav: boolean
  belegt: string
  dateien: string
  zuletzt_login: string | null
  gewarnt: number
  created_at: string
}
export interface Unterkonto {
  id: number
  box_id: number
  nr: number
  login: string
  ordner: string
  schreiben: boolean
  notiz: string
  passwort_hash: string
  ssh_keys: string[]
  zuletzt_login: string | null
  created_at: string
}

const ordnerName = (b: Pick<Box, 'id'>) => `box-${b.id}`
const ordnerSftpgo = (b: Pick<Box, 'id'>) => `${BOXEN_SFTPGO}/boxen/${b.id}`
const ordnerApp = (b: Pick<Box, 'id'>) => join(BOXEN_APP, 'boxen', String(Number(b.id)))
export const ORDNER_RE = /^[A-Za-z0-9_-][A-Za-z0-9._ -]{0,62}$/
const SSH_RE =
  /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/=]{40,1200}( [^\n\r]{0,200})?$/
export function sshPruefen(liste: unknown): string[] {
  if (!Array.isArray(liste)) return []
  const aus = liste.map((s) => String(s ?? '').trim()).filter(Boolean)
  if (aus.length > 20) throw fehler(400, st('Höchstens 20 SSH-Schlüssel.', 'At most 20 SSH keys.'))
  for (const k of aus)
    if (!SSH_RE.test(k))
      throw fehler(
        400,
        st(
          `Kein gültiger öffentlicher SSH-Schlüssel: ${k.slice(0, 40)}…`,
          `Not a valid public SSH key: ${k.slice(0, 40)}…`
        )
      )
  return [...new Set(aus)]
}

function gesperrteProtokolle(b: Pick<Box, 'sftp' | 'webdav'>): string[] {
  return ['FTP', 'HTTP', ...(b.sftp ? [] : ['SSH']), ...(b.webdav ? [] : ['DAV'])]
}
function nutzerDaten(b: Box, u?: Unterkonto) {
  const basis = {
    status: 1,
    password: fuerSftpgo(u ? u.passwort_hash : b.passwort_hash),
    public_keys: (u ? u.ssh_keys : b.ssh_keys) || [],
    home_dir: ordnerSftpgo(b),
    quota_size: 0,
    quota_files: 0,
    virtual_folders: [{ name: ordnerName(b), virtual_path: '/', quota_size: Number(b.kontingent), quota_files: 0 }],
    description: u ? `VylarisCloud: Unterkonto von ${b.kennung}` : `VylarisCloud: Box ${b.id}`
  }
  if (!u)
    return {
      ...basis,
      username: b.kennung,
      permissions: { '/': VOLL },
      filters: { denied_protocols: gesperrteProtokolle(b) }
    }
  const p = `/${u.ordner}`
  return {
    ...basis,
    username: u.login,
    permissions: { '/': ['list'], [p]: u.schreiben ? VOLL : LESEN },
    filters: {
      denied_protocols: gesperrteProtokolle(b),
      start_directory: p,
      file_patterns: [
        { path: '/', allowed_patterns: [u.ordner], deny_policy: 1 },
        { path: p, allowed_patterns: ['*'] }
      ]
    }
  }
}
async function nutzerSetzen(daten: { username: string } & Record<string, unknown>) {
  const da = await sftpgo('GET', `/users/${encodeURIComponent(daten.username)}`)
  if (da.status === 404) await sftpgo('POST', '/users', daten)
  else await sftpgo('PUT', `/users/${encodeURIComponent(daten.username)}`, daten)
}
async function nutzerWeg(login: string) {
  await sftpgo('DELETE', `/users/${encodeURIComponent(login)}`)
}

export async function boxAbgleichen(b: Box): Promise<void> {
  await fs.mkdir(ordnerApp(b), { recursive: true })
  const unter = await q<Unterkonto>('SELECT * FROM speicher_unterkonten WHERE box_id = $1 ORDER BY nr', [b.id])
  for (const u of unter) await fs.mkdir(join(ordnerApp(b), u.ordner), { recursive: true })
  const f = await sftpgo('GET', `/folders/${ordnerName(b)}`)
  const ordner = { name: ordnerName(b), mapped_path: ordnerSftpgo(b), description: `VylarisCloud: Box ${b.id}` }
  if (f.status === 404) await sftpgo('POST', '/folders', ordner)
  else await sftpgo('PUT', `/folders/${ordnerName(b)}`, ordner)
  await nutzerSetzen(nutzerDaten(b))
  for (const u of unter) await nutzerSetzen(nutzerDaten(b, u))
}

export async function boxLaden(id: number, u: Nutzer): Promise<Box> {
  const b = await q1<Box>('SELECT * FROM speicher_boxen WHERE id = $1', [Number(id) || 0])
  if (!b || (b.user_id !== u.id && u.role === 'user')) throw fehler(404, st('Box nicht gefunden.', 'Box not found.'))
  return b
}

export async function anlegenErlaubt(u: Nutzer, neueBytes: number): Promise<void> {
  if (!speicherKonfiguriert())
    throw fehler(409, st('Der Speicherdienst ist nicht eingeschaltet.', 'The storage service is not switched on.'))
  if (u.role !== 'user') return
  const e = await getSpeicherEinst()
  if (e.wer !== 'alle') throw fehler(403, st('Speicher legen hier nur Admins an.', 'Only admins create storage here.'))
  const r = await q1<{ n: string; summe: string }>(
    `SELECT (SELECT count(*) FROM speicher_boxen WHERE user_id = $1) + (SELECT count(*) FROM speicher_buckets WHERE user_id = $1) AS n,
    (SELECT coalesce(sum(kontingent), 0) FROM speicher_boxen WHERE user_id = $1) + (SELECT coalesce(sum(kontingent), 0) FROM speicher_buckets WHERE user_id = $1) AS summe`,
    [u.id]
  )
  if (e.maxAnzahl > 0 && Number(r?.n || 0) >= e.maxAnzahl)
    throw fehler(
      400,
      st(
        `Höchstens ${e.maxAnzahl} Boxen und Buckets pro Konto.`,
        `At most ${e.maxAnzahl} boxes and buckets per account.`
      )
    )
  if (e.grenzeGb > 0 && Number(r?.summe || 0) + neueBytes > e.grenzeGb * GiB)
    throw fehler(
      400,
      st(`Zusammen höchstens ${e.grenzeGb} GB pro Konto.`, `At most ${e.grenzeGb} GB in total per account.`)
    )
}
export async function kontingentErlaubt(u: Nutzer, alt: number, neu: number): Promise<void> {
  if (u.role !== 'user') return
  const e = await getSpeicherEinst()
  if (e.grenzeGb <= 0) return
  const r = await q1<{ summe: string }>(
    'SELECT (SELECT coalesce(sum(kontingent), 0) FROM speicher_boxen WHERE user_id = $1) + (SELECT coalesce(sum(kontingent), 0) FROM speicher_buckets WHERE user_id = $1) AS summe',
    [u.id]
  )
  if (Number(r?.summe || 0) - alt + neu > e.grenzeGb * GiB)
    throw fehler(
      400,
      st(`Zusammen höchstens ${e.grenzeGb} GB pro Konto.`, `At most ${e.grenzeGb} GB in total per account.`)
    )
}

async function neueKennung(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const k = `vd${randomInt(100000, 1000000)}`
    if (!(await q1('SELECT 1 FROM speicher_boxen WHERE kennung = $1', [k]))) return k
  }
  throw fehler(500, st('Keine freie Kennung gefunden.', 'No free identifier found.'))
}

export async function boxAnlegen(u: Nutzer, name: string, kontingent: number): Promise<{ box: Box; passwort: string }> {
  await anlegenErlaubt(u, kontingent)
  const passwort = neuesPasswort()
  const b = (
    await q<Box>(
      'INSERT INTO speicher_boxen (user_id, name, kennung, kontingent, passwort_hash) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [u.id, name, await neueKennung(), kontingent, await hashPw(passwort)]
    )
  )[0]!
  try {
    await boxAbgleichen(b)
  } catch (e) {
    await nutzerWeg(b.kennung).catch(() => {})
    await sftpgo('DELETE', `/folders/${ordnerName(b)}`).catch(() => {})
    await q('DELETE FROM speicher_boxen WHERE id = $1', [b.id])
    dienstFehlerMelden(e, 'Box anlegen')
  }
  return { box: b, passwort }
}

export async function boxAendern(
  b: Box,
  neu: Partial<Pick<Box, 'name' | 'sftp' | 'webdav' | 'ssh_keys'>> & { kontingent?: number }
): Promise<Box> {
  const z = (
    await q<Box>(
      `UPDATE speicher_boxen SET name = coalesce($2, name), kontingent = coalesce($3, kontingent), sftp = coalesce($4, sftp),
    webdav = coalesce($5, webdav), ssh_keys = coalesce($6::jsonb, ssh_keys), gewarnt = CASE WHEN $3::bigint IS NOT NULL THEN 0 ELSE gewarnt END
    WHERE id = $1 RETURNING *`,
      [
        b.id,
        neu.name ?? null,
        neu.kontingent ?? null,
        neu.sftp ?? null,
        neu.webdav ?? null,
        neu.ssh_keys ? JSON.stringify(neu.ssh_keys) : null
      ]
    )
  )[0]!
  if (
    neu.kontingent !== undefined ||
    neu.sftp !== undefined ||
    neu.webdav !== undefined ||
    neu.ssh_keys !== undefined
  ) {
    try {
      await boxAbgleichen(z)
    } catch (e) {
      dienstFehlerMelden(e, 'Box ändern')
    }
  }
  return z
}

export async function boxPasswortNeu(b: Box): Promise<string> {
  const pw = neuesPasswort()
  const z = (
    await q<Box>('UPDATE speicher_boxen SET passwort_hash = $2 WHERE id = $1 RETURNING *', [b.id, await hashPw(pw)])
  )[0]!
  try {
    await nutzerSetzen(nutzerDaten(z))
  } catch (e) {
    dienstFehlerMelden(e, 'Passwort setzen')
  }
  return pw
}

export async function boxLoeschen(b: Box): Promise<void> {
  const unter = await q<{ login: string }>('SELECT login FROM speicher_unterkonten WHERE box_id = $1', [b.id])
  try {
    for (const u of unter) await nutzerWeg(u.login)
    await nutzerWeg(b.kennung)
    await sftpgo('DELETE', `/folders/${ordnerName(b)}`)
  } catch (e) {
    dienstFehlerMelden(e, 'Box löschen')
  }
  await q('DELETE FROM speicher_boxen WHERE id = $1', [b.id])
  await fs
    .rm(ordnerApp(b), { recursive: true, force: true })
    .catch((e) => console.error('[vylariscloud] Box-Ordner nicht gelöscht:', e.message))
}

export async function unterkontoAnlegen(
  b: Box,
  d: { ordner: string; schreiben: boolean; notiz: string }
): Promise<{ konto: Unterkonto; passwort: string }> {
  if (!ORDNER_RE.test(d.ordner) || d.ordner.includes('..'))
    throw fehler(
      400,
      st(
        'Ordnername: Buchstaben, Ziffern, Punkt, Bindestrich, Unterstrich und Leerzeichen (eine Ebene).',
        'Folder name: letters, digits, dot, hyphen, underscore and spaces (one level).'
      )
    )
  const n = await q1<{ n: string; max: number | null }>(
    'SELECT count(*) AS n, max(nr) AS max FROM speicher_unterkonten WHERE box_id = $1',
    [b.id]
  )
  if (Number(n?.n || 0) >= MAX_UNTER)
    throw fehler(400, st(`Höchstens ${MAX_UNTER} Unterkonten pro Box.`, `At most ${MAX_UNTER} sub-accounts per box.`))
  const nr = Number(n?.max || 0) + 1
  const passwort = neuesPasswort()
  const konto = (
    await q<Unterkonto>(
      'INSERT INTO speicher_unterkonten (box_id, nr, login, ordner, schreiben, notiz, passwort_hash) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [b.id, nr, `${b.kennung}-sub${nr}`, d.ordner, d.schreiben, d.notiz, await hashPw(passwort)]
    )
  )[0]!
  try {
    await fs.mkdir(join(ordnerApp(b), konto.ordner), { recursive: true })
    await nutzerSetzen(nutzerDaten(b, konto))
  } catch (e) {
    await nutzerWeg(konto.login).catch(() => {})
    await q('DELETE FROM speicher_unterkonten WHERE id = $1', [konto.id])
    dienstFehlerMelden(e, 'Unterkonto anlegen')
  }
  return { konto, passwort }
}
export async function unterkontoLaden(b: Box, id: number): Promise<Unterkonto> {
  const u = await q1<Unterkonto>('SELECT * FROM speicher_unterkonten WHERE id = $1 AND box_id = $2', [
    Number(id) || 0,
    b.id
  ])
  if (!u) throw fehler(404, st('Unterkonto nicht gefunden.', 'Sub-account not found.'))
  return u
}
export async function unterkontoAendern(
  b: Box,
  u: Unterkonto,
  neu: { schreiben?: boolean; notiz?: string; ssh_keys?: string[]; passwort?: boolean }
): Promise<{ konto: Unterkonto; passwort?: string }> {
  const pw = neu.passwort ? neuesPasswort() : undefined
  const z = (
    await q<Unterkonto>(
      `UPDATE speicher_unterkonten SET schreiben = coalesce($2, schreiben), notiz = coalesce($3, notiz),
    ssh_keys = coalesce($4::jsonb, ssh_keys), passwort_hash = coalesce($5, passwort_hash) WHERE id = $1 RETURNING *`,
      [
        u.id,
        neu.schreiben ?? null,
        neu.notiz ?? null,
        neu.ssh_keys ? JSON.stringify(neu.ssh_keys) : null,
        pw ? await hashPw(pw) : null
      ]
    )
  )[0]!
  try {
    await nutzerSetzen(nutzerDaten(b, z))
  } catch (e) {
    dienstFehlerMelden(e, 'Unterkonto ändern')
  }
  return { konto: z, passwort: pw }
}
export async function unterkontoLoeschen(u: Unterkonto): Promise<void> {
  try {
    await nutzerWeg(u.login)
  } catch (e) {
    dienstFehlerMelden(e, 'Unterkonto löschen')
  }
  await q('DELETE FROM speicher_unterkonten WHERE id = $1', [u.id])
}

export async function boxMessen(b: Box): Promise<{ belegt: number; dateien: number }> {
  const f = await sftpgo('GET', `/folders/${ordnerName(b)}`)
  if (f.status === 404) return { belegt: Number(b.belegt), dateien: Number(b.dateien) }
  const belegt = Number(f.json?.used_quota_size || 0),
    dateien = Number(f.json?.used_quota_files || 0)
  const haupt = await sftpgo('GET', `/users/${encodeURIComponent(b.kennung)}`)
  const zuletzt = Number(haupt.json?.last_login || 0)
  await q(
    'UPDATE speicher_boxen SET belegt = $2, dateien = $3, zuletzt_login = coalesce($4, zuletzt_login) WHERE id = $1',
    [b.id, belegt, dateien, zuletzt ? new Date(zuletzt).toISOString() : null]
  )
  const unter = await q<Unterkonto>('SELECT * FROM speicher_unterkonten WHERE box_id = $1', [b.id])
  for (const u of unter) {
    const r = await sftpgo('GET', `/users/${encodeURIComponent(u.login)}`)
    const z = Number(r.json?.last_login || 0)
    if (z)
      await q('UPDATE speicher_unterkonten SET zuletzt_login = $2 WHERE id = $1', [u.id, new Date(z).toISOString()])
  }
  return { belegt, dateien }
}
export async function boxNeuZaehlen(b: Box): Promise<void> {
  await sftpgo('POST', `/quotas/folders/${ordnerName(b)}/scan`).catch(() => {})
}
