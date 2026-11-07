import { q } from './db'
import { ablaufVon, type SchluesselZeile } from './lizenzAussteller'

export type LizenzStatus = 'neu' | 'aktiv' | 'abgelaufen' | 'gesperrt'

export function statusVon(z: SchluesselZeile): LizenzStatus {
  if (z.gesperrt) return 'gesperrt'
  if (!z.aktiviert_at) return 'neu'
  const a = ablaufVon(z)
  return a && a.getTime() <= Date.now() ? 'abgelaufen' : 'aktiv'
}

export async function listeLaden() {
  const zeilen = await q<SchluesselZeile & { geraete: number }>(
    `SELECT s.*, (SELECT count(*) FROM lizenz_geraete g WHERE g.key_id = s.id)::int AS geraete
       FROM lizenz_schluessel s ORDER BY s.id DESC LIMIT 1000`
  )
  const geraete = await q<{ key_id: number; hwid: string; name: string; aktiviert_at: Date; zuletzt_at: Date }>(
    'SELECT key_id, hwid, name, aktiviert_at, zuletzt_at FROM lizenz_geraete ORDER BY aktiviert_at'
  )
  return zeilen.map((z) => {
    const ablauf = ablaufVon(z)
    return {
      id: z.id,
      schluessel: z.schluessel,
      notiz: z.notiz,
      plan: z.plan,
      features: z.features,
      tage: z.laufzeit_tage,
      aktiviertAm: z.aktiviert_at,
      ablauf: ablauf ? ablauf.toISOString() : null,
      maxGeraete: z.max_geraete,
      geraete: z.geraete,
      gesperrt: z.gesperrt,
      status: statusVon(z),
      erstelltAm: z.created_at,
      geraeteListe: geraete
        .filter((g) => g.key_id === z.id)
        .map((g) => ({ name: g.name, hwid: g.hwid.slice(0, 8), aktiviertAm: g.aktiviert_at, zuletzt: g.zuletzt_at }))
    }
  })
}
