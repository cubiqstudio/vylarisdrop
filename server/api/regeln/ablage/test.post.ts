import { z } from 'zod'
import { q1 } from '../../../utils/db'
import { limit, requireAdmin } from '../../../utils/auth'
import { ablageAuswerten, ablageKontextFuer, zielAuswahl } from '../../../utils/ablageRegeln'

const Body = z.object({
  name: z.string().trim().min(1).max(200),
  mime: z.string().trim().max(120).optional(),
  groesse_mb: z.number().min(0).max(10_000_000).optional(),
  konto: z.union([z.number().int().positive(), z.string().trim().min(1).max(64)]).optional(),
  ordner: z.number().int().positive().max(2_000_000_000).nullable().optional()
})

// „Datei testen“: welche Regel greift, welches Ziel (oder welche Ablehnung) — ohne etwas zu schreiben. Ohne Konto zählt der Admin selbst.
export default defineEventHandler(async (event) => {
  const u = await requireAdmin(event)
  if (limit('ablage-test:' + u.id, 120, 60)) throw fehler(429, 'Zu viele Tests — bitte kurz warten.', 'Too many tests — please wait a moment.')
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Bitte prüfe die Angaben.', 'Please check your input.')
  const b = p.data
  const konto =
    b.konto == null
      ? { id: u.id, username: u.username, role: u.role, rolle_id: u.rolle_id ?? null }
      : await q1<{ id: number; username: string; role: string; rolle_id: number | null }>(
          typeof b.konto === 'number'
            ? 'SELECT id, username, role, rolle_id FROM users WHERE id = $1'
            : 'SELECT id, username, role, rolle_id FROM users WHERE lower(username) = lower($1)',
          [b.konto]
        )
  if (!konto) throw fehler(404, 'Dieses Konto gibt es nicht.', 'This account does not exist.')
  const gr = b.groesse_mb == null ? null : Math.round(b.groesse_mb * 1024 * 1024)
  const e = await ablageAuswerten(
    ablageKontextFuer({ id: konto.id, role: konto.role, rolle_id: konto.rolle_id }, { name: b.name, mime: b.mime, groesse: gr, ordnerId: b.ordner ?? null }),
    { trocken: true }
  )
  const ziele = await zielAuswahl()
  return {
    ...e.entscheid,
    ortName: e.entscheid.ort ? ziele.find((z) => z.ort === e.entscheid.ort)?.name || e.entscheid.ort : null,
    pruefung: e.pruefung,
    kontext: { ...e.kontext, konto: { id: konto.id, name: konto.username, rolle: konto.role } }
  }
})
