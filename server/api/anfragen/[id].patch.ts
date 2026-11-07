import { q, q1 } from '../../utils/db'
import { hashPw, requireUser } from '../../utils/auth'
import { ablaufAus } from '../../utils/dateien'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!(await q1('SELECT 1 FROM anfragen WHERE id = $1 AND user_id = $2', [id, u.id])))
    throw fehler(404, 'Anfrage nicht gefunden.', 'Request not found.')
  const b = await readBody(event)
  const set: string[] = [],
    w: unknown[] = [id]
  const neu = (sp: string, v: unknown) => {
    w.push(v)
    set.push(`${sp} = $${w.length}`)
  }
  if (typeof b?.aktiv === 'boolean') neu('aktiv', b.aktiv)
  if (typeof b?.titel === 'string' && b.titel.trim()) neu('titel', b.titel.trim().slice(0, 100))
  if (typeof b?.nachricht === 'string') neu('nachricht', b.nachricht.slice(0, 1000))
  if ('ablauf' in (b || {})) neu('laeuft_ab', b.ablauf ? ablaufAus(b.ablauf) : null)
  if ('max_dateien' in (b || {}))
    neu('max_dateien', b.max_dateien ? Math.max(1, Math.floor(Number(b.max_dateien))) : null)
  if ('max_mb' in (b || {})) neu('max_bytes', b.max_mb ? Math.round(Number(b.max_mb) * 1024 ** 2) : null)
  if (typeof b?.passwort === 'string') neu('password_hash', b.passwort ? await hashPw(b.passwort.slice(0, 200)) : '')
  if (typeof b?.aufnahme === 'boolean') neu('aufnahme', b.aufnahme)
  if ([1, 5, 15, 30].includes(b?.aufnahme_min)) neu('aufnahme_min', b.aufnahme_min)
  if (set.length) await q(`UPDATE anfragen SET ${set.join(', ')} WHERE id = $1`, w)
  return { ok: true }
})
