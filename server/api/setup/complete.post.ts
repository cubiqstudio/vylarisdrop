import { z } from 'zod'
import { q1, ereignis } from '../../utils/db'
import { requireSetupToken } from '../../utils/setup'
import { istDomain, istGeprueft, serverIp } from '../../utils/netz'
import { setSetting, st } from '../../utils/settings'
import { getTunnel } from '../../utils/tunnel'
import { hashPw, sessionStart } from '../../utils/auth'

const Body = z.object({
  token: z.string(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  name: z.string().trim().min(1).max(40).optional().default('VylarisCloud'),
  mode: z.enum(['domain', 'ip', 'proxy', 'tunnel']),
  domain: z.string().trim().toLowerCase().max(253).optional().default(''),
  admin: z.object({
    username: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[a-zA-Z0-9._-]+$/),
    email: z.string().trim().email().max(200),
    password: z.string().min(10).max(200)
  })
})

export default defineEventHandler(async (event) => {
  const roh = await readBody(event)
  await requireSetupToken(event, roh?.token)
  const p = Body.safeParse(roh)
  if (!p.success) {
    const feld = String(p.error.issues[0]?.path.join('.') || '')
    const text: Record<string, string> = {
      'admin.username': st(
        'Der Benutzername braucht 3–40 Zeichen (Buchstaben, Ziffern, . _ -).',
        'The username needs 3–40 characters (letters, digits, . _ -).'
      ),
      'admin.email': st('Bitte gib eine gültige E-Mail-Adresse ein.', 'Please enter a valid e-mail address.'),
      'admin.password': st('Das Passwort braucht mindestens 10 Zeichen.', 'The password needs at least 10 characters.')
    }
    throw fehler(400, text[feld] || st('Bitte prüfe deine Eingaben.', 'Please check your input.'))
  }
  const b = p.data
  if (b.mode === 'domain') {
    if (!istDomain(b.domain)) throw fehler(400, 'Bitte gib eine gültige Domain ein.', 'Please enter a valid domain.')
    if (!istGeprueft(b.domain))
      throw fehler(
        400,
        'Die Domain wurde noch nicht erfolgreich geprüft.',
        'The domain has not been checked successfully yet.'
      )
  }
  if (b.mode === 'proxy' && b.domain && !istDomain(b.domain))
    throw fehler(400, 'Bitte gib eine gültige Domain ein.', 'Please enter a valid domain.')
  const tunnel = b.mode === 'tunnel' ? await getTunnel() : null
  if (b.mode === 'tunnel' && !tunnel?.an)
    throw fehler(400, 'Bitte starte zuerst den Cloudflare Tunnel.', 'Please start the Cloudflare Tunnel first.')

  const u = await q1<{ id: number }>(
    'INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id',
    [b.admin.username, b.admin.email, await hashPw(b.admin.password), 'owner']
  )
  await setSetting('design', { color: b.color.toLowerCase(), name: b.name })
  const sip = await serverIp()
  if (tunnel) {
    await setSetting('net', { mode: 'proxy', domain: tunnel.domain, https: true, ip: sip })
    await setSetting('tunnel', { ...tunnel, netVorher: { mode: 'ip', domain: '', https: false, ip: sip } })
  } else {
    await setSetting('net', {
      mode: b.mode,
      domain: b.mode === 'ip' ? '' : b.domain,
      https: b.mode === 'domain',
      ip: sip
    })
  }
  await setSetting('setup', { done: true, at: new Date().toISOString() })
  await ereignis('setup', u!.id, { mode: b.mode })
  console.log('[vylariscloud] Einrichtung abgeschlossen.')
  if (b.mode === 'ip') await sessionStart(event, u!.id)
  const ziel = tunnel?.domain || b.domain
  const url = b.mode !== 'ip' && ziel ? `https://${ziel}/login` : '/'
  return { ok: true, url }
})
