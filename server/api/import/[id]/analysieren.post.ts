import { z } from 'zod'
import { q } from '../../../utils/db'
import { requireUser } from '../../../utils/auth'
import { requireRecht } from '../../../utils/teams'
import { analyseAnstossen, meinImport } from '../../../utils/importKern'
import { importAnalysieren } from '../../../utils/importQuellen'

const Zugang = z
  .object({
    url: z.string().trim().max(500).optional(),
    token: z.string().trim().max(2000).optional(),
    apiKey: z.string().trim().max(500).optional(),
    clientId: z.string().trim().max(200).optional(),
    accessToken: z.string().trim().max(500).optional(),
    alben: z.string().max(20_000).optional(),
    ordner: z.string().trim().max(500).optional(),
    inhalt: z.enum(['fotos', 'drive', 'beides']).optional(),
    mysql: z
      .object({
        host: z.string().trim().max(200).optional(),
        port: z.coerce.number().int().min(1).max(65535).optional(),
        user: z.string().max(200).optional(),
        password: z.string().max(500).optional(),
        database: z.string().max(200).optional()
      })
      .optional()
  })
  .strict()

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  await requireRecht(u, 'import')
  const imp = await meinImport(event, u)
  if (imp.status !== 'entwurf' && imp.status !== 'bereit')
    throw fehler(409, 'Dieser Import wurde schon gestartet.', 'This import has already been started.')
  const b = await readBody(event)
  const p = Zugang.safeParse(b?.zugang || {})
  if (!p.success) throw fehler(400, 'Bitte prüfe die Angaben zur Quelle.', 'Please check the source details.')
  const alt = imp.zugang || {}
  const neu: Record<string, any> = { ...p.data }
  for (const k of ['token', 'apiKey', 'accessToken', 'clientId'] as const) if (!neu[k] && alt[k]) neu[k] = alt[k]
  if (neu.mysql && !neu.mysql.password && alt.mysql?.password) neu.mysql.password = alt.mysql.password
  if (alt.icloud) neu.icloud = alt.icloud
  if (alt.icloudCk) neu.icloudCk = alt.icloudCk
  const r = await q(
    `UPDATE importe SET status = 'analyse', zugang = $2::jsonb, meldung = '', knoten = NULL, lease_bis = NULL WHERE id = $1 AND status IN ('entwurf', 'bereit') RETURNING id`,
    [imp.id, JSON.stringify(neu)]
  )
  if (!r.length) throw fehler(409, 'Dieser Import wurde schon gestartet.', 'This import has already been started.')
  analyseAnstossen(imp.id, importAnalysieren)
  return { ok: true }
})
