import { q, q1 } from './db'
import type { Nutzer } from './auth'
import { istPro } from './lizenz'
import { st } from './settings'

export interface Rechte {
  hochladen: boolean
  anfragen: boolean
  import: boolean
  maxDateiMb: number | null
  kontingentGb: number | null
  ablaufMaxTage: number | null
  trafficGb: number | null
}
export const RECHTE_STANDARD: Rechte = {
  hochladen: true,
  anfragen: true,
  import: true,
  maxDateiMb: null,
  kontingentGb: null,
  ablaufMaxTage: null,
  trafficGb: null
}

export function rechteNorm(r: any): Rechte {
  const zahl = (v: any, max: number) => {
    const n = Number(v)
    return v === null || v === '' || v === undefined || !Number.isFinite(n) || n <= 0
      ? null
      : Math.min(max, Math.round(n * 1000) / 1000)
  }
  return {
    hochladen: r?.hochladen !== false,
    anfragen: r?.anfragen !== false,
    import: r?.import !== false,
    maxDateiMb: zahl(r?.maxDateiMb, 10_000_000),
    kontingentGb: zahl(r?.kontingentGb, 1_000_000),
    ablaufMaxTage: zahl(r?.ablaufMaxTage, 36_500),
    trafficGb: zahl(r?.trafficGb, 1_000_000)
  }
}

export async function rechteVon(u: Pick<Nutzer, 'id' | 'role'> & { rolle_id?: number | null }): Promise<Rechte> {
  if (u.role !== 'user') return RECHTE_STANDARD
  let rid = u.rolle_id
  if (rid === undefined)
    rid = (await q1<{ rolle_id: number | null }>('SELECT rolle_id FROM users WHERE id = $1', [u.id]))?.rolle_id ?? null
  if (!rid || !(await istPro('teams'))) return RECHTE_STANDARD
  const r = await q1<{ rechte: any }>('SELECT rechte FROM rollen WHERE id = $1', [rid])
  return r ? rechteNorm(r.rechte) : RECHTE_STANDARD
}
export async function requireRecht(u: Nutzer, recht: 'hochladen' | 'anfragen' | 'import'): Promise<void> {
  const r = await rechteVon(u)
  if (r[recht]) return
  const text: Record<typeof recht, [string, string]> = {
    hochladen: ['Deine Rolle erlaubt keine Uploads.', 'Your role does not allow uploads.'],
    anfragen: ['Deine Rolle erlaubt keine Datei-Anfragen.', 'Your role does not allow file requests.'],
    import: ['Deine Rolle erlaubt keine Importe.', 'Your role does not allow imports.']
  }
  throw fehler(403, st(...text[recht]))
}

export async function meineTeams(
  userId: number
): Promise<Array<{ team_id: number; rolle: 'leitung' | 'mitglied'; name: string; farbe: string }>> {
  if (!(await istPro('teams'))) return []
  return q(
    'SELECT m.team_id, m.rolle, t.name, t.farbe FROM team_mitglieder m JOIN teams t ON t.id = m.team_id WHERE m.user_id = $1 ORDER BY lower(t.name)',
    [userId]
  )
}

export interface OrdnerRecht {
  id: number
  user_id: number
  team_id: number | null
  eigen: boolean
  hineinladen: boolean
  verwalten: boolean
  leitung: boolean
}

export async function ordnerRecht(userId: number, ordnerId: number): Promise<OrdnerRecht | null> {
  // über dem int4-Bereich gibt es keine Ordner (und Postgres würde die Abfrage mit einem Fehler abweisen)
  if (!Number.isSafeInteger(ordnerId) || ordnerId <= 0 || ordnerId > 2_147_483_647) return null
  const o = await q1<{ id: number; user_id: number; team_id: number | null }>(
    'SELECT id, user_id, team_id FROM folders WHERE id = $1',
    [ordnerId]
  )
  if (!o) return null
  const eigen = o.user_id === userId
  if (o.team_id && (await istPro('teams'))) {
    const m = await q1<{ rolle: string }>('SELECT rolle FROM team_mitglieder WHERE team_id = $1 AND user_id = $2', [
      o.team_id,
      userId
    ])
    if (m) {
      const leitung = m.rolle === 'leitung'
      return { ...o, eigen, hineinladen: true, verwalten: eigen || leitung, leitung }
    }
    // Team-Ordner: wer nicht (mehr) Mitglied ist, hat keinen Zugriff darauf – auch nicht als Ersteller.
    // Sonst könnte ein entfernter Ersteller den Ordner aus dem Team lösen, umbenennen oder löschen.
    return null
  }
  // Kein Team-Ordner (oder Pro "teams" aus): nur der Ersteller
  return eigen ? { ...o, team_id: null, eigen, hineinladen: true, verwalten: true, leitung: false } : null
}

export async function dateiRecht<T = any>(
  userId: number,
  fileId: string,
  art: 'lesen' | 'aendern'
): Promise<(T & { eigen: boolean }) | null> {
  const f = await q1<any>('SELECT * FROM files WHERE id = $1', [fileId])
  if (!f) return null
  if (f.user_id === userId) return { ...f, eigen: true }
  if (!f.folder_id) return null
  const o = await ordnerRecht(userId, f.folder_id)
  if (!o || !o.team_id) return null
  if (art === 'aendern' && !o.leitung) return null
  return { ...f, eigen: false }
}

export async function aenderbareDateien(
  userId: number,
  ids: string[]
): Promise<Array<{ id: string; ablage: string; user_id: number }>> {
  const leitung = (await istPro('teams'))
    ? await q<{ team_id: number }>(`SELECT team_id FROM team_mitglieder WHERE user_id = $1 AND rolle = 'leitung'`, [
        userId
      ])
    : []
  return q(
    `SELECT f.id, f.ablage, f.user_id FROM files f LEFT JOIN folders o ON o.id = f.folder_id
    WHERE f.id = ANY($2::bigint[]) AND (f.user_id = $1 OR o.team_id = ANY($3::int[]))`,
    [userId, ids, leitung.map((l) => l.team_id)]
  )
}

export async function teamOrdnerIds(userId: number): Promise<number[]> {
  if (!(await istPro('teams'))) return []
  const r = await q<{ id: number }>(
    'SELECT f.id FROM folders f JOIN team_mitglieder m ON m.team_id = f.team_id AND m.user_id = $1',
    [userId]
  )
  return r.map((x) => x.id)
}

export async function ablaufBegrenzen(userId: number, ablauf: Date | null): Promise<Date | null> {
  const u = await q1<{ role: Nutzer['role']; rolle_id: number | null }>(
    'SELECT role, rolle_id FROM users WHERE id = $1',
    [userId]
  )
  if (!u) return ablauf
  const r = await rechteVon({ id: userId, role: u.role, rolle_id: u.rolle_id })
  if (!r.ablaufMaxTage) return ablauf
  const max = new Date(Date.now() + r.ablaufMaxTage * 86400_000)
  return !ablauf || ablauf > max ? max : ablauf
}
