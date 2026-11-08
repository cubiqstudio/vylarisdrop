import { q, q1 } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'
import { getSpeicher } from '../../../utils/s3'
import { standardOrt } from '../../../utils/speicher'
import { ablageRegelnLaden, regelAnzeige, zielAuswahl, MAX_REGELN } from '../../../utils/ablageRegeln'

// Ablage-Regeln („Wohin kommt was?“): Liste in Reihenfolge, Zustand der Ziele und Auswahllisten für den Dialog — nur Admin/Inhaber
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const [regeln, ziele, w, ort] = await Promise.all([ablageRegelnLaden(true), zielAuswahl(), getSpeicher(), standardOrt()])
  const [konten, rollen, teams, ordnerRoh] = await Promise.all([
    q('SELECT id, username, role FROM users ORDER BY lower(username) LIMIT 1000'),
    q('SELECT id, name FROM rollen ORDER BY lower(name) LIMIT 200').catch(() => []),
    q('SELECT id, name FROM teams ORDER BY lower(name) LIMIT 500').catch(() => []),
    q<{ id: number; name: string; parent_id: number | null; username: string; team_id: number | null }>(
      'SELECT f.id, f.name, f.parent_id, f.team_id, u.username FROM folders f JOIN users u ON u.id = f.user_id ORDER BY f.id LIMIT 5000'
    )
  ])
  const nach = new Map(ordnerRoh.map((o) => [o.id, o]))
  const pfad = (o: (typeof ordnerRoh)[number]): string => {
    const teile: string[] = []
    for (let x: (typeof o) | undefined = o, n = 0; x && n < 32; x = x.parent_id ? nach.get(x.parent_id) : undefined, n++) teile.unshift(x.name)
    return teile.join(' / ')
  }
  const belegt = await q1<{ n: string }>('SELECT count(*) AS n FROM files')
  return {
    regeln: regeln.map((r) => regelAnzeige(r, ziele)),
    max: MAX_REGELN,
    standard: { art: w.art, ort, name: ziele.find((z) => z.ort === ort)?.name || ort, mitglieder: w.art === 'pool' ? w.mitglieder || ['lokal'] : [] },
    auswahl: {
      ziele,
      konten,
      rollen,
      teams,
      ordner: ordnerRoh.map((o) => ({ id: o.id, pfad: pfad(o), konto: o.username, team_id: o.team_id }))
    },
    dateien: Number(belegt?.n || 0)
  }
})
