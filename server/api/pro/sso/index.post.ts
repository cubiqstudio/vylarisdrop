import { z } from 'zod'
import { ereignis } from '../../../utils/db'
import { clientIp, requireOwner } from '../../../utils/auth'
import { requirePro } from '../../../utils/lizenz'
import { st } from '../../../utils/settings'
import { getSso, setSso, type Anbieter } from '../../../utils/sso'

const Eintrag = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,23}$/),
  art: z.enum(['oidc', 'google', 'microsoft', 'github', 'discord']),
  name: z.string().trim().min(1).max(40),
  aktiv: z.boolean(),
  clientId: z.string().trim().min(1).max(300),
  clientSecret: z.string().max(500),
  issuer: z.string().trim().max(300),
  scopes: z.string().max(200),
  autoAnlegen: z.boolean(),
  domains: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)
    )
    .max(30),
  perEmail: z.boolean(),
  rolleId: z.number().int().positive().nullable(),
  teamId: z.number().int().positive().nullable(),
  adminGruppe: z.string().trim().max(120)
})
const Body = z.object({ anbieter: z.array(Eintrag).max(10), passwortAus: z.boolean() })

export default defineEventHandler(async (event) => {
  const ich = await requireOwner(event)
  await requirePro('sso')
  const p = Body.safeParse(await readBody(event))
  if (!p.success)
    throw fehler(
      400,
      st(
        'Bitte prüfe die Angaben (Kennung: Kleinbuchstaben, Ziffern, Bindestrich).',
        'Please check your input (ID: lowercase letters, digits, hyphen).'
      )
    )
  const alt = await getSso()
  const ids = new Set<string>()
  const liste: Anbieter[] = []
  for (const a of p.data.anbieter) {
    if (ids.has(a.id))
      throw fehler(400, st(`Die Kennung „${a.id}“ kommt doppelt vor.`, `The ID "${a.id}" appears twice.`))
    ids.add(a.id)
    if (
      a.art === 'oidc' &&
      !/^https:\/\/[^\s]+$/i.test(a.issuer) &&
      !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(a.issuer)
    )
      throw fehler(
        400,
        st(
          `${a.name}: Die Aussteller-Adresse muss mit https:// beginnen.`,
          `${a.name}: The issuer URL must start with https://.`
        )
      )
    const vorher = alt.anbieter.find((x) => x.id === a.id)
    const geheim = a.clientSecret || vorher?.clientSecret || ''
    if (!geheim)
      throw fehler(400, st(`${a.name}: Das Client-Geheimnis fehlt.`, `${a.name}: The client secret is missing.`))
    liste.push({ ...a, clientSecret: geheim })
  }
  if (p.data.passwortAus && !liste.some((a) => a.aktiv))
    throw fehler(
      400,
      st(
        'Ohne aktiven Anbieter kann die Passwort-Anmeldung nicht abgeschaltet werden.',
        'Password sign-in cannot be turned off without an active provider.'
      )
    )
  await setSso({ anbieter: liste, passwortAus: p.data.passwortAus })
  await ereignis('sso_geaendert', ich.id, { anbieter: liste.map((a) => a.id) }, clientIp(event))
  return { ok: true }
})
