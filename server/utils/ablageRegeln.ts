import { z } from 'zod'
import { q, q1 } from './db'
import { getSpeicher } from './s3'
import { istPro } from './lizenz'
import { st } from './settings'
import { hoeren, melde } from './knoten'
import { alleZiele, zielLaden } from './sftpZiele'
import { sftpBereit } from './sftpClient'
import { artVon, endung as dateiEndung, typErkennen } from './dateien'
import { teamVonOrdner } from './quota'
import { poolPlatz, sftpId, standardOrt, type Geschrieben, type Ort } from './speicher'

/**
 * Ablage-Regeln: „Wohin kommt was?“ — der Admin legt fest, in welchen Speicher (lokal, S3, eine Storage Box = SFTP-Speicher-Erweiterung
 * oder der Pool) neue Dateien je nach Art, Größe, Konto, Rolle, Ordner/Team gespeichert werden, und was gar nicht gespeichert werden darf.
 *
 * Grundsätze
 *  - Es zählt die erste zutreffende, aktive Regel (nach Position). Ohne Treffer gilt die bisherige Einstellung (zielOrt()).
 *  - Regeln gelten nur für NEUE Schreibvorgänge. Bestehende Dateien werden nie verschoben (dafür gibt es den Umzug).
 *  - Regeln verweisen per Text auf Orte ('lokal', 's3', 'sftp<ID>', 'pool'). Ein unbekanntes, inaktives, schreibgeschütztes oder
 *    offline gemeldetes Ziel gilt als „nicht verfügbar“ — die Regel bleibt gültig, das Ziel wird übersprungen.
 *  - Fällt kein Ziel einer Regel aus: fallback 'naechstes' (nächste Regel), 'lokal' (auf den Server) oder 'ablehnen' (503, nichts
 *    wird geschrieben). Ein stilles Ausweichen gibt es nie.
 *  - Unbekannte Größe (WebDAV ohne Content-Length): eine Größenbedingung gilt dann als NICHT erfüllt (nur eine Regel ohne
 *    Größenbedingung trifft zu). Verbote werden nach dem Schreiben mit der echten Größe und der erkannten Dateiart noch einmal
 *    geprüft und die Datei dann sauber entfernt (ablageNachpruefen).
 */

export type Strategie = 'erste' | 'frei' | 'abwechselnd'
export type Rueckfall = 'naechstes' | 'lokal' | 'ablehnen'
export type AblageAktion = 'speichern' | 'verbieten'
export const ABLAGE_ARTEN = ['bild', 'video', 'audio', 'text', 'datei'] as const
export const ABLAGE_ROLLEN = ['user', 'admin', 'owner'] as const

export interface AblageBedingung {
  art?: string[]
  mime?: string[]
  endungen?: string[]
  groesse_von_mb?: number | null
  groesse_bis_mb?: number | null
  konten?: number[]
  rollen?: string[]
  rollen_ids?: number[]
  ordner?: number[]
  teams?: number[]
  geltung?: 'alle'
}
export interface AblageRegel {
  id: number
  position: number
  name: string
  aktiv: boolean
  bedingung: AblageBedingung
  aktion: AblageAktion
  ziele: string[]
  strategie: Strategie
  fallback: Rueckfall
  meldung: string
  created_by: number | null
  created_at: string
  geaendert_at: string
}

/** Was über die zu speichernde Datei bekannt ist. `groesse` null = unbekannt. */
export interface AblageKontext {
  name: string
  mime?: string
  art?: string
  groesse?: number | null
  userId: number | null
  rolle?: string
  rolleId?: number | null
  ordnerId?: number | null
}

export const MAX_REGELN = 200
const LISTE_MAX = 50
const MiB = 1024 * 1024

// ===== Prüfung der Eingaben (zod), gemeinsam für Anlegen, Ändern und Test =====
export const OrtWert = z.string().regex(/^(lokal|s3|pool|sftp[1-9][0-9]{0,8})$/)
const ganz = (max: number, min = 1) => z.number().int().min(min).max(max)
const BedingungZod = z
  .object({
    art: z.array(z.enum(ABLAGE_ARTEN)).max(ABLAGE_ARTEN.length).optional(),
    mime: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9][a-z0-9.+-]{0,60}\/[a-z0-9.+-]{0,80}\*?$/)
      )
      .max(LISTE_MAX)
      .optional(),
    endungen: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .transform((s) => s.replace(/^\.+/, ''))
          .pipe(z.string().regex(/^[a-z0-9][a-z0-9._+-]{0,19}$/))
      )
      .max(LISTE_MAX)
      .optional(),
    groesse_von_mb: ganz(10_000_000, 0).nullable().optional(),
    groesse_bis_mb: ganz(10_000_000, 1).nullable().optional(),
    konten: z.array(ganz(2_000_000_000)).max(LISTE_MAX).optional(),
    rollen: z.array(z.enum(ABLAGE_ROLLEN)).max(ABLAGE_ROLLEN.length).optional(),
    rollen_ids: z.array(ganz(2_000_000_000)).max(LISTE_MAX).optional(),
    ordner: z.array(ganz(2_000_000_000)).max(LISTE_MAX).optional(),
    teams: z.array(ganz(2_000_000_000)).max(LISTE_MAX).optional(),
    geltung: z.literal('alle').optional()
  })
  .strict()
const form = {
  name: z.string().trim().max(80),
  aktiv: z.boolean(),
  bedingung: BedingungZod,
  aktion: z.enum(['speichern', 'verbieten']),
  ziele: z.array(OrtWert).max(LISTE_MAX),
  strategie: z.enum(['erste', 'frei', 'abwechselnd']),
  fallback: z.enum(['naechstes', 'lokal', 'ablehnen']),
  meldung: z.string().trim().max(300)
}
export const RegelEingabe = z.object({
  ...form,
  name: form.name.default(''),
  aktiv: form.aktiv.default(true),
  bedingung: form.bedingung.default({}),
  ziele: form.ziele.default([]),
  strategie: form.strategie.default('erste'),
  fallback: form.fallback.default('naechstes'),
  meldung: form.meldung.default('')
})
/** Teiländerung (PATCH): nur die genannten Felder; sie werden mit der gespeicherten Regel zusammengeführt und neu geprüft. */
export const RegelAenderung = z.object(form).partial().extend({ position: z.number().int().min(1).max(MAX_REGELN).optional() })
export type RegelDaten = z.infer<typeof RegelEingabe>

/** Bereinigt eine geprüfte Bedingung: Duplikate raus, leere Listen weg, Größen stimmig. */
export function bedingungBereinigen(b: z.infer<typeof BedingungZod>): AblageBedingung {
  const liste = <T>(l: T[] | undefined) => {
    const u = [...new Set(l || [])]
    return u.length ? u : undefined
  }
  const aus: AblageBedingung = { geltung: 'alle' }
  const mime = liste(b.mime?.map((m) => m.replace(/\*$/, '')))
  const e: Array<[keyof AblageBedingung, unknown]> = [
    ['art', liste(b.art)],
    ['mime', mime],
    ['endungen', liste(b.endungen)],
    ['konten', liste(b.konten)],
    ['rollen', liste(b.rollen)],
    ['rollen_ids', liste(b.rollen_ids)],
    ['ordner', liste(b.ordner)],
    ['teams', liste(b.teams)]
  ]
  for (const [k, v] of e) if (v) (aus as any)[k] = v
  if (b.groesse_von_mb) aus.groesse_von_mb = b.groesse_von_mb
  if (b.groesse_bis_mb) aus.groesse_bis_mb = b.groesse_bis_mb
  if (aus.groesse_von_mb && aus.groesse_bis_mb && aus.groesse_von_mb > aus.groesse_bis_mb)
    throw fehler(
      400,
      'Die Größe „von“ darf nicht über der Größe „bis“ liegen.',
      'The size “from” must not be larger than the size “to”.'
    )
  return aus
}

/** Prüft die Zusammenstellung einer Regel (Ziele nur bei „speichern“, sftp-Ziele müssen es geben). */
export async function regelPruefen(
  d: RegelDaten,
  opt: { zieleExistieren?: boolean } = {}
): Promise<{ bedingung: AblageBedingung; ziele: string[]; meldung: string }> {
  const bedingung = bedingungBereinigen(d.bedingung)
  const ziele = d.aktion === 'speichern' ? [...new Set(d.ziele)] : []
  if (d.aktion === 'speichern') {
    if (!ziele.length)
      throw fehler(
        400,
        'Bitte mindestens ein Ziel wählen (oder die Aktion „Nicht speichern“).',
        'Please choose at least one destination (or the action “Do not store”).'
      )
    // beim bloßen Ein-/Ausschalten einer Regel darf ein inzwischen entferntes Ziel noch darin stehen („nicht verfügbar“)
    const vorhanden = new Set((await alleZiele(true)).map((z) => z.id))
    if (opt.zieleExistieren !== false)
      for (const z of ziele) {
        const id = sftpId(z)
        if (id != null && !vorhanden.has(id))
          throw fehler(404, 'Diese Storage Box gibt es nicht.', 'This storage box does not exist.')
      }
  }
  return { bedingung, ziele, meldung: d.meldung }
}

// ===== Regelliste mit kurzer Zwischenspeicherung =====
const TTL = 4000
let zwischen: { bis: number; liste: AblageRegel[] } | null = null
let hoererAn = false
function hoererAnmelden() {
  if (hoererAn) return
  hoererAn = true
  hoeren('vd_settings', (n) => {
    if (n === '*' || n === 'ablage_regeln') zwischen = null
  })
}
/** Zwischenspeicher dieses Knotens verwerfen und die anderen Knoten benachrichtigen (nach jeder Änderung aufrufen). */
export async function ablageVerwerfen(): Promise<void> {
  zwischen = null
  await melde('vd_settings', 'ablage_regeln')
}
export async function ablageRegelnLaden(frisch = false): Promise<AblageRegel[]> {
  hoererAnmelden()
  if (!frisch && zwischen && zwischen.bis > Date.now()) return zwischen.liste
  const liste = (
    await q<any>(
      'SELECT id, position, name, aktiv, bedingung, aktion, ziele, strategie, fallback, meldung, created_by, created_at, geaendert_at FROM ablage_regeln ORDER BY position, id'
    )
  ).map(
    (r): AblageRegel => ({
      ...r,
      bedingung: r.bedingung && typeof r.bedingung === 'object' ? r.bedingung : {},
      ziele: Array.isArray(r.ziele) ? r.ziele : []
    })
  )
  zwischen = { bis: Date.now() + TTL, liste }
  return liste
}

/** Aktive Regeln, die diesen Ort namentlich nennen (für Warnungen beim Ändern/Löschen eines Ziels). */
export async function regelnMitZiel(ort: string): Promise<AblageRegel[]> {
  return (await ablageRegelnLaden(true)).filter((r) => r.aktiv && r.aktion === 'speichern' && r.ziele.includes(ort))
}

// ===== Bedingungen =====
interface Aufgeloest extends AblageKontext {
  art: string
  mime: string
}
export function kontextAufloesen(k: AblageKontext): Aufgeloest {
  const gemeldet = String(k.mime || '').split(';')[0]!.trim().toLowerCase()
  const mime = /\//.test(gemeldet) && gemeldet !== 'application/octet-stream' ? gemeldet : typErkennen(Buffer.alloc(0), k.name, gemeldet)
  return { ...k, mime, art: k.art || artVon(mime, k.name) }
}

const ordnerKette = async (ordnerId: number): Promise<number[]> =>
  (
    await q<{ id: number }>(
      `WITH RECURSIVE oben(id, parent_id, tiefe) AS (
         SELECT id, parent_id, 0 FROM folders WHERE id = $1
         UNION ALL SELECT f.id, f.parent_id, o.tiefe + 1 FROM folders f JOIN oben o ON f.id = o.parent_id WHERE o.tiefe < 64)
       SELECT id FROM oben`,
      [ordnerId]
    )
  ).map((r) => r.id)

/** Kurze Begründung je Bedingung, die NICHT zutrifft (leer = trifft zu). */
async function bedingungPruefen(b: AblageBedingung, k: Aufgeloest): Promise<string> {
  const de = (a: string, e: string) => st(a, e)
  if (b.art?.length && !b.art.includes(k.art)) return de(`Art „${k.art}“ gehört nicht dazu`, `type “${k.art}” is not included`)
  if (b.mime?.length && !b.mime.some((m) => (m.endsWith('/') ? k.mime.startsWith(m) : k.mime === m || k.mime.startsWith(m))))
    return de(`Typ „${k.mime}“ passt nicht`, `type “${k.mime}” does not match`)
  if (b.endungen?.length) {
    const n = k.name.toLowerCase()
    if (!b.endungen.some((e) => n.endsWith('.' + e)))
      return de(`Endung „${dateiEndung(k.name) || '–'}“ passt nicht`, `extension “${dateiEndung(k.name) || '–'}” does not match`)
  }
  const von = b.groesse_von_mb || 0
  const bis = b.groesse_bis_mb || 0
  if (von > 0 || bis > 0) {
    if (k.groesse == null)
      return de(
        'Größe unbekannt — eine Größenbedingung gilt dann als nicht erfüllt',
        'size unknown — a size condition then counts as not met'
      )
    if (von > 0 && k.groesse < von * MiB) return de('Datei ist kleiner als die Untergrenze', 'file is below the lower size limit')
    if (bis > 0 && k.groesse > bis * MiB) return de('Datei ist größer als die Obergrenze', 'file is above the upper size limit')
  }
  if (b.konten?.length && (k.userId == null || !b.konten.includes(k.userId))) return de('anderes Konto', 'different account')
  if (b.rollen?.length || b.rollen_ids?.length) {
    let treffer = !!k.rolle && !!b.rollen?.includes(k.rolle)
    if (!treffer && b.rollen_ids?.length) {
      let rid = k.rolleId
      if (rid === undefined && k.userId != null)
        rid = (await q1<{ rolle_id: number | null }>('SELECT rolle_id FROM users WHERE id = $1', [k.userId]))?.rolle_id ?? null
      treffer = rid != null && b.rollen_ids.includes(rid)
    }
    if (!treffer) return de('andere Rolle', 'different role')
  }
  if (b.ordner?.length) {
    if (!k.ordnerId) return de('liegt nicht in einem der Ordner', 'is not inside one of the folders')
    const kette = await ordnerKette(k.ordnerId)
    if (!kette.some((i) => b.ordner!.includes(i))) return de('liegt nicht in einem der Ordner', 'is not inside one of the folders')
  }
  if (b.teams?.length) {
    const t = k.ordnerId ? await teamVonOrdner(k.ordnerId) : null
    if (t == null || !b.teams.includes(t)) return de('gehört zu keinem der Teams', 'does not belong to any of the teams')
  }
  return ''
}
/** Schränkt die Regel nach Dateityp ein? (bestimmt den Statuscode eines Verbots: 415 statt 403) */
const nachTyp = (b: AblageBedingung) => !!(b.art?.length || b.mime?.length || b.endungen?.length)

// ===== Ziele =====
export interface ZielStatusInfo {
  ort: string
  name: string
  /** online | offline | voll | inaktiv | schreibgeschuetzt | entfernt | nicht_eingerichtet */
  zustand: string
  frei: number | null
  verfuegbar: boolean
}
const ausfaelle = new Map<string, number>()
const AUSFALL_SEK = 15

async function poolMitglieder(): Promise<string[]> {
  const w = await getSpeicher()
  return w.art === 'pool' ? w.mitglieder || ['lokal'] : []
}

/** Zustand aller genannten Orte (Statusangaben aus dem Zwischenspeicher, kein Live-Abruf). */
export async function zielZustaende(orte: string[], groesse?: number | null): Promise<Map<string, ZielStatusInfo>> {
  const aus = new Map<string, ZielStatusInfo>()
  const eigene = orte.filter((o) => o === 'lokal' || sftpId(o) != null)
  const platz = eigene.length ? await poolPlatz(eigene) : null
  const w = await getSpeicher()
  for (const ort of new Set(orte)) {
    if (ort === 's3') {
      const bereit = !!w.s3?.bucket && (await istPro('s3'))
      aus.set(ort, {
        ort,
        name: 'S3',
        zustand: bereit ? 'online' : 'nicht_eingerichtet',
        frei: null,
        verfuegbar: bereit
      })
      continue
    }
    if (ort === 'pool') continue
    if (ort === 'lokal') {
      const m = platz?.mitglieder.find((x) => x.ort === 'lokal')
      const voll = m?.frei != null && groesse != null && m.frei < groesse
      aus.set(ort, {
        ort,
        name: st('Dieser Server', 'This server'),
        zustand: voll ? 'voll' : 'online',
        frei: m?.frei ?? null,
        verfuegbar: !voll
      })
      continue
    }
    const id = sftpId(ort)
    const z = id != null ? await zielLaden(id) : null
    if (!z) {
      aus.set(ort, { ort, name: ort, zustand: 'entfernt', frei: null, verfuegbar: false })
      continue
    }
    const m = platz?.mitglieder.find((x) => x.ort === ort)
    let zustand = 'online'
    if (!z.aktiv) zustand = 'inaktiv'
    else if (!z.schreibbar) zustand = 'schreibgeschuetzt'
    else if (z.status?.online === false || (ausfaelle.get(ort) || 0) > Date.now()) zustand = 'offline'
    else if (m?.frei != null && groesse != null && m.frei < groesse) zustand = 'voll'
    aus.set(ort, { ort, name: z.name, zustand, frei: m?.frei ?? null, verfuegbar: zustand === 'online' })
  }
  return aus
}

/** Echte Erreichbarkeit einer Storage Box kurz vor dem Schreiben (verbindet höchstens 5 Sekunden lang). */
async function erreichbar(ort: string): Promise<boolean> {
  const id = sftpId(ort)
  if (id == null) return true
  if ((ausfaelle.get(ort) || 0) > Date.now()) return false
  try {
    await Promise.race([
      sftpBereit(id),
      new Promise((_, nein) => setTimeout(() => nein(new Error('Zeitüberschreitung')), 5000).unref?.())
    ])
    return true
  } catch {
    ausfaelle.set(ort, Date.now() + AUSFALL_SEK * 1000)
    return false
  }
}

const reihum = new Map<number, number>()

export interface Entscheid {
  /** standard: keine Regel traf; ziel: Regel mit Ort; verboten/abgelehnt: kein Schreiben */
  ergebnis: 'standard' | 'ziel' | 'verboten' | 'abgelehnt'
  ort: Ort | null
  regel: { id: number; name: string; position: number } | null
  status: number
  meldung: string
  grund: string
}
export interface Pruefzeile {
  id: number
  name: string
  aktiv: boolean
  trifft: boolean
  warum: string
}

/**
 * Wertet die Regeln für eine Datei aus. `trocken`: nur ansehen (Test/Vorschau) — kein Weiterdrehen der Reihenfolge bei „abwechselnd“,
 * keine Verbindung zu den Boxen.
 */
export async function ablageAuswerten(
  ctx: AblageKontext,
  opt: { trocken?: boolean } = {}
): Promise<{ entscheid: Entscheid; pruefung: Pruefzeile[]; kontext: { art: string; mime: string; groesse: number | null } }> {
  const k = kontextAufloesen(ctx)
  const regeln = await ablageRegelnLaden()
  const pruefung: Pruefzeile[] = []
  const kontext = { art: k.art, mime: k.mime, groesse: k.groesse ?? null }
  const standard = async (grund: string): Promise<Entscheid> => ({
    ergebnis: 'standard',
    ort: await standardOrt(),
    regel: null,
    status: 200,
    meldung: '',
    grund
  })
  for (const r of regeln) {
    const kopf = { id: r.id, name: r.name, aktiv: r.aktiv }
    if (!r.aktiv) {
      pruefung.push({ ...kopf, trifft: false, warum: st('ausgeschaltet — übersprungen', 'switched off — skipped') })
      continue
    }
    const nein = await bedingungPruefen(r.bedingung, k)
    if (nein) {
      pruefung.push({ ...kopf, trifft: false, warum: nein })
      continue
    }
    const regel = { id: r.id, name: r.name, position: r.position }
    if (r.aktion === 'verbieten') {
      pruefung.push({ ...kopf, trifft: true, warum: st('trifft zu — Speichern verboten', 'matches — storing forbidden') })
      return {
        entscheid: {
          ergebnis: 'verboten',
          ort: null,
          regel,
          status: nachTyp(r.bedingung) ? 415 : 403,
          meldung: r.meldung || st('Diese Datei darf hier nicht gespeichert werden.', 'This file may not be stored here.'),
          grund: st('Die Regel verbietet das Speichern.', 'The rule forbids storing.')
        },
        pruefung,
        kontext
      }
    }
    // speichern: Ziele aufstellen (das Wort „pool“ steht für die aktuell eingestellte Pool-Gruppe)
    const orte: string[] = []
    for (const z of r.ziele) for (const o of z === 'pool' ? await poolMitglieder() : [z]) if (!orte.includes(o)) orte.push(o)
    const zustand = await zielZustaende(orte, k.groesse)
    let geeignet = orte.filter((o) => zustand.get(o)?.verfuegbar)
    // „größter freier Platz“ braucht bekannte Platzangaben — Ziele ohne Angabe (z. B. S3) zählen dabei nicht
    if (r.strategie === 'frei') {
      geeignet = geeignet.filter((o) => zustand.get(o)?.frei != null)
      geeignet.sort((a, b) => zustand.get(b)!.frei! - zustand.get(a)!.frei!)
    } else if (r.strategie === 'abwechselnd' && geeignet.length) {
      const n = reihum.get(r.id) || 0
      if (!opt.trocken) reihum.set(r.id, (n + 1) % 1_000_000)
      const s = n % geeignet.length
      geeignet = [...geeignet.slice(s), ...geeignet.slice(0, s)]
    }
    let gewaehlt: string | null = null
    for (const o of geeignet) {
      if (opt.trocken || (await erreichbar(o))) {
        gewaehlt = o
        break
      }
    }
    if (gewaehlt) {
      const z = zustand.get(gewaehlt)!
      pruefung.push({ ...kopf, trifft: true, warum: st(`trifft zu — ${z.name}`, `matches — ${z.name}`) })
      return {
        entscheid: {
          ergebnis: 'ziel',
          ort: gewaehlt as Ort,
          regel,
          status: 200,
          meldung: '',
          grund: st(
            `Regel „${r.name || '#' + r.id}“ legt die Datei in „${z.name}“ ab.`,
            `Rule “${r.name || '#' + r.id}” stores the file in “${z.name}”.`
          )
        },
        pruefung,
        kontext
      }
    }
    const nenner = orte.length
      ? orte.map((o) => `${zustand.get(o)?.name || o}: ${zustand.get(o)?.zustand || '?'}`).join(', ')
      : st('keine Ziele', 'no destinations')
    pruefung.push({
      ...kopf,
      trifft: true,
      warum: st(`trifft zu, aber kein Ziel verfügbar (${nenner})`, `matches, but no destination available (${nenner})`)
    })
    if (r.fallback === 'lokal')
      return {
        entscheid: {
          ergebnis: 'ziel',
          ort: 'lokal',
          regel,
          status: 200,
          meldung: '',
          grund: st(
            `Kein Ziel der Regel „${r.name || '#' + r.id}“ verfügbar — Rückfall auf den Server.`,
            `No destination of rule “${r.name || '#' + r.id}” available — falling back to the server.`
          )
        },
        pruefung,
        kontext
      }
    if (r.fallback === 'ablehnen')
      return {
        entscheid: {
          ergebnis: 'abgelehnt',
          ort: null,
          regel,
          status: 503,
          meldung:
            r.meldung ||
            st(
              'Der vorgesehene Speicher ist gerade nicht erreichbar. Bitte später erneut versuchen.',
              'The designated storage is not reachable right now. Please try again later.'
            ),
          grund: st(
            `Kein Ziel der Regel „${r.name || '#' + r.id}“ verfügbar — die Regel lehnt dann ab.`,
            `No destination of rule “${r.name || '#' + r.id}” available — the rule then rejects.`
          )
        },
        pruefung,
        kontext
      }
    // naechstes: weiter mit der nächsten Regel
  }
  return {
    entscheid: await standard(
      regeln.some((r) => r.aktiv)
        ? st('Keine Regel trifft zu — es gilt die Speicher-Einstellung.', 'No rule matches — the storage setting applies.')
        : st('Keine aktive Regel — es gilt die Speicher-Einstellung.', 'No active rule — the storage setting applies.')
    ),
    pruefung,
    kontext
  }
}

const ablageFehler = (status: number, meldung: string, regel: string, art: 'verbot' | 'abgelehnt') =>
  Object.assign(createError({ statusCode: status, statusMessage: 'Error', message: meldung, data: { ablage: art, regel } }), {
    ablage: art
  })

/** Entscheidet den Zielort für eine neue Datei; wirft bei Verbot (415/403) oder Ablehnung (503), bevor etwas geschrieben wird. */
export async function ablageEntscheiden(ctx: AblageKontext): Promise<Entscheid> {
  const { entscheid: e } = await ablageAuswerten(ctx)
  if (e.ergebnis === 'verboten') throw ablageFehler(e.status, e.meldung, e.regel?.name || '', 'verbot')
  if (e.ergebnis === 'abgelehnt') throw ablageFehler(e.status, e.meldung, e.regel?.name || '', 'abgelehnt')
  return e
}

/** Erste zutreffende Regel, falls sie verbietet (eine zutreffende „speichern“-Regel beendet die Suche). */
async function verbotSuchen(k: Aufgeloest): Promise<AblageRegel | null> {
  for (const r of await ablageRegelnLaden()) {
    if (!r.aktiv || (await bedingungPruefen(r.bedingung, k))) continue
    return r.aktion === 'verbieten' ? r : null
  }
  return null
}
const verbotWerfen = (r: AblageRegel) =>
  ablageFehler(
    nachTyp(r.bedingung) ? 415 : 403,
    r.meldung || st('Diese Datei darf hier nicht gespeichert werden.', 'This file may not be stored here.'),
    r.name,
    'verbot'
  )

/** Nur die Verbote prüfen, vor dem Schreiben an einen fest vorgegebenen Ort (Chunk-Upload am Startort, Überschreiben). */
export async function ablageVerbotPruefen(ctx: AblageKontext): Promise<void> {
  const r = await verbotSuchen(kontextAufloesen(ctx))
  if (r) throw verbotWerfen(r)
}

/**
 * Prüfung nach dem Schreiben (Größe jetzt bekannt, Dateiart aus dem Inhalt erkannt): verbietet eine Regel die Datei, wird sie wieder
 * entfernt. Eine zutreffende „speichern“-Regel beendet die Prüfung. Verschoben wird nie.
 */
export async function ablageNachpruefen(g: Geschrieben, ctx: AblageKontext, entfernen: (ablage: string) => Promise<void>): Promise<void> {
  if (!(await ablageRegelnLaden()).some((r) => r.aktiv && r.aktion === 'verbieten')) return
  const r = await verbotSuchen(
    kontextAufloesen({ ...ctx, groesse: g.size, mime: typErkennen(g.kopf, ctx.name, ctx.mime || ''), art: undefined })
  )
  if (!r) return
  await entfernen(g.schluessel)
  throw verbotWerfen(r)
}

/** Baut den Kontext für die Ablage-Regeln aus einem Konto und den Angaben zur Datei. */
export function ablageKontextFuer(
  u: { id: number; role?: string; rolle_id?: number | null },
  d: { name: string; mime?: string; groesse?: number | null; ordnerId?: number | null }
): AblageKontext {
  return { name: d.name, mime: d.mime, groesse: d.groesse ?? null, userId: u.id, rolle: u.role, rolleId: u.rolle_id, ordnerId: d.ordnerId ?? null }
}

// ===== Übersicht für die Verwaltung =====
export interface ZielAuswahl extends ZielStatusInfo {
  art: 'lokal' | 's3' | 'sftp' | 'pool'
  mitglieder?: string[]
}

/** Alle wählbaren Orte mit Zustand (für Dialog und Regelkarten). */
export async function zielAuswahl(): Promise<ZielAuswahl[]> {
  const ziele = await alleZiele(true)
  const orte = ['lokal', 's3', ...ziele.map((z) => `sftp${z.id}`)]
  const zu = await zielZustaende(orte)
  const pool = await poolMitglieder()
  const aus: ZielAuswahl[] = orte.map((o) => ({ ...zu.get(o)!, art: o === 'lokal' ? 'lokal' : o === 's3' ? 's3' : 'sftp' }))
  aus.push({
    ort: 'pool',
    name: st('Pool (aktuelle Gruppe)', 'Pool (current group)'),
    zustand: pool.length ? 'online' : 'nicht_eingerichtet',
    frei: null,
    verfuegbar: pool.length > 0,
    art: 'pool',
    mitglieder: pool
  })
  return aus
}

/** Regel mit dem Zustand ihrer Ziele (`pool` wird als Gruppe gezeigt, unbekannte Ziele als „entfernt“). */
export function regelAnzeige(r: AblageRegel, auswahl: ZielAuswahl[]) {
  return {
    ...r,
    ziele_status: r.ziele.map(
      (o) =>
        auswahl.find((a) => a.ort === o) ||
        ({ ort: o, name: o, zustand: 'entfernt', frei: null, verfuegbar: false, art: 'sftp' } as ZielAuswahl)
    )
  }
}

/** Nummeriert die Positionen lückenlos neu (1, 2, 3 …), z. B. nach Löschen oder Verschieben. */
export async function positionenNeu(): Promise<void> {
  await q(
    `UPDATE ablage_regeln a SET position = n.pos FROM (SELECT id, row_number() OVER (ORDER BY position, id) AS pos FROM ablage_regeln) n
      WHERE a.id = n.id AND a.position <> n.pos`
  )
}
