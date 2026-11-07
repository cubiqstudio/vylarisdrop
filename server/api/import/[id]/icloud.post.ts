import { z } from 'zod'
import { q } from '../../../utils/db'
import { limit, requireUser } from '../../../utils/auth'
import { requireRecht } from '../../../utils/teams'
import { importAnsicht, ladeImport, meinImport } from '../../../utils/importKern'
import { icloudAnmelden, icloudCode, icloudSms, icloudTelefone, type Sitzung } from '../../../utils/icloud'

const Body = z.discriminatedUnion('aktion', [
  z.object({
    aktion: z.literal('anmelden'),
    appleId: z.string().trim().min(3).max(200),
    passwort: z.string().min(1).max(300)
  }),
  z.object({ aktion: z.literal('telefone') }),
  z.object({ aktion: z.literal('sms'), telefon: z.coerce.number().int().min(1).max(1000) }),
  z.object({ aktion: z.literal('code'), code: z.string().trim().min(6).max(12) }),
  z.object({ aktion: z.literal('abmelden') })
])

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  await requireRecht(u, 'import')
  const imp = await meinImport(event, u)
  if (imp.quelle !== 'icloud' || imp.weg !== 'konto')
    throw fehler(400, 'Dieser Import nutzt keine Apple-ID.', 'This import does not use an Apple ID.')
  if (imp.status !== 'entwurf' && imp.status !== 'bereit' && imp.status !== 'pausiert' && imp.status !== 'fertig')
    throw fehler(409, 'Der Import läuft gerade.', 'The import is running right now.')
  const p = Body.safeParse(await readBody(event))
  if (!p.success) throw fehler(400, 'Bitte prüfe die Angaben.', 'Please check the details.')
  if (limit('icloud:' + u.id, p.data.aktion === 'anmelden' ? 6 : 20, 900))
    throw fehler(
      429,
      'Zu viele Versuche — bitte in 15 Minuten noch einmal.',
      'Too many attempts — please try again in 15 minutes.'
    )
  const alt = (imp.zugang?.icloud || null) as Sitzung | null
  let s: Sitzung | null = alt
  let telefone: Array<{ id: number; nummer: string }> | undefined
  const b = p.data
  if (b.aktion === 'anmelden') s = await icloudAnmelden(b.appleId, b.passwort, alt)
  else if (b.aktion === 'abmelden') s = null
  else {
    if (!s)
      throw fehler(
        400,
        'Bitte zuerst mit Apple-ID und Passwort anmelden.',
        'Please sign in with Apple ID and password first.'
      )
    if (b.aktion === 'telefone') telefone = await icloudTelefone(s)
    else if (b.aktion === 'sms') await icloudSms(s, b.telefon)
    else s = await icloudCode(s, b.code)
  }
  await q(
    `UPDATE importe SET zugang = CASE WHEN $2::jsonb IS NULL THEN zugang - 'icloud' ELSE jsonb_set(zugang, '{icloud}', $2::jsonb) END, meldung = '' WHERE id = $1`,
    [imp.id, s ? JSON.stringify(s) : null]
  )
  const neu = await ladeImport(imp.id)
  return { ok: true, schritt: s?.schritt || null, telefone, import: neu ? importAnsicht(neu) : null }
})
