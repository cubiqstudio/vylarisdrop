import { q, q1, ereignis } from '../../utils/db'
import { checkPw, clientIp, hashPw, limit, requireUser, sessionTokenHash } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const a = await requireUser(event)
  if (limit('pw:' + a.id, 8, 600))
    throw fehler(429, 'Zu viele Versuche. Bitte warte 10 Minuten.', 'Too many attempts. Please wait 10 minutes.')
  const b = await readBody(event)
  const neu = String(b?.password || '')
  if (neu.length < 10 || neu.length > 200)
    throw fehler(
      400,
      'Das neue Passwort braucht mindestens 10 Zeichen.',
      'The new password needs at least 10 characters.'
    )
  const z = await q1<{ password: string }>('SELECT password FROM users WHERE id = $1', [a.id])
  if (!z || !(await checkPw(String(b?.current || ''), z.password)))
    throw fehler(403, 'Das aktuelle Passwort stimmt nicht.', 'The current password is not correct.')
  await q('UPDATE users SET password = $1 WHERE id = $2', [await hashPw(neu), a.id])
  await q('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [a.id, sessionTokenHash(event)])
  await ereignis('password_changed', a.id, {}, clientIp(event))
  return { ok: true }
})
