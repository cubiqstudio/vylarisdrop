import { q } from '../../utils/db'
import { requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  return {
    tags: await q(
      'SELECT t.id, t.name, t.color, (SELECT count(*) FROM file_tags ft WHERE ft.tag_id = t.id)::int AS anzahl FROM tags t WHERE t.user_id = $1 ORDER BY lower(t.name)',
      [u.id]
    )
  }
})
