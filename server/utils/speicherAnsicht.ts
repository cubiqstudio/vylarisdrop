import { stat, statfs } from 'node:fs/promises'
import type { H3Event } from 'h3'
import { q } from './db'
import type { Nutzer } from './auth'
import { basisUrl } from './dateien'
import { platte } from './speicher'
import type { Box, Unterkonto } from './boxen'
import type { Bucket, Schluessel } from './buckets'
import {
  BOXEN_APP,
  S3_REGION,
  garageKapazitaetSoll,
  garageKnoten,
  getSpeicherEinst,
  sftpPort,
  speicherKonfiguriert
} from './speicherdienst'

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
  // SFTP braucht einen Namen/eine Adresse, die direkt zum Server führt. Liegt die Web-Adresse hinter einem Cloudflare Tunnel
  // (Anfrage trägt cf-ray), geht SFTP dort nicht durch: dann ist ein eigener Host (VD_SFTP_HOST oder Einstellung) nötig.
  const eigen = String(process.env.VD_SFTP_HOST || (await getSpeicherEinst()).sftpHost || '')
    .trim()
    .toLowerCase()
  const eigenOk = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$|^[0-9a-f:]{2,45}$/.test(eigen) ? eigen : ''
  const ueberCloudflare = !!getRequestHeader(event, 'cf-ray')
  return {
    basis,
    host,
    sftpHost: eigenOk || host,
    sftpHostEigen: !!eigenOk,
    sftpWarnung: !eigenOk && ueberCloudflare,
    sftpPort: sftpPort(),
    webdav: `${basis}/webdav/`,
    s3: basis,
    region: S3_REGION
  }
}

export async function speicherPlatte(): Promise<{ frei: number; gesamt: number } | null> {
  try {
    const s = await statfs(BOXEN_APP)
    return { frei: Number(s.bavail) * Number(s.bsize), gesamt: Number(s.blocks) * Number(s.bsize) }
  } catch {
    return platte()
  }
}

export interface Platz {
  frei: number
  gesamt: number
}
export interface PlattenPosten extends Platz {
  /** true = liegt (vermutlich) auf demselben Dateisystem wie das Betriebssystem/Docker, false = eigene Platte */
  systemplatte: boolean
}
/** Wie viel Prozent der Systemplatte frei sein müssen, bevor die Oberfläche warnt. */
export const SYSTEM_FREI_MIN = 20

interface DsInfo extends Platz {
  dev: number
}
async function dsInfo(pfad: string): Promise<DsInfo | null> {
  try {
    const [f, s] = await Promise.all([statfs(pfad), stat(pfad)])
    return { frei: Number(f.bavail) * Number(f.bsize), gesamt: Number(f.blocks) * Number(f.bsize), dev: Number(s.dev) }
  } catch {
    return null
  }
}
/**
 * Dasselbe Dateisystem? Entweder dieselbe Geräte-Nummer oder (z. B. btrfs-Subvolumes, fremde Messung ohne Gerät)
 * gleiche Gesamtgröße und fast gleicher freier Platz. Zwei verschiedene Platten mit auf 2 % gleicher Belegung UND
 * exakt gleicher Größe sind unwahrscheinlich; im Zweifel warnt die Oberfläche eher zu viel als zu wenig.
 */
export function gleichesDateisystem(a: Platz & { dev?: number }, b: Platz & { dev?: number }): boolean {
  if (a.dev != null && b.dev != null && a.dev === b.dev) return true
  const tol = Math.max(1, a.gesamt) * 0.02
  return Math.abs(a.gesamt - b.gesamt) <= Math.max(1, a.gesamt) * 0.005 && Math.abs(a.frei - b.frei) <= tol
}
/** Warnungen: Daten auf der Systemplatte UND dort weniger als SYSTEM_FREI_MIN % frei. */
export function plattenWarnungen(
  system: Platz | null,
  posten: Record<string, PlattenPosten | null>
): Array<{ was: string; freiProzent: number }> {
  if (!system || system.gesamt <= 0) return []
  const prozent = Math.round((system.frei / system.gesamt) * 1000) / 10
  if (prozent >= SYSTEM_FREI_MIN) return []
  return Object.entries(posten)
    .filter(([, p]) => p?.systemplatte)
    .map(([was]) => ({ was, freiProzent: prozent }))
}

/**
 * Auf welcher Platte liegen Boxen und Buckets, und wie viel ist dort frei?
 * Der app-Container sieht nur /speicher (Boxen). Garage-Daten und -Metadaten meldet die Garage-Admin-API
 * (GetClusterStatus); antwortet sie nicht oder liefert sie keine Zahlen, gilt der Wert als nicht ermittelbar.
 * Testhilfe: VD_SYSTEMPLATTE = Pfad, der als Systemplatte gilt (Standard: / bzw. /etc/hosts).
 */
export async function speicherPlatten() {
  const sysPfad = process.env.VD_SYSTEMPLATTE || '/'
  // Im Container liegt /etc/hosts auf dem Dateisystem von Docker (= Systemplatte); "/" ist dort ein Overlay mit eigener Geräte-Nummer.
  const sys = await dsInfo(sysPfad)
  const sysDev = (await dsInfo(process.env.VD_SYSTEMPLATTE || '/etc/hosts'))?.dev ?? sys?.dev
  const system = sys ? { frei: sys.frei, gesamt: sys.gesamt, dev: sysDev } : null
  const mit = (p: Platz & { dev?: number } | null): PlattenPosten | null =>
    p && system ? { frei: p.frei, gesamt: p.gesamt, systemplatte: gleichesDateisystem(p, system) } : null

  const boxen = mit(await dsInfo(BOXEN_APP))
  let garage: {
    erreichbar: boolean
    daten: PlattenPosten | null
    meta: PlattenPosten | null
    kapazitaet: { layout: number | null; soll: number | null; abweichung: boolean } | null
  } = { erreichbar: false, daten: null, meta: null, kapazitaet: null }
  if (speicherKonfiguriert()) {
    const g = await garageKnoten()
    const k = g?.knoten.find((x) => x.rolle) || g?.knoten[0]
    if (g && k) {
      const daten = mit(k.daten),
        meta = mit(k.meta)
      const layout = k.rolle?.kapazitaet ?? null,
        soll = garageKapazitaetSoll(k.daten?.gesamt ?? null)
      garage = {
        erreichbar: true,
        daten,
        meta,
        kapazitaet: k.rolle
          ? { layout, soll, abweichung: layout == null || soll == null ? false : Math.abs(layout - soll) > soll * 0.02 }
          : null
      }
    }
  }
  const warnungen = plattenWarnungen(system, { boxen, 'garage-daten': garage.daten, 'garage-meta': garage.meta })
  return {
    system: system ? { frei: system.frei, gesamt: system.gesamt } : null,
    boxen,
    garage,
    warnungen,
    mindestFreiProzent: SYSTEM_FREI_MIN
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
