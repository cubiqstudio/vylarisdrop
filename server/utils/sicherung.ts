import { createWriteStream, promises as fs } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { createInterface } from 'node:readline'
import yazl from 'yazl'
import yauzl from 'yauzl'
import { db, q, q1 } from './db'
import { arbeitsPfad, datenordner, lesen, loeschen, nebenLesen, nebenSchreiben, schreiben, zielOrt } from './speicher'
import { melde, VERSION } from './knoten'
import { settingsCacheLeeren } from './settings'

export const FORMAT = 'vylariscloud-sicherung-1'
const OHNE = new Set([
  'sessions',
  'uploads',
  'importe',
  'import_posten',
  'knoten',
  'sicherung_lauf',
  'webhook_lieferungen',
  'messwerte',
  'speicher_verlauf'
])

async function tabellen(): Promise<Array<{ name: string; selbst: string[] }>> {
  const alle = (await q<{ t: string }>(`SELECT tablename AS t FROM pg_tables WHERE schemaname = current_schema()`))
    .map((r) => r.t)
    .filter((t) => !OHNE.has(t))
  const fk = await q<{
    von: string
    nach: string
    spalte: string
  }>(`SELECT c.conrelid::regclass::text AS von, c.confrelid::regclass::text AS nach, a.attname AS spalte
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f' AND c.connamespace = current_schema()::regnamespace`)
  const reihe: string[] = [],
    offen = new Set(alle)
  while (offen.size) {
    const bereit = [...offen].filter((t) => fk.every((f) => f.von !== t || f.nach === t || !offen.has(f.nach)))
    if (!bereit.length) throw new Error('Fremdschluessel im Kreis: ' + [...offen].join(', '))
    for (const t of bereit.sort()) {
      reihe.push(t)
      offen.delete(t)
    }
  }
  return reihe.map((name) => ({
    name,
    selbst: fk.filter((f) => f.von === name && f.nach === name).map((f) => f.spalte)
  }))
}

function spaeter(oeffnen: () => Readable): Readable {
  let quelle: Readable | null = null
  return new Readable({
    read() {
      if (!quelle) {
        quelle = oeffnen()
        quelle.on('data', (c) => {
          if (!this.push(c)) quelle!.pause()
        })
        quelle.on('end', () => this.push(null))
        quelle.on('error', (e) => this.destroy(e))
      } else quelle.resume()
    }
  })
}

async function spalten(tabelle: string): Promise<Array<{ name: string; typ: string }>> {
  return q(
    `SELECT attname AS name, format_type(atttypid, atttypmod) AS typ FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum`,
    [tabelle]
  )
}
const id = (s: string) => '"' + s.replace(/"/g, '""') + '"'

async function* zeilen(tabelle: string): AsyncGenerator<string> {
  const sp = await spalten(tabelle)
  const liste = sp.map((c) => `${id(c.name)}::text AS ${id(c.name)}`).join(', ')
  let nach = '(0,0)'
  for (;;) {
    const r = await q<any>(
      `SELECT ctid::text AS __ctid, ${liste} FROM ${tabelle} WHERE ctid > $1::tid ORDER BY ctid LIMIT 2000`,
      [nach]
    )
    if (!r.length) return
    let block = ''
    for (const z of r) {
      nach = z.__ctid
      delete z.__ctid
      block += JSON.stringify(z) + '\n'
    }
    yield block
  }
}

export async function sicherungErstellen(): Promise<{ strom: Readable; name: string }> {
  const t = await tabellen()
  const zip = new yazl.ZipFile()
  const objekte = await q<{ ablage: string; size: string }>(
    `SELECT ablage, size FROM files UNION SELECT datei->>'ablage', (datei->>'size')::bigint FROM papierkorb`
  )
  const zahlen: Record<string, number> = {}
  for (const x of t) zahlen[x.name] = Number((await q1<{ n: string }>(`SELECT count(*) AS n FROM ${x.name}`))?.n || 0)
  const kopf = {
    format: FORMAT,
    version: VERSION,
    erstellt: new Date().toISOString(),
    tabellen: t.map((x) => x.name),
    zahlen,
    dateien: objekte.length,
    bytes: objekte.reduce((a, o) => a + Number(o.size || 0), 0)
  }
  zip.addBuffer(Buffer.from(JSON.stringify(kopf, null, 2)), 'vylariscloud-sicherung.json')
  for (const o of objekte) {
    if (!o.ablage) continue
    zip.addReadStream(
      spaeter(() => lesen(o.ablage)),
      `dateien/${encodeURIComponent(o.ablage)}`,
      { compress: false, size: Number(o.size) }
    )
  }
  const live = await q<{ ablage: string }>(
    `SELECT ablage FROM files WHERE live UNION SELECT datei->>'ablage' FROM papierkorb WHERE (datei->>'live')::boolean`
  )
  for (const o of live) {
    const n = await nebenLesen(o.ablage, 'live').catch(() => null)
    if (n) zip.addReadStream(n.strom, `live/${encodeURIComponent(o.ablage)}`, { compress: false, size: n.groesse })
  }
  for (const x of t) zip.addReadStream(Readable.from(zeilen(x.name)), `db/${x.name}.jsonl`)
  zip.end()
  const stempel = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  return { strom: zip.outputStream as unknown as Readable, name: `vylariscloud-sicherung-${stempel}.zip` }
}

export interface Lauf {
  id: string
  status: 'laeuft' | 'fertig' | 'fehler'
  schritt: string
  anteil: number
  meldung: string
}

const laufSetzen = (l: Lauf) =>
  q(
    `INSERT INTO sicherung_lauf (id, status, schritt, anteil, meldung, zeit) VALUES ($1,$2,$3,$4,$5, now())
  ON CONFLICT (id) DO UPDATE SET status = $2, schritt = $3, anteil = $4, meldung = $5, zeit = now()`,
    [l.id, l.status, l.schritt, l.anteil, l.meldung.slice(0, 500)]
  )
export const laufLesen = (id: string) =>
  q1<Lauf & { zeit: string }>('SELECT id, status, schritt, anteil, meldung, zeit FROM sicherung_lauf WHERE id = $1', [
    id
  ])
export const letzterLauf = () =>
  q1<Lauf & { zeit: string }>(
    'SELECT id, status, schritt, anteil, meldung, zeit FROM sicherung_lauf ORDER BY zeit DESC LIMIT 1'
  )

export const ablageOrdner = () => join(datenordner(), 'tmp', 'sicherung')

function zipOeffnen(pfad: string): Promise<yauzl.ZipFile> {
  return new Promise((res, rej) =>
    yauzl.open(pfad, { lazyEntries: true, autoClose: false, strictFileNames: false }, (e, z) =>
      e || !z ? rej(e || new Error('zip')) : res(z)
    )
  )
}
const eintragStrom = (z: yauzl.ZipFile, e: yauzl.Entry) =>
  new Promise<Readable>((res, rej) =>
    z.openReadStream(e, (err, s) => (err || !s ? rej(err || new Error('zip')) : res(s)))
  )

export async function sicherungPruefen(pfad: string): Promise<any> {
  const z = await zipOeffnen(pfad)
  try {
    return await new Promise((res, rej) => {
      z.on('entry', async (e: yauzl.Entry) => {
        if (e.fileName !== 'vylariscloud-sicherung.json') return rej(new Error('kein-kopf'))
        const s = await eintragStrom(z, e)
        const teile: Buffer[] = []
        s.on('data', (c: Buffer) => teile.push(c))
        s.on('end', () => {
          try {
            const k = JSON.parse(Buffer.concat(teile).toString())
            k.format === FORMAT ? res(k) : rej(new Error('format'))
          } catch {
            rej(new Error('kein-kopf'))
          }
        })
      })
      z.on('error', rej)
      z.readEntry()
    })
  } finally {
    z.close()
  }
}

let aktiv = false
export const wiederherstellungLaeuft = () => aktiv

export async function wiederherstellen(pfad: string, id: string, aufraeumen: boolean): Promise<void> {
  aktiv = true
  const lauf: Lauf = { id, status: 'laeuft', schritt: 'pruefen', anteil: 0, meldung: '' }
  await laufSetzen(lauf)
  const neueSchluessel: string[] = []
  let c: any = null
  try {
    const kopf = await sicherungPruefen(pfad)
    const t = await tabellen()
    const bekannt = new Map(t.map((x) => [x.name, x]))
    const schema = new Map<string, Map<string, string>>()
    for (const x of t) schema.set(x.name, new Map((await spalten(x.name)).map((s) => [s.name, s.typ])))
    const alteAblagen = (
      await q<{ ablage: string }>(`SELECT ablage FROM files UNION SELECT datei->>'ablage' FROM papierkorb`)
    )
      .map((r) => r.ablage)
      .filter(Boolean)
    const ort = await zielOrt()
    const umbenannt = new Map<string, string>()
    const z = await zipOeffnen(pfad)
    let dateienFertig = 0
    const gesamt = Math.max(1, Number(kopf.dateien) || 1)
    await new Promise<void>((res, rej) => {
      z.on('error', rej)
      z.on('end', () => res())
      z.on('entry', async (e: yauzl.Entry) => {
        try {
          if (e.fileName.startsWith('dateien/') && !e.fileName.endsWith('/')) {
            const alt = decodeURIComponent(e.fileName.slice(8))
            const g = await schreiben(await eintragStrom(z, e), 0, ort)
            neueSchluessel.push(g.schluessel)
            umbenannt.set(alt, g.schluessel)
            if (++dateienFertig % 20 === 0) {
              lauf.schritt = 'dateien'
              lauf.anteil = Math.round((dateienFertig / gesamt) * 80)
              await laufSetzen(lauf)
            }
          } else if (e.fileName.startsWith('live/') && !e.fileName.endsWith('/')) {
            const neu = umbenannt.get(decodeURIComponent(e.fileName.slice(5)))
            if (neu) {
              const tmp = await arbeitsPfad()
              await pipeline(await eintragStrom(z, e), createWriteStream(tmp))
              await nebenSchreiben(neu, 'live', tmp)
            }
          } else if (e.fileName.startsWith('db/') && e.fileName.endsWith('.jsonl')) {
            const name = e.fileName.slice(3, -6)
            if (!bekannt.has(name)) throw new Error(`Unbekannte Tabelle in der Sicherung: ${name}`)
            if (!c) {
              lauf.schritt = 'datenbank'
              lauf.anteil = 82
              await laufSetzen(lauf)
              c = await db().connect()
              await c.query('BEGIN')
              await c.query(
                `TRUNCATE ${t.map((x) => x.name).join(', ')}, sessions, uploads, importe, import_posten, webhook_lieferungen RESTART IDENTITY CASCADE`
              )
            }
            await tabelleEinspielen(c, bekannt.get(name)!, schema.get(name)!, await eintragStrom(z, e), umbenannt)
          }
          z.readEntry()
        } catch (err) {
          rej(err)
        }
      })
      z.readEntry()
    })
    z.close()
    if (!c) throw new Error('Die Sicherung enthält keine Datenbank.')
    for (const x of t) {
      const seq = await c.query(
        `SELECT a.attname AS spalte, pg_get_serial_sequence($1, a.attname) AS seq FROM pg_attribute a WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND pg_get_serial_sequence($1, a.attname) IS NOT NULL`,
        [x.name]
      )
      for (const s of seq.rows)
        await c.query(`SELECT setval($1, coalesce((SELECT max(${s.spalte}) FROM ${x.name}), 0) + 1, false)`, [s.seq])
    }
    await c.query(
      `UPDATE files SET verarbeitung = 'offen', vorschau = false, streifen = 0, ansicht = false, live_mp4 = false WHERE NOT verschluesselt`
    )
    await c.query(
      `INSERT INTO sicherung_lauf (id, status, schritt, anteil, meldung, zeit) VALUES ($1, 'laeuft', 'abschluss', 95, '', now()) ON CONFLICT (id) DO UPDATE SET schritt = 'abschluss', anteil = 95`,
      [id]
    )
    await c.query('COMMIT')
    c.release()
    c = null
    settingsCacheLeeren('*')
    await melde('vd_settings', '*').catch(() => {})
    await melde('vd_arbeit', 'medien').catch(() => {})
    if (aufraeumen) for (const a of alteAblagen) await loeschen(a).catch(() => {})
    lauf.status = 'fertig'
    lauf.schritt = 'fertig'
    lauf.anteil = 100
    await laufSetzen(lauf)
  } catch (e: any) {
    if (c) {
      await c.query('ROLLBACK').catch(() => {})
      c.release()
    }
    for (const s of neueSchluessel) await loeschen(s).catch(() => {})
    console.error('[vylariscloud] Wiederherstellen:', e)
    lauf.status = 'fehler'
    lauf.meldung = String(e?.message || e).slice(0, 300)
    await laufSetzen(lauf).catch(() => {})
  } finally {
    aktiv = false
    await fs.rm(pfad, { force: true }).catch(() => {})
  }
}

async function tabelleEinspielen(
  c: any,
  x: { name: string; selbst: string[] },
  heute: Map<string, string>,
  strom: Readable,
  umbenannt: Map<string, string>
) {
  const rl = createInterface({ input: strom, crlfDelay: Infinity })
  let block: any[] = []
  let felder: string[] | null = null
  const nachtrag: Array<Record<string, unknown>> = []
  const weg = async () => {
    if (!block.length || !felder) return
    const auswahl = felder.map((f) => `(e->>${"'" + f.replace(/'/g, "''") + "'"})::${heute.get(f)}`).join(', ')
    await c.query(
      `INSERT INTO ${x.name} (${felder.map(id).join(', ')}) SELECT ${auswahl} FROM jsonb_array_elements($1::jsonb) e`,
      [JSON.stringify(block)]
    )
    block = []
  }
  for await (const zeile of rl) {
    if (!zeile.trim()) continue
    const r = JSON.parse(zeile)
    felder ||= Object.keys(r).filter((k) => heute.has(k))
    if (x.name === 'files' && r.ablage && umbenannt.has(r.ablage)) r.ablage = umbenannt.get(r.ablage)
    if (x.name === 'papierkorb' && typeof r.datei === 'string') {
      const d = JSON.parse(r.datei)
      if (d?.ablage && umbenannt.has(d.ablage)) r.datei = JSON.stringify({ ...d, ablage: umbenannt.get(d.ablage) })
    }
    if (x.selbst.length) {
      const n: Record<string, unknown> = { id: r.id }
      for (const s of x.selbst) {
        n[s] = r[s]
        r[s] = null
      }
      nachtrag.push(n)
    }
    block.push(r)
    if (block.length >= 500) await weg()
  }
  await weg()
  for (const n of nachtrag)
    for (const s of x.selbst)
      if (n[s] != null)
        await c.query(`UPDATE ${x.name} SET ${id(s)} = $2::${heute.get(s)} WHERE id = $1::${heute.get('id')}`, [
          n.id,
          n[s]
        ])
}

export const neueLaufId = () => randomBytes(16).toString('hex')
