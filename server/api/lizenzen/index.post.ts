import { z } from 'zod'
import { q, ereignis } from '../../utils/db'
import { clientIp, limit, requireOwner } from '../../utils/auth'
import { neuerSchluessel } from '../../utils/lizenzAussteller'
import { FUNKTIONEN } from '../../utils/lizenz'

const Body = z.object({
  notiz: z.string().trim().max(120).default(''),
  // null = unbegrenzt; sonst Tage ab der ersten Aktivierung
  tage: z.number().int().min(1).max(36500).nullable().default(30),
  maxGeraete: z.number().int().min(1).max(1000).default(1),
  features: z.array(z.enum(FUNKTIONEN as [string, ...string[]])).max(20).default([]),
  anzahl: z.number().int().min(1).max(50).default(1)
})

// Schlüssel erzeugen — ohne E-Mail oder andere Angaben zur Person
export default defineEventHandler(async (event) => {
  const u = await requireOwner(event)
  if (limit('lizenz-neu:' + u.id, 30, 3600))
    throw fehler(429, 'Zu viele Schlüssel in kurzer Zeit.', 'Too many keys in a short time.')
  const p = Body.safeParse(await readBody(event))
  if (!p.success)
    throw fehler(400, 'Bitte die Angaben prüfen (Laufzeit, Geräte, Anzahl).', 'Please check the values (duration, devices, count).')
  const b = p.data
  const neu: string[] = []
  for (let i = 0; i < b.anzahl; i++) {
    for (let versuch = 0; versuch < 5; versuch++) {
      const k = neuerSchluessel()
      const r = await q(
        `INSERT INTO lizenz_schluessel (schluessel, notiz, features, laufzeit_tage, max_geraete, created_by)
         VALUES ($1, $2, $3::text[], $4, $5, $6) ON CONFLICT (schluessel) DO NOTHING RETURNING id`,
        [k, b.notiz, b.features, b.tage, b.maxGeraete, u.id]
      )
      if (r.length) {
        neu.push(k)
        break
      }
    }
  }
  await ereignis('lizenz_erstellt', u.id, { anzahl: neu.length, tage: b.tage }, clientIp(event))
  return { ok: true, schluessel: neu }
})
