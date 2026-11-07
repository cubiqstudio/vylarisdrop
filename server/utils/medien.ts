import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import { q, q1 } from './db'
import { getMedien } from './settings'
import { arbeitsPfad, loeschen, lokaleKopie, nebenKopie, nebenSchreiben, ortVon, schreiben } from './speicher'
import { heifOhneMeta } from './heif'
import { arbeitBeginnt, arbeitEndet, KNOTEN_ID, melde, NUR_WEB } from './knoten'

const FFMPEG = process.env.VD_FFMPEG || 'ffmpeg'
const FFPROBE = process.env.VD_FFPROBE || 'ffprobe'
const HEIFDEC = process.env.VD_HEIFDEC || 'heif-dec'
const HEIC = /^image\/hei[cf]$/
const ZEIT_MS = 5 * 60_000

function lauf(
  cmd: string,
  args: string[],
  opt: { ausgabe?: boolean } = {}
): Promise<{ code: number; out: Buffer; err: string }> {
  return new Promise((resolve) => {
    let p
    try {
      p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      return resolve({ code: -1, out: Buffer.alloc(0), err: 'nicht gefunden' })
    }
    const teile: Buffer[] = []
    let err = ''
    const bremse = setTimeout(() => p.kill('SIGKILL'), ZEIT_MS)
    p.stdout.on('data', (d: Buffer) => {
      if (opt.ausgabe !== false) teile.push(d)
    })
    p.stderr.on('data', (d: Buffer) => {
      if (err.length < 4000) err += d.toString()
    })
    p.on('error', () => {
      clearTimeout(bremse)
      resolve({ code: -1, out: Buffer.alloc(0), err: 'nicht gefunden' })
    })
    p.on('close', (code: number) => {
      clearTimeout(bremse)
      resolve({ code: code ?? -1, out: Buffer.concat(teile), err })
    })
  })
}

export const ffmpegLauf = (args: string[]) => lauf(FFMPEG, args, { ausgabe: false })

export async function heicNachJpeg(ein: string, aus: string): Promise<boolean> {
  const ok = async () => {
    const st = await fs.stat(aus).catch(() => null)
    return !!st && st.size > 0
  }
  let r = await lauf(HEIFDEC, ['--quality', '90', ein, aus], { ausgabe: false })
  if (r.code !== 0 || !(await ok()))
    r = await lauf(
      FFMPEG,
      [
        '-v',
        'error',
        '-y',
        '-i',
        ein,
        '-frames:v',
        '1',
        '-map_metadata',
        '-1',
        '-c:v',
        'mjpeg',
        '-pix_fmt',
        'yuvj420p',
        '-q:v',
        '3',
        aus
      ],
      { ausgabe: false }
    )
  if (r.code !== 0 || !(await ok())) {
    await fs.rm(aus, { force: true }).catch(() => {})
    return false
  }
  const sauber = jpegOhneMeta(await fs.readFile(aus), true)
  if (sauber) await fs.writeFile(aus, sauber)
  return true
}

let ffmpegDa: boolean | null = null
export async function ffmpegVorhanden(): Promise<boolean> {
  if (ffmpegDa === null) ffmpegDa = (await lauf(FFMPEG, ['-version'])).code === 0
  return ffmpegDa
}

interface Probe {
  dauer_ms: number | null
  breite: number | null
  hoehe: number | null
  drehung: number
}
async function probe(pfad: string): Promise<Probe> {
  const r = await lauf(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', pfad])
  if (r.code !== 0) return { dauer_ms: null, breite: null, hoehe: null, drehung: 0 }
  try {
    const j = JSON.parse(r.out.toString())
    const v = (j.streams || []).find((s: any) => s.codec_type === 'video')
    const dauer = Number(j.format?.duration || v?.duration || 0)
    const dreh = Number(v?.tags?.rotate || v?.side_data_list?.find((x: any) => x.rotation != null)?.rotation || 0)
    let breite = v?.width ? Number(v.width) : null,
      hoehe = v?.height ? Number(v.height) : null
    if (Math.abs(dreh) === 90 && breite && hoehe) [breite, hoehe] = [hoehe, breite]
    return { dauer_ms: dauer > 0 ? Math.round(dauer * 1000) : null, breite, hoehe, drehung: dreh }
  } catch {
    return { dauer_ms: null, breite: null, hoehe: null, drehung: 0 }
  }
}

function jpegOrientierung(b: Buffer): number {
  let i = 2
  while (i + 4 < b.length && b[i] === 0xff) {
    const m = b[i + 1]!,
      len = b.readUInt16BE(i + 2)
    if (m === 0xe1 && b.subarray(i + 4, i + 10).toString('latin1') === 'Exif\0\0') {
      const t = i + 10,
        le = b.subarray(t, t + 2).toString('latin1') === 'II'
      const u16 = (o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o)),
        u32 = (o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o))
      const ifd = t + u32(t + 4),
        n = u16(ifd)
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12
        if (u16(e) === 0x0112) return u16(e + 8) || 1
      }
      return 1
    }
    if (m === 0xda) break
    i += 2 + len
  }
  return 1
}
function exifNurOrientierung(o: number): Buffer {
  const tiff = Buffer.alloc(26)
  tiff.write('MM', 0, 'latin1')
  tiff.writeUInt16BE(42, 2)
  tiff.writeUInt32BE(8, 4)
  tiff.writeUInt16BE(1, 8)
  tiff.writeUInt16BE(0x0112, 10)
  tiff.writeUInt16BE(3, 12)
  tiff.writeUInt32BE(1, 14)
  tiff.writeUInt16BE(o, 18)
  tiff.writeUInt32BE(0, 22)
  const kopf = Buffer.from('Exif\0\0', 'latin1')
  const seg = Buffer.alloc(4)
  seg[0] = 0xff
  seg[1] = 0xe1
  seg.writeUInt16BE(2 + kopf.length + tiff.length, 2)
  return Buffer.concat([seg, kopf, tiff])
}
function jpegOhneMeta(b: Buffer, ohneAusrichtung = false): Buffer | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null
  const o = ohneAusrichtung ? 1 : jpegOrientierung(b)
  const teile: Buffer[] = [b.subarray(0, 2)]
  if (o !== 1) teile.push(exifNurOrientierung(o))
  let i = 2,
    entfernt = false
  while (i + 4 <= b.length && b[i] === 0xff) {
    const m = b[i + 1]!
    if (m === 0xda) break
    const len = b.readUInt16BE(i + 2)
    if (m === 0xe1 || m === 0xed || m === 0xfe) entfernt = true
    else teile.push(b.subarray(i, i + 2 + len))
    i += 2 + len
  }
  if (!entfernt) return null
  teile.push(b.subarray(i))
  return Buffer.concat(teile)
}
function pngOhneMeta(b: Buffer): Buffer | null {
  if (b.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null
  const teile: Buffer[] = [b.subarray(0, 8)]
  let i = 8,
    entfernt = false
  while (i + 8 <= b.length) {
    const len = b.readUInt32BE(i),
      typ = b.subarray(i + 4, i + 8).toString('latin1')
    const ende = i + 12 + len
    if (['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'].includes(typ)) entfernt = true
    else teile.push(b.subarray(i, ende))
    i = ende
    if (typ === 'IEND') break
  }
  return entfernt ? Buffer.concat(teile) : null
}
function webpOhneMeta(b: Buffer): Buffer | null {
  if (b.subarray(0, 4).toString('latin1') !== 'RIFF' || b.subarray(8, 12).toString('latin1') !== 'WEBP') return null
  const teile: Buffer[] = []
  let i = 12,
    entfernt = false
  while (i + 8 <= b.length) {
    const typ = b.subarray(i, i + 4).toString('latin1'),
      len = b.readUInt32LE(i + 4)
    const ende = i + 8 + len + (len % 2)
    if (typ === 'EXIF' || typ === 'XMP ') entfernt = true
    else {
      const c = Buffer.from(b.subarray(i, ende))
      if (typ === 'VP8X') c[8] = c[8]! & ~0x0c
      teile.push(c)
    }
    i = ende
  }
  if (!entfernt) return null
  const inhalt = Buffer.concat(teile)
  const kopf = Buffer.alloc(12)
  kopf.write('RIFF', 0, 'latin1')
  kopf.writeUInt32LE(inhalt.length + 4, 4)
  kopf.write('WEBP', 8, 'latin1')
  return Buffer.concat([kopf, inhalt])
}

let arbeitet = false
let nochmal = false
export function verarbeiten(_id?: string): void {
  void arbeiten()
  void melde('vd_arbeit', 'medien')
}
async function holen(): Promise<string | null> {
  const r = await q1<{ id: string }>(
    `UPDATE files SET verarbeitung = 'laeuft', verarbeitung_seit = now(), verarbeitet_von = $1
    WHERE id = (SELECT id FROM files WHERE verarbeitung = 'offen' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id`,
    [KNOTEN_ID]
  )
  return r?.id ?? null
}
export async function arbeiten(): Promise<void> {
  if (NUR_WEB) return
  if (arbeitet) {
    nochmal = true
    return
  }
  arbeitet = true
  try {
    do {
      nochmal = false
      for (;;) {
        const id = await holen()
        if (!id) break
        arbeitBeginnt('medien')
        try {
          await eineDatei(id)
        } catch (e: any) {
          console.error('[vylariscloud] Verarbeitung', id, e?.message)
          await q("UPDATE files SET verarbeitung = 'fehler' WHERE id = $1", [id]).catch(() => {})
        } finally {
          arbeitEndet('medien')
        }
      }
    } while (nochmal)
  } catch (e: any) {
    console.error('[vylariscloud] Warteschlange:', e?.message)
  } finally {
    arbeitet = false
  }
}
export async function verarbeitungNachholen(): Promise<void> {
  await q(
    `UPDATE files SET verarbeitung = 'offen' WHERE verarbeitung = 'laeuft' AND verarbeitet_von IS DISTINCT FROM $1 AND (verarbeitet_von IS NULL
    OR verarbeitet_von NOT IN (SELECT id FROM knoten WHERE zuletzt_at > now() - interval '60 seconds') OR verarbeitung_seit < now() - interval '30 minutes')`,
    [KNOTEN_ID]
  )
  await arbeiten()
}

async function eineDatei(id: string) {
  const f = await q1<{
    id: string
    art: string
    ablage: string
    mime: string
    name: string
    size: string
    live: boolean
  }>('SELECT id, art, ablage, mime, name, size, live FROM files WHERE id = $1', [id])
  if (!f) return
  const cfg = await getMedien()
  const mitFfmpeg = cfg.vorschau && (await ffmpegVorhanden())
  if (!['bild', 'video', 'audio'].includes(f.art)) {
    await q("UPDATE files SET verarbeitung = 'aus' WHERE id = $1", [id])
    return
  }
  let ablage = f.ablage
  const set: Record<string, unknown> = {}
  let kopie = await lokaleKopie(ablage)
  const neuKopieren = async () => {
    await kopie.weg()
    kopie = await lokaleKopie(ablage)
  }
  let ansicht: string | null = null
  try {
    if (f.art === 'bild') {
      if (cfg.exifEntfernen && Number(f.size) < 60 * 1024 ** 2) {
        const b = await fs.readFile(kopie.pfad)
        const sauber =
          f.mime === 'image/jpeg'
            ? jpegOhneMeta(b)
            : f.mime === 'image/png'
              ? pngOhneMeta(b)
              : f.mime === 'image/webp'
                ? webpOhneMeta(b)
                : HEIC.test(f.mime)
                  ? heifOhneMeta(b)
                  : null
        if (sauber) {
          ablage = await ersetzen(id, ablage, sauber, {})
          set.exif_entfernt = true
          await neuKopieren()
        }
      }
      if (mitFfmpeg && cfg.umwandeln !== 'aus' && ['image/jpeg', 'image/png', 'image/bmp'].includes(f.mime)) {
        const ziel = await arbeitsPfad(`.${cfg.umwandeln}`)
        const codec =
          cfg.umwandeln === 'webp'
            ? ['-c:v', 'libwebp', '-quality', String(cfg.qualitaet)]
            : ['-c:v', 'libaom-av1', '-still-picture', '1', '-crf', String(Math.round(63 - cfg.qualitaet * 0.5))]
        const r = await lauf(
          FFMPEG,
          ['-v', 'error', '-y', '-i', kopie.pfad, '-map_metadata', '-1', '-frames:v', '1', ...codec, ziel],
          { ausgabe: false }
        )
        const st = await fs.stat(ziel).catch(() => null)
        if (r.code === 0 && st && st.size > 0 && st.size < Number(f.size)) {
          const neuName = f.name.replace(/\.[a-z0-9]{2,5}$/i, '') + '.' + cfg.umwandeln
          ablage = await ersetzen(id, ablage, await fs.readFile(ziel), {
            mime: `image/${cfg.umwandeln}`,
            name: neuName
          })
          await neuKopieren()
        }
        await fs.rm(ziel, { force: true }).catch(() => {})
      }
    }

    let quelle = kopie.pfad
    if (f.art === 'bild' && HEIC.test(f.mime)) {
      const aus = await arbeitsPfad('.jpg')
      if (await heicNachJpeg(kopie.pfad, aus)) {
        ansicht = aus
        quelle = aus
      } else set.ansicht = false
    }

    if (mitFfmpeg) {
      const p = await probe(quelle)
      if (f.art === 'bild' && p.breite && p.hoehe) {
        const kopf = Buffer.alloc(128 * 1024)
        const fh = await fs.open(kopie.pfad, 'r')
        try {
          await fh.read(kopf, 0, kopf.length, 0)
        } finally {
          await fh.close()
        }
        let o = 1
        try {
          if (kopf[0] === 0xff && kopf[1] === 0xd8) o = jpegOrientierung(kopf)
        } catch {}
        if (o >= 5) [p.breite, p.hoehe] = [p.hoehe, p.breite]
      }
      set.width = p.breite
      set.height = p.hoehe
      if (f.art === 'bild' || p.dauer_ms) set.duration_ms = f.art === 'bild' ? null : p.dauer_ms
      if (f.art === 'bild' || f.art === 'video') {
        const ab = f.art === 'video' ? ['-ss', String(Math.max(0, Math.min(3, (p.dauer_ms || 0) / 10000)))] : []
        const aus = await arbeitsPfad('.webp')
        const r = await lauf(
          FFMPEG,
          [
            '-v',
            'error',
            '-y',
            ...ab,
            '-i',
            quelle,
            '-frames:v',
            '1',
            '-vf',
            "scale='min(640,iw)':-2",
            '-c:v',
            'libwebp',
            '-quality',
            '78',
            aus
          ],
          { ausgabe: false }
        )
        set.vorschau = r.code === 0
        if (r.code === 0) await nebenSchreiben(ablage, 'vorschau', aus)
        else await fs.rm(aus, { force: true }).catch(() => {})
      }
      if (f.art === 'video' && p.dauer_ms && p.dauer_ms > 2000) {
        const n = 10
        const aus = await arbeitsPfad('.webp')
        const r = await lauf(
          FFMPEG,
          [
            '-v',
            'error',
            '-y',
            '-i',
            kopie.pfad,
            '-vf',
            `fps=${n}/${(p.dauer_ms / 1000).toFixed(2)},scale=160:-2,tile=${n}x1`,
            '-frames:v',
            '1',
            '-c:v',
            'libwebp',
            '-quality',
            '70',
            aus
          ],
          { ausgabe: false }
        )
        set.streifen = r.code === 0 ? n : 0
        if (r.code === 0) await nebenSchreiben(ablage, 'streifen', aus)
        else await fs.rm(aus, { force: true }).catch(() => {})
      }
      if (f.art === 'audio') {
        const r = await lauf(FFMPEG, ['-v', 'error', '-i', kopie.pfad, '-ac', '1', '-ar', '2000', '-f', 's16le', '-'])
        if (r.code === 0 && r.out.length > 400) set.wellen = JSON.stringify(wellenAus(r.out, 160))
      }
      if (f.live) set.live_mp4 = await liveUmwandeln(ablage)
    }
    if (ansicht) {
      await nebenSchreiben(ablage, 'ansicht', ansicht)
      set.ansicht = true
    }
  } finally {
    await kopie.weg()
    if (ansicht) await fs.rm(ansicht, { force: true }).catch(() => {})
  }
  const spalten = Object.keys(set)
  await q(
    `UPDATE files SET verarbeitung = 'fertig'${spalten.map((s, i) => `, ${s} = $${i + 2}${s === 'wellen' ? '::jsonb' : ''}`).join('')} WHERE id = $1`,
    [id, ...spalten.map((s) => set[s])]
  )
}

async function liveUmwandeln(ablage: string): Promise<boolean> {
  const roh = await nebenKopie(ablage, 'live')
  if (!roh) return false
  const aus = await arbeitsPfad('.mp4')
  try {
    const r = await lauf(
      FFMPEG,
      [
        '-v',
        'error',
        '-y',
        '-i',
        roh.pfad,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-vf',
        "scale='if(gt(iw,ih),min(1440,iw),-2)':'if(gt(iw,ih),-2,min(1440,ih))'",
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '96k',
        '-movflags',
        '+faststart',
        aus
      ],
      { ausgabe: false }
    )
    const st = await fs.stat(aus).catch(() => null)
    if (r.code !== 0 || !st?.size) return false
    await nebenSchreiben(ablage, 'livemp4', aus)
    return true
  } finally {
    await roh.weg()
    await fs.rm(aus, { force: true }).catch(() => {})
  }
}

async function ersetzen(
  id: string,
  alt: string,
  inhalt: Buffer,
  felder: { mime?: string; name?: string }
): Promise<string> {
  const g = await schreiben(Readable.from([inhalt]), 0, ortVon(alt))
  const r = await q(
    'UPDATE files SET ablage = $2, size = $3, sha256 = $4, mime = coalesce($5, mime), name = coalesce($6, name) WHERE id = $1 AND ablage = $7 RETURNING id',
    [id, g.schluessel, g.size, g.sha256, felder.mime || null, felder.name || null, alt]
  )
  if (!r.length) {
    await loeschen(g.schluessel)
    throw new Error('Datei inzwischen geaendert oder geloescht')
  }
  const live = await nebenKopie(alt, 'live').catch(() => null)
  if (live) await nebenSchreiben(g.schluessel, 'live', live.pfad)
  await loeschen(alt)
  return g.schluessel
}

function wellenAus(pcm: Buffer, n: number): number[] {
  const proben = Math.floor(pcm.length / 2),
    schritt = Math.max(1, Math.floor(proben / n))
  const aus: number[] = []
  for (let k = 0; k < n; k++) {
    let max = 0
    for (let i = k * schritt; i < Math.min(proben, (k + 1) * schritt); i++) {
      const v = Math.abs(pcm.readInt16LE(i * 2))
      if (v > max) max = v
    }
    aus.push(max)
  }
  const spitze = Math.max(1, ...aus)
  return aus.map((v) => Math.round(Math.sqrt(v / spitze) * 100))
}
