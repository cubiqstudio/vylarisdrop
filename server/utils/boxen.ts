import { promises as fs } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import { q, q1 } from './db'
import { hashPw, type Nutzer } from './auth'
import { st } from './settings'
import type { Ausf } from './quota'
import { besitzerLaden, budgetPruefen, mitBudgetSperre, speicherErlaubt } from './speicherBudget'
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

/**
 * Legt den Unterordner eines Unterkontos in der Box an — und nur dort: Name streng geprüft (eine Ebene, keine Schrägstriche,
 * kein ".."), Ergebnis liegt garantiert unter dem Box-Ordner, weder Box-Ordner noch Unterordner sind ein Symlink (auch nicht
 * nach dem Anlegen, geprüft per realpath).
 */
export async function unterordnerAnlegen(b: Pick<Box, 'id'>, name: string): Promise<string> {
  const falsch = () =>
    fehler(
      400,
      st(
        'Ordnername: Buchstaben, Ziffern, Punkt, Bindestrich, Unterstrich und Leerzeichen (eine Ebene).',
        'Folder name: letters, digits, dot, hyphen, underscore and spaces (one level).'
      )
    )
  if (typeof name !== 'string' || !ORDNER_RE.test(name) || name.includes('..') || /[\\/\0]/.test(name) || name.endsWith(' ') || name.endsWith('.'))
    throw falsch()
  const wurzel = resolve(ordnerApp(b))
  const ziel = resolve(wurzel, name)
  if (ziel === wurzel || !ziel.startsWith(wurzel + sep) || ziel.slice(wurzel.length + 1).includes(sep)) throw falsch()
  await fs.mkdir(wurzel, { recursive: true })
  if ((await fs.lstat(wurzel)).isSymbolicLink()) throw falsch()
  const lst = await fs.lstat(ziel).catch((e: any) => (e?.code === 'ENOENT' ? null : Promise.reject(e)))
  if (lst && (lst.isSymbolicLink() || !lst.isDirectory())) throw falsch()
  if (!lst) await fs.mkdir(ziel)
  const [echtW, echtZ] = [await fs.realpath(wurzel), await fs.realpath(ziel)]
  if (!echtZ.startsWith(echtW + sep)) throw falsch()
  return ziel
}

export async function boxAbgleichen(b: Box): Promise<void> {
  await fs.mkdir(ordnerApp(b), { recursive: true })
  const unter = await q<Unterkonto>('SELECT * FROM speicher_unterkonten WHERE box_id = $1 ORDER BY nr', [b.id])
  for (const u of unter) await unterordnerAnlegen(b, u.ordner)
  const f = await sftpgo('GET', `/folders/${ordnerName(b)}`)
  const ordner = { name: ordnerName(b), mapped_path: ordnerSftpgo(b), description: `VylarisCloud: Box ${b.id}` }
  if (f.status === 404) await sftpgo('POST', '/folders', ordner)
  else await sftpgo('PUT', `/folders/${ordnerName(b)}`, ordner)
  await nutzerSetzen(nutzerDaten(b))
  for (const u of unter) await nutzerSetzen(nutzerDaten(b, u))
}

/** Zeilen-ID aus der URL: nur ganze Zahlen im Bereich von int4, alles andere (1.5, 1e3, 99999999999, abc) ist "nicht gefunden" */
export const idAus = (v: unknown): number => {
  const n = typeof v === 'string' && /^[1-9]\d{0,9}$/.test(v) ? Number(v) : typeof v === 'number' ? v : 0
  return Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647 ? n : 0
}
/** Box laden; fremde Boxen sind für normale Konten "nicht gefunden" (404, nicht 403, damit sich IDs nicht abtasten lassen) */
export async function boxLaden(id: unknown, u: Nutzer): Promise<Box> {
  const n = idAus(id)
  const b = n ? await q1<Box>('SELECT * FROM speicher_boxen WHERE id = $1', [n]) : null
  if (!b || (b.user_id !== u.id && u.role === 'user')) throw fehler(404, st('Box nicht gefunden.', 'Box not found.'))
  return b
}

/**
 * Darf `u` eine Box/einen Bucket mit `neueBytes` anlegen? Dienst an, "Wer darf?", maxAnzahl, grenzeGb und das Budget aus dem
 * Kontingent (speicherBudget.ts). Verbindlich nur innerhalb von mitBudgetSperre() (`x` der Sperre).
 */
export async function anlegenErlaubt(u: Nutzer, neueBytes: number, x: Ausf): Promise<void> {
  if (!speicherKonfiguriert())
    throw fehler(409, st('Der Speicherdienst ist nicht eingeschaltet.', 'The storage service is not switched on.'))
  await speicherErlaubt(u)
  await budgetPruefen(await besitzerLaden(u.id), u, 0, neueBytes, true, x)
}

const KENNUNG_ZEICHEN = 'abcdefghijklmnopqrstuvwxyz0123456789'
/** Anmeldename der Box (SFTP/WebDAV): "vd" + 10 zufällige Zeichen (rund 51 Bit) — nicht erratbar, kein Zähler */
async function neueKennung(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const b = randomBytes(10)
    const k = 'vd' + Array.from(b, (x) => KENNUNG_ZEICHEN[x % KENNUNG_ZEICHEN.length]).join('')
    if (!(await q1('SELECT 1 FROM speicher_boxen WHERE kennung = $1', [k]))) return k
  }
  throw fehler(500, st('Keine freie Kennung gefunden.', 'No free identifier found.'))
}

export async function boxAnlegen(u: Nutzer, name: string, kontingent: number): Promise<{ box: Box; passwort: string }> {
  const passwort = neuesPasswort()
  const hash = await hashPw(passwort)
  const kennung = await neueKennung()
  // Prüfen und Eintragen unter der Konto-Sperre: parallele Anlegen/Uploads sehen die Reservierung sofort
  const b = await mitBudgetSperre(u.id, async (x) => {
    await anlegenErlaubt(u, kontingent, x)
    return (
      await x(
        'INSERT INTO speicher_boxen (user_id, name, kennung, kontingent, passwort_hash) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [u.id, name, kennung, kontingent, hash]
      )
    )[0] as Box
  })
  try {
    await boxAbgleichen(b)
  } catch (e) {
    await nutzerWeg(b.kennung).catch(() => {})
    await sftpgo('DELETE', `/folders/${ordnerName(b)}`).catch(() => {})
    await q('DELETE FROM speicher_boxen WHERE id = $1', [b.id])
    await fs.rm(ordnerApp(b), { recursive: true, force: true }).catch(() => {})
    dienstFehlerMelden(e, 'Box anlegen')
  }
  return { box: b, passwort }
}

export async function boxAendern(
  b: Box,
  neu: Partial<Pick<Box, 'name' | 'sftp' | 'webdav' | 'ssh_keys'>> & { kontingent?: number },
  aktor: Nutzer
): Promise<Box> {
  const update = (x: Ausf, id: number, n: typeof neu) =>
    x(
      `UPDATE speicher_boxen SET name = coalesce($2, name), kontingent = coalesce($3, kontingent), sftp = coalesce($4, sftp),
    webdav = coalesce($5, webdav), ssh_keys = coalesce($6::jsonb, ssh_keys), gewarnt = CASE WHEN $3::bigint IS NOT NULL THEN 0 ELSE gewarnt END
    WHERE id = $1 RETURNING *`,
      [
        id,
        n.name ?? null,
        n.kontingent ?? null,
        n.sftp ?? null,
        n.webdav ?? null,
        n.ssh_keys ? JSON.stringify(n.ssh_keys) : null
      ]
    ).then((r) => r[0] as Box)
  if (neu.kontingent === undefined) {
    const z = await update((s, p = []) => q(s, p), b.id, neu)
    if (neu.sftp !== undefined || neu.webdav !== undefined || neu.ssh_keys !== undefined) {
      try {
        await boxAbgleichen(z)
      } catch (e) {
        dienstFehlerMelden(e, 'Box ändern')
      }
    }
    return z
  }
  // Kontingent: alles unter der Konto-Sperre des BESITZERS (auch wenn ein Admin handelt), Dienst inklusive
  if (!speicherKonfiguriert())
    throw fehler(409, st('Der Speicherdienst ist nicht eingeschaltet.', 'The storage service is not switched on.'))
  return mitBudgetSperre(b.user_id, async (x) => {
    const alt = (await x('SELECT * FROM speicher_boxen WHERE id = $1', [b.id]))[0] as Box | undefined
    if (!alt) throw fehler(404, st('Box nicht gefunden.', 'Box not found.'))
    const neuK = neu.kontingent!
    if (neuK < Number(alt.kontingent)) {
      // Verkleinern nur, wenn die Box ins neue Kontingent passt — gegen eine frische Messung, nicht gegen den Stundenwert
      let belegt = 0
      try {
        belegt = (await boxMessen(alt)).belegt
      } catch (e) {
        dienstFehlerMelden(e, 'Box messen')
      }
      if (belegt > neuK)
        throw fehler(
          400,
          st(
            'Das Kontingent darf nicht kleiner sein als die Belegung.',
            'The quota cannot be smaller than the space in use.'
          )
        )
    } else if (neuK > Number(alt.kontingent)) {
      await speicherErlaubt(aktor)
      await budgetPruefen(await besitzerLaden(alt.user_id), aktor, Number(alt.kontingent), neuK, false, x)
    }
    const z = await update(x, b.id, neu)
    try {
      await boxAbgleichen(z)
    } catch (e) {
      // Zurückrollen, damit Datenbank (und damit das Budget) und Dienst wieder zusammenpassen
      await x(
        'UPDATE speicher_boxen SET name = $2, kontingent = $3, sftp = $4, webdav = $5, ssh_keys = $6::jsonb, gewarnt = $7 WHERE id = $1',
        [alt.id, alt.name, alt.kontingent, alt.sftp, alt.webdav, JSON.stringify(alt.ssh_keys || []), alt.gewarnt]
      )
      boxAbgleichen(alt).catch(() => {})
      dienstFehlerMelden(e, 'Box ändern')
    }
    return z
  })
}

export async function boxPasswortNeu(b: Box): Promise<string> {
  const pw = neuesPasswort()
  const z = (
    await q<Box>('UPDATE speicher_boxen SET passwort_hash = $2 WHERE id = $1 RETURNING *', [b.id, await hashPw(pw)])
  )[0]!
  try {
    await boxAbgleichen(z)
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
  const passwort = neuesPasswort()
  const hash = await hashPw(passwort)
  // Zählen + Eintragen unter der Konto-Sperre: parallele Anfragen überschreiten MAX_UNTER nicht und bekommen nie dieselbe Nummer
  const konto = await mitBudgetSperre(b.user_id, async (x) => {
    await unterordnerAnlegen(b, d.ordner)
    const n = (
      await x('SELECT count(*) AS n, max(nr) AS max FROM speicher_unterkonten WHERE box_id = $1', [b.id])
    )[0]
    if (Number(n?.n || 0) >= MAX_UNTER)
      throw fehler(400, st(`Höchstens ${MAX_UNTER} Unterkonten pro Box.`, `At most ${MAX_UNTER} sub-accounts per box.`))
    const nr = Number(n?.max || 0) + 1
    return (
      await x(
        'INSERT INTO speicher_unterkonten (box_id, nr, login, ordner, schreiben, notiz, passwort_hash) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [b.id, nr, `${b.kennung}-sub${nr}`, d.ordner, d.schreiben, d.notiz, hash]
      )
    )[0] as Unterkonto
  })
  try {
    await nutzerSetzen(nutzerDaten(b, konto))
  } catch (e) {
    await nutzerWeg(konto.login).catch(() => {})
    await q('DELETE FROM speicher_unterkonten WHERE id = $1', [konto.id])
    dienstFehlerMelden(e, 'Unterkonto anlegen')
  }
  return { konto, passwort }
}
export async function unterkontoLaden(b: Box, id: unknown): Promise<Unterkonto> {
  const n = idAus(id)
  const u = n
    ? await q1<Unterkonto>('SELECT * FROM speicher_unterkonten WHERE id = $1 AND box_id = $2', [n, b.id])
    : null
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

function kontingentAbweichung(b: Box, user: any, fehlt: boolean): boolean {
  if (fehlt || !user) return true
  const vf = Array.isArray(user.virtual_folders) ? user.virtual_folders : []
  const mein = vf.find((f: any) => f?.name === ordnerName(b))
  return !mein || Number(mein.quota_size) !== Number(b.kontingent) || Number(user.quota_size || 0) !== 0
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
  // Durchsetzung: das Kontingent im Dienst muss dem in der Datenbank entsprechen (Abweichung durch Eingriff im Dienst,
  // Wiederherstellung oder abgebrochene Änderung). Maßgeblich ist immer die Datenbank, nicht der Dienst.
  const frisch = await q1<Box>('SELECT * FROM speicher_boxen WHERE id = $1', [b.id])
  let abweichung = !!frisch && kontingentAbweichung(frisch, haupt.json, haupt.status === 404)
  for (const u of unter) {
    const r = await sftpgo('GET', `/users/${encodeURIComponent(u.login)}`)
    const z = Number(r.json?.last_login || 0)
    if (z)
      await q('UPDATE speicher_unterkonten SET zuletzt_login = $2 WHERE id = $1', [u.id, new Date(z).toISOString()])
    if (frisch && kontingentAbweichung(frisch, r.json, r.status === 404)) abweichung = true
  }
  if (frisch && abweichung) {
    console.error(`[vylariscloud] Speicher: Kontingent von Box ${b.id} im Dienst weicht ab — wird neu gesetzt`)
    await boxAbgleichen(frisch).catch((e) => console.error('[vylariscloud] Box-Abgleich:', e.message))
  }
  return { belegt, dateien }
}
export async function boxNeuZaehlen(b: Box): Promise<void> {
  await sftpgo('POST', `/quotas/folders/${ordnerName(b)}/scan`).catch(() => {})
}
