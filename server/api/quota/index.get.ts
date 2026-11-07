import { q } from '../../utils/db'
import { requireAdmin } from '../../utils/auth'
import { platte } from '../../utils/speicher'
import { istPro } from '../../utils/lizenz'
import { getQuota } from '../../utils/settings'
import { belegungAllerKonten, stufeVon, teamBelegungen, wirksameKontingente } from '../../utils/quota'

// Kontingent-Übersicht für Admins: Summen, Konten mit Belegung und Warnstufe, Teams mit Kontingent, freier Platz auf der Platte
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const konten = await q<{ id: number; username: string; role: 'owner' | 'admin' | 'user'; quota_bytes: string | null; rolle_id: number | null }>(
    'SELECT id, username, role, quota_bytes, rolle_id FROM users ORDER BY lower(username)'
  )
  const belegung = await belegungAllerKonten()
  const kontingente = await wirksameKontingente(konten)
  const nutzer = konten.map((u) => {
    const b = belegung.get(u.id)
    const k = kontingente.get(u.id)!
    const used = b?.gesamt || 0
    return {
      id: u.id,
      username: u.username,
      role: u.role,
      limit: k.limit,
      source: k.source,
      unbegrenzt: k.unbegrenzt,
      used,
      papierkorb: b?.papierkorb || 0,
      dateien: b?.anzahl || 0,
      prozent: k.limit ? Math.round((used / k.limit) * 1000) / 10 : null,
      stufe: stufeVon(used, k.limit)
    }
  })
  const begrenzt = nutzer.filter((u) => u.limit != null)
  let teams: Array<{ id: number; name: string; limit: number; used: number; prozent: number; stufe: string }> = []
  if (await istPro('teams')) {
    const t = await q<{ id: number; name: string; quota_bytes: string }>(
      'SELECT id, name, quota_bytes FROM teams WHERE quota_bytes > 0 ORDER BY lower(name)'
    )
    const bel = await teamBelegungen()
    teams = t.map((x) => {
      const used = bel.get(x.id) || 0
      const limit = Number(x.quota_bytes)
      return { id: x.id, name: x.name, limit, used, prozent: Math.round((used / limit) * 1000) / 10, stufe: stufeVon(used, limit) }
    })
  }
  return {
    standardGb: (await getQuota()).standardGb,
    belegt: nutzer.reduce((a, u) => a + u.used, 0),
    papierkorb: nutzer.reduce((a, u) => a + u.papierkorb, 0),
    vergeben: begrenzt.reduce((a, u) => a + (u.limit || 0), 0),
    konten: nutzer.length,
    begrenzt: begrenzt.length,
    unbegrenzt: nutzer.length - begrenzt.length,
    ueber80: nutzer.filter((u) => u.stufe !== 'ok').length,
    voll: nutzer.filter((u) => u.stufe === 'voll').length,
    platte: await platte(),
    nutzer,
    teams
  }
})
