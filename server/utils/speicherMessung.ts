import { q, q1 } from './db'
import { getSetting, setSetting } from './settings'
import { imHintergrund } from './benachrichtigen'
import { boxLoeschen, boxMessen, boxNeuZaehlen, type Box } from './boxen'
import { bucketLoeschen, bucketMessen, type Bucket } from './buckets'
import { garageKapazitaetAbgleichen, speicherKonfiguriert } from './speicherdienst'

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
  // Reservierungen von Buckets, deren Anlegen in Garage nie fertig wurde (Absturz mitten im Anlegen), geben ihr Budget wieder frei
  await q("DELETE FROM speicher_buckets WHERE garage_id = '' AND created_at < now() - interval '10 minutes'")
  for (const b of await q<Box>('SELECT * FROM speicher_boxen ORDER BY id')) {
    try {
      const m = await boxMessen(b)
      await q(VERLAUF, ['box', b.id, m.belegt, m.dateien])
      await warnen('box', b, m.belegt)
    } catch (e: any) {
      console.error(`[vylariscloud] Speicher: Box ${b.id} nicht gemessen:`, e.message)
    }
  }
  for (const b of await q<Bucket>("SELECT * FROM speicher_buckets WHERE garage_id <> '' ORDER BY id")) {
    try {
      const m = await bucketMessen(b)
      await q(VERLAUF, ['bucket', b.id, m.belegt, m.objekte])
      await warnen('bucket', b, m.belegt)
    } catch (e: any) {
      console.error(`[vylariscloud] Speicher: Bucket ${b.id} nicht gemessen:`, e.message)
    }
  }
  // Garage-Kapazität nur anheben (z. B. 1-GB-Notwert oder alte SSD-Größe nach dem Umzug auf eine größere Platte)
  await garageKapazitaetAbgleichen(true).then(
    (r) => {
      if (r.geaendert) console.log(`[vylariscloud] Garage-Kapazität angepasst: ${r.alt ?? '?'} → ${r.neu} Byte`)
    },
    (e: any) => console.error('[vylariscloud] Garage-Kapazität nicht geprüft:', e?.message || e)
  )
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

/**
 * Räumt Boxen und Buckets eines Kontos im Dienst UND in der Datenbank auf, bevor das Konto gelöscht wird. Klappt das bei einer
 * Box/einem Bucket nicht (Dienst aus oder gestört), wird abgebrochen und das Konto NICHT gelöscht — sonst blieben Daten, Logins
 * und Schlüssel im Dienst ohne Besitzer zurück (die Datenbankzeilen würden per CASCADE verschwinden). `ohneDienst` (nur Inhaber)
 * lässt den Dienst aus: die Zeilen verschwinden, Reste im Dienst bleiben und müssen dort von Hand entfernt werden.
 */
export async function speicherVonKontoLoeschen(userId: number, ohneDienst = false): Promise<number> {
  const boxen = await q<Box>('SELECT * FROM speicher_boxen WHERE user_id = $1', [userId])
  const buckets = await q<Bucket>('SELECT * FROM speicher_buckets WHERE user_id = $1', [userId])
  if (!boxen.length && !buckets.length) return 0
  if (ohneDienst) return boxen.length + buckets.length
  if (!speicherKonfiguriert())
    throw fehler(
      409,
      'Das Konto hat Boxen oder Buckets, aber der Speicherdienst ist nicht eingeschaltet. Bitte erst einschalten, damit sie sauber entfernt werden.',
      'The account has boxes or buckets, but the storage service is not switched on. Please switch it on first so they can be removed cleanly.'
    )
  let n = 0
  const fehlgeschlagen: string[] = []
  for (const b of boxen) {
    await boxLoeschen(b).then(
      () => n++,
      (e: any) => {
        fehlgeschlagen.push(`Box ${b.id}`)
        console.error('[vylariscloud] Box beim Konto-Löschen:', e.message)
      }
    )
  }
  for (const b of buckets) {
    await bucketLoeschen(b).then(
      () => n++,
      (e: any) => {
        fehlgeschlagen.push(`Bucket ${b.id}`)
        console.error('[vylariscloud] Bucket beim Konto-Löschen:', e.message)
      }
    )
  }
  if (fehlgeschlagen.length)
    throw fehler(
      503,
      'Die Boxen und Buckets dieses Kontos konnten im Speicherdienst nicht entfernt werden. Das Konto wurde nicht gelöscht. Läuft der Speicherdienst? Danach bitte erneut versuchen.',
      'The boxes and buckets of this account could not be removed in the storage service. The account was not deleted. Is the storage service running? Please try again afterwards.'
    )
  return n
}
