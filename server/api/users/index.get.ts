import { q } from '../../utils/db'
import { requireAdmin } from '../../utils/auth'
import { istPro } from '../../utils/lizenz'
import { trafficGrenze, trafficProKonto } from '../../utils/traffic'
import { belegungAllerKonten, stufeVon, wirksameKontingente } from '../../utils/quota'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const users = await q<any>(`SELECT u.id, u.username, u.email, u.role, u.rolle_id, u.quota_bytes, u.totp_enabled, u.created_at
      FROM users u ORDER BY u.created_at`)
  // Belegung = Dateien + Papierkorb; wirksames Kontingent = Konto, Rolle, Standard (siehe utils/quota.ts)
  const belegung = await belegungAllerKonten()
  const kontingente = await wirksameKontingente(users)
  for (const u of users) {
    const b = belegung.get(u.id)
    const k = kontingente.get(u.id)!
    u.belegt = b?.gesamt || 0
    u.papierkorb = b?.papierkorb || 0
    u.dateien = b?.anzahl || 0
    u.quota_wirksam = k.limit
    u.quota_quelle = k.source
    u.quota_unbegrenzt = k.unbegrenzt
    u.quota_erbt = k.erbt
    u.quota_stufe = stufeVon(u.belegt, k.limit)
    u.quota_prozent = k.limit ? Math.round((u.belegt / k.limit) * 1000) / 10 : null
  }
  if (await istPro('traffic')) {
    const t = await trafficProKonto()
    for (const u of users) {
      u.traffic = t.get(u.id) || 0
      u.traffic_grenze = await trafficGrenze(u.id)
    }
  }
  return { users }
})
