import { createHash } from 'node:crypto'
import { getSetting, setSetting } from './settings'
import { istPro } from './lizenz'

export interface Marke {
  logo: string
  icon: string
  nurLogo: boolean
  ohneHinweis: boolean
  loginText: string
  fusszeile: string
}
const LEER: Marke = { logo: '', icon: '', nurLogo: false, ohneHinweis: false, loginText: '', fusszeile: '' }
export const getMarke = async (): Promise<Marke> => ({ ...LEER, ...(await getSetting<Partial<Marke>>('marke', {})) })
export const setMarke = (m: Marke) => setSetting('marke', m)

export const BILD_TYPEN = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon'
]
export function datenUrl(s: string): { typ: string; daten: Buffer } | null {
  const m = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(s)
  if (!m || !BILD_TYPEN.includes(m[1]!.toLowerCase())) return null
  return { typ: m[1]!.toLowerCase(), daten: Buffer.from(m[2]!, 'base64') }
}
const version = (s: string) => (s ? createHash('sha256').update(s).digest('hex').slice(0, 10) : '')

export async function markeFuerSeite() {
  const an = await istPro('white-label')
  const m = await getMarke()
  return {
    weiss: an,
    logo: an && m.logo ? `/api/public/marke/logo?v=${version(m.logo)}` : '',
    icon: an && m.icon ? `/api/public/marke/icon?v=${version(m.icon)}` : '',
    nurLogo: an && !!m.logo && m.nurLogo,
    hinweis: !(an && m.ohneHinweis),
    loginText: an ? m.loginText : '',
    fusszeile: an ? m.fusszeile : ''
  }
}
