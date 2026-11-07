import { q } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { importWurzel, WEGE } from '../../utils/importKern'
import { promises as fs } from 'node:fs'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const liste = await q(
    `SELECT i.id, i.quelle, i.weg, i.titel, i.status, i.gesamt, i.erledigt, i.fehlgeschlagen, i.uebersprungen, i.bytes::float8 AS bytes,
      i.bytes_gesamt::float8 AS bytes_gesamt, i.created_at, i.fertig_at, u.username
    FROM importe i JOIN users u ON u.id = i.user_id WHERE ($1 OR i.user_id = $2) ORDER BY i.id DESC LIMIT 50`,
    [u.role !== 'user', u.id]
  )
  const admin = u.role !== 'user'
  const ordnerDa = admin && !!(await fs.stat(importWurzel()).catch(() => null))?.isDirectory()
  return { importe: liste, admin, ordnerDa, wege: WEGE }
})
