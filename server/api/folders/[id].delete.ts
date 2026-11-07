import { q } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { ordnerRecht } from '../../utils/teams'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!(await ordnerRecht(u.id, id))?.verwalten) throw fehler(404, 'Ordner nicht gefunden.', 'Folder not found.')
  // Wie im Dateimanager: Ordner und Dateien anderer Mitglieder im Teilbaum darf nur die Team-Leitung mitlöschen
  if (await fremdesImBaum(u.id, id))
    throw fehler(
      403,
      'Der Ordner enthält Ordner oder Dateien anderer Mitglieder, die du nicht löschen darfst.',
      'The folder contains folders or files of other members that you may not delete.'
    )
  await q('DELETE FROM folders WHERE id = $1', [id])
  return { ok: true }
})
