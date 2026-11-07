import { z } from 'zod'
import { ereignis } from '../../utils/db'
import { clientIp, requireOwner } from '../../utils/auth'
import { getAuslieferung, getMedien, getUploads, setSetting, setSprache } from '../../utils/settings'
import { requirePro } from '../../utils/lizenz'
import { getMail } from '../../utils/benachrichtigen'

const Body = z.object({
  design: z.object({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/), name: z.string().trim().min(1).max(40) }).optional(),
  uploads: z
    .object({
      maxGb: z.number().min(0).max(100_000).optional(),
      namensstil: z.enum(['zufall', 'woerter', 'datum', 'original', 'unsichtbar', 'uuid']).optional(),
      laenge: z.number().int().min(4).max(32).optional()
    })
    .optional(),
  lang: z.enum(['de', 'en']).optional(),
  webhooks: z.object({ intern: z.boolean() }).optional(),
  mail: z
    .object({
      host: z
        .string()
        .trim()
        .max(200)
        .regex(/^[a-zA-Z0-9.-]*$/),
      port: z.number().int().min(1).max(65535),
      sicher: z.boolean(),
      user: z.string().trim().max(200),
      pass: z.string().max(500).optional(),
      von: z.string().trim().max(200)
    })
    .optional(),
  medien: z
    .object({
      exifEntfernen: z.boolean().optional(),
      umwandeln: z.enum(['aus', 'webp', 'avif']).optional(),
      qualitaet: z.number().int().min(30).max(100).optional(),
      vorschau: z.boolean().optional()
    })
    .optional(),
  auslieferung: z
    .object({
      bilder: z.boolean().optional(),
      maxPx: z.number().int().min(64).max(8192).optional(),
      maxVarianten: z.number().int().min(1).max(500).optional(),
      hotlink: z.boolean().optional(),
      ohneHerkunft: z.boolean().optional(),
      erlaubt: z.array(z.string().trim().toLowerCase().max(253)).max(200).optional()
    })
    .optional(),
  traffic: z.object({ grenzeGb: z.number().min(0).max(1_000_000).nullable() }).optional()
})

export default defineEventHandler(async (event) => {
  const ich = await requireOwner(event)
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Ungültige Einstellung.', 'Invalid setting.')
  const b = p.data
  if (b.design) await setSetting('design', { color: b.design.color.toLowerCase(), name: b.design.name })
  if (b.uploads) {
    const alt = await getUploads()
    await setSetting('uploads', {
      ...alt,
      ...(b.uploads.maxGb !== undefined ? { maxBytes: Math.round(b.uploads.maxGb * 1024 ** 3) } : {}),
      ...(b.uploads.namensstil ? { namensstil: b.uploads.namensstil } : {}),
      ...(b.uploads.laenge ? { laenge: b.uploads.laenge } : {})
    })
  }
  if (b.lang) await setSprache(b.lang)
  if (b.medien) await setSetting('medien', { ...(await getMedien()), ...b.medien })
  if (b.auslieferung) {
    const a = { ...(await getAuslieferung()), ...b.auslieferung }
    a.erlaubt = [
      ...new Set(
        (a.erlaubt || [])
          .map((e) => e.replace(/^https?:\/\//, '').replace(/[/:].*$/, ''))
          .filter((e) => /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(e))
      )
    ]
    await setSetting('auslieferung', a)
  }
  if (b.traffic) {
    await requirePro('traffic')
    await setSetting('traffic', { grenzeGb: b.traffic.grenzeGb && b.traffic.grenzeGb > 0 ? b.traffic.grenzeGb : null })
  }
  if (b.webhooks) await setSetting('webhooks', { intern: b.webhooks.intern })
  if (b.mail) await setSetting('mail', { ...b.mail, pass: b.mail.pass || (await getMail())?.pass || '' })
  await ereignis('settings_changed', ich.id, {}, clientIp(event))
  return { ok: true }
})
