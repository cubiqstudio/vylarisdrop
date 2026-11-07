import { randomBytes } from 'node:crypto'
import { posix } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import ssh2, { type SFTPWrapper } from 'ssh2'
import { getSetting, setSetting, st as st2 } from './settings'
import {
  adresseAufloesen,
  entschluesseln,
  fingerabdruck,
  SftpFehler,
  statusSetzen,
  zielLaden,
  zielStempel,
  type Geheim,
  type ZielZeile
} from './sftpZiele'

// ssh2 ist ein CommonJS-Paket: nach dem Bündeln gibt es keine benannten Importe, nur den Standardexport
const { Client } = ssh2
type SshClient = InstanceType<typeof Client>

/**
 * SFTP-Client für die Speicher-Erweiterungen: Verbindungspool je Ziel (Wiederverwendung, Keepalive,
 * Wiederverbinden), Parallelitätsbegrenzung, Zeitlimits, Host-Key-Pinning und Streaming mit mehreren
 * gleichzeitigen Anfragen (Lesen/Schreiben „in Flug“), damit auch Verbindungen mit höherer Latenz schnell sind.
 */

const VERBINDEN_MS = 15_000
const KEEPALIVE_MS = 10_000
const ANFRAGE_MS = 25_000 // einzelne SFTP-Anfrage (stat, mkdir, …)
const STILLSTAND_MS = 45_000 // Datenstrom ohne Fortschritt
const WARTE_MS = 20_000 // Warten auf einen freien Platz
const LEERLAUF_MS = 90_000
const FEHLER_MERKEN_MS = 4_000 // ein toter Server wird nicht von jeder Anfrage neu angewählt
const MAX_PARALLEL = 8 // gleichzeitige Vorgänge je Ziel
const MAX_VERBINDUNGEN = 3
const STUECK_MAX = 128 * 1024 // größere Anfragen sind deutlich schneller (weniger Anfragen je MB), wenn der Server sie erlaubt
const IN_FLUG = 16
/** Anfragegröße: höchstens 128 KiB und höchstens das, was der Server laut limits@openssh.com zulässt (sonst 32 KiB). */
const stueckGroesse = (s: SFTPWrapper, art: 'lesen' | 'schreiben'): number => {
  const x: any = s
  const grenze = Number(art === 'lesen' ? x._maxReadLen : x._maxWriteLen) || 32 * 1024
  return Math.max(4096, Math.min(STUECK_MAX, grenze))
}

// ===== Hilfen =====
const DEBUG = process.env.VD_SFTP_DEBUG === '1'
const dbg = (...a: unknown[]) => {
  if (DEBUG) console.log('[sftp]', new Date().toISOString().slice(11, 23), ...a)
}

export const istNichtDa = (e: any) => e instanceof SftpFehler ? e.code === 'NICHT_DA' : e?.code === 2

export function abbilden(e: any, name = ''): any {
  if (e instanceof SftpFehler) return e
  if (e?.code === 'ZU_GROSS') return e
  const c = e?.code
  const msg = String(e?.message || '')
  if (c === 2) return new SftpFehler('NICHT_DA', name)
  if (c === 3) return new SftpFehler('RECHT', name)
  if (c === 6 || c === 7) return new SftpFehler('OFFLINE', name)
  if (e?.level === 'client-authentication' || /authentication methods failed/i.test(msg))
    return new SftpFehler('AUTH', name)
  if (e?.level === 'client-timeout' || c === 'ETIMEDOUT' || /timed out/i.test(msg)) return new SftpFehler('TIMEOUT', name)
  if (
    /^(ECONN|ENOTFOUND|EHOST|ENET|EAI_|EPIPE)/.test(String(c || '')) ||
    /not connected|no response from server|channel|socket|ECONN|closed|ended|destroyed/i.test(msg)
  )
    return new SftpFehler('OFFLINE', name, msg)
  return new SftpFehler('SFTP', name, msg)
}

class Wachhund {
  private t: NodeJS.Timeout | null = null
  constructor(
    private ms: number,
    private bei: () => void
  ) {}
  schlagen() {
    if (this.t) clearTimeout(this.t)
    this.t = setTimeout(this.bei, this.ms)
    this.t.unref?.()
  }
  stopp() {
    if (this.t) clearTimeout(this.t)
    this.t = null
  }
}

// ===== Verbindung =====
export class Verb {
  tot = false
  ops = 0
  zuletzt = Date.now()
  private abbrueche = new Set<(e: any) => void>()
  constructor(
    public client: SshClient,
    public sftp: SFTPWrapper,
    public info: { banner: string; fp: string; typ: string; ms: number }
  ) {}
  beiAbbruch(fn: (e: any) => void): () => void {
    this.abbrueche.add(fn)
    return () => this.abbrueche.delete(fn)
  }
  sterben(e?: any) {
    if (this.tot) return
    this.tot = true
    const fa = e || new SftpFehler('OFFLINE')
    for (const f of [...this.abbrueche]) {
      try {
        f(fa)
      } catch {}
    }
    this.abbrueche.clear()
    try {
      this.client.destroy()
    } catch {}
  }
}

interface OeffnenOpt {
  host: string
  port: number
  benutzer: string
  geheim: Geheim
  name: string
  /** erwarteter Fingerabdruck. Ohne Angabe wird NUR der Fingerabdruck geholt und nichts gesendet (keine Anmeldung). */
  pin?: string
}
export class FingerabdruckNeu extends Error {
  constructor(
    public fp: string,
    public typ: string
  ) {
    super('fingerabdruck')
  }
}

export async function oeffnen(o: OeffnenOpt): Promise<Verb> {
  const { ip } = await adresseAufloesen(o.host).catch((e) => {
    throw e instanceof SftpFehler ? new SftpFehler(e.code, o.name) : e
  })
  const t0 = Date.now()
  return new Promise<Verb>((res, rej) => {
    const c = new Client()
    let fertig = false
    let bereit = false
    let verb: Verb | null = null
    let gesehen: { fp: string; typ: string } | null = null
    let hostFalsch = false
    const ende = (e: any) => {
      if (fertig) return
      fertig = true
      try {
        c.destroy()
      } catch {}
      rej(e)
    }
    const gruende = (e: any) => {
      if (hostFalsch && gesehen) return Object.assign(new SftpFehler('HOSTKEY', o.name), { fp: gesehen.fp, typ: gesehen.typ })
      if (!o.pin && gesehen) return new FingerabdruckNeu(gesehen.fp, gesehen.typ)
      return abbilden(e, o.name)
    }
    c.on('error', (e: any) => (bereit ? verb?.sterben(abbilden(e, o.name)) : ende(gruende(e))))
    c.on('close', () => (bereit ? verb?.sterben(new SftpFehler('OFFLINE', o.name)) : ende(gruende(new Error('closed')))))
    c.on('ready', () => {
      c.sftp((err, sftp) => {
        if (err) return ende(abbilden(err, o.name))
        if (fertig) return
        fertig = true
        bereit = true
        sftp.on('error', (e: any) => verb?.sterben(abbilden(e, o.name)))
        sftp.on('close', () => verb?.sterben(new SftpFehler('OFFLINE', o.name)))
        verb = new Verb(c, sftp, {
          banner: String((c as any)._remoteVer || '').slice(0, 120),
          fp: gesehen?.fp || '',
          typ: gesehen?.typ || '',
          ms: Date.now() - t0
        })
        res(verb)
      })
    })
    if (o.geheim.passwort)
      c.on('keyboard-interactive', (_n, _i, _l, prompts, finish) => finish(prompts.map(() => o.geheim.passwort || '')))
    try {
      c.connect({
        host: ip,
        port: o.port,
        username: o.benutzer,
        ...(o.geheim.schluessel
          ? { privateKey: o.geheim.schluessel, passphrase: o.geheim.passphrase || undefined }
          : { password: o.geheim.passwort, tryKeyboard: true }),
        readyTimeout: VERBINDEN_MS,
        keepaliveInterval: KEEPALIVE_MS,
        keepaliveCountMax: 3,
        hostVerifier: ((key: Buffer, verify: (ok: boolean) => void) => {
          gesehen = fingerabdruck(key)
          if (!o.pin) return verify(false)
          if (gesehen.fp !== o.pin) {
            hostFalsch = true
            return verify(false)
          }
          verify(true)
        }) as any
      } as any)
    } catch (e) {
      ende(abbilden(e, o.name))
    }
  })
}

// ===== Pool =====
export interface Lease {
  verb: Verb
  sftp: SFTPWrapper
  ziel: Pick<ZielZeile, 'id' | 'name' | 'basis_pfad'>
  ordner: Set<string>
  frei: () => void
  beiAbbruch: (fn: (e: any) => void) => () => void
}

class Pool {
  verbs: Verb[] = []
  verbinden: Promise<Verb> | null = null
  wartend: Array<{ los: () => void; t: NodeJS.Timeout; abbruch: (e: any) => void }> = []
  slots = 0
  letzterFehler: { zeit: number; fehler: SftpFehler } | null = null
  ordner = new Set<string>()
  constructor(
    public id: number,
    public stempel: string
  ) {}

  private async platz(name: string): Promise<void> {
    if (this.slots < MAX_PARALLEL) {
      this.slots++
      return
    }
    await new Promise<void>((los, abbruch) => {
      const w = {
        los: () => {
          clearTimeout(w.t)
          los()
        },
        abbruch,
        t: setTimeout(() => {
          this.wartend = this.wartend.filter((x) => x !== w)
          abbruch(new SftpFehler('AUSGELASTET', name))
        }, WARTE_MS)
      }
      w.t.unref?.()
      this.wartend.push(w)
    })
  }
  private platzFrei() {
    const n = this.wartend.shift()
    if (n) n.los()
    else this.slots = Math.max(0, this.slots - 1)
  }

  private async neueVerbindung(ziel: ZielZeile): Promise<Verb> {
    if (this.verbinden) return this.verbinden
    const p = (async () => {
      if (!this.verbs.length && this.letzterFehler && Date.now() - this.letzterFehler.zeit < FEHLER_MERKEN_MS)
        throw new SftpFehler(this.letzterFehler.fehler.code, ziel.name)
      try {
        const v = await oeffnen({
          host: ziel.host,
          port: ziel.port,
          benutzer: ziel.benutzer,
          geheim: await entschluesseln(ziel.geheim, ziel.name),
          name: ziel.name,
          pin: ziel.host_key
        })
        this.letzterFehler = null
        this.verbs.push(v)
        v.beiAbbruch((e) => {
          this.verbs = this.verbs.filter((x) => x !== v)
          if (!v.ops && e) void statusSetzen(ziel.id, { online: false, fehler: e.message, fehlerCode: e.code }).catch(() => {})
        })
        void statusSetzen(ziel.id, { online: true, latenzMs: v.info.ms, banner: v.info.banner }).catch(() => {})
        return v
      } catch (e: any) {
        const f: SftpFehler = e instanceof FingerabdruckNeu ? new SftpFehler('HOSTKEY', ziel.name) : abbilden(e, ziel.name)
        if (f instanceof SftpFehler) {
          this.letzterFehler = { zeit: Date.now(), fehler: f }
          void statusSetzen(ziel.id, {
            online: false,
            fehler: f.message,
            fehlerCode: f.code,
            hostKeyGeaendert: f.code === 'HOSTKEY'
          }).catch(() => {})
        }
        throw f
      }
    })()
    this.verbinden = p
    try {
      return await p
    } finally {
      this.verbinden = null
    }
  }

  async leihen(ziel: ZielZeile): Promise<Lease> {
    await this.platz(ziel.name)
    let gibtFrei = true
    try {
      const lebend = this.verbs.filter((v) => !v.tot)
      lebend.sort((a, b) => a.ops - b.ops)
      let v = lebend[0]
      if (!v || (v.ops >= 2 && lebend.length < MAX_VERBINDUNGEN)) {
        try {
          v = await this.neueVerbindung(ziel)
        } catch (e) {
          if (!v) throw e
        }
      }
      v!.ops++
      v!.zuletzt = Date.now()
      const verb = v!
      let frei = false
      gibtFrei = false
      return {
        verb,
        sftp: verb.sftp,
        ziel,
        ordner: this.ordner,
        beiAbbruch: (fn) => verb.beiAbbruch(fn),
        frei: () => {
          if (frei) return
          frei = true
          verb.ops = Math.max(0, verb.ops - 1)
          verb.zuletzt = Date.now()
          this.platzFrei()
        }
      }
    } finally {
      if (gibtFrei) this.platzFrei()
    }
  }

  schliessen() {
    for (const v of [...this.verbs]) v.sterben(new SftpFehler('OFFLINE'))
    this.verbs = []
    for (const w of this.wartend.splice(0)) {
      clearTimeout(w.t)
      w.abbruch(new SftpFehler('OFFLINE'))
    }
  }
}

const pools = new Map<number, Pool>()
let putzer: NodeJS.Timeout | null = null
function putzerStarten() {
  if (putzer) return
  putzer = setInterval(() => {
    const jetzt = Date.now()
    for (const [id, p] of pools) {
      for (const v of p.verbs) if (!v.ops && jetzt - v.zuletzt > LEERLAUF_MS) v.sterben()
      p.verbs = p.verbs.filter((v) => !v.tot)
      if (!p.verbs.length && !p.verbinden && !p.wartend.length && !p.slots && jetzt - (p.letzterFehler?.zeit || 0) > 60_000)
        pools.delete(id)
    }
  }, 30_000)
  putzer.unref?.()
}

export function poolVerwerfen(id: number) {
  pools.get(id)?.schliessen()
  pools.delete(id)
}

export async function leihen(zielId: number, opt: { schreiben?: boolean } = {}): Promise<Lease> {
  const z = await zielLaden(zielId)
  if (!z) throw new SftpFehler('GELOESCHT')
  if (!z.aktiv) throw new SftpFehler('DEAKTIVIERT', z.name)
  if (opt.schreiben && !z.schreibbar) throw new SftpFehler('SCHREIBGESCHUETZT', z.name)
  const stempel = zielStempel(z)
  let p = pools.get(zielId)
  if (p && p.stempel !== stempel) {
    p.schliessen()
    p = undefined
  }
  if (!p) {
    p = new Pool(zielId, stempel)
    pools.set(zielId, p)
    putzerStarten()
  }
  return p.leihen(z)
}

/** Prüft vorab (vor dem Senden von Antwortkopfzeilen), ob der Speicherort erreichbar ist — sonst saubere 503/502-Meldung. */
export async function sftpBereit(zielId: number): Promise<void> {
  const l = await leihen(zielId)
  l.frei()
}

// ===== Einzelne Anfragen =====
function aufruf<T>(l: Lease, start: (cb: (e: any, r?: any) => void) => void, ms = ANFRAGE_MS): Promise<T> {
  return new Promise<T>((res, rej) => {
    let aus = false
    let weg = () => {}
    const t = setTimeout(() => {
      dbg('Anfrage Zeitüberschreitung')
      l.verb.sterben(new SftpFehler('TIMEOUT', l.ziel.name))
      ende(new SftpFehler('TIMEOUT', l.ziel.name))
    }, ms)
    t.unref?.()
    function ende(e: any, r?: any) {
      if (aus) return
      aus = true
      clearTimeout(t)
      weg()
      e ? rej(abbilden(e, l.ziel.name)) : res(r as T)
    }
    weg = l.beiAbbruch((e) => ende(e))
    try {
      start((e, r) => ende(e, r))
    } catch (e) {
      ende(e)
    }
  })
}
const statA = (l: Lease, p: string) => aufruf<any>(l, (cb) => l.sftp.stat(p, cb))
const mkdirA = (l: Lease, p: string) => aufruf<void>(l, (cb) => l.sftp.mkdir(p, { mode: 0o750 }, cb))
const unlinkA = (l: Lease, p: string) => aufruf<void>(l, (cb) => l.sftp.unlink(p, cb))
const openA = (l: Lease, p: string, flags: string, mode?: number) =>
  aufruf<Buffer>(l, (cb) => l.sftp.open(p, flags as any, mode != null ? { mode } : {}, cb))
const closeA = (l: Lease, h: Buffer) => aufruf<void>(l, (cb) => l.sftp.close(h, cb), 10_000)

export async function sftpOrdnerAnlegen(l: Lease, abs: string): Promise<void> {
  if (l.ordner.has(abs)) return
  const teile = abs.split('/').filter(Boolean)
  let p = ''
  for (const t of teile) {
    p += '/' + t
    if (l.ordner.has(p)) continue
    try {
      await statA(l, p)
    } catch (e) {
      if (!istNichtDa(e)) throw e
      try {
        await mkdirA(l, p)
      } catch (e2) {
        // gleichzeitig angelegt?
        await statA(l, p).catch(() => {
          throw e2
        })
      }
    }
    l.ordner.add(p)
  }
}

// ===== Schreiben (mehrere Schreibanfragen gleichzeitig) =====
class SftpSchreiber extends Writable {
  pos = 0
  offen = 0
  fehlerWert: any = null
  private warten: (() => void) | null = null
  private leer: (() => void) | null = null
  private hund: Wachhund
  constructor(
    private sftp: SFTPWrapper,
    private handle: Buffer,
    name: string,
    entfernen: (e: any) => void
  ) {
    super({ highWaterMark: 512 * 1024 })
    this.hund = new Wachhund(STILLSTAND_MS, () => {
      dbg('Schreiber: Stillstand', name)
      entfernen(new SftpFehler('TIMEOUT', name))
    })
  }
  override _write(chunk: Buffer, _e: BufferEncoding, cb: (e?: Error | null) => void) {
    const stuecke: Buffer[] = []
    const g = stueckGroesse(this.sftp, 'schreiben')
    for (let i = 0; i < chunk.length; i += g) stuecke.push(chunk.subarray(i, i + g))
    let i = 0
    const los = () => {
      if (this.fehlerWert) return cb(this.fehlerWert)
      while (i < stuecke.length) {
        if (this.offen >= IN_FLUG) {
          this.warten = los
          return
        }
        const s = stuecke[i++]!
        const pos = this.pos
        this.pos += s.length
        this.offen++
        this.hund.schlagen()
        this.sftp.write(this.handle, s, 0, s.length, pos, (er: any) => {
          this.offen--
          if (er && !this.fehlerWert) this.fehlerWert = er
          if (this.offen) this.hund.schlagen()
          else this.hund.stopp()
          const w = this.warten
          this.warten = null
          w?.()
          this.leer?.()
        })
      }
      cb()
    }
    los()
  }
  override _final(cb: (e?: Error | null) => void) {
    const fertig = () => cb(this.fehlerWert || null)
    if (!this.offen) return fertig()
    this.leer = () => {
      if (this.offen) return
      this.leer = null
      fertig()
    }
  }
  override _destroy(e: Error | null, cb: (e?: Error | null) => void) {
    this.hund.stopp()
    cb(e)
  }
}

/** Schreibt einen Strom in eine Datei (Pfad absolut). Räumt bei Fehler/Abbruch die Teil-Datei auf. */
export async function schreibenAuf(l: Lease, pfad: string, quelle: Readable): Promise<void> {
  let h: Buffer | null = null
  let schreiber: SftpSchreiber | null = null
  const abbruch = (e: any) => {
    schreiber?.destroy(e)
    quelle.destroy(e)
  }
  const weg = l.beiAbbruch(abbruch)
  try {
    await sftpOrdnerAnlegen(l, posix.dirname(pfad))
    h = await openA(l, pfad, 'w', 0o640)
    schreiber = new SftpSchreiber(l.sftp, h, l.ziel.name, abbruch)
    await pipeline(quelle, schreiber)
    await closeA(l, h)
  } catch (e: any) {
    dbg('schreibenAuf Fehler', pfad, e?.code, e?.message)
    quelle.destroy() // der Absender (z. B. der Upload) darf nicht an einem nie gelesenen Strom hängen bleiben
    // Teil-Datei entfernen (best effort; bei toter Verbindung bleibt nur ein Rest, der nie in der Datenbank steht)
    if (h && !l.verb.tot) {
      await closeA(l, h).catch(() => {})
      await unlinkA(l, pfad).catch(() => {})
    }
    throw abbilden(e, l.ziel.name)
  } finally {
    weg()
  }
}

// ===== Lesen (Vorauslesen mit mehreren Anfragen) =====
interface Slot {
  pos: number
  len: number
  got: number
  teile: Buffer[]
  fertig: boolean
  fehler?: any
}
class SftpLeser extends Readable {
  private handle: Buffer | null = null
  private pos = 0
  private ende = 0
  private slots: Slot[] = []
  private inFlug = 0
  private zu = false
  private bereit = false
  private hund: Wachhund
  constructor(
    private l: Lease,
    private pfad: string,
    private bereich?: { start: number; end: number }
  ) {
    super({ highWaterMark: 256 * 1024 })
    this.hund = new Wachhund(STILLSTAND_MS, () => this.destroy(new SftpFehler('TIMEOUT', l.ziel.name)))
    const weg = l.beiAbbruch((e) => this.destroy(e))
    this.once('close', weg)
    void this.starten()
  }
  private async starten() {
    try {
      const h = await openA(this.l, this.pfad, 'r')
      if (this.destroyed) {
        void closeA(this.l, h).catch(() => {})
        return
      }
      this.handle = h
      const attr: any = await aufruf<any>(this.l, (cb) => this.l.sftp.fstat(h, cb))
      const groesse = Number(attr?.size ?? 0)
      this.pos = this.bereich ? this.bereich.start : 0
      this.ende = Math.min(groesse, this.bereich ? this.bereich.end + 1 : groesse)
      if (this.bereich && this.bereich.end + 1 > groesse && this.bereich.start < groesse) {
        // Bereich reicht über das Dateiende hinaus: die Datei ist auf dem Server kürzer als erwartet
        throw new SftpFehler('SFTP', this.l.ziel.name, 'kuerzer')
      }
      this.bereit = true
      this.weiter()
    } catch (e) {
      this.destroy(abbilden(e, this.l.ziel.name))
    }
  }
  override _read() {
    if (this.bereit) this.weiter()
  }
  private weiter() {
    this.liefern()
    this.nachfordern()
  }
  private liefern() {
    while (this.slots.length && this.slots[0]!.fertig && !this.destroyed) {
      const s = this.slots.shift()!
      if (s.fehler) return void this.destroy(abbilden(s.fehler, this.l.ziel.name))
      if (!this.push(s.teile.length === 1 ? s.teile[0]! : Buffer.concat(s.teile))) break
    }
    if (!this.zu && this.pos >= this.ende && !this.slots.length && !this.destroyed) {
      this.zu = true
      this.hund.stopp()
      this.push(null)
    }
  }
  private nachfordern() {
    while (!this.destroyed && this.pos < this.ende && this.slots.length < IN_FLUG) {
      const len = Math.min(stueckGroesse(this.l.sftp, 'lesen'), this.ende - this.pos)
      const s: Slot = { pos: this.pos, len, got: 0, teile: [], fertig: false }
      this.pos += len
      this.slots.push(s)
      this.lesenSlot(s)
    }
  }
  private lesenSlot(s: Slot) {
    const buf = Buffer.allocUnsafe(s.len - s.got)
    this.inFlug++
    this.hund.schlagen()
    this.l.sftp.read(this.handle!, buf, 0, buf.length, s.pos + s.got, (er: any, nb: number) => {
      this.inFlug--
      if (this.destroyed) return
      if (this.inFlug) this.hund.schlagen()
      else this.hund.stopp()
      if (er) {
        s.fehler = er
        s.fertig = true
      } else if (!nb) {
        s.fehler = new SftpFehler('SFTP', this.l.ziel.name, 'eof')
        s.fertig = true
      } else {
        s.teile.push(buf.subarray(0, nb))
        s.got += nb
        if (s.got < s.len) return this.lesenSlot(s)
        s.fertig = true
      }
      this.weiter()
    })
  }
  override _destroy(e: Error | null, cb: (e?: Error | null) => void) {
    this.hund.stopp()
    const h = this.handle
    this.handle = null
    this.slots = []
    if (h && !this.l.verb.tot) void closeA(this.l, h).catch(() => {})
    this.l.frei()
    cb(e)
  }
}

// ===== Öffentliche Operationen =====
export async function sftpSchreiben(zielId: number, rel: string, quelle: Readable): Promise<void> {
  let l: Lease
  try {
    l = await leihen(zielId, { schreiben: true })
  } catch (e) {
    quelle.destroy()
    throw e
  }
  try {
    await schreibenAuf(l, posix.join(l.ziel.basis_pfad, rel), quelle)
  } finally {
    l.frei()
  }
}

/**
 * Liefert einen Lesestrom. Verbindung und Datei werden erst geöffnet, wenn jemand liest (so halten viele
 * gleichzeitig angelegte Ströme, z. B. beim ZIP-Download, keine Plätze belegt). Fehler kommen als Stream-Fehler.
 */
export function sftpLesen(zielId: number, rel: string, bereich?: { start: number; end: number }): Readable {
  let gestartet = false
  let abgebrochen = false
  let innen: Readable | null = null
  const los = async () => {
    try {
      const l = await leihen(zielId)
      if (abgebrochen) return l.frei()
      const r = new SftpLeser(l, posix.join(l.ziel.basis_pfad, rel), bereich)
      innen = r
      r.on('data', (c) => {
        if (!aus.push(c)) r.pause()
      })
      r.on('end', () => aus.push(null))
      r.on('error', (e) => aus.destroy(abbilden(e, l.ziel.name)))
    } catch (e) {
      aus.destroy(e as Error)
    }
  }
  const aus: Readable = new Readable({
    highWaterMark: 256 * 1024,
    read() {
      if (!gestartet) {
        gestartet = true
        void los()
      } else innen?.resume()
    },
    destroy(e, cb) {
      abgebrochen = true
      innen?.destroy()
      cb(e)
    }
  })
  return aus
}

export async function sftpGroesse(zielId: number, rel: string): Promise<number | null> {
  const l = await leihen(zielId)
  try {
    const s = await statA(l, posix.join(l.ziel.basis_pfad, rel))
    return Number(s.size ?? 0)
  } catch (e) {
    if (istNichtDa(e)) return null
    throw e
  } finally {
    l.frei()
  }
}

export async function sftpLoeschen(zielId: number, rels: string[]): Promise<void> {
  const l = await leihen(zielId)
  try {
    for (const r of rels)
      try {
        await unlinkA(l, posix.join(l.ziel.basis_pfad, r))
      } catch (e) {
        if (!istNichtDa(e)) throw e
      }
  } finally {
    l.frei()
  }
}

// ===== Löschliste: Dateien, die nicht entfernt werden konnten (Server offline), werden später erneut versucht =====
const LISTE = 'sftp_loeschliste'
export async function loeschenVormerken(ablage: string): Promise<void> {
  const liste = await getSetting<string[]>(LISTE, [], true)
  if (liste.includes(ablage) || liste.length >= 5000) return
  await setSetting(LISTE, [...liste, ablage])
}
export async function loeschlisteAbarbeiten(
  loeschen: (ablage: string) => Promise<void>
): Promise<{ offen: number; erledigt: number }> {
  const liste = await getSetting<string[]>(LISTE, [], true)
  if (!liste.length) return { offen: 0, erledigt: 0 }
  const rest: string[] = []
  for (const a of liste) {
    try {
      await loeschen(a)
    } catch {
      rest.push(a)
    }
  }
  if (rest.length !== liste.length) await setSetting(LISTE, rest)
  return { offen: rest.length, erledigt: liste.length - rest.length }
}

// ===== Platz (statvfs@openssh.com), Zustandsprüfung =====
export async function platzMessen(l: Lease): Promise<{ frei: number; gesamt: number } | null> {
  const s: any = l.sftp
  if (typeof s.ext_openssh_statvfs !== 'function' || !s._extensions?.['statvfs@openssh.com']) return null
  try {
    const r: any = await aufruf<any>(l, (cb) => s.ext_openssh_statvfs(l.ziel.basis_pfad, cb))
    const fr = Number(r.f_frsize || r.f_bsize || 0)
    return fr && Number(r.f_blocks) ? { frei: Number(r.f_bavail) * fr, gesamt: Number(r.f_blocks) * fr } : null
  } catch {
    return null
  }
}

/** Leichte Zustandsprüfung über den Pool (Latenz, Platz) — für die Statusanzeige und die regelmäßige Prüfung. */
export async function sftpPruefen(zielId: number): Promise<void> {
  const z = await zielLaden(zielId, true)
  if (!z) return
  if (!z.aktiv) return void (await statusSetzen(zielId, { online: null, fehler: '', fehlerCode: 'DEAKTIVIERT' }, true))
  try {
    const l = await leihen(zielId)
    try {
      const t0 = Date.now()
      await statA(l, z.basis_pfad).catch((e) => {
        if (!istNichtDa(e)) throw e
      })
      const ms = Date.now() - t0
      const platz = await platzMessen(l)
      await statusSetzen(zielId, { online: true, latenzMs: ms, platz, banner: l.verb.info.banner }, true)
    } finally {
      l.frei()
    }
  } catch (e: any) {
    const f = abbilden(e, z.name)
    await statusSetzen(
      zielId,
      {
        online: false,
        fehler: f.message,
        fehlerCode: f.code || 'SFTP',
        hostKeyGeaendert: f.code === 'HOSTKEY'
      },
      true
    )
  }
}

// ===== Verbindungstest (eigene Verbindung, nicht aus dem Pool) =====
export interface TestSchritt {
  name: string
  ok: boolean
  ms?: number
}
export interface TestErgebnis {
  ok: boolean
  stufe: 'adresse' | 'fingerabdruck' | 'anmeldung' | 'zugriff' | 'ok'
  meldung: string
  fingerabdruck?: string
  keyTyp?: string
  braucheBestaetigung?: boolean
  hostKeyGeaendert?: boolean
  latenzMs?: number
  verbindungMs?: number
  banner?: string
  platz?: { frei: number; gesamt: number } | null
  schritte: TestSchritt[]
}
export interface TestEingabe {
  host: string
  port: number
  benutzer: string
  geheim: Geheim
  name: string
  basis: string
  pin?: string
  schreibbar: boolean
}

export async function sftpTesten(p: TestEingabe): Promise<TestErgebnis> {
  const schritte: TestSchritt[] = []
  const T = async <R>(name: string, fn: () => Promise<R>): Promise<R> => {
    const t0 = Date.now()
    try {
      const r = await fn()
      schritte.push({ name, ok: true, ms: Date.now() - t0 })
      return r
    } catch (e) {
      schritte.push({ name, ok: false, ms: Date.now() - t0 })
      throw e
    }
  }
  let verb: Verb | null = null
  try {
    try {
      verb = await T('verbindung', () => oeffnen({ ...p }))
    } catch (e: any) {
      if (e instanceof FingerabdruckNeu) {
        schritte[schritte.length - 1]!.ok = true
        return {
          ok: false,
          stufe: 'fingerabdruck',
          braucheBestaetigung: true,
          fingerabdruck: e.fp,
          keyTyp: e.typ,
          meldung: st2(
            'Server erreicht. Bitte den Fingerabdruck mit dem Wert deines Anbieters vergleichen und bestätigen.',
            'Server reached. Please compare the fingerprint with the value from your provider and confirm it.'
          ),
          schritte
        }
      }
      if (e instanceof SftpFehler && e.code === 'HOSTKEY')
        return {
          ok: false,
          stufe: 'fingerabdruck',
          hostKeyGeaendert: true,
          fingerabdruck: (e as any).fp,
          keyTyp: (e as any).typ,
          meldung: e.message,
          schritte
        }
      if (e instanceof SftpFehler)
        return { ok: false, stufe: e.code === 'ADRESSE' ? 'adresse' : e.code === 'AUTH' ? 'anmeldung' : 'zugriff', meldung: e.message, schritte }
      throw e
    }
    const l: Lease = {
      verb,
      sftp: verb.sftp,
      ziel: { id: 0, name: p.name, basis_pfad: p.basis },
      ordner: new Set(),
      frei: () => {},
      beiAbbruch: (fn) => verb!.beiAbbruch(fn)
    }
    const res: TestErgebnis = {
      ok: false,
      stufe: 'zugriff',
      meldung: '',
      fingerabdruck: verb.info.fp,
      keyTyp: verb.info.typ,
      banner: verb.info.banner,
      verbindungMs: verb.info.ms,
      schritte
    }
    try {
      schritte.push({ name: 'hostkey', ok: true }, { name: 'anmeldung', ok: true })
      if (p.schreibbar) await T('ordner', () => sftpOrdnerAnlegen(l, p.basis))
      else
        await T('ordner', async () => {
          await statA(l, p.basis)
        })
      const t0 = Date.now()
      await statA(l, p.basis)
      res.latenzMs = Date.now() - t0
      res.platz = await platzMessen(l)
      if (p.schreibbar) {
        const probe = Buffer.alloc(96 * 1024)
        for (let i = 0; i < probe.length; i++) probe[i] = (i * 31 + 7) & 255
        const pfad = posix.join(p.basis, `.vylariscloud-test-${randomBytes(6).toString('hex')}`)
        try {
          await T('schreiben', () => schreibenAuf(l, pfad, Readable.from([probe])))
          await T('lesen', async () => {
            const lesen = async (b?: { start: number; end: number }) => {
              const teile: Buffer[] = []
              const r = new SftpLeser({ ...l, frei: () => {} }, pfad, b)
              for await (const c of r) teile.push(c as Buffer)
              return Buffer.concat(teile)
            }
            const ganz = await lesen()
            const teil = await lesen({ start: 1000, end: 1999 })
            if (!ganz.equals(probe) || !teil.equals(probe.subarray(1000, 2000)))
              throw new SftpFehler('SFTP', p.name, 'inhalt')
          })
        } finally {
          await T('loeschen', () => unlinkA(l, pfad)).catch(() => {})
        }
      }
      res.ok = true
      res.stufe = 'ok'
      res.meldung = st2(
        p.schreibbar ? 'Verbinden, Schreiben, Lesen und Löschen klappen.' : 'Verbinden und Lesen klappen (schreibgeschützt).',
        p.schreibbar ? 'Connecting, writing, reading and deleting work.' : 'Connecting and reading work (write-protected).'
      )
      return res
    } catch (e: any) {
      const f = abbilden(e, p.name)
      res.meldung =
        f instanceof SftpFehler && f.code === 'SFTP'
          ? st2(
              'Der Server verhält sich beim Schreiben/Lesen unerwartet — Zielordner und Rechte prüfen.',
              'The server behaves unexpectedly when writing/reading — check the target folder and permissions.'
            )
          : f.message
      return res
    }
  } finally {
    verb?.sterben()
  }
}
