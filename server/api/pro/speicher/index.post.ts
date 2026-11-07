import { z } from 'zod'
import { ereignis } from '../../../utils/db'
import { clientIp, limit, requireOwner } from '../../../utils/auth'
import { requirePro } from '../../../utils/lizenz'
import { ausUmgebung, getSpeicher, praefixNorm, s3Testen, setSpeicher, type S3Ziel } from '../../../utils/s3'
import { umzugStarten, umzugSteuern } from '../../../utils/umzug'

const Ziel = z.object({
  endpoint: z
    .string()
    .trim()
    .max(300)
    .refine((v) => !v || /^https?:\/\/[^\s/]+/i.test(v), 'endpoint'),
  region: z.string().trim().max(60),
  bucket: z
    .string()
    .trim()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/),
  zugang: z.string().trim().min(1).max(200),
  geheim: z.string().max(300),
  pfadStil: z.boolean(),
  praefix: z.string().max(120)
})
const Body = z.discriminatedUnion('aktion', [
  z.object({ aktion: z.literal('testen'), s3: Ziel }),
  z.object({ aktion: z.literal('speichern'), art: z.enum(['lokal', 's3']), s3: Ziel.optional() }),
  z.object({ aktion: z.literal('umzug'), ziel: z.enum(['lokal', 's3']) }),
  z.object({ aktion: z.literal('umzug_steuern'), was: z.enum(['pausieren', 'fortsetzen', 'verwerfen']) })
])

export default defineEventHandler(async (event) => {
  const ich = await requireOwner(event)
  const p = Body.safeParse(await readBody(event))
  if (!p.success)
    throw fehler(
      400,
      'Bitte prüfe die Angaben (Bucket-Name: Kleinbuchstaben, Ziffern, Punkt, Bindestrich).',
      'Please check your input (bucket name: lowercase letters, digits, dot, hyphen).'
    )
  const b = p.data
  const mitGeheim = async (s: z.infer<typeof Ziel>): Promise<S3Ziel> => {
    const alt = (await getSpeicher()).s3
    return {
      ...s,
      praefix: praefixNorm(s.praefix),
      region: s.region || 'auto',
      geheim: s.geheim || (alt?.zugang === s.zugang ? alt?.geheim || '' : '')
    }
  }
  if (b.aktion === 'testen') {
    await requirePro('s3')
    if (limit('s3test:' + ich.id, 20, 600))
      throw fehler(429, 'Zu viele Tests — bitte kurz warten.', 'Too many tests — please wait a moment.')
    return s3Testen(await mitGeheim(b.s3))
  }
  if (b.aktion === 'speichern') {
    if (ausUmgebung())
      throw fehler(
        409,
        'Der Speicher ist über Umgebungsvariablen (VD_S3_*) festgelegt.',
        'Storage is set via environment variables (VD_S3_*).'
      )
    if (b.art === 's3') {
      await requirePro('s3')
      if (!b.s3) throw fehler(400, 'S3-Angaben fehlen.', 'S3 details are missing.')
      const z2 = await mitGeheim(b.s3)
      const t = await s3Testen(z2)
      if (!t.ok) throw fehler(400, t.meldung)
      await setSpeicher({ art: 's3', s3: z2 })
    } else {
      const alt = await getSpeicher()
      await setSpeicher({ art: 'lokal', s3: alt.s3 })
    }
    await ereignis('speicher_geaendert', ich.id, { art: b.art }, clientIp(event))
    return { ok: true }
  }
  if (b.aktion === 'umzug') {
    if (b.ziel === 's3' && !(await getSpeicher()).s3?.bucket)
      throw fehler(400, 'Bitte zuerst S3 einrichten.', 'Please set up S3 first.')
    await ereignis('speicher_umzug', ich.id, { ziel: b.ziel }, clientIp(event))
    return { ok: true, umzug: await umzugStarten(b.ziel) }
  }
  await umzugSteuern(b.was)
  return { ok: true }
})
