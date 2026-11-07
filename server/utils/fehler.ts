import { sLang } from './settings'

export function fehler(statusCode: number, text: string, en?: string) {
  return createError({ statusCode, statusMessage: 'Error', message: en && sLang() === 'en' ? en : text })
}
