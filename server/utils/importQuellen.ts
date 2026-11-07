import { createWriteStream, promises as fs } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { basename, dirname, join, relative, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import { q } from './db'
import { hashPw } from './auth'
import { istSlug } from './namen'
import { sLang } from './settings'
import {
  analyseSpeichern,
  importAblage,
  importMelden,
  importWurzel,
  innerhalb,
  ladeImport,
  quelleJson,
  zipLesen,
  zipText,
  type ImportAnalyse,
  type ImportNutzer,
  type ImportPosten,
  type ImportZeile,
  type PostenQuelle,
  type ZipArchiv
} from './importKern'
import {
  albumCkLesen,
  albumLesen,
  driveKontoLesen,
  driveLinkLesen,
  icloudBereit,
  linkErkennen,
  mediathekLesen,
  type Sitzung
} from './icloud'

const de = () => sLang() !== 'en'
const tx = (d: string, e: string) => (de() ? d : e)
const nz = (n: number, eins: [string, string], viele: [string, string]) => (n === 1 ? tx(...eins) : tx(...viele))
const GRENZE = 300_000

interface Ctx {
  imp: ImportZeile
  admin: boolean
  melden: (t: string) => Promise<void>
  archive: ZipArchiv[]
}

export async function importAnalysieren(id: number): Promise<void> {
  const imp = await ladeImport(id)
  if (!imp) return
  const nutzer = await q<{ role: string }>('SELECT role FROM users WHERE id = $1', [imp.user_id])
  const ctx: Ctx = { imp, admin: nutzer[0]?.role !== 'user', melden: (t) => importMelden(id, t), archive: [] }
  try {
    const a = await ADAPTER[imp.quelle](ctx)
    if (!a.posten.length)
      throw fehler(400, 'In dieser Quelle wurden keine Dateien gefunden.', 'No files were found in this source.')
    if (a.posten.length > GRENZE)
      throw fehler(
        400,
        `Mehr als ${GRENZE.toLocaleString('de-DE')} Dateien — bitte in mehrere Läufe aufteilen.`,
        `More than ${GRENZE} files — please split into several runs.`
      )
    await analyseSpeichern(id, a)
  } catch (e: any) {
    const m = String(e?.data?.message || e?.message || e).slice(0, 300)
    await q(`UPDATE importe SET status = 'entwurf', meldung = $2 WHERE id = $1`, [id, m])
  } finally {
    for (const a of ctx.archive) a.zip.close()
  }
}

const ohneEndung = (n: string) => n.replace(/\.[A-Za-z0-9]{1,10}$/, '')
const slugAus = (n: string) => {
  const s = ohneEndung(String(n || ''))
  return istSlug(s) ? s : undefined
}
const zeit = (v: unknown): string | null => {
  if (v == null || v === '') return null
  const d =
    typeof v === 'number' || /^\d{10,13}$/.test(String(v))
      ? new Date(Number(v) < 1e12 ? Number(v) * 1000 : Number(v))
      : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const basisUrl = (u: string) => {
  let s = String(u || '').trim()
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  try {
    const x = new URL(s)
    return x.origin + x.pathname.replace(/\/+$/, '')
  } catch {
    throw fehler(400, 'Die Adresse ist ungültig.', 'The address is invalid.')
  }
}
const SYSTEM = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX\/.*|\.[^/]+)$/i

interface Eintrag {
  rel: string
  groesse: number
  datum: string | null
  quelle: PostenQuelle
  text: () => Promise<string>
  pfad?: string
}

async function eintraege(ctx: Ctx, opt: { zipsAufklappen?: boolean } = {}): Promise<Eintrag[]> {
  const aus: Eintrag[] = []
  let wurzel: string
  if (ctx.imp.weg === 'ordner') {
    if (!ctx.admin)
      throw fehler(403, 'Server-Ordner dürfen nur Admins importieren.', 'Only admins can import server folders.')
    wurzel = await innerhalb(importWurzel(), String(ctx.imp.zugang?.ordner || ''))
  } else wurzel = importAblage(ctx.imp.id)
  const st = await fs.stat(wurzel).catch(() => null)
  if (!st?.isDirectory())
    throw fehler(
      400,
      ctx.imp.weg === 'ordner' ? 'Der Ordner wurde nicht gefunden.' : 'Es wurden noch keine Dateien hochgeladen.',
      ctx.imp.weg === 'ordner' ? 'The folder was not found.' : 'No files have been uploaded yet.'
    )
  const zips: string[] = []
  const gehen = async (dir: string) => {
    for (const d of await fs.readdir(dir, { withFileTypes: true })) {
      if (aus.length > GRENZE) return
      const voll = join(dir, d.name)
      if (d.isDirectory()) {
        if (!d.name.startsWith('.')) await gehen(voll)
        continue
      }
      if (!d.isFile()) continue
      const rel = relative(wurzel, voll).split(sep).join('/')
      if (SYSTEM.test(rel) || /\.rdteil$/.test(rel)) continue
      if (opt.zipsAufklappen !== false && /\.zip$/i.test(d.name)) {
        zips.push(voll)
        continue
      }
      const s = await fs.stat(voll)
      aus.push({
        rel,
        groesse: s.size,
        datum: s.mtime.toISOString(),
        quelle: { art: 'datei', pfad: voll },
        pfad: voll,
        text: () => fs.readFile(voll, 'utf8')
      })
    }
  }
  await gehen(wurzel)
  for (const z of zips) {
    await ctx.melden(tx(`Archiv wird gelesen: ${basename(z)} …`, `Reading archive: ${basename(z)} …`))
    let a: ZipArchiv
    try {
      a = await zipLesen(z)
    } catch {
      throw fehler(
        400,
        `„${basename(z)}“ ist kein lesbares ZIP-Archiv.`,
        `“${basename(z)}” is not a readable ZIP archive.`
      )
    }
    for (const [name, en] of a.eintraege) {
      if (SYSTEM.test(name)) continue
      aus.push({
        rel: name,
        groesse: en.uncompressedSize,
        datum: en.getLastModDate?.()?.toISOString?.() || null,
        quelle: { art: 'zip', zip: z, eintrag: name },
        text: () => zipText(a, name)
      })
    }
    ctx.archive.push(a)
  }
  return aus
}

async function seiten(
  ctx: Ctx,
  holen: (seite: number) => Promise<any[]>,
  text: (n: number) => string,
  start = 1
): Promise<any[]> {
  const alle: any[] = []
  for (let s = start; s < start + 20_000; s++) {
    const r = await holen(s)
    if (!r.length) break
    alle.push(...r)
    await ctx.melden(text(alle.length))
    if (alle.length > GRENZE) break
  }
  return alle
}

async function zipline(ctx: Ctx): Promise<ImportAnalyse> {
  const z = ctx.imp.zugang || {}
  if (ctx.imp.weg === 'live') {
    const basis = basisUrl(z.url)
    ctx.imp.zugang = { ...z, basis, header: { authorization: String(z.token || '').trim() } }
    await q(`UPDATE importe SET zugang = $2::jsonb WHERE id = $1`, [ctx.imp.id, JSON.stringify(ctx.imp.zugang)])
    if (!z.token)
      throw fehler(
        400,
        'Bitte den API-Schlüssel (Token) aus Zipline eintragen.',
        'Please enter the API token from Zipline.'
      )
    await ctx.melden(tx('Verbinde mit Zipline …', 'Connecting to Zipline …'))
    const v4 = await quelleJson(ctx, basis + '/api/server/export?nometrics=true').catch(() => null)
    if (v4?.versions?.export === '4') return ziplineExport(ctx, v4, { art: 'url', basis })
    const v3 = await quelleJson(ctx, basis + '/api/admin/export').catch(() => null)
    if (v3?.versions?.export === '3') return ziplineExport(ctx, v3, { art: 'url', basis })
    return ziplineEigene(ctx, basis)
  }
  const liste = await eintraege(ctx, { zipsAufklappen: false })
  const exp =
    liste.find((e) => /zipline4?_export_.*\.json$/i.test(e.rel)) ||
    liste.find((e) => /\.json$/i.test(e.rel) && e.groesse < 300 * 1024 * 1024)
  if (!exp)
    throw fehler(
      400,
      'Keine Zipline-Export-Datei (zipline_export_….json) gefunden.',
      'No Zipline export file (zipline_export_….json) found.'
    )
  let daten: any
  try {
    daten = JSON.parse(await exp.text())
  } catch {
    throw fehler(400, 'Die Export-Datei ist kein gültiges JSON.', 'The export file is not valid JSON.')
  }
  if (ctx.imp.weg === 'datei' && exp.pfad) await fs.rm(exp.pfad, { force: true }).catch(() => {})
  if (daten?.request) delete daten.request
  if (ctx.imp.weg === 'ordner') {
    const dateien = new Map<string, string>()
    for (const e of liste) if (e.pfad) dateien.set(basename(e.rel), e.pfad)
    return ziplineExport(ctx, daten, { art: 'ordner', dateien })
  }
  if (!z.url)
    throw fehler(
      400,
      'Bitte die Adresse der alten Zipline-Instanz eintragen — von dort werden die Dateien geladen.',
      'Please enter the address of the old Zipline instance — the files are loaded from there.'
    )
  const basis = basisUrl(z.url)
  ctx.imp.zugang = { ...z, basis, header: {} }
  await q(`UPDATE importe SET zugang = $2::jsonb WHERE id = $1`, [ctx.imp.id, JSON.stringify(ctx.imp.zugang)])
  return ziplineExport(ctx, daten, { art: 'url', basis })
}

type ZlDateien = { art: 'url'; basis: string } | { art: 'ordner'; dateien: Map<string, string> }

function ziplineExport(ctx: Ctx, d: any, wo: ZlDateien): ImportAnalyse {
  const v = String(d?.versions?.export || '')
  if (v !== '3' && v !== '4')
    throw fehler(
      400,
      'Das ist kein Zipline-Export (Version 3 oder 4).',
      'This is not a Zipline export (version 3 or 4).'
    )
  const nutzer: ImportNutzer[] = []
  const posten: ImportPosten[] = []
  const hinweise: string[] = []
  let ohneDatei = 0,
    gesperrt = 0
  const quelle = (name: string, pw: boolean): PostenQuelle | null => {
    if (wo.art === 'ordner') {
      const p = wo.dateien.get(name)
      if (!p) {
        ohneDatei++
        return null
      }
      return { art: 'datei', pfad: p }
    }
    if (pw) {
      gesperrt++
      return null
    }
    return { art: 'url', url: `${wo.basis}/${v === '3' ? 'r' : 'raw'}/${encodeURIComponent(name)}` }
  }
  const pfade = (name: string) =>
    v === '3'
      ? [
          { pfad: '/u/' + name, ziel: 'seite' as const },
          { pfad: '/r/' + name, ziel: 'direkt' as const }
        ]
      : [
          { pfad: '/u/' + name, ziel: 'seite' as const },
          { pfad: '/raw/' + name, ziel: 'direkt' as const }
        ]

  if (v === '3') {
    for (const [id, u] of Object.entries<any>(d.users || {}))
      nutzer.push({
        schluessel: id,
        username: String(u.username || ''),
        passwortHash: u.password || '',
        admin: !!(u.administrator || u.super_administrator)
      })
    const ordnerVon = new Map<string, string>()
    for (const f of Object.values<any>(d.folders || {}))
      for (const fid of f.files || []) ordnerVon.set(String(fid), String(f.name || ''))
    for (const [id, f] of Object.entries<any>(d.files || {})) {
      const qu = quelle(String(f.name), !!f.password)
      if (!qu) continue
      posten.push({
        schluessel: 'zl3:' + id,
        name: String(f.original_name || f.name),
        quelle: qu,
        mime: f.type,
        groesse: Number(f.size) || 0,
        slug: slugAus(f.name),
        erstellt: zeit(f.created_at),
        ablauf: zeit(f.expires_at),
        maxAufrufe: f.max_views ?? null,
        aufrufe: Number(f.views) || 0,
        favorit: !!f.favorite,
        passwortHash: f.password || '',
        besitzer: f.user ? String(f.user) : undefined,
        ordner: ordnerVon.get(id) ? [ordnerVon.get(id)!] : [],
        altePfade: pfade(String(f.name))
      })
    }
  } else {
    const x = d.data || {}
    const quota = new Map<string, number>()
    for (const qu of x.userQuotas || [])
      if (qu.userId && qu.filesQuota === 'BY_BYTES' && qu.maxBytes) quota.set(qu.userId, Number(qu.maxBytes))
    for (const u of x.users || [])
      nutzer.push({
        schluessel: u.id,
        username: String(u.username || ''),
        passwortHash: u.password || '',
        admin: u.role === 'ADMIN' || u.role === 'SUPERADMIN',
        quotaBytes: quota.get(u.id) ?? null
      })
    const ordner = new Map<string, any>((x.folders || []).map((f: any) => [f.id, f]))
    const pfadVon = (id: string | null | undefined): string[] => {
      const aus: string[] = []
      const gesehen = new Set<string>()
      for (
        let f = id ? ordner.get(id) : null;
        f && !gesehen.has(f.id);
        f = f.parentId ? ordner.get(f.parentId) : null
      ) {
        gesehen.add(f.id)
        aus.unshift(String(f.name || ''))
      }
      return aus
    }
    const tagsVon = new Map<string, string[]>()
    for (const t of x.userTags || [])
      for (const fid of t.files || []) tagsVon.set(fid, [...(tagsVon.get(fid) || []), String(t.name)])
    for (const f of x.files || []) {
      const qu = quelle(String(f.name), !!f.password)
      if (!qu) continue
      posten.push({
        schluessel: 'zl4:' + f.id,
        name: String(f.originalName || f.name),
        quelle: qu,
        mime: f.type,
        groesse: Number(f.size) || 0,
        slug: slugAus(f.name),
        erstellt: zeit(f.createdAt),
        ablauf: zeit(f.deletesAt),
        maxAufrufe: f.maxViews ?? null,
        aufrufe: Number(f.views) || 0,
        favorit: !!f.favorite,
        passwortHash: f.password || '',
        besitzer: f.userId || undefined,
        ordner: pfadVon(f.folderId),
        tags: tagsVon.get(f.id) || [],
        altePfade: pfade(String(f.name))
      })
    }
  }
  if (gesperrt)
    hinweise.push(
      nz(
        gesperrt,
        [
          '1 passwortgeschützte Datei lässt sich über die Adresse nicht laden — über den Server-Ordner kommt sie mit.',
          '1 password-protected file cannot be loaded via the address — it comes along via the server folder.'
        ],
        [
          `${gesperrt} passwortgeschützte Dateien lassen sich über die Adresse nicht laden — über den Server-Ordner kommen sie mit.`,
          `${gesperrt} password-protected files cannot be loaded via the address — they come along via the server folder.`
        ]
      )
    )
  if (ohneDatei)
    hinweise.push(
      nz(
        ohneDatei,
        [
          '1 Datei aus dem Export fehlt im Ordner (z. B. auf S3 gespeichert) und wird übersprungen.',
          '1 file from the export is missing in the folder (e.g. stored on S3) and is skipped.'
        ],
        [
          `${ohneDatei} Dateien aus dem Export fehlen im Ordner (z. B. auf S3 gespeichert) und werden übersprungen.`,
          `${ohneDatei} files from the export are missing in the folder (e.g. stored on S3) and are skipped.`
        ]
      )
    )
  hinweise.push(
    tx(
      'Kurz-URLs, Einladungen und Passkeys übernimmt VylarisCloud nicht.',
      'VylarisCloud does not take over short URLs, invites and passkeys.'
    )
  )
  return { titel: `Zipline v${v}`, nutzer, posten, hinweise }
}

async function ziplineEigene(ctx: Ctx, basis: string): Promise<ImportAnalyse> {
  const posten: ImportPosten[] = []
  const probe = await quelleJson(ctx, `${basis}/api/user/files?page=1&perpage=100`).catch(() => null)
  if (probe && Array.isArray(probe.page)) {
    const alle = await seiten(
      ctx,
      async (s) =>
        (s === 1 ? probe : await quelleJson(ctx, `${basis}/api/user/files?page=${s}&perpage=100`)).page || [],
      (n) => tx(`${n} Dateien gefunden …`, `${n} files found …`)
    )
    let gesperrt = 0
    for (const f of alle) {
      if (f.password) {
        gesperrt++
        continue
      }
      posten.push({
        schluessel: 'zl4:' + f.id,
        name: String(f.originalName || f.name),
        quelle: { art: 'url', url: `${basis}/raw/${encodeURIComponent(f.name)}` },
        mime: f.type,
        groesse: Number(f.size) || 0,
        slug: slugAus(f.name),
        erstellt: zeit(f.createdAt),
        ablauf: zeit(f.deletesAt),
        maxAufrufe: f.maxViews ?? null,
        aufrufe: Number(f.views) || 0,
        favorit: !!f.favorite,
        tags: (f.tags || []).map((t: any) => String(t.name || t)).filter(Boolean),
        altePfade: [
          { pfad: '/u/' + f.name, ziel: 'seite' },
          { pfad: '/raw/' + f.name, ziel: 'direkt' }
        ]
      })
    }
    return {
      titel: 'Zipline v4',
      nutzer: [],
      posten,
      hinweise: [
        tx(
          'Nur die Dateien des Token-Besitzers — für alle Konten, Ordner und Tags das Token eines Super-Admins verwenden.',
          'Only the token owner’s files — use a super admin token for all accounts, folders and tags.'
        ),
        ...(gesperrt
          ? [
              nz(
                gesperrt,
                ['1 passwortgeschützte Datei wird übersprungen.', '1 password-protected file is skipped.'],
                [
                  `${gesperrt} passwortgeschützte Dateien werden übersprungen.`,
                  `${gesperrt} password-protected files are skipped.`
                ]
              )
            ]
          : [])
      ]
    }
  }
  const a = await quelleJson(ctx, `${basis}/api/user/files`).catch(() => null)
  if (!Array.isArray(a))
    throw fehler(
      400,
      'Zipline hat nicht geantwortet — stimmen Adresse und Token?',
      'Zipline did not respond — are the address and token correct?'
    )
  const b = await quelleJson(ctx, `${basis}/api/user/files?favorite=1`).catch(() => [])
  const gesehen = new Set<string>()
  let gesperrt = 0
  for (const f of [...a, ...(Array.isArray(b) ? b : [])]) {
    if (gesehen.has(String(f.id))) continue
    gesehen.add(String(f.id))
    if (f.password) {
      gesperrt++
      continue
    }
    posten.push({
      schluessel: 'zl3:' + f.id,
      name: String(f.originalName || f.name),
      quelle: { art: 'url', url: `${basis}/r/${encodeURIComponent(f.name)}` },
      mime: f.mimetype,
      groesse: Number(f.size) || 0,
      slug: slugAus(f.name),
      erstellt: zeit(f.createdAt),
      ablauf: zeit(f.expiresAt),
      maxAufrufe: f.maxViews ?? null,
      aufrufe: Number(f.views) || 0,
      favorit: !!f.favorite,
      altePfade: [
        { pfad: '/u/' + f.name, ziel: 'seite' },
        { pfad: '/r/' + f.name, ziel: 'direkt' }
      ]
    })
  }
  return {
    titel: 'Zipline v3',
    nutzer: [],
    posten,
    hinweise: [
      tx(
        'Nur die Dateien des Token-Besitzers — für alle Konten das Token eines Super-Admins verwenden.',
        'Only the token owner’s files — use a super admin token for all accounts.'
      ),
      ...(gesperrt
        ? [
            nz(
              gesperrt,
              ['1 passwortgeschützte Datei wird übersprungen.', '1 password-protected file is skipped.'],
              [
                `${gesperrt} passwortgeschützte Dateien werden übersprungen.`,
                `${gesperrt} password-protected files are skipped.`
              ]
            )
          ]
        : [])
    ]
  }
}

async function sqliteLesen<T = any>(datei: string, sql: string): Promise<T[]> {
  const { DatabaseSync } = await import('node:sqlite' as any)
  const db = new DatabaseSync(datei, { readOnly: true })
  try {
    return db.prepare(sql).all() as T[]
  } finally {
    db.close()
  }
}
const sqliteTabellen = async (datei: string) =>
  (await sqliteLesen<{ name: string }>(datei, `SELECT name FROM sqlite_master WHERE type = 'table'`)).map((t) => t.name)

async function xbackbone(ctx: Ctx): Promise<ImportAnalyse> {
  const liste = await eintraege(ctx, { zipsAufklappen: false })
  const wurzel = await innerhalb(importWurzel(), String(ctx.imp.zugang?.ordner || ''))
  const cfgDatei = liste.find((e) => /(^|\/)config\.php$/.test(e.rel))
  const cfg = cfgDatei ? await cfgDatei.text() : ''
  const mysql = ctx.imp.zugang?.mysql || {}
  type Abfrage = <T = any>(sql: string) => Promise<T[]>
  let abfrage: Abfrage
  let schliessen = async () => {}
  const dbDatei = liste.find((e) => /\.(db|sqlite3?)$/i.test(e.rel))
  if (mysql.host || /'connection'\s*=>\s*'mysql'/.test(cfg)) {
    const dsn = /'dsn'\s*=>\s*'mysql:([^']*)'/.exec(cfg)?.[1] || ''
    const teil = (k: string) => new RegExp(`${k}=([^;]+)`).exec(dsn)?.[1]
    const { createConnection } = await import('mysql2/promise')
    const verb = await createConnection({
      host: mysql.host || teil('host') || 'localhost',
      port: Number(mysql.port || teil('port') || 3306),
      database: mysql.database || teil('dbname') || 'xbackbone',
      user: mysql.user || /'username'\s*=>\s*'([^']*)'/.exec(cfg)?.[1] || 'root',
      password: mysql.password ?? /'password'\s*=>\s*'([^']*)'/.exec(cfg)?.[1] ?? '',
      connectTimeout: 10_000
    }).catch((e: any) => {
      throw fehler(
        400,
        `Keine Verbindung zur XBackBone-Datenbank: ${e.message}`,
        `Could not connect to the XBackBone database: ${e.message}`
      )
    })
    abfrage = async (sql) => (await verb.query(sql))[0] as any[]
    schliessen = () => verb.end()
  } else if (dbDatei?.pfad) {
    abfrage = (sql) => sqliteLesen(dbDatei.pfad!, sql)
  } else
    throw fehler(
      400,
      'Keine XBackBone-Datenbank gefunden (resources/database/*.db) und keine MySQL-Angaben.',
      'No XBackBone database found (resources/database/*.db) and no MySQL details.'
    )

  try {
    await ctx.melden(tx('Lese XBackBone-Datenbank …', 'Reading XBackBone database …'))
    const users = await abfrage('SELECT * FROM users')
    const uploads = await abfrage('SELECT * FROM uploads ORDER BY id')
    const tags = await abfrage(
      'SELECT t.name, ut.upload_id FROM uploads_tags ut JOIN tags t ON t.id = ut.tag_id'
    ).catch(() => [] as any[])
    const tagsVon = new Map<string, string[]>()
    for (const t of tags)
      tagsVon.set(String(t.upload_id), [...(tagsVon.get(String(t.upload_id)) || []), String(t.name)])
    const codeVon = new Map<string, string>(users.map((u: any) => [String(u.id), String(u.user_code || '')]))
    const speicher = /'path'\s*=>\s*(?:__DIR__\s*\.\s*)?'([^']*storage[^']*)'/.exec(cfg)?.[1]
    const speicherOrdner =
      speicher && !speicher.startsWith('/') ? join(wurzel, speicher.replace(/^\/+/, '')) : join(wurzel, 'storage')
    const privat = await hashPw(randomBytes(24).toString('base64url'))
    const posten: ImportPosten[] = []
    let fehlt = 0,
      unveroeffentlicht = 0
    for (const u of uploads) {
      const pfad = join(speicherOrdner, String(u.storage_path || ''))
      const st = await fs.stat(pfad).catch(() => null)
      if (!st?.isFile()) {
        fehlt++
        continue
      }
      const code = String(u.code || ''),
        uc = codeVon.get(String(u.user_id)) || ''
      const ext = /\.([a-z0-9]{1,10})$/i.exec(String(u.storage_path))?.[1] || ''
      if (!Number(u.published)) unveroeffentlicht++
      posten.push({
        schluessel: 'xbb:' + u.id,
        name: String(u.filename || basename(pfad)),
        quelle: { art: 'datei', pfad },
        groesse: st.size,
        slug: istSlug(code) ? code : undefined,
        erstellt: zeit(u.timestamp),
        besitzer: u.user_id != null ? String(u.user_id) : undefined,
        tags: tagsVon.get(String(u.id)) || [],
        passwortHash: Number(u.published) ? '' : privat,
        altePfade: uc
          ? [
              { pfad: `/${uc}/${code}`, ziel: 'seite' },
              { pfad: `/${uc}/${code}.${ext}`, ziel: 'seite' },
              { pfad: `/${uc}/${code}/raw`, ziel: 'direkt' },
              { pfad: `/${uc}/${code}/raw.${ext}`, ziel: 'direkt' },
              { pfad: `/${uc}/${code}/download`, ziel: 'download' }
            ]
          : []
      })
    }
    const nutzer: ImportNutzer[] = users.map((u: any) => ({
      schluessel: String(u.id),
      username: String(u.username || ''),
      email: String(u.email || ''),
      passwortHash: u.ldap ? '' : String(u.password || ''),
      admin: !!Number(u.is_admin),
      quotaBytes: Number(u.max_disk_quota) > 0 ? Number(u.max_disk_quota) : null
    }))
    const hinweise: string[] = []
    if (fehlt)
      hinweise.push(
        nz(
          fehlt,
          [
            '1 Eintrag hat keine Datei im Speicher-Ordner und wird übersprungen.',
            '1 entry has no file in the storage folder and is skipped.'
          ],
          [
            `${fehlt} Einträge haben keine Datei im Speicher-Ordner und werden übersprungen.`,
            `${fehlt} entries have no file in the storage folder and are skipped.`
          ]
        )
      )
    if (unveroeffentlicht)
      hinweise.push(
        nz(
          unveroeffentlicht,
          [
            '1 nicht veröffentlichter Upload bleibt privat (zufälliges Passwort, der Besitzer öffnet ihn weiter).',
            '1 unpublished upload stays private (random password, the owner can still open it).'
          ],
          [
            `${unveroeffentlicht} nicht veröffentlichte Uploads bleiben privat (zufälliges Passwort, der Besitzer öffnet sie weiter).`,
            `${unveroeffentlicht} unpublished uploads stay private (random password, the owner can still open them).`
          ]
        )
      )
    return { titel: 'XBackBone', nutzer, posten, hinweise }
  } finally {
    await schliessen().catch(() => {})
  }
}

async function chibisafe(ctx: Ctx): Promise<ImportAnalyse> {
  const z = ctx.imp.zugang || {}
  if (ctx.imp.weg === 'live') {
    if (!z.apiKey)
      throw fehler(
        400,
        'Bitte den API-Schlüssel aus Chibisafe eintragen (Profil → API-Schlüssel).',
        'Please enter the Chibisafe API key (profile → API key).'
      )
    const basis = basisUrl(z.url)
    ctx.imp.zugang = { ...z, basis, header: { 'x-api-key': String(z.apiKey).trim() } }
    await q(`UPDATE importe SET zugang = $2::jsonb WHERE id = $1`, [ctx.imp.id, JSON.stringify(ctx.imp.zugang)])
    await ctx.melden(tx('Verbinde mit Chibisafe …', 'Connecting to Chibisafe …'))
    const dateien = await seiten(
      ctx,
      async (s) => (await quelleJson(ctx, `${basis}/api/files?page=${s}&limit=100`)).files || [],
      (n) => tx(`${n} Dateien gefunden …`, `${n} files found …`)
    )
    const albumVon = new Map<string, string>()
    const alben = await seiten(
      ctx,
      async (s) =>
        (await quelleJson(ctx, `${basis}/api/albums?page=${s}&limit=100`).catch(() => ({ albums: [] }))).albums || [],
      (n) => tx(`${n} Alben …`, `${n} albums …`)
    )
    for (const a of alben) {
      const inhalt = await seiten(
        ctx,
        async (s) =>
          (
            await quelleJson(ctx, `${basis}/api/album/${encodeURIComponent(a.uuid)}?page=${s}&limit=100`).catch(() => ({
              files: []
            }))
          ).files || [],
        () => tx(`Album „${a.name}“ …`, `Album “${a.name}” …`)
      )
      for (const f of inhalt) if (!albumVon.has(f.uuid)) albumVon.set(f.uuid, String(a.name || ''))
    }
    const posten: ImportPosten[] = dateien.map((f: any) => ({
      schluessel: 'chibi:' + f.uuid,
      name: String(f.original || f.name),
      mime: f.type,
      groesse: Number(f.size) || 0,
      quelle: { art: 'url', url: f.url || `${basis}/api/file/${encodeURIComponent(f.uuid)}/download` },
      slug: slugAus(f.name),
      erstellt: zeit(f.createdAt),
      ordner: albumVon.get(f.uuid) ? [albumVon.get(f.uuid)!] : [],
      altePfade: [{ pfad: '/' + f.name, ziel: 'direkt' }]
    }))
    return {
      titel: 'Chibisafe',
      nutzer: [],
      posten,
      hinweise: [
        tx(
          'Nur die Dateien des Schlüssel-Besitzers — für alle Konten den Chibisafe-Ordner einhängen.',
          'Only the key owner’s files — mount the Chibisafe folder for all accounts.'
        )
      ]
    }
  }
  const liste = await eintraege(ctx, { zipsAufklappen: false })
  const db = liste.find((e) => /database\.sqlite$/i.test(e.rel)) || liste.find((e) => /\.sqlite3?$/i.test(e.rel))
  if (!db?.pfad)
    throw fehler(
      400,
      'Keine Chibisafe-Datenbank (database/database.sqlite) im Ordner gefunden.',
      'No Chibisafe database (database/database.sqlite) found in the folder.'
    )
  const dateienIm = new Map<string, string>()
  for (const e of liste) if (e.pfad && /(^|\/)uploads\/[^/]+$/.test(e.rel)) dateienIm.set(basename(e.rel), e.pfad)
  await ctx.melden(tx('Lese Chibisafe-Datenbank …', 'Reading Chibisafe database …'))
  const tabellen = await sqliteTabellen(db.pfad)
  const users = await sqliteLesen<any>(db.pfad, 'SELECT * FROM users')
  const files = await sqliteLesen<any>(db.pfad, 'SELECT * FROM files ORDER BY id')
  const jt = (a: string, b: string) => tabellen.find((t) => t.toLowerCase() === `_${a}to${b}`)
  const albumVon = new Map<number, string>(),
    tagsVon = new Map<number, string[]>()
  const af = jt('albums', 'files')
  if (af)
    for (const r of await sqliteLesen<any>(
      db.pfad,
      `SELECT a.name, j.B AS f FROM "${af}" j JOIN albums a ON a.id = j.A`
    ))
      if (!albumVon.has(r.f)) albumVon.set(r.f, String(r.name))
  const ft = jt('files', 'tags')
  if (ft)
    for (const r of await sqliteLesen<any>(db.pfad, `SELECT t.name, j.A AS f FROM "${ft}" j JOIN tags t ON t.id = j.B`))
      tagsVon.set(r.f, [...(tagsVon.get(r.f) || []), String(r.name)])
  const posten: ImportPosten[] = []
  let fehlt = 0
  for (const f of files) {
    const pfad = dateienIm.get(String(f.name))
    if (!pfad) {
      fehlt++
      continue
    }
    posten.push({
      schluessel: 'chibi:' + (f.uuid || f.id),
      name: String(f.original || f.name),
      quelle: { art: 'datei', pfad },
      mime: f.type,
      groesse: Number(f.size) || 0,
      slug: slugAus(f.name),
      erstellt: zeit(f.createdAt),
      besitzer: f.userId != null ? String(f.userId) : undefined,
      ordner: albumVon.get(f.id) ? [albumVon.get(f.id)!] : [],
      tags: tagsVon.get(f.id) || [],
      altePfade: [{ pfad: '/' + f.name, ziel: 'direkt' }]
    })
  }
  const nutzer: ImportNutzer[] = users.map((u: any) => ({
    schluessel: String(u.id),
    username: String(u.username || ''),
    passwortHash: String(u.password || '')
  }))
  return {
    titel: 'Chibisafe',
    nutzer,
    posten,
    hinweise: fehlt
      ? [
          nz(
            fehlt,
            [
              '1 Eintrag hat keine Datei im uploads-Ordner (z. B. auf S3) und wird übersprungen.',
              '1 entry has no file in the uploads folder (e.g. on S3) and is skipped.'
            ],
            [
              `${fehlt} Einträge haben keine Datei im uploads-Ordner (z. B. auf S3) und werden übersprungen.`,
              `${fehlt} entries have no file in the uploads folder (e.g. on S3) and are skipped.`
            ]
          )
        ]
      : []
  }
}

interface SxEintrag {
  FileName?: string
  FilePath?: string
  DateTime?: string
  URL?: string
  Type?: string
  Tags?: Record<string, string | null> | null
}

async function sharex(ctx: Ctx): Promise<ImportAnalyse> {
  const liste = await eintraege(ctx)
  const hinweise: string[] = []
  let verlauf: SxEintrag[] = []
  const db = liste.find((e) => /(^|\/)History\.db$/i.test(e.rel))
  const json = liste.find((e) => /(^|\/)History\.json$/i.test(e.rel))
  const xml = liste.find((e) => /(^|\/)History\.xml$/i.test(e.rel))
  if (db?.pfad) {
    verlauf = (await sqliteLesen<any>(db.pfad, 'SELECT * FROM History ORDER BY Id')).map((r) => ({
      ...r,
      Tags: r.Tags
        ? (() => {
            try {
              return JSON.parse(r.Tags)
            } catch {
              return null
            }
          })()
        : null
    }))
  } else if (json) {
    let t = (await json.text()).replace(/^﻿/, '').trim().replace(/,\s*$/, '')
    try {
      verlauf = JSON.parse(t.startsWith('[') ? t : `[${t}]`)
    } catch {
      t = t.slice(0, t.lastIndexOf('}') + 1)
      for (let i = 0; i < 50 && t; i++) {
        try {
          verlauf = JSON.parse(`[${t}]`)
          break
        } catch {
          t = t.slice(0, t.lastIndexOf('}', t.length - 2) + 1)
        }
      }
      hinweise.push(
        tx(
          'Der Verlauf war am Ende beschädigt — der letzte Eintrag wurde ausgelassen.',
          'The history was damaged at the end — the last entry was left out.'
        )
      )
    }
  } else if (xml) {
    const t = await xml.text()
    const feld = (b: string, n: string) =>
      (new RegExp(`<${n}>([\\s\\S]*?)</${n}>`).exec(b)?.[1] || '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
    for (const m of t.matchAll(/<HistoryItem>([\s\S]*?)<\/HistoryItem>/g))
      verlauf.push({
        FileName: feld(m[1]!, 'Filename'),
        FilePath: feld(m[1]!, 'Filepath'),
        DateTime: feld(m[1]!, 'DateTimeUtc'),
        URL: feld(m[1]!, 'URL'),
        Type: feld(m[1]!, 'Type')
      })
  }
  const lokal = new Map<string, Eintrag>()
  for (const e of liste)
    if (
      !/(^|\/)History\.(db|json|xml)$/i.test(e.rel) &&
      !/\.json$/i.test(e.rel) &&
      !/(^|\/)(ApplicationConfig|HotkeysConfig|UploadersConfig)/i.test(e.rel)
    )
      lokal.set(basename(e.rel).toLowerCase(), e)
  const posten: ImportPosten[] = []
  const benutzt = new Set<string>()
  let ohneQuelle = 0
  for (const [i, h] of verlauf.entries()) {
    const name = String(h.FileName || basename(String(h.FilePath || '').replace(/\\/g, '/')) || '')
    if (!name) continue
    const l = lokal.get(name.toLowerCase())
    let quelle: PostenQuelle | null = l ? l.quelle : null
    if (!quelle && h.URL && /^https?:\/\//i.test(h.URL)) {
      if (ctx.admin || /(^|\.)imgur\.com$/i.test(new URL(h.URL).hostname)) quelle = { art: 'url', url: h.URL }
    }
    if (!quelle) {
      ohneQuelle++
      continue
    }
    if (l) benutzt.add(name.toLowerCase())
    posten.push({
      schluessel: 'sx:' + i + ':' + name,
      name,
      quelle,
      groesse: l?.groesse,
      erstellt: zeit(h.DateTime) || l?.datum || null,
      favorit: !!h.Tags && Object.prototype.hasOwnProperty.call(h.Tags, 'Favorite'),
      tags: h.Tags?.ProcessName ? [String(h.Tags.ProcessName).slice(0, 40)] : [],
      altePfade:
        h.URL &&
        !/(^|\.)imgur\.com$/i.test(
          (() => {
            try {
              return new URL(h.URL!).hostname
            } catch {
              return ''
            }
          })()
        )
          ? [{ pfad: h.URL, ziel: 'direkt' }]
          : []
    })
  }
  for (const [n, e] of lokal) {
    if (benutzt.has(n)) continue
    posten.push({
      schluessel: 'sxf:' + e.rel,
      name: basename(e.rel),
      quelle: e.quelle,
      groesse: e.groesse,
      erstellt: e.datum,
      ordner: []
    })
  }
  if (!verlauf.length)
    hinweise.push(
      tx(
        'Kein ShareX-Verlauf gefunden — es werden nur die Dateien im Ordner übernommen.',
        'No ShareX history found — only the files in the folder are taken over.'
      )
    )
  if (ohneQuelle)
    hinweise.push(
      nz(
        ohneQuelle,
        [
          '1 Verlaufseintrag hat weder eine Datei im Ordner noch eine ladbare Adresse.',
          '1 history entry has neither a file in the folder nor a loadable address.'
        ],
        [
          `${ohneQuelle} Verlaufseinträge haben weder eine Datei im Ordner noch eine ladbare Adresse.`,
          `${ohneQuelle} history entries have neither a file in the folder nor a loadable address.`
        ]
      )
    )
  return { titel: 'ShareX', nutzer: [], posten, hinweise }
}

async function imgur(ctx: Ctx): Promise<ImportAnalyse> {
  const z = ctx.imp.zugang || {}
  const token = String(z.accessToken || '').trim(),
    client = String(z.clientId || '').trim()
  if (!token && !client)
    throw fehler(
      400,
      'Bitte eine Client-ID (für öffentliche Alben) oder einen Zugriffs-Token (für das ganze Konto) eintragen.',
      'Please enter a client ID (for public albums) or an access token (for the whole account).'
    )
  const basis = 'https://api.imgur.com'
  ctx.imp.zugang = { ...z, basis, header: { authorization: token ? `Bearer ${token}` : `Client-ID ${client}` } }
  await q(`UPDATE importe SET zugang = $2::jsonb WHERE id = $1`, [ctx.imp.id, JSON.stringify(ctx.imp.zugang)])
  const posten: ImportPosten[] = []
  const gesehen = new Set<string>()
  const bild = (b: any, ordner: string[]) => {
    if (!b?.id || gesehen.has(b.id)) return
    gesehen.add(b.id)
    const url = b.animated && b.mp4 ? b.mp4 : b.link
    if (!url) return
    const ext = /\.([a-z0-9]{2,5})(\?|$)/i.exec(url)?.[1] || 'jpg'
    const titel = String(b.title || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
      .trim()
      .slice(0, 120)
    posten.push({
      schluessel: 'imgur:' + b.id,
      name: `${titel || b.id}.${ext}`,
      quelle: { art: 'url', url },
      mime: b.animated && b.mp4 ? 'video/mp4' : b.type,
      groesse: Number(b.animated && b.mp4 ? b.mp4_size || b.size : b.size) || 0,
      slug: istSlug(b.id) ? b.id : undefined,
      erstellt: zeit(b.datetime),
      aufrufe: Number(b.views) || 0,
      favorit: !!b.favorite,
      ordner,
      tags: (b.tags || [])
        .map((t: any) => String(t.name || t))
        .filter(Boolean)
        .slice(0, 10)
    })
  }
  const daten = async (pfad: string) => (await quelleJson(ctx, basis + pfad)).data
  const links = String(z.alben || '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  for (const l of links) {
    const m = /imgur\.com\/(?:a|gallery)\/(?:[^/?#]*-)?([A-Za-z0-9]{5,10})/.exec(l)
    const einzel =
      /i\.imgur\.com\/([A-Za-z0-9]{5,10})\./.exec(l) ||
      /^imgur\.com\/([A-Za-z0-9]{5,10})$/.exec(l.replace(/^https?:\/\/(www\.)?/, ''))
    if (einzel && !m) {
      bild(await daten(`/3/image/${einzel[1]}`), [])
      continue
    }
    const hash = m?.[1] || (/^[A-Za-z0-9]{5,10}$/.test(l) ? l : '')
    if (!hash)
      throw fehler(
        400,
        `Diesen Imgur-Link verstehe ich nicht: ${l.slice(0, 80)}`,
        `I don't understand this Imgur link: ${l.slice(0, 80)}`
      )
    await ctx.melden(tx(`Album ${hash} …`, `Album ${hash} …`))
    const album = await daten(`/3/album/${hash}`)
    for (const b of album?.images || (await daten(`/3/album/${hash}/images`)))
      bild(b, [String(album?.title || hash).slice(0, 80)])
  }
  if (token) {
    const alben = await seiten(
      ctx,
      async (s) => (await daten(`/3/account/me/albums/${s}`)) || [],
      (n) => tx(`${n} Alben gefunden …`, `${n} albums found …`),
      0
    )
    for (const a of alben) {
      await ctx.melden(tx(`Album „${a.title || a.id}“ …`, `Album “${a.title || a.id}” …`))
      for (const b of (await daten(`/3/album/${a.id}/images`)) || []) bild(b, [String(a.title || a.id).slice(0, 80)])
    }
    const bilder = await seiten(
      ctx,
      async (s) => (await daten(`/3/account/me/images?page=${s}&perPage=100`)) || [],
      (n) => tx(`${n} Bilder gefunden …`, `${n} images found …`),
      0
    )
    for (const b of bilder) bild(b, [])
  }
  if (!links.length && !token)
    throw fehler(
      400,
      'Mit einer Client-ID bitte die Album-Links eintragen (einer pro Zeile).',
      'With a client ID, please enter the album links (one per line).'
    )
  return {
    titel: 'Imgur',
    nutzer: [],
    posten,
    hinweise: [
      tx(
        'Imgur erlaubt rund 12.500 Abrufe am Tag — sehr große Konten brauchen eventuell zwei Tage.',
        'Imgur allows about 12,500 requests per day — very large accounts may need two days.'
      )
    ]
  }
}

async function takeout(ctx: Ctx): Promise<ImportAnalyse> {
  const liste = await eintraege(ctx)
  await ctx.melden(tx('Ordne Fotos und Beschreibungen zu …', 'Matching photos and descriptions …'))
  const innen = (rel: string) => {
    const m = /(?:^|\/)Takeout\/[^/]*(?:Photo|Foto)[^/]*\/(.*)$/i.exec(rel)
    return m ? m[1]! : rel
  }
  const ordner = new Map<string, { medien: Eintrag[]; json: Eintrag[] }>()
  for (const e of liste) {
    const rel = innen(e.rel)
    if (/(^|\/)Failed Videos\//i.test(rel) || /(^|\/)archive_browser\.html$/i.test(rel)) continue
    const dir = dirname(rel) === '.' ? '' : dirname(rel)
    const o = ordner.get(dir) || { medien: [], json: [] }
    ;(/\.json$/i.test(rel) ? o.json : o.medien).push(e)
    ordner.set(dir, o)
  }
  const posten: ImportPosten[] = []
  const doppelt = new Map<string, ImportPosten>()
  let weg = 0,
    ohneJson = 0
  const reihenfolge: Array<[string, { medien: Eintrag[]; json: Eintrag[] }, string | null, Map<string, any>]> = []
  for (const [dir, o] of ordner) {
    let album: string | null = null
    const sidecars = new Map<string, any>()
    for (const j of o.json) {
      if (j.groesse > 5 * 1024 * 1024) continue
      let d: any
      try {
        d = JSON.parse(await j.text())
      } catch {
        continue
      }
      if (d?.albumData) d = d.albumData
      if (d?.photoTakenTime?.timestamp != null || d?.creationTime) sidecars.set(sidecarSchluessel(basename(j.rel)), d)
      else if (d?.title) album = String(d.title)
    }
    if (!album && dir && !/(19|20)\d\d$/.test(dir)) album = basename(dir)
    if (album && /(19|20)\d\d$/.test(dir) && /^(Photos from|Fotos von|Photos de|Foto del) /i.test(basename(dir)))
      album = null
    reihenfolge.push([dir, o, album, sidecars])
  }
  reihenfolge.sort((a, b) => Number(!a[2]) - Number(!b[2]))
  for (const [dir, o, album, sidecars] of reihenfolge) {
    for (const m of o.medien) {
      const name = basename(m.rel)
      const meta = sidecarFuer(name, sidecars)
      if (!meta) ohneJson++
      if (meta && (meta.trashed || meta.archived || meta.googlePhotosOrigin?.fromPartnerSharing)) {
        weg++
        continue
      }
      const schl = name.replace(/\(\d+\)(?=\.[^.]+$)/, '').toLowerCase() + '|' + m.groesse
      const da = doppelt.get(schl)
      if (da) {
        if (!da.ordner?.length && album) da.ordner = [album]
        if (meta?.favorited) da.favorit = true
        const personen = (meta?.people || []).map((x: any) => String(x?.name || '')).filter(Boolean)
        if (personen.length) da.tags = [...new Set([...(da.tags || []), ...personen])].slice(0, 10)
        continue
      }
      const ext = /\.[^.]+$/.exec(name)?.[0] || ''
      const titel = meta?.title ? String(meta.title).replace(/[\r\n\\/:*?"<>|]/g, '_') : name
      const anzeige =
        ext && !titel.toLowerCase().endsWith(ext.toLowerCase()) ? titel.replace(/\.[^.]{1,5}$/, '') + ext : titel
      const t = Number(meta?.photoTakenTime?.timestamp || 0)
      const p: ImportPosten = {
        schluessel: 'gp:' + schl,
        name: anzeige,
        quelle: m.quelle,
        groesse: m.groesse,
        erstellt: t > 0 ? new Date(t * 1000).toISOString() : m.datum,
        favorit: !!meta?.favorited,
        ordner: album ? [album] : [],
        tags: (meta?.people || [])
          .map((x: any) => String(x?.name || ''))
          .filter(Boolean)
          .slice(0, 10)
      }
      doppelt.set(schl, p)
      posten.push(p)
    }
    void dir
  }
  const hinweise: string[] = []
  if (weg)
    hinweise.push(
      nz(
        weg,
        [
          '1 Foto aus Papierkorb, Archiv oder Partnerfreigabe wird ausgelassen.',
          '1 photo from trash, archive or partner sharing is left out.'
        ],
        [
          `${weg} Fotos aus Papierkorb, Archiv oder Partnerfreigabe werden ausgelassen.`,
          `${weg} photos from trash, archive or partner sharing are left out.`
        ]
      )
    )
  if (ohneJson)
    hinweise.push(
      nz(
        ohneJson,
        [
          '1 Datei ohne Beschreibungsdatei — sie bekommt das Datum aus dem Archiv.',
          '1 file without a description file — it gets the date from the archive.'
        ],
        [
          `${ohneJson} Dateien ohne Beschreibungsdatei — sie bekommen das Datum aus dem Archiv.`,
          `${ohneJson} files without a description file — they get the date from the archive.`
        ]
      )
    )
  hinweise.push(
    tx(
      'Takeout liefert Fotos oft doppelt (Jahres- und Albumordner) — doppelte werden nur einmal übernommen.',
      'Takeout often contains photos twice (year and album folders) — duplicates are taken over only once.'
    )
  )
  return { titel: 'Google Fotos', nutzer: [], posten, hinweise }
}

function sidecarSchluessel(json: string): string {
  let n = json.replace(/\.json$/i, '')
  let idx = ''
  const m = /\((\d+)\)$/.exec(n)
  if (m) {
    idx = m[1]!
    n = n.slice(0, -m[0].length)
  }
  const punkt = n.lastIndexOf('.')
  if (punkt > 0) {
    const seg = n.slice(punkt + 1).toLowerCase()
    if (seg && 'supplemental-metadata'.startsWith(seg) && !/^(jpe?g|png|gif|heic|mp4|mov|webp)$/.test(seg))
      n = n.slice(0, punkt)
  }
  return n.toLowerCase() + '|' + idx
}
function sidecarFuer(name: string, sidecars: Map<string, any>): any | null {
  const m = /^(.*?)(?:\((\d+)\))?(\.[^.]+)$/.exec(name)
  const stamm = m ? m[1]! : name,
    idx = m?.[2] || '',
    ext = m?.[3] || ''
  const voll = (stamm + ext).toLowerCase()
  const kandidaten = [
    voll,
    stamm.replace(/-(edited|bearbeitet|modifié|editado)$/i, '').toLowerCase() + ext.toLowerCase()
  ]
  for (const k of kandidaten) {
    const d = sidecars.get(k + '|' + idx)
    if (d) return d
  }
  for (const [k, d] of sidecars) {
    const [jb, ji] = k.split('|')
    if (ji !== idx) continue
    if (ohneEndung(jb!) === stamm.toLowerCase()) return d
    if (jb!.length >= 40 && voll.startsWith(jb!)) return d
  }
  return null
}

async function eigeneDateien(ctx: Ctx): Promise<ImportAnalyse> {
  const liste = await eintraege(ctx)
  const posten: ImportPosten[] = liste.map((e) => {
    const teile = e.rel.split('/')
    return {
      schluessel: 'f:' + e.rel,
      name: teile.pop()!,
      quelle: e.quelle,
      groesse: e.groesse,
      erstellt: e.datum,
      ordner: teile.filter(Boolean).slice(-6)
    }
  })
  return {
    titel: tx('Eigene Dateien', 'Own files'),
    nutzer: [],
    posten,
    hinweise: [tx('Unterordner werden zu VylarisCloud-Ordnern.', 'Subfolders become VylarisCloud folders.')]
  }
}

function phpWerte(text: string, name: string): string[] | Record<string, string> | string | null {
  const t = text
    .split(/\r?\n/)
    .filter((z) => !/^\s*(\/\/|#)/.test(z))
    .join('\n')
  const m = new RegExp(`\\$${name}\\s*=\\s*(array\\s*\\(|\\[)([\\s\\S]*?)(\\)|\\])\\s*;`).exec(t)
  if (m) {
    const inhalt = m[2]!
    const paare = [...inhalt.matchAll(/(['"])((?:(?!\1).)*)\1\s*=>\s*(['"])((?:(?!\3).)*)\3/g)]
    if (paare.length) return Object.fromEntries(paare.map((p) => [p[2]!, p[4]!]))
    return [...inhalt.matchAll(/(['"])((?:(?!\1).)*)\1/g)].map((p) => p[2]!)
  }
  const s = new RegExp(`\\$${name}\\s*=\\s*(['"])((?:(?!\\1).)*)\\1\\s*;`).exec(t)
  return s ? s[2]! : null
}

async function tinyfilemanager(ctx: Ctx): Promise<ImportAnalyse> {
  const liste = await eintraege(ctx, { zipsAufklappen: ctx.imp.weg === 'datei' })
  await ctx.melden(tx('Suche Tiny File Manager …', 'Looking for Tiny File Manager …'))
  let skript: (typeof liste)[number] | undefined,
    skriptText = ''
  for (const e of liste
    .filter((x) => /\.php$/i.test(x.rel) && x.groesse < 2_000_000 && !/(^|\/)config\.php$/i.test(x.rel))
    .sort((a, b) => Number(/tinyfilemanager/i.test(b.rel)) - Number(/tinyfilemanager/i.test(a.rel)))) {
    const text = await e.text().catch(() => '')
    if (/\$auth_users\s*=/.test(text) && /tiny\s*file\s*manager|FM_VERSION|fm_get_/i.test(text)) {
      skript = e
      skriptText = text
      break
    }
  }
  const basis = skript ? skript.rel.split('/').slice(0, -1).join('/') : ''
  const cfgEintrag = liste.find((e) => e.rel === (basis ? basis + '/' : '') + 'config.php')
  const cfgText = cfgEintrag ? await cfgEintrag.text().catch(() => '') : ''
  const wert = (n: string) => {
    const c = cfgText ? phpWerte(cfgText, n) : null
    return c ?? (skriptText ? phpWerte(skriptText, n) : null)
  }
  const auth = wert('auth_users'),
    nurLesen = wert('readonly_users'),
    eigene = wert('directories_users'),
    root = wert('root_path'),
    ausnahmen = wert('exclude_items')

  const nutzer: ImportNutzer[] =
    auth && !Array.isArray(auth) && typeof auth === 'object'
      ? Object.entries(auth)
          .filter(([n]) => /^[A-Za-z0-9._-]{1,40}$/.test(n))
          .map(([n, h]) => ({ schluessel: n, username: n, passwortHash: /^\$2[aby]\$\d{2}\$/.test(h) ? h : '' }))
      : []
  const unterSkript = liste
    .map((e) => (basis ? (e.rel.startsWith(basis + '/') ? e.rel.slice(basis.length + 1) : '') : e.rel))
    .filter(Boolean)
  const relativ = (d: string) => {
    const v = d.replace(/\\/g, '/').replace(/\/+$/, '')
    if (!v.startsWith('/')) return v.replace(/^\.?\/+/, '')
    const r = typeof root === 'string' && root.startsWith('/') ? root.replace(/\/+$/, '') : ''
    if (r && v.startsWith(r + '/')) return v.slice(r.length + 1)
    const teile = v.split('/').filter(Boolean)
    for (let k = 0; k < teile.length; k++) {
      const ende = teile.slice(k).join('/')
      if (unterSkript.some((x) => x.startsWith(ende + '/'))) return ende
    }
    return ''
  }
  const ordnerVon: Array<[string, string]> =
    eigene && !Array.isArray(eigene) && typeof eigene === 'object'
      ? Object.entries(eigene)
          .map(([n, d]) => [n, relativ(String(d))] as [string, string])
          .filter(([, d]) => !!d)
      : []
  const weg = new Set(
    [skript?.rel, cfgEintrag?.rel, (basis ? basis + '/' : '') + 'translation.json'].filter(Boolean) as string[]
  )
  const ausnahmeNamen = new Set((Array.isArray(ausnahmen) ? ausnahmen : []).map((x) => x.toLowerCase()))

  const posten: ImportPosten[] = []
  for (const e of liste) {
    if (weg.has(e.rel)) continue
    const teile = e.rel.split('/')
    const name = teile.pop()!
    if (ausnahmeNamen.has(name.toLowerCase()) || teile.some((t) => ausnahmeNamen.has(t.toLowerCase()))) continue
    const relSkript = basis ? (e.rel.startsWith(basis + '/') ? e.rel.slice(basis.length + 1) : null) : e.rel
    const besitzer = relSkript
      ? ordnerVon.find(([, d]) => relSkript === d || relSkript.startsWith(d + '/'))?.[0]
      : undefined
    posten.push({
      schluessel: 'tfm:' + e.rel,
      name,
      quelle: e.quelle,
      groesse: e.groesse,
      erstellt: e.datum,
      besitzer,
      ordner: (relSkript ?? e.rel).split('/').slice(0, -1).filter(Boolean).slice(-6),
      altePfade: relSkript ? [{ pfad: '/' + relSkript, ziel: 'direkt' }] : []
    })
  }
  const hinweise: string[] = []
  if (!skript)
    hinweise.push(
      tx(
        'Kein Tiny-File-Manager-Skript gefunden — die Dateien werden ohne Konten übernommen. Lege tinyfilemanager.php (und ggf. config.php) mit in den Ordner, damit auch die Konten mitkommen.',
        'No Tiny File Manager script found — files are imported without accounts. Put tinyfilemanager.php (and config.php, if any) into the folder so the accounts come along too.'
      )
    )
  else
    hinweise.push(
      tx(
        `Tiny File Manager gefunden (${skript.rel}${cfgEintrag ? ' + config.php' : ''}).`,
        `Tiny File Manager found (${skript.rel}${cfgEintrag ? ' + config.php' : ''}).`
      )
    )
  if (nutzer.length)
    hinweise.push(
      nz(
        nutzer.length,
        [
          '1 Konto mit Passwort wird übernommen (als normales Konto).',
          '1 account with password is imported (as a normal account).'
        ],
        [
          `${nutzer.length} Konten mit Passwort werden übernommen (als normale Konten).`,
          `${nutzer.length} accounts with passwords are imported (as normal accounts).`
        ]
      )
    )
  if (Array.isArray(nurLesen) && nurLesen.length)
    hinweise.push(
      tx(
        `Nur-Lese-Konten (${nurLesen.join(', ')}) werden zu normalen Konten — Rechte bei Bedarf über eine Rolle einschränken.`,
        `Read-only accounts (${nurLesen.join(', ')}) become normal accounts — restrict them with a role if needed.`
      )
    )
  if (typeof root === 'string' && root && !/DOCUMENT_ROOT|__DIR__|dirname/.test(root))
    hinweise.push(
      tx(
        `Tiny File Manager verwaltete den Ordner „${root}“ — falls die Dateien dort liegen, diesen Ordner wählen.`,
        `Tiny File Manager managed the folder “${root}” — if the files are there, select that folder.`
      )
    )
  hinweise.push(
    tx(
      'Unterordner werden zu VylarisCloud-Ordnern. Zeigt die alte Domain später auf VylarisCloud, leiten die alten Datei-Adressen weiter.',
      'Subfolders become VylarisCloud folders. If the old domain later points to VylarisCloud, the old file addresses redirect.'
    )
  )
  return { titel: 'Tiny File Manager', nutzer, posten, hinweise }
}

async function icloudImport(ctx: Ctx): Promise<ImportAnalyse> {
  if (ctx.imp.weg === 'live') return icloudLinks(ctx)
  if (ctx.imp.weg === 'konto') return icloudKonto(ctx)
  return icloudExport(ctx)
}

const BILD_ENDUNG = /\.(heic|heif|jpe?g|png|dng|tiff?|gif|webp|avif)$/i
const VIDEO_ENDUNG = /\.(mov|mp4|m4v)$/i
const LIVE_MAX = 40 * 1024 * 1024

function csvZeilen(text: string): string[][] {
  const zeilen: string[][] = []
  let feld = '',
    zeile: string[] = [],
    inQ = false
  const t = text.replace(/^﻿/, '')
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!
    if (inQ) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          feld += '"'
          i++
        } else inQ = false
      } else feld += c
    } else if (c === '"') inQ = true
    else if (c === ',') {
      zeile.push(feld)
      feld = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      zeile.push(feld)
      feld = ''
      if (zeile.some((x) => x !== '')) zeilen.push(zeile)
      zeile = []
    } else feld += c
  }
  zeile.push(feld)
  if (zeile.some((x) => x !== '')) zeilen.push(zeile)
  return zeilen
}
const MONATE = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december'
]
function appleDatum(s: string): string | null {
  const m = /^\s*\w+\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(
    String(s || '')
  )
  if (!m) return zeit(s)
  const mon = MONATE.indexOf(m[1]!.toLowerCase())
  if (mon < 0) return null
  let h = Number(m[4]) % 12
  if (m[7]?.toUpperCase() === 'PM') h += 12
  if (!m[7]) h = Number(m[4])
  const d = new Date(Date.UTC(Number(m[3]), mon, Number(m[2]), h, Number(m[5]), Number(m[6] || 0)))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

async function innereZips(ctx: Ctx, liste: Eintrag[]): Promise<Eintrag[]> {
  const innen = liste.filter((e) => e.quelle.art === 'zip' && /\.zip$/i.test(e.rel))
  if (!innen.length) return liste
  const aus = liste.filter((e) => !innen.includes(e))
  const ziel = join(importAblage(ctx.imp.id), '.innen')
  await fs.mkdir(ziel, { recursive: true })
  for (const [n, e] of innen.entries()) {
    const qz = e.quelle as Extract<PostenQuelle, { art: 'zip' }>
    await ctx.melden(
      tx(`Inneres Archiv wird ausgepackt: ${basename(e.rel)} …`, `Unpacking inner archive: ${basename(e.rel)} …`)
    )
    const pfad = join(ziel, `${n}-${basename(e.rel).replace(/[^\w.-]+/g, '_')}`)
    const st = await fs.stat(pfad).catch(() => null)
    if (!st || st.size !== e.groesse) {
      const aussen =
        ctx.archive.find(
          (a) => a.eintraege.get(qz.eintrag) && a.eintraege.get(qz.eintrag)!.uncompressedSize === e.groesse
        ) || (await zipLesen(qz.zip))
      if (!ctx.archive.includes(aussen)) ctx.archive.push(aussen)
      const en = aussen.eintraege.get(qz.eintrag)
      if (!en) continue
      const strom = await new Promise<NodeJS.ReadableStream>((res, rej) =>
        aussen.zip.openReadStream(en, (x, s) => (x || !s ? rej(x) : res(s)))
      )
      await pipeline(strom, createWriteStream(pfad))
    }
    let a: ZipArchiv
    try {
      a = await zipLesen(pfad)
    } catch {
      continue
    }
    ctx.archive.push(a)
    const vor = e.rel.replace(/\.zip$/i, '')
    for (const [name, en] of a.eintraege) {
      if (SYSTEM.test(name)) continue
      aus.push({
        rel: `${vor}/${name}`,
        groesse: en.uncompressedSize,
        datum: en.getLastModDate?.()?.toISOString?.() || null,
        quelle: { art: 'zip', zip: pfad, eintrag: name },
        text: () => zipText(a, name)
      })
    }
  }
  return aus
}

async function icloudExport(ctx: Ctx): Promise<ImportAnalyse> {
  const liste = await innereZips(ctx, await eintraege(ctx))
  await ctx.melden(tx('Ordne Fotos, Alben und Angaben zu …', 'Matching photos, albums and details …'))
  interface Foto {
    e: Eintrag
    teil: string
    name: string
    stamm: string
  }
  const fotos: Foto[] = []
  const details = new Map<string, Map<string, string[]>>()
  const albumVon = new Map<string, string[]>()
  const sonst: Array<{ e: Eintrag; ordner: string[] }> = []
  let geloescht = 0,
    kopf: string[] = []
  const KOPF_FELDER = ['imgname', 'filechecksum', 'favorite', 'hidden', 'deleted', 'originalcreationdate']
  for (const e of liste) {
    const t = e.rel.split('/')
    const name = t[t.length - 1]!
    const iF = t.findIndex((x, i) => i < t.length - 1 && /^Photos$/i.test(x))
    const iA = t.findIndex((x, i) => i < t.length - 1 && /^(Albums|Memories)$/i.test(x))
    if (t.some((x, i) => i < t.length - 1 && /^Recently Deleted$/i.test(x))) {
      geloescht++
      continue
    }
    if (iF >= 0 && /\.csv$/i.test(name)) {
      if (!/^Photo Details/i.test(name)) continue
      const teil = t.slice(0, iF).join('/')
      const z = csvZeilen(await e.text().catch(() => ''))
      if (!z.length) continue
      kopf = z[0]!.map((x) => x.trim().toLowerCase())
      const idx = (n: string) => kopf.indexOf(n)
      if (idx('imgname') < 0) continue
      const m = details.get(teil) || new Map<string, string[]>()
      for (const r of z.slice(1)) {
        const zeile = KOPF_FELDER.map((f) => (idx(f) >= 0 ? String(r[idx(f)] || '').trim() : ''))
        if (zeile[0]) m.set(zeile[0].toLowerCase(), zeile)
      }
      details.set(teil, m)
      continue
    }
    if (iA >= 0 && /\.csv$/i.test(name)) {
      if (!/^Albums$/i.test(t[iA]!)) continue
      const album = name
        .replace(/\.csv$/i, '')
        .trim()
        .slice(0, 80)
      if (!album || /^RAW$/i.test(album)) continue
      for (const r of csvZeilen(await e.text().catch(() => '')).slice(1)) {
        const n = String(r[0] || '')
          .trim()
          .toLowerCase()
        if (n) albumVon.set(n, [...(albumVon.get(n) || []), album])
      }
      continue
    }
    if (iF >= 0 && iF === t.length - 2) {
      fotos.push({ e, teil: t.slice(0, iF).join('/'), name, stamm: name.replace(/\.[^.]+$/, '').toLowerCase() })
      continue
    }
    if (/\.(csv|json|plist)$/i.test(name) && t.length <= 3) continue
    const ordner = t.slice(0, -1).filter((x, i) => !(i === 0 && /\d+\s*(of|von|av|de|di|sur)\s*\d+\s*$/i.test(x)))
    const iD = ordner.findIndex((x) => /^iCloud Drive$/i.test(x))
    const pfad =
      iD >= 0
        ? ['iCloud Drive', ...ordner.slice(iD + 1)]
        : ordner.map((x) => x.replace(/^iCloud Shared Albums(-\d+)?$/i, tx('Geteilte Alben', 'Shared albums')))
    sonst.push({ e, ordner: pfad.filter((x, i) => i === 0 || x !== pfad[i - 1]).slice(-6) })
  }

  const jeStamm = new Map<string, Foto[]>()
  for (const f of fotos) {
    const k = f.teil + '|' + f.stamm
    jeStamm.set(k, [...(jeStamm.get(k) || []), f])
  }
  const begleit = new Map<Foto, Foto>()
  const verbraucht = new Set<Foto>()
  for (const gruppe of jeStamm.values()) {
    const bild = gruppe.find((f) => BILD_ENDUNG.test(f.name)),
      video = gruppe.find((f) => VIDEO_ENDUNG.test(f.name))
    if (bild && video && video.e.groesse <= LIVE_MAX) {
      begleit.set(bild, video)
      verbraucht.add(video)
    }
  }

  const posten: ImportPosten[] = []
  const gesehen = new Set<string>()
  let ausgeblendet = 0,
    live = 0,
    ohneAngaben = 0,
    doppelt = 0
  for (const f of fotos) {
    if (verbraucht.has(f)) continue
    const z = details.get(f.teil)?.get(f.name.toLowerCase())
    if (!z) ohneAngaben++
    if (z?.[4] === 'yes') {
      geloescht++
      continue
    }
    const schl = z?.[1] ? 'icx:' + z[1] : 'icx:' + f.e.rel
    if (gesehen.has(schl)) {
      doppelt++
      continue
    }
    gesehen.add(schl)
    const alben = albumVon.get(f.name.toLowerCase()) || []
    const versteckt = z?.[3] === 'yes'
    if (versteckt) ausgeblendet++
    const v = begleit.get(f)
    if (v) live++
    posten.push({
      schluessel: schl,
      name: f.name,
      quelle: f.e.quelle,
      groesse: f.e.groesse,
      erstellt: (z?.[5] && appleDatum(z[5])) || f.e.datum,
      favorit: z?.[2] === 'yes',
      ordner: versteckt ? [tx('Ausgeblendet', 'Hidden')] : alben.slice(0, 1),
      tags: alben.slice(1, 10),
      live: v?.e.quelle
    })
  }
  for (const s of sonst)
    posten.push({
      schluessel: 'icd:' + s.e.rel,
      name: basename(s.e.rel),
      quelle: s.e.quelle,
      groesse: s.e.groesse,
      erstellt: s.e.datum,
      ordner: s.ordner
    })

  const hinweise: string[] = []
  if (!fotos.length && !sonst.length)
    throw fehler(
      400,
      'Das sieht nicht nach einem iCloud-Export aus (kein Ordner „Photos“ oder „iCloud Drive“ gefunden).',
      'This does not look like an iCloud export (no “Photos” or “iCloud Drive” folder found).'
    )
  if (fotos.length && !details.size)
    hinweise.push(
      tx(
        'Keine „Photo Details“-Tabelle gefunden — Aufnahmedatum und Favoriten fehlen. Bitte alle Teile des Exports hochladen.',
        'No “Photo Details” table found — capture dates and favourites are missing. Please upload all parts of the export.'
      )
    )
  else if (ohneAngaben)
    hinweise.push(
      nz(
        ohneAngaben,
        [
          '1 Foto steht in keiner „Photo Details“-Tabelle — es bekommt das Datum aus dem Archiv.',
          '1 photo is not in any “Photo Details” table — it gets the date from the archive.'
        ],
        [
          `${ohneAngaben} Fotos stehen in keiner „Photo Details“-Tabelle — sie bekommen das Datum aus dem Archiv.`,
          `${ohneAngaben} photos are not in any “Photo Details” table — they get the date from the archive.`
        ]
      )
    )
  if (live)
    hinweise.push(
      nz(
        live,
        [
          '1 Live Photo: das Video hängt am Foto und spielt beim Drüberfahren.',
          '1 Live Photo: the video is attached to the photo and plays on hover.'
        ],
        [
          `${live} Live Photos: das Video hängt jeweils am Foto und spielt beim Drüberfahren.`,
          `${live} Live Photos: the video is attached to each photo and plays on hover.`
        ]
      )
    )
  if (geloescht)
    hinweise.push(
      nz(
        geloescht,
        ['1 Datei aus „Zuletzt gelöscht“ wird ausgelassen.', '1 file from “Recently Deleted” is left out.'],
        [
          `${geloescht} Dateien aus „Zuletzt gelöscht“ werden ausgelassen.`,
          `${geloescht} files from “Recently Deleted” are left out.`
        ]
      )
    )
  if (ausgeblendet)
    hinweise.push(
      nz(
        ausgeblendet,
        ['1 ausgeblendetes Foto kommt in den Ordner „Ausgeblendet“.', '1 hidden photo goes into the folder “Hidden”.'],
        [
          `${ausgeblendet} ausgeblendete Fotos kommen in den Ordner „Ausgeblendet“.`,
          `${ausgeblendet} hidden photos go into the folder “Hidden”.`
        ]
      )
    )
  if (doppelt)
    hinweise.push(
      nz(
        doppelt,
        ['1 doppelter Eintrag wird nur einmal übernommen.', '1 duplicate entry is taken over only once.'],
        [
          `${doppelt} doppelte Einträge werden nur einmal übernommen.`,
          `${doppelt} duplicate entries are taken over only once.`
        ]
      )
    )
  hinweise.push(
    tx(
      'HEIC-Fotos bleiben im Original — für Vorschau, Direktlink und Galerie entsteht ein JPEG.',
      'HEIC photos stay original — a JPEG is created for preview, direct link and gallery.'
    )
  )
  return { titel: fotos.length ? 'iCloud Fotos' : 'iCloud Drive', nutzer: [], posten, hinweise }
}

async function icloudLinks(ctx: Ctx): Promise<ImportAnalyse> {
  const links = String(ctx.imp.zugang?.alben || '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50)
  if (!links.length)
    throw fehler(400, 'Bitte mindestens einen iCloud-Link eintragen.', 'Please enter at least one iCloud link.')
  const posten: ImportPosten[] = []
  const hinweise: string[] = []
  let klein = false
  for (const l of links) {
    const x = linkErkennen(l)
    if (!x)
      throw fehler(
        400,
        `Diesen Link verstehe ich nicht: ${l.slice(0, 80)} — erwartet werden Links von icloud.com (geteiltes Album oder iCloud-Drive-Freigabe).`,
        `I don't understand this link: ${l.slice(0, 80)} — expected are icloud.com links (shared album or iCloud Drive share).`
      )
    if (x.art === 'album') {
      await ctx.melden(tx('Lese geteiltes Album …', 'Reading shared album …'))
      const a = await albumLesen(x.token, ctx.melden)
      klein = true
      for (const f of a.fotos) {
        posten.push({
          schluessel: `ica:${x.token}:${f.guid}`,
          name: f.name,
          groesse: f.groesse,
          erstellt: f.erstellt,
          ordner: [a.titel],
          quelle: { art: 'icloud', typ: 'album', token: x.token, host: a.host, guid: f.guid, checksum: f.checksum }
        })
      }
      hinweise.push(
        tx(
          `Album „${a.titel}“${a.von ? ` von ${a.von}` : ''}: ${a.fotos.length} Fotos und Videos.`,
          `Album “${a.titel}”${a.von ? ` by ${a.von}` : ''}: ${a.fotos.length} photos and videos.`
        )
      )
    } else if (x.art === 'albumck') {
      await ctx.melden(tx('Lese geteiltes Album …', 'Reading shared album …'))
      const a = await albumCkLesen(x.token, ctx.melden)
      ctx.imp.zugang = { ...ctx.imp.zugang, icloudCk: { basis: a.basis, zugriff: a.zugriff } }
      await q(`UPDATE importe SET zugang = jsonb_set(zugang, '{icloudCk}', $2::jsonb) WHERE id = $1`, [
        ctx.imp.id,
        JSON.stringify(ctx.imp.zugang.icloudCk)
      ])
      for (const f of a.eintraege) {
        const qu = (feld: string, name: string, url: string): PostenQuelle => ({
          art: 'icloud',
          typ: 'ck',
          db: 'oeffentlich',
          zone: a.zone,
          record: f.record,
          feld,
          name,
          url,
          token: x.token
        })
        posten.push({
          schluessel: `ick:${x.token}:${f.record}`,
          name: f.name,
          mime: f.typ || undefined,
          groesse: f.groesse,
          erstellt: f.erstellt,
          favorit: f.favorit,
          ordner: [a.titel],
          quelle: qu(f.feld, f.name, f.url),
          live: f.live ? qu(f.live.feld, f.name.replace(/\.[^.]+$/, '') + '.mov', f.live.url) : undefined
        })
      }
      hinweise.push(
        tx(
          `Album „${a.titel}“: ${a.eintraege.length} Fotos und Videos in voller Größe.`,
          `Album “${a.titel}”: ${a.eintraege.length} photos and videos in full size.`
        )
      )
    } else {
      await ctx.melden(tx('Lese iCloud-Drive-Freigabe …', 'Reading iCloud Drive share …'))
      const d = await driveLinkLesen(x.guid)
      posten.push({
        schluessel: `icl:${x.guid}`,
        name: d.name,
        groesse: d.groesse,
        erstellt: d.geaendert,
        ordner: [],
        quelle: { art: 'icloud', typ: 'drive', guid: d.guid, name: d.name }
      })
    }
  }
  if (klein)
    hinweise.push(
      tx(
        'Ältere geteilte Alben enthalten bei Apple nur verkleinerte Fassungen (Fotos bis 2048 px, Videos bis 720p, Live Photos als Standbild). Für Originale den Apple-Datenexport oder die Anmeldung mit Apple-ID nutzen.',
        'Older shared albums only contain reduced versions at Apple (photos up to 2048 px, videos up to 720p, Live Photos as stills). For originals use the Apple data export or sign in with Apple ID.'
      )
    )
  return { titel: 'iCloud', nutzer: [], posten, hinweise }
}

async function icloudKonto(ctx: Ctx): Promise<ImportAnalyse> {
  const s = ctx.imp.zugang?.icloud as Sitzung | undefined
  if (!s || s.schritt !== 'fertig')
    throw fehler(
      400,
      'Bitte zuerst mit der Apple-ID anmelden (und den Code bestätigen).',
      'Please sign in with your Apple ID first (and confirm the code).'
    )
  const speichern = () =>
    q(`UPDATE importe SET zugang = jsonb_set(zugang, '{icloud}', $2::jsonb) WHERE id = $1`, [
      ctx.imp.id,
      JSON.stringify(s)
    ])
  await ctx.melden(tx('Verbinde mit iCloud …', 'Connecting to iCloud …'))
  try {
    await icloudBereit(s)
  } finally {
    await speichern()
  }
  const inhalt = String(ctx.imp.zugang?.inhalt || 'fotos')
  const posten: ImportPosten[] = []
  const hinweise: string[] = []
  if (inhalt !== 'drive') {
    const fotos = await mediathekLesen(s, ctx.melden)
    await speichern()
    let live = 0
    for (const f of fotos) {
      const qu = (feld: string, name: string, url: string): PostenQuelle => ({
        art: 'icloud',
        typ: 'ck',
        db: f.db,
        zone: f.zone,
        record: f.record,
        feld,
        name,
        url
      })
      if (f.live) live++
      posten.push({
        schluessel: `icm:${f.record}`,
        name: f.name,
        mime: f.typ || undefined,
        groesse: f.groesse,
        erstellt: f.erstellt,
        favorit: f.favorit,
        ordner: f.album,
        quelle: qu(f.feld, f.name, f.url),
        live: f.live ? qu(f.live.feld, f.name.replace(/\.[^.]+$/, '') + '.mov', f.live.url) : undefined
      })
    }
    hinweise.push(
      tx(
        `Fotos-Mediathek: ${fotos.length} Fotos und Videos im Original.`,
        `Photos library: ${fotos.length} photos and videos in original quality.`
      )
    )
    if (live)
      hinweise.push(
        nz(
          live,
          [
            '1 Live Photo: das Video hängt am Foto und spielt beim Drüberfahren.',
            '1 Live Photo: the video is attached to the photo and plays on hover.'
          ],
          [
            `${live} Live Photos: das Video hängt jeweils am Foto und spielt beim Drüberfahren.`,
            `${live} Live Photos: the video is attached to each photo and plays on hover.`
          ]
        )
      )
    hinweise.push(
      tx('Ausgeblendete und gelöschte Fotos bleiben in iCloud.', 'Hidden and deleted photos stay in iCloud.')
    )
  }
  if (inhalt !== 'fotos') {
    const dateien = await driveKontoLesen(s, ctx.melden)
    await speichern()
    for (const d of dateien)
      posten.push({
        schluessel: `icdr:${d.docwsid}`,
        name: d.name,
        groesse: d.groesse,
        erstellt: d.geaendert,
        ordner: ['iCloud Drive', ...d.ordner].slice(0, 6),
        quelle: { art: 'icloud', typ: 'drivekonto', docwsid: d.docwsid, zone: d.zone }
      })
    hinweise.push(
      tx(
        `iCloud Drive: ${dateien.length} Dateien, die Ordner bleiben erhalten.`,
        `iCloud Drive: ${dateien.length} files, folders are kept.`
      )
    )
  }
  hinweise.push(
    tx(
      'Die Anmeldung gilt nur für diesen Import und wird danach gelöscht. Dein Passwort wurde nicht gespeichert.',
      'The sign-in is only used for this import and deleted afterwards. Your password was not stored.'
    )
  )
  return { titel: inhalt === 'drive' ? 'iCloud Drive' : 'iCloud Fotos', nutzer: [], posten, hinweise }
}

const ADAPTER: Record<ImportZeile['quelle'], (ctx: Ctx) => Promise<ImportAnalyse>> = {
  zipline,
  xbackbone,
  chibisafe,
  sharex,
  imgur,
  takeout,
  icloud: icloudImport,
  tinyfilemanager,
  ordner: eigeneDateien
}
