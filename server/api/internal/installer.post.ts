import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { q, q1, ereignis } from '../../utils/db'
import { datenordner } from '../../utils/speicher'
import { analyseAnstossen, importAnstossen, ladeImport } from '../../utils/importKern'
import { importAnalysieren } from '../../utils/importQuellen'

export default defineEventHandler(async (event) => {
  if (getRequestHeader(event, 'x-forwarded-for') || getRequestHeader(event, 'x-real-ip'))
    throw fehler(404, 'Nicht gefunden', 'Not found')
  const datei = join(datenordner(), '.installer-schluessel')
  const st = await fs.stat(datei).catch(() => null)
  if (!st || Date.now() - st.mtimeMs > 3 * 3600_000) throw fehler(404, 'Nicht gefunden', 'Not found')
  const soll = Buffer.from((await fs.readFile(datei, 'utf8')).trim())
  const ist = Buffer.from(String(getRequestHeader(event, 'x-vd-installer') || ''))
  if (soll.length < 32 || soll.length !== ist.length || !timingSafeEqual(soll, ist))
    throw fehler(403, 'Nicht erlaubt', 'Not allowed')

  const b = await readBody(event)
  const inhaber = await q1<{ id: number }>(`SELECT id FROM users WHERE role = 'owner' ORDER BY id LIMIT 1`)
  if (!inhaber) throw fehler(409, 'VylarisCloud ist noch nicht eingerichtet.', 'VylarisCloud is not set up yet.')

  if (b?.aktion === 'zipline') {
    const ordner = String(b.ordner || '').trim()
    let weg: 'ordner' | 'live', zugang: Record<string, string>
    if (ordner) {
      if (!/^[A-Za-z0-9._-]{1,80}$/.test(ordner)) throw fehler(400, 'Ungültiger Ordner.', 'Invalid folder.')
      weg = 'ordner'
      zugang = { ordner }
    } else {
      const url = String(b.url || '')
        .trim()
        .replace(/\/+$/, '')
      const token = String(b.token || '').trim()
      if (!/^https?:\/\/[^\s/]+$/.test(url) || !token || token.length > 2000)
        throw fehler(400, 'Adresse oder Token fehlt.', 'Address or token missing.')
      weg = 'live'
      zugang = { url, token }
    }
    const r = await q1<{ id: number }>(
      `INSERT INTO importe (user_id, quelle, weg, status, titel, zugang, optionen) VALUES ($1, 'zipline', $2, 'analyse', 'Zipline (Umzug per Installer)', $3::jsonb, $4::jsonb) RETURNING id`,
      [inhaber.id, weg, JSON.stringify(zugang), JSON.stringify({ zielNutzer: inhaber.id })]
    )
    analyseAnstossen(r!.id, importAnalysieren)
    await ereignis('import_installer', inhaber.id, { quelle: 'zipline' })
    return { ok: true, id: r!.id }
  }
  const id = Number(b?.id)
  const imp = Number.isSafeInteger(id) ? await ladeImport(id) : null
  if (!imp || imp.user_id !== inhaber.id) throw fehler(404, 'Import nicht gefunden.', 'Import not found.')
  if (b?.aktion === 'starten') {
    if (imp.status !== 'bereit')
      throw fehler(409, `Import ist nicht bereit (${imp.status}).`, `Import is not ready (${imp.status}).`)
    const optionen = {
      konten: true,
      linknamen: true,
      weiterleiten: true,
      grenzen: true,
      aufrufe: true,
      ordnerName: '',
      zielNutzer: inhaber.id
    }
    await q(
      `UPDATE importe SET status = 'laeuft', optionen = $2::jsonb, gestartet_at = now() WHERE id = $1 AND status = 'bereit'`,
      [id, JSON.stringify(optionen)]
    )
    importAnstossen(id)
    return { ok: true }
  }
  if (b?.aktion === 'stand') {
    return {
      status: imp.status,
      gesamt: imp.gesamt,
      erledigt: imp.erledigt,
      fehler: imp.fehlgeschlagen,
      uebersprungen: imp.uebersprungen,
      meldung: imp.meldung,
      nutzer: (imp.plan?.nutzer || []).length,
      hinweise: (imp.plan?.hinweise || []).slice(0, 5)
    }
  }
  throw fehler(400, 'Unbekannte Aktion.', 'Unknown action.')
})
