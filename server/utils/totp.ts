import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(data: Buffer): string {
  let out = '',
    bits = 0,
    val = 0
  for (const b of data) {
    val = (val << 8) | b
    bits += 8
    while (bits >= 5) {
      out += B32[(val >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31]
  return out
}
function base32Decode(s: string): Buffer {
  const t = s.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0,
    val = 0
  const out: number[] = []
  for (const c of t) {
    val = (val << 5) | B32.indexOf(c)
    bits += 5
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export const totpSecret = () => base32Encode(randomBytes(20))

function code(secret: string, zeit: number): string {
  const zaehler = Buffer.alloc(8)
  zaehler.writeBigUInt64BE(BigInt(Math.floor(zeit / 30)))
  const h = createHmac('sha1', base32Decode(secret)).update(zaehler).digest()
  const o = h[19]! & 0x0f
  const n = (((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 1_000_000
  return String(n).padStart(6, '0')
}

export function totpVerify(secret: string, eingabe: string): boolean {
  const c = String(eingabe || '').replace(/\D/g, '')
  if (c.length !== 6 || !secret) return false
  const jetzt = Math.floor(Date.now() / 1000)
  for (const d of [-30, 0, 30]) {
    if (timingSafeEqual(Buffer.from(code(secret, jetzt + d)), Buffer.from(c))) return true
  }
  return false
}

export const totpUri = (secret: string, konto: string, aussteller = 'VylarisCloud') =>
  `otpauth://totp/${encodeURIComponent(aussteller + ':' + konto)}?secret=${secret}&issuer=${encodeURIComponent(aussteller)}&period=30&digits=6`

const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const block = () => Array.from({ length: 5 }, () => A[randomInt(A.length)]).join('')
export const backupHash = (c: string) =>
  createHash('sha256')
    .update(c.toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .digest('hex')
export function backupCodesNeu(): { klar: string[]; hashes: string[] } {
  const klar = Array.from({ length: 8 }, () => `${block()}-${block()}`)
  return { klar, hashes: klar.map(backupHash) }
}
