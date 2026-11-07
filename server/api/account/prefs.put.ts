import { z } from 'zod'
import { q } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { WEBHOOK } from '../../utils/benachrichtigen'

const Embed = z.object({
  titel: z.string().max(120).optional(),
  anbieter: z.string().max(120).optional(),
  text: z.string().max(300).optional(),
  farbe: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  bild: z.boolean().optional()
})
const Body = z.object({
  theme: z.enum(['dark', 'light', 'system']).optional(),
  lang: z.enum(['de', 'en']).optional(),
  stil: z.enum(['zufall', 'woerter', 'datum', 'original', 'unsichtbar', 'uuid', '']).optional(),
  ablauf: z
    .string()
    .regex(/^(\d{1,4}[mhdw])?$/)
    .optional(),
  embed: Embed.optional(),
  benachrichtigung: z
    .object({
      discord: z
        .string()
        .trim()
        .max(200)
        .refine((v) => v === '' || WEBHOOK.test(v))
        .optional(),
      email: z.boolean().optional(),
      arten: z
        .object({
          upload: z.boolean(),
          anfrage: z.boolean(),
          speicher: z.boolean(),
          virus: z.boolean(),
          webhook: z.boolean(),
          system: z.boolean(),
          traffic: z.boolean()
        })
        .partial()
        .optional()
    })
    .optional()
})

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const p = Body.safeParse(await readBody(event))
  if (!p.success) {
    if (p.error.issues.some((i) => i.path.includes('discord')))
      throw fehler(
        400,
        'Das ist keine Discord-Webhook-URL (https://discord.com/api/webhooks/…).',
        'That is not a Discord webhook URL (https://discord.com/api/webhooks/…).'
      )
    throw fehler(400, 'Ungültige Einstellung.', 'Invalid setting.')
  }
  const alt = u.prefs?.benachrichtigung || {}
  const neu = {
    ...(u.prefs || {}),
    ...p.data,
    ...(p.data.embed ? { embed: { ...(u.prefs?.embed || {}), ...p.data.embed } } : {}),
    ...(p.data.benachrichtigung
      ? {
          benachrichtigung: {
            ...alt,
            ...p.data.benachrichtigung,
            arten: { ...(alt.arten || {}), ...(p.data.benachrichtigung.arten || {}) }
          }
        }
      : {})
  }
  await q('UPDATE users SET prefs = $1::jsonb WHERE id = $2', [JSON.stringify(neu), u.id])
  return { ok: true, prefs: neu }
})
