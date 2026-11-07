import { z } from 'zod'
import { ereignis } from '../../utils/db'
import { clientIp, requireOwner } from '../../utils/auth'
import { requirePro } from '../../utils/lizenz'
import { st } from '../../utils/settings'
import { datenUrl, getMarke, setMarke } from '../../utils/marke'

const Body = z.object({
  logo: z.string().max(600_000).nullable().optional(),
  icon: z.string().max(600_000).nullable().optional(),
  nurLogo: z.boolean().optional(),
  ohneHinweis: z.boolean().optional(),
  loginText: z.string().max(300).optional(),
  fusszeile: z.string().max(200).optional()
})

export default defineEventHandler(async (event) => {
  const ich = await requireOwner(event)
  await requirePro('white-label')
  const p = Body.safeParse(await readBody(event))
  if (!p.success)
    throw fehler(
      400,
      st('Bitte prüfe die Angaben (Bilder höchstens 400 KB).', 'Please check your input (images at most 400 KB).')
    )
  const b = p.data
  const m = await getMarke()
  for (const k of ['logo', 'icon'] as const) {
    if (b[k] === undefined) continue
    if (b[k] === null || b[k] === '') {
      m[k] = ''
      continue
    }
    const d = datenUrl(b[k]!)
    if (!d)
      throw fehler(400, st('Erlaubt sind PNG, JPEG, WebP, SVG und ICO.', 'Allowed are PNG, JPEG, WebP, SVG and ICO.'))
    if (d.daten.length > 400 * 1024)
      throw fehler(413, st('Das Bild ist größer als 400 KB.', 'The image is larger than 400 KB.'))
    if (d.typ === 'image/svg+xml' && /<script|on\w+\s*=|javascript:/i.test(d.daten.toString('utf8')))
      throw fehler(
        400,
        st(
          'Das SVG enthält Skripte — bitte ein Logo ohne Skripte verwenden.',
          'The SVG contains scripts — please use a logo without scripts.'
        )
      )
    m[k] = b[k]!
  }
  if (b.nurLogo !== undefined) m.nurLogo = b.nurLogo
  if (b.ohneHinweis !== undefined) m.ohneHinweis = b.ohneHinweis
  if (b.loginText !== undefined) m.loginText = b.loginText.trim()
  if (b.fusszeile !== undefined) m.fusszeile = b.fusszeile.trim()
  await setMarke(m)
  await ereignis('marke_geaendert', ich.id, {}, clientIp(event))
  return { ok: true }
})
