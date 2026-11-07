interface Kasten {
  typ: string
  start: number
  inhalt: number
  ende: number
}

function kaesten(b: Buffer, von: number, bis: number): Kasten[] {
  const aus: Kasten[] = []
  let i = von
  while (i + 8 <= bis) {
    let groesse = b.readUInt32BE(i)
    const typ = b.toString('latin1', i + 4, i + 8)
    let kopf = 8
    if (groesse === 1) {
      if (i + 16 > bis) break
      groesse = Number(b.readBigUInt64BE(i + 8))
      kopf = 16
    } else if (groesse === 0) groesse = bis - i
    if (groesse < kopf || i + groesse > bis) break
    aus.push({ typ, start: i, inhalt: i + kopf, ende: i + groesse })
    i += groesse
  }
  return aus
}

function zahl(b: Buffer, o: number, n: number): number {
  if (n === 0) return 0
  if (n === 1) return b[o]!
  if (n === 2) return b.readUInt16BE(o)
  if (n === 4) return b.readUInt32BE(o)
  if (n === 8) return Number(b.readBigUInt64BE(o))
  throw new Error('Feldbreite')
}

const LEERES_XMP = Buffer.from(
  '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"/><?xpacket end="w"?>',
  'latin1'
)

export function heifOhneMeta(original: Buffer): Buffer | null {
  try {
    const b = Buffer.from(original)
    const meta = kaesten(b, 0, b.length).find((k) => k.typ === 'meta')
    if (!meta) return null
    const kinder = kaesten(b, meta.inhalt + 4, meta.ende)
    const iinf = kinder.find((k) => k.typ === 'iinf'),
      iloc = kinder.find((k) => k.typ === 'iloc'),
      idat = kinder.find((k) => k.typ === 'idat')
    if (!iinf || !iloc) return null

    const ziele = new Map<number, 'exif' | 'xmp'>()
    const vi = b[iinf.inhalt]!
    const anfang = iinf.inhalt + 4 + (vi === 0 ? 2 : 4)
    for (const e of kaesten(b, anfang, iinf.ende)) {
      if (e.typ !== 'infe') continue
      const v = b[e.inhalt]!
      if (v < 2) continue
      let o = e.inhalt + 4
      const id = v === 2 ? b.readUInt16BE(o) : b.readUInt32BE(o)
      o += (v === 2 ? 2 : 4) + 2
      const art = b.toString('latin1', o, o + 4)
      o += 4
      if (art === 'Exif') {
        ziele.set(id, 'exif')
        continue
      }
      if (art === 'mime') {
        const nameEnde = b.indexOf(0, o)
        if (nameEnde < 0 || nameEnde >= e.ende) continue
        const typEnde = b.indexOf(0, nameEnde + 1)
        const inhaltTyp = b.toString('latin1', nameEnde + 1, typEnde < 0 || typEnde > e.ende ? e.ende : typEnde)
        if (/rdf\+xml|xmp/i.test(inhaltTyp)) ziele.set(id, 'xmp')
      }
    }
    if (!ziele.size) return null

    const v = b[iloc.inhalt]!
    let o = iloc.inhalt + 4
    const g1 = b[o]!,
      g2 = b[o + 1]!
    const offsetGr = g1 >> 4,
      laengeGr = g1 & 15,
      basisGr = g2 >> 4,
      indexGr = v >= 1 ? g2 & 15 : 0
    o += 2
    const anzahl = v < 2 ? b.readUInt16BE(o) : b.readUInt32BE(o)
    o += v < 2 ? 2 : 4
    let geaendert = false
    for (let n = 0; n < anzahl; n++) {
      const id = v < 2 ? b.readUInt16BE(o) : b.readUInt32BE(o)
      o += v < 2 ? 2 : 4
      let methode = 0
      if (v >= 1) {
        methode = b.readUInt16BE(o) & 15
        o += 2
      }
      o += 2
      const basis = zahl(b, o, basisGr)
      o += basisGr
      const extents = b.readUInt16BE(o)
      o += 2
      const stuecke: Array<[number, number]> = []
      for (let x = 0; x < extents; x++) {
        o += indexGr
        const off = zahl(b, o, offsetGr)
        o += offsetGr
        const len = zahl(b, o, laengeGr)
        o += laengeGr
        stuecke.push([off, len])
      }
      const art = ziele.get(id)
      if (!art) continue
      const nullpunkt = methode === 0 ? basis : methode === 1 && idat ? idat.inhalt + basis : -1
      if (nullpunkt < 0) continue
      for (const [off, len0] of stuecke) {
        const start = nullpunkt + off
        const len = len0 || (methode === 0 ? b.length - start : 0)
        if (start < 0 || len <= 0 || start + len > b.length) continue
        b.fill(0, start, start + len)
        if (art === 'exif' && len >= 18) {
          b.writeUInt32BE(0, start)
          b.write('MM', start + 4, 'latin1')
          b.writeUInt16BE(42, start + 6)
          b.writeUInt32BE(8, start + 8)
          b.writeUInt16BE(0, start + 12)
          b.writeUInt32BE(0, start + 14)
        } else if (art === 'xmp') {
          b.fill(0x20, start, start + len)
          if (len >= LEERES_XMP.length) LEERES_XMP.copy(b, start)
        }
        geaendert = true
      }
    }
    return geaendert ? b : null
  } catch {
    return null
  }
}
