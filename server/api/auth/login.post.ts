import { q, q1, ereignis } from '../../utils/db'
import { checkPw, clientIp, fehlversuch, fremderHash, gesperrt, hashPw, sessionStart } from '../../utils/auth'
import { backupHash, totpVerify } from '../../utils/totp'
import { ssoFuerLogin } from '../../utils/sso'

const ATTRAPPE = hashPw('kein-konto-' + Math.random())

export default defineEventHandler(async (event) => {
  const ip = clientIp(event)
  if (gesperrt('login:' + ip, 8))
    throw fehler(
      429,
      'Zu viele Fehlversuche. Bitte warte 10 Minuten.',
      'Too many failed attempts. Please wait 10 minutes.'
    )
  const b = await readBody(event)
  const name = String(b?.username || '')
    .trim()
    .toLowerCase()
    .slice(0, 200)
  const pw = String(b?.password || '').slice(0, 200)
  if (!name || !pw)
    throw fehler(400, 'Bitte Benutzername und Passwort eingeben.', 'Please enter your username and password.')

  const a = await q1<{
    id: number
    username: string
    password: string
    role: string
    totp_enabled: boolean
    totp_secret: string
    backup_codes: string[]
  }>(
    'SELECT id, username, password, role, totp_enabled, totp_secret, backup_codes FROM users WHERE lower(username) = $1 OR lower(email) = $1',
    [name]
  )
  const ok = await checkPw(pw, a?.password || (await ATTRAPPE))
  if (!a || !ok) {
    fehlversuch('login:' + ip, 600)
    await ereignis('login_failed', null, { username: name.slice(0, 40) }, ip)
    throw fehler(401, 'Benutzername oder Passwort falsch.', 'Wrong username or password.')
  }
  if (a.role !== 'owner' && (await ssoFuerLogin()).passwortAus)
    throw fehler(
      403,
      'Bitte melde dich über den Anmelde-Dienst deiner Organisation an.',
      "Please sign in via your organisation's sign-in service."
    )
  if (fremderHash(a.password)) await q('UPDATE users SET password = $1 WHERE id = $2', [await hashPw(pw), a.id])
  if (a.totp_enabled) {
    const code = String(b?.code || '').trim()
    if (!code) return { ok: false, require2fa: true }
    let durch = totpVerify(a.totp_secret, code)
    if (!durch) {
      const h = backupHash(code)
      if ((a.backup_codes || []).includes(h)) {
        await q('UPDATE users SET backup_codes = $1::jsonb WHERE id = $2', [
          JSON.stringify(a.backup_codes.filter((x) => x !== h)),
          a.id
        ])
        await ereignis('backup_code_used', a.id, { uebrig: a.backup_codes.length - 1 }, ip)
        durch = true
      }
    }
    if (!durch) {
      fehlversuch('login:' + ip, 600)
      await ereignis('login_failed', a.id, { grund: '2fa' }, ip)
      throw fehler(401, 'Der Code stimmt nicht.', 'The code is not correct.')
    }
  }
  await sessionStart(event, a.id)
  await ereignis('login', a.id, {}, ip)
  return { ok: true }
})
