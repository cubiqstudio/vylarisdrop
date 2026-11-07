import { requireAdmin } from '../../../utils/auth'
import { ausUmgebung } from '../../../utils/s3'
import { istPro } from '../../../utils/lizenz'
import { poolPlatz, zielOrt } from '../../../utils/speicher'
import { umzugStand } from '../../../utils/umzug'
import { alleZiele, zielBelegung, zielOeffentlich } from '../../../utils/sftpZiele'
import { speicherZustand } from '../../../utils/sftpVerwaltung'

// Speicher-Erweiterungen (SFTP): Liste mit Status und Belegung, gewählter Speicherort, Verteilung, Umzug
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const [ziele, belegung, { w, verteilung }, ort, umzug] = await Promise.all([
    alleZiele(true),
    zielBelegung(),
    speicherZustand(),
    zielOrt(),
    umzugStand()
  ])
  return {
    ziele: ziele.map((z) => ({
      ...zielOeffentlich(z),
      dateien: belegung.get(z.id)?.dateien || 0,
      bytes: belegung.get(z.id)?.bytes || 0,
      papierkorb: belegung.get(z.id)?.korb || 0
    })),
    ort: {
      art: w.art,
      mitglieder: w.mitglieder || ['lokal'],
      strategie: w.strategie === 'abwechselnd' ? 'abwechselnd' : 'frei',
      sftpZiel: w.sftpZiel ?? null,
      aktuell: ort,
      // gewählt, aber nicht nutzbar (deaktiviert/schreibgeschützt/entfernt): neue Dateien landen dann lokal
      ausgewichen: w.art === 'sftp' && !ort.startsWith('sftp'),
      ausUmgebung: ausUmgebung(),
      s3Bereit: !!w.s3?.bucket,
      s3Pro: await istPro('s3')
    },
    // Platz je Pool-Mitglied (bei Pool-Modus die Mitglieder, sonst Vorschau über Server und alle Ziele)
    platz: await poolPlatz(
      w.art === 'pool' ? w.mitglieder || ['lokal'] : ['lokal', ...ziele.map((z) => `sftp${z.id}`)]
    ),
    verteilung,
    umzug
  }
})
