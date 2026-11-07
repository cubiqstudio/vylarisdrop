export const E2E_BLOCK = 1024 * 1024
const KOPF = 32,
  TAG = 16
const MAGIE = [0x52, 0x44, 0x45, 0x31]

const b64u = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
const ausB64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) =>
    c.charCodeAt(0)
  )
function iv(praefix: Uint8Array, nr: number) {
  const v = new Uint8Array(12)
  v.set(praefix)
  new DataView(v.buffer).setUint32(8, nr >>> 0)
  return v
}

export interface Verschluesselt {
  blob: { size: number; slice: (a: number, b: number) => Promise<Blob> }
  schluessel: string
}

export async function verschluesseln(datei: File): Promise<Verschluesselt> {
  const roh = crypto.getRandomValues(new Uint8Array(32))
  const key = await crypto.subtle.importKey('raw', roh, 'AES-GCM', false, ['encrypt'])
  const praefix = crypto.getRandomValues(new Uint8Array(8))
  const meta = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv(praefix, 0xffffffff), additionalData: new TextEncoder().encode('meta') },
      key,
      new TextEncoder().encode(JSON.stringify({ n: datei.name, t: datei.type }))
    )
  )
  const kopf = new Uint8Array(KOPF + meta.length)
  kopf.set(MAGIE)
  kopf[4] = 1
  const dv = new DataView(kopf.buffer)
  dv.setUint32(8, E2E_BLOCK)
  kopf.set(praefix, 12)
  dv.setBigUint64(20, BigInt(datei.size))
  dv.setUint32(28, meta.length)
  kopf.set(meta, KOPF)
  const n = Math.max(1, Math.ceil(datei.size / E2E_BLOCK))
  const groesse = kopf.length + datei.size + n * TAG
  const cache = new Map<number, Uint8Array>()
  async function block(i: number): Promise<Uint8Array> {
    const c = cache.get(i)
    if (c) return c
    const klar = new Uint8Array(
      await datei.slice(i * E2E_BLOCK, Math.min(datei.size, (i + 1) * E2E_BLOCK)).arrayBuffer()
    )
    const z = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv(praefix, i), additionalData: new Uint8Array([i === n - 1 ? 1 : 0]) },
        key,
        klar
      )
    )
    cache.set(i, z)
    if (cache.size > 6) cache.delete(cache.keys().next().value!)
    return z
  }
  async function slice(a: number, b: number): Promise<Blob> {
    const teile: BlobPart[] = []
    if (a < kopf.length) teile.push(kopf.slice(a, Math.min(b, kopf.length)))
    const start = Math.max(a, kopf.length) - kopf.length,
      ende = b - kopf.length
    if (ende > start) {
      for (let i = Math.floor(start / (E2E_BLOCK + TAG)); i < n && i * (E2E_BLOCK + TAG) < ende; i++) {
        const z = await block(i),
          o = i * (E2E_BLOCK + TAG)
        teile.push(z.slice(Math.max(0, start - o), Math.min(z.length, ende - o)))
      }
    }
    return new Blob(teile)
  }
  return { blob: { size: groesse, slice }, schluessel: b64u(roh) }
}

export interface Entschluesselt {
  name: string
  mime: string
  groesse: number
}

export async function entschluesseln(
  url: string,
  schluessel: string,
  ziel: (b: Uint8Array) => Promise<void> | void,
  kopfDa?: (k: Entschluesselt) => Promise<void> | void,
  fortschritt?: (p: number) => void
): Promise<Entschluesselt> {
  const key = await crypto.subtle.importKey('raw', ausB64u(schluessel), 'AES-GCM', false, ['decrypt'])
  const r = await fetch(url)
  if (!r.ok || !r.body) throw new Error(t('Die Datei konnte nicht geladen werden.', 'The file could not be loaded.'))
  const leser = r.body.getReader()
  let puffer = new Uint8Array(0)
  let fertig = false
  const nachladen = async (min: number) => {
    while (puffer.length < min && !fertig) {
      const { value, done } = await leser.read()
      if (done) {
        fertig = true
        break
      }
      const neu = new Uint8Array(puffer.length + value.length)
      neu.set(puffer)
      neu.set(value, puffer.length)
      puffer = neu
    }
  }
  const nehmen = (n: number) => {
    const s = puffer.slice(0, n)
    puffer = puffer.slice(n)
    return s
  }
  await nachladen(KOPF)
  const kopf = nehmen(KOPF)
  if (kopf.length < KOPF || MAGIE.some((m, i) => kopf[i] !== m) || kopf[4] !== 1)
    throw new Error(t('Das ist keine verschlüsselte VylarisCloud-Datei.', 'This is not an encrypted VylarisCloud file.'))
  const dv = new DataView(kopf.buffer)
  const block = dv.getUint32(8),
    praefix = kopf.slice(12, 20),
    groesse = Number(dv.getBigUint64(20)),
    metaLen = dv.getUint32(28)
  if (block < 1024 || block > 64 * 1024 * 1024 || metaLen > 65536)
    throw new Error(t('Die Datei ist beschädigt.', 'The file is damaged.'))
  await nachladen(metaLen)
  let info: Entschluesselt
  try {
    const m = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv(praefix, 0xffffffff), additionalData: new TextEncoder().encode('meta') },
      key,
      nehmen(metaLen)
    )
    const j = JSON.parse(new TextDecoder().decode(m))
    info = { name: String(j.n || 'datei'), mime: String(j.t || 'application/octet-stream'), groesse }
  } catch {
    throw new Error(t('Der Schlüssel passt nicht zu dieser Datei.', 'The key does not match this file.'))
  }
  await kopfDa?.(info)
  const n = Math.max(1, Math.ceil(groesse / block))
  for (let i = 0; i < n; i++) {
    const laenge = Math.min(block, groesse - i * block) + TAG
    await nachladen(laenge)
    if (puffer.length < laenge) throw new Error(t('Die Datei ist unvollständig.', 'The file is incomplete.'))
    let klar: ArrayBuffer
    try {
      klar = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv(praefix, i), additionalData: new Uint8Array([i === n - 1 ? 1 : 0]) },
        key,
        nehmen(laenge)
      )
    } catch {
      throw new Error(t('Die Datei wurde verändert oder ist beschädigt.', 'The file was modified or is damaged.'))
    }
    await ziel(new Uint8Array(klar))
    fortschritt?.((i + 1) / n)
  }
  return info
}

export function schluesselAusAnker(): string {
  if (!import.meta.client) return ''
  const m = /(?:^#|&)k=([A-Za-z0-9_-]{43})(?:&|$)/.exec(location.hash)
  return m ? m[1]! : ''
}
export function e2eMerken(slug: string, schluessel: string) {
  try {
    localStorage.setItem('vd_e2e_' + slug, schluessel)
  } catch {}
}
export function e2eSchluessel(slug: string): string {
  try {
    return localStorage.getItem('vd_e2e_' + slug) || ''
  } catch {
    return ''
  }
}
