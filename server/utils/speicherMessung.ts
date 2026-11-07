import { q, q1 } from './db'
import { getSetting, setSetting } from './settings'
import { imHintergrund } from './benachrichtigen'
import { boxLoeschen, boxMessen, boxNeuZaehlen, type Box } from './boxen'
import { bucketLoeschen, bucketMessen, type Bucket } from './buckets'
import { speicherKonfiguriert } from './speicherdienst'

async function warnen(
  art: 'box' | 'bucket',
  z: { id: number; user_id: number; name: string; kontingent: string; gewarnt: number },
  belegt: number
) {
  const k = Number(z.kontingent)
  if (!k) return
  const anteil = belegt / k
  const stufe = anteil >= 0.995 ? 100 : anteil >= 0.8 ? 80 : 0
  const tabelle = art === 'box' ? 'speicher_boxen' : 'speicher_buckets'
  if (stufe > z.gewarnt) {
    await q(`UPDATE ${tabelle} SET gewarnt = $2 WHERE id = $1`, [z.id, stufe])
    const nutzer = await q1<{ prefs: Record<string, any> }>('SELECT prefs FROM users WHERE id = $1', [z.user_id])
    const en = nutzer?.prefs?.lang === 'en',
      pz = Math.round(anteil * 100)
    const was = art === 'box' ? (en ? 'Storage box' : 'Storage-Box') : 'Bucket'
    imHintergrund(
      z.user_id,
      'speicher',
      stufe === 100
        ? en
          ? {
              titel: `${was} full: ${z.name}`,
              text: `${was} “${z.name}” has reached its quota. New files are rejected until you delete something or raise the quota.`
            }
          : {
              titel: `${was} voll: ${z.name}`,
              text: `${was} „${z.name}“ hat ihr Kontingent erreicht. Neue Dateien werden abgelehnt, bis du etwas löschst oder das Kontingent erhöhst.`
            }
        : en
          ? { titel: `${was} almost full: ${z.name}`, text: `${was} “${z.name}” is ${pz}% full.` }
          : { titel: `${was} fast voll: ${z.name}`, text: `${was} „${z.name}“ ist zu ${pz} % belegt.` }
    )
  } else if (anteil < 0.75 && z.gewarnt) {
    await q(`UPDATE ${tabelle} SET gewarnt = 0 WHERE id = $1`, [z.id])
  }
}

const VERLAUF = `INSERT INTO speicher_verlauf (art, ref, zeit, bytes, anzahl) VALUES ($1, $2, date_trunc('hour', now()), $3, $4)
  ON CONFLICT (art, ref, zeit) DO UPDATE SET bytes = EXCLUDED.bytes, anzahl = EXCLUDED.anzahl`

export async function speicherMessen(): Promise<void> {
  if (!speicherKonfiguriert()) return
  for (const b of await q<Box>('SELECT * FROM speicher_boxen ORDER BY id')) {
    try {
      const m = await boxMessen(b)
      await q(VERLAUF, ['box', b.id, m.belegt, m.dateien])
      await warnen('box', b, m.belegt)
    } catch (e: any) {
      console.error(`[vylariscloud] Speicher: Box ${b.id} nicht gemessen:`, e.message)
    }
  }
  for (const b of await q<Bucket>('SELECT * FROM speicher_buckets ORDER BY id')) {
    try {
      const m = await bucketMessen(b)
      await q(VERLAUF, ['bucket', b.id, m.belegt, m.objekte])
      await warnen('bucket', b, m.belegt)
    } catch (e: any) {
      console.error(`[vylariscloud] Speicher: Bucket ${b.id} nicht gemessen:`, e.message)
    }
  }
  await q("DELETE FROM speicher_verlauf WHERE zeit < now() - interval '100 days'")
  const l = await getSetting<{ zeit: number }>('speicher-zaehlen', { zeit: 0 }, true)
  if (Date.now() - l.zeit > 23 * 3600_000) {
    await setSetting('speicher-zaehlen', { zeit: Date.now() })
    for (const b of await q<Box>('SELECT * FROM speicher_boxen')) await boxNeuZaehlen(b)
  }
}

export async function speicherVerlauf(
  art: 'box' | 'bucket',
  ref: number,
  tage: number
): Promise<Array<{ zeit: string; wert: number }>> {
  const t = [7, 30, 90].includes(tage) ? tage : 30
  const stufe = t <= 7 ? 'hour' : 'day'
  const r = await q<{ zeit: string; wert: string }>(
    `SELECT date_trunc('${stufe}', zeit) AS zeit, max(bytes) AS wert FROM speicher_verlauf
    WHERE art = $1 AND ref = $2 AND zeit > now() - ($3 || ' days')::interval GROUP BY 1 ORDER BY 1`,
    [art, ref, String(t)]
  )
  return r.map((z) => ({ zeit: new Date(z.zeit).toISOString(), wert: Number(z.wert) }))
}

export async function speicherVonKontoLoeschen(userId: number): Promise<number> {
  if (!speicherKonfiguriert()) return 0
  let n = 0
  for (const b of await q<Box>('SELECT * FROM speicher_boxen WHERE user_id = $1', [userId])) {
    await boxLoeschen(b).then(
      () => n++,
      (e: any) => console.error('[vylariscloud] Box beim Konto-Löschen:', e.message)
    )
  }
  for (const b of await q<Bucket>('SELECT * FROM speicher_buckets WHERE user_id = $1', [userId])) {
    await bucketLoeschen(b).then(
      () => n++,
      (e: any) => console.error('[vylariscloud] Bucket beim Konto-Löschen:', e.message)
    )
  }
  return n
}
