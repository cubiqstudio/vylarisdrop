import { promises as fs } from 'node:fs'
import { requireOwner } from '../../../utils/auth'
import { istPro } from '../../../utils/lizenz'
import { letzterLauf } from '../../../utils/sicherung'
import { importWurzel } from '../../../utils/importKern'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const namen = await fs.readdir(importWurzel()).catch(() => [] as string[])
  const server = []
  for (const n of namen.filter((n) => /^vylariscloud-sicherung.*\.zip$/i.test(n)).slice(0, 50)) {
    const st = await fs.stat(`${importWurzel()}/${n}`).catch(() => null)
    if (st?.isFile()) server.push({ name: n, groesse: st.size, zeit: st.mtime.toISOString() })
  }
  return { pro: await istPro('sicherung'), lauf: await letzterLauf(), server }
})
