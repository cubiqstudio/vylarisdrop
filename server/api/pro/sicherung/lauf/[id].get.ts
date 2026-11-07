import { laufLesen } from '../../../../utils/sicherung'

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '')
  if (!/^[0-9a-f]{32}$/.test(id)) throw fehler(404, 'Unbekannt.', 'Unknown.')
  const l = await laufLesen(id)
  if (!l) throw fehler(404, 'Unbekannt.', 'Unknown.')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { status: l.status, schritt: l.schritt, anteil: l.anteil, meldung: l.meldung }
})
