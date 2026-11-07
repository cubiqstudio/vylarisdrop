import { q, q1, ereignis } from '../../utils/db'
import { clientIp, neuesToken, requireUser, TOKEN_RECHTE, type TokenRecht } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const b = await readBody(event)
  const name =
    String(b?.name || '')
      .trim()
      .slice(0, 60) || 'Upload-Tool'
  const n = await q1<{ n: string }>('SELECT count(*) AS n FROM upload_tokens WHERE user_id = $1', [u.id])
  if (Number(n?.n || 0) >= 25) throw fehler(400, 'Höchstens 25 Token pro Konto.', 'At most 25 tokens per account.')
  const rechte = Array.isArray(b?.rechte)
    ? (TOKEN_RECHTE.filter((x) => b.rechte.includes(x)) as TokenRecht[])
    : ['upload']
  if (!rechte.length) throw fehler(400, 'Bitte mindestens ein Recht wählen.', 'Please choose at least one permission.')
  const t = neuesToken()
  const r = await q(
    'INSERT INTO upload_tokens (user_id, name, prefix, key_hash, rechte) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id, name, prefix, rechte, created_at, last_used_at',
    [u.id, name, t.prefix, t.hash, JSON.stringify(rechte)]
  )
  await ereignis('token_created', u.id, { name, rechte }, clientIp(event))
  return { ok: true, token: r[0], klar: t.klar }
})
