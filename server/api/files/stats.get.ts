import { q, q1 } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { platte, poolPlatz } from '../../utils/speicher'
import { quotaStand } from '../../utils/quota'
import { quotaWarnen } from '../../utils/benachrichtigen'
import { getSpeicher } from '../../utils/s3'
import { getSpeicherEinst, speicherKonfiguriert } from '../../utils/speicherdienst'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const proArt = await q<{ art: string; n: string; s: string }>(
    'SELECT art, count(*) AS n, coalesce(sum(size),0) AS s FROM files WHERE user_id = $1 GROUP BY art',
    [u.id]
  )
  const ordner = await q1<{ n: string }>('SELECT count(*) AS n FROM folders WHERE user_id = $1', [u.id])
  const letzte = await q1<{ t: string }>('SELECT max(created_at) AS t FROM files WHERE user_id = $1', [u.id])
  // Belegung = Dateien + Papierkorb; Kontingent = wirksames Limit (Konto, Rolle, Standard), siehe utils/quota.ts
  const quota = await quotaStand(u)
  // Warnstufe nachziehen (z. B. wenn ein Admin das Limit geändert oder der Papierkorb sich geleert hat)
  void quotaWarnen(u.id, quota).catch(() => {})
  const p = u.role === 'owner' ? await platte() : null
  // Pool: statt nur des lokalen Platzes den Gesamtplatz aller Mitglieder (nur Inhaber sehen Plattenwerte)
  const pool = u.role === 'owner' && (await getSpeicher()).art === 'pool' ? await poolPlatz() : null
  // Navigation "Speicher": normale Konten sehen den Eintrag nur, wenn der Dienst läuft und sie anlegen dürfen oder schon etwas haben
  const speicherSichtbar =
    u.role !== 'user' ||
    (speicherKonfiguriert() &&
      ((await getSpeicherEinst()).wer === 'alle' ||
        !!(await q1(
          'SELECT 1 FROM speicher_boxen WHERE user_id = $1 UNION ALL SELECT 1 FROM speicher_buckets WHERE user_id = $1 LIMIT 1',
          [u.id]
        ))))
  return {
    speicherSichtbar,
    pool,
    dateien: proArt.reduce((a, r) => a + Number(r.n), 0),
    ordner: Number(ordner?.n || 0),
    zuletzt: letzte?.t || null,
    belegt: quota.used,
    kontingent: quota.limit,
    quota,
    papierkorb: quota.papierkorb,
    proArt: Object.fromEntries(proArt.map((r) => [r.art, { anzahl: Number(r.n), bytes: Number(r.s) }])),
    platte: p
  }
})
