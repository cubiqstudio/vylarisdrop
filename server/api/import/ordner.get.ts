import { promises as fs } from 'node:fs'
import { relative, sep } from 'node:path'
import { requireAdmin } from '../../utils/auth'
import { importWurzel, innerhalb } from '../../utils/importKern'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const wurzel = importWurzel()
  if (!(await fs.stat(wurzel).catch(() => null))?.isDirectory())
    return {
      vorhanden: false,
      wurzel: process.platform === 'win32' ? wurzel : '/import',
      pfad: '',
      ordner: [],
      dateien: 0,
      beispiele: []
    }
  const ziel = await innerhalb(wurzel, String(getQuery(event).pfad || ''))
  const eintraege = await fs.readdir(ziel, { withFileTypes: true }).catch(() => [])
  const ordner = eintraege
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 300)
  const dateien = eintraege.filter((d) => d.isFile())
  const rel = relative(await fs.realpath(wurzel), ziel)
    .split(sep)
    .join('/')
  return {
    vorhanden: true,
    wurzel: process.platform === 'win32' ? wurzel : '/import',
    pfad: rel === '' ? '' : rel,
    ordner,
    dateien: dateien.length,
    beispiele: dateien.slice(0, 6).map((d) => d.name)
  }
})
