import { randomInt, randomUUID } from 'node:crypto'
import type { NamensStil } from './settings'

const ZEICHEN = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const zufall = (n: number) => Array.from({ length: n }, () => ZEICHEN[randomInt(ZEICHEN.length)]).join('')

const ADJ = [
  'ruhig',
  'flink',
  'kuehn',
  'mild',
  'hell',
  'wild',
  'sanft',
  'frisch',
  'klar',
  'warm',
  'kuehl',
  'stolz',
  'leise',
  'bunt',
  'zart',
  'rasch',
  'schlau',
  'treu',
  'weit',
  'still'
]
const ADJ_EN = [
  'calm',
  'swift',
  'bold',
  'mild',
  'bright',
  'wild',
  'gentle',
  'fresh',
  'clear',
  'warm',
  'cool',
  'proud',
  'quiet',
  'vivid',
  'tender',
  'rapid',
  'clever',
  'loyal',
  'vast',
  'silent'
]
const NOM = [
  'falke',
  'fuchs',
  'otter',
  'luchs',
  'reh',
  'adler',
  'biber',
  'dachs',
  'kranich',
  'wal',
  'eule',
  'hirsch',
  'igel',
  'marder',
  'rabe',
  'specht',
  'wolf',
  'hase',
  'kauz',
  'robbe'
]
const NOM_EN = [
  'falcon',
  'fox',
  'otter',
  'lynx',
  'deer',
  'eagle',
  'beaver',
  'badger',
  'crane',
  'whale',
  'owl',
  'stag',
  'hedgehog',
  'marten',
  'raven',
  'woodpecker',
  'wolf',
  'hare',
  'heron',
  'seal'
]
const ZAHL = ['eins', 'zwei', 'drei', 'vier', 'fuenf', 'sechs', 'sieben', 'acht', 'neun', 'zehn']
const ZAHL_EN = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const nimm = (l: string[]) => l[randomInt(l.length)]!

const UNSICHTBAR = ['​', '‌', '‍', '⁠']

export function bereinigen(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\.[a-z0-9]{1,8}$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'datei'
  )
}

export function neuerName(
  stil: NamensStil,
  opt: { laenge?: number; original?: string; sprache?: 'de' | 'en' } = {}
): string {
  const en = opt.sprache === 'en'
  switch (stil) {
    case 'woerter':
      return `${nimm(en ? ADJ_EN : ADJ)}-${nimm(en ? NOM_EN : NOM)}-${nimm(en ? ZAHL_EN : ZAHL)}`
    case 'datum': {
      const d = new Date(),
        p = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
    }
    case 'original':
      return `${bereinigen(opt.original || '')}-${zufall(3)}`
    case 'unsichtbar':
      return Array.from({ length: 24 }, () => UNSICHTBAR[randomInt(4)]).join('')
    case 'uuid':
      return randomUUID()
    default:
      return zufall(Math.max(4, Math.min(32, opt.laenge || 8)))
  }
}

export const istSlug = (s: string) => /^[A-Za-z0-9_-]{1,80}$/.test(s) || /^[​‌‍⁠]{8,64}$/.test(s)
