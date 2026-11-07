import { apiNutzer, alsApi, bodySetzen } from '../../../utils/api'
import aendern from '../../files/[id]/index.patch'

export default defineEventHandler(async (event) => {
  await apiNutzer(event, 'verwalten')
  const b = (await readBody(event)) || {}
  const neu: Record<string, unknown> = {}
  if ('name' in b) neu.name = b.name
  if ('slug' in b) neu.slug = b.slug
  if ('folder_id' in b) neu.ordner = b.folder_id
  if ('expires' in b) neu.ablauf = b.expires === null ? null : b.expires
  if ('max_views' in b) neu.max_aufrufe = b.max_views
  if ('password' in b) neu.passwort = b.password
  if ('favorite' in b) neu.favorit = b.favorite
  if ('tag_ids' in b) neu.tags = b.tag_ids
  bodySetzen(event, neu)
  const r: any = await aendern(event)
  return alsApi(r.file)
})
