import { z } from 'zod'
import { q, q1, ereignis } from '../../utils/db'
import { clientIp, hashPw, requireAdmin } from '../../utils/auth'

const Body = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/),
  email: z.string().trim().email().max(200).or(z.literal('')).optional().default(''),
  password: z.string().min(10).max(200),
  role: z.enum(['admin', 'user']).default('user'),
  quota_gb: z.number().min(0).max(1_000_000).nullable().optional()
})

export default defineEventHandler(async (event) => {
  const ich = await requireAdmin(event)
  const p = Body.safeParse(await readBody(event))
  if (!p.success) {
    const feld = String(p.error.issues[0]?.path[0] || '')
    throw fehler(
      400,
      feld === 'password'
        ? 'Das Passwort braucht mindestens 10 Zeichen.'
        : feld === 'username'
          ? 'Der Benutzername braucht 3–40 Zeichen (Buchstaben, Ziffern, . _ -).'
          : 'Bitte prüfe deine Eingaben.',
      feld === 'password'
        ? 'The password needs at least 10 characters.'
        : feld === 'username'
          ? 'The username needs 3–40 characters (letters, digits, . _ -).'
          : 'Please check your input.'
    )
  }
  const b = p.data
  if (b.role === 'admin' && ich.role !== 'owner')
    throw fehler(403, 'Admins kann nur der Inhaber anlegen.', 'Only the owner can create admins.')
  if (
    await q1("SELECT 1 FROM users WHERE lower(username) = lower($1) OR ($2 <> '' AND lower(email) = lower($2))", [
      b.username,
      b.email
    ])
  )
    throw fehler(409, 'Benutzername oder E-Mail ist schon vergeben.', 'Username or e-mail is already taken.')
  const quota = b.quota_gb ? Math.round(b.quota_gb * 1024 ** 3) : null
  const r = await q(
    'INSERT INTO users (username, email, password, role, quota_bytes) VALUES ($1,$2,$3,$4,$5) RETURNING id, username, email, role, quota_bytes, created_at',
    [b.username, b.email, await hashPw(b.password), b.role, quota]
  )
  await ereignis('user_created', ich.id, { username: b.username, role: b.role }, clientIp(event))
  return { ok: true, user: r[0] }
})
