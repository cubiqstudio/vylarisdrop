import { createHash } from 'node:crypto'

// Das Windows-Skript deploy/windows-webdav.ps1 (Datei-Limit des WebClient anheben). Es wird beim Bauen als Server-Asset
// mitgenommen (nuxt.config.ts, serverAssets) und hier einmal gelesen.
let zwischen: { text: string; sha256: string; groesse: number } | null | undefined

export async function windowsSkript(): Promise<{ text: string; sha256: string; groesse: number } | null> {
  if (zwischen !== undefined) return zwischen
  try {
    const roh = await useStorage('assets:deploy').getItemRaw('windows-webdav.ps1')
    if (!roh) return (zwischen = null)
    const puffer = Buffer.isBuffer(roh) ? roh : Buffer.from(roh as any)
    zwischen = {
      text: puffer.toString('utf8'),
      sha256: createHash('sha256').update(puffer).digest('hex'),
      groesse: puffer.length
    }
  } catch {
    zwischen = null
  }
  return zwischen
}
