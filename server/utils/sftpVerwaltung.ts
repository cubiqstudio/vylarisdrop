import { q, q1 } from './db'
import { getSpeicher } from './s3'
import { regelnMitZiel } from './ablageRegeln'
import { st } from './settings'
import { sftpTesten, type TestErgebnis } from './sftpClient'
import {
  geheimBauen,
  pruefeDaten,
  statusSetzen,
  zielBelegung,
  zielLaden,
  type ZielDaten,
  type ZielZeile
} from './sftpZiele'

/** Gemeinsame Abläufe der Verwaltungs-API: Test aus Formulardaten, Zugangsdaten übernehmen, Belegung. */

/**
 * Baut die Test-Eingabe aus dem Formular. Bleiben Passwort/Schlüssel leer, gilt der gespeicherte Wert — aber nur,
 * solange Host, Port und Benutzer gleich bleiben (sonst ließe sich das gespeicherte Geheimnis an einen fremden
 * Server schicken).
 */
export async function testEingabe(d: ZielDaten, alt: ZielZeile | null) {
  const { host, basis } = pruefeDaten(d)
  const neuesGeheimnis = d.auth === 'passwort' ? !!d.passwort : !!d.schluessel?.trim()
  if (alt && !neuesGeheimnis && (alt.host !== host || alt.port !== d.port || alt.benutzer !== d.benutzer))
    throw fehler(
      400,
      'Wenn Host, Port oder Benutzer geändert werden, bitte Passwort bzw. Schlüssel erneut eingeben.',
      'When host, port or user are changed, please enter the password or key again.'
    )
  const geheim = await geheimBauen(d, alt)
  return {
    host,
    basis,
    geheim,
    eingabe: {
      host,
      port: d.port,
      benutzer: d.benutzer,
      geheim,
      name: d.name,
      basis,
      pin: d.host_key,
      schreibbar: d.schreibbar !== false
    }
  }
}

export async function testen(d: ZielDaten, alt: ZielZeile | null): Promise<TestErgebnis> {
  return sftpTesten((await testEingabe(d, alt)).eingabe)
}

/** Übernimmt ein Testergebnis in die Statusanzeige einer gespeicherten Erweiterung. */
export async function statusAusTest(id: number, t: TestErgebnis): Promise<void> {
  await statusSetzen(
    id,
    t.ok
      ? { online: true, latenzMs: t.latenzMs ?? null, platz: t.platz ?? null, banner: t.banner || '' }
      : {
          online: false,
          fehler: t.meldung,
          fehlerCode: t.hostKeyGeaendert ? 'HOSTKEY' : t.stufe === 'anmeldung' ? 'AUTH' : 'OFFLINE',
          hostKeyGeaendert: !!t.hostKeyGeaendert
        },
    true
  )
}

export async function speicherZustand() {
  const w = await getSpeicher()
  const verteilung = await q<{ ort: string; n: string; s: string }>(
    `SELECT CASE WHEN ablage LIKE 's3:%' THEN 's3' WHEN ablage ~ '^sftp[0-9]+:' THEN substring(ablage from '^(sftp[0-9]+):') ELSE 'lokal' END AS ort,
            count(*) AS n, coalesce(sum(size), 0) AS s FROM files GROUP BY 1`
  )
  return {
    w,
    verteilung: Object.fromEntries(verteilung.map((v) => [v.ort, { anzahl: Number(v.n), bytes: Number(v.s) }]))
  }
}

/** Gründe, die das Entfernen einer Erweiterung verhindern (leer = darf entfernt werden). */
export async function loeschHindernis(z: ZielZeile): Promise<string | null> {
  const b = (await zielBelegung()).get(z.id)
  if (b && (b.dateien || b.korb))
    return st(
      `Auf „${z.name}“ liegen noch ${b.dateien} Datei(en)${b.korb ? ` und ${b.korb} im Papierkorb` : ''}. Bitte zuerst alle Dateien umziehen (Dateien umziehen) bzw. den Papierkorb leeren.`,
      `“${z.name}” still holds ${b.dateien} file(s)${b.korb ? ` and ${b.korb} in the trash` : ''}. Please move all files away first (Move files) or empty the trash.`
    )
  const w = await getSpeicher()
  if (w.art === 'sftp' && w.sftpZiel === z.id)
    return st(
      `„${z.name}“ ist der Speicherort für neue Uploads. Bitte zuerst einen anderen Speicherort wählen.`,
      `“${z.name}” is the storage location for new uploads. Please choose another location first.`
    )
  // Ablage-Regeln: eine aktive Regel, die diese Box nennt, würde ins Leere zeigen — erst die Regel ändern
  const regeln = await regelnMitZiel(`sftp${z.id}`)
  if (regeln.length)
    return st(
      `Die Ablage-Regel(n) ${regeln.map((r) => `„${r.name || '#' + r.id}“`).join(', ')} nennen „${z.name}“ noch. Bitte zuerst die Regel ändern oder ausschalten (Speicher-Regeln, Reiter „Ablage“).`,
      `The storage rule(s) ${regeln.map((r) => `“${r.name || '#' + r.id}”`).join(', ')} still name “${z.name}”. Please change or switch off the rule first (Storage rules, “Placement” tab).`
    )
  const up = await q1<{ n: string }>('SELECT count(*) AS n FROM uploads WHERE speicher = $1', [`sftp${z.id}`])
  if (Number(up?.n || 0))
    return st(
      'Es laufen noch unvollständige Uploads auf diese Erweiterung. Bitte kurz warten oder abbrechen.',
      'Unfinished uploads are still targeting this add-on. Please wait briefly or cancel them.'
    )
  const um = await q1<{ value: { ziel?: string; status?: string } | null }>("SELECT value FROM settings WHERE key = 'umzug'")
  if (um?.value?.ziel === `sftp${z.id}` && um.value.status !== 'fertig')
    return st('Ein Umzug auf diese Erweiterung ist noch nicht abgeschlossen.', 'A move to this add-on is not finished yet.')
  return null
}

