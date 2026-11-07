import { setSprache, setupDone } from '../../utils/settings'

export default defineEventHandler(async (event) => {
  if (await setupDone()) throw fehler(403, 'Die Einrichtung ist abgeschlossen.', 'Setup is already complete.')
  const lang = (await readBody(event))?.lang === 'en' ? 'en' : 'de'
  await setSprache(lang)
  return { ok: true, lang }
})
