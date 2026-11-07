import { mitSperre, NUR_WEB } from '../utils/knoten'
import { sftpNachLoeschen } from '../utils/speicher'
import { loeschlisteAbarbeiten, sftpPruefen } from '../utils/sftpClient'
import { alleZiele } from '../utils/sftpZiele'

/** Begrenzt eine Prüfung: ein hängendes Ziel darf die Prüf- und Löschschleife aller anderen Ziele nicht anhalten. */
const PRUEFEN_MS = 90_000
const mitFrist = <T>(p: Promise<T>, ms: number): Promise<T | void> =>
  Promise.race([p, new Promise<void>((res) => setTimeout(res, ms).unref?.())])

export default defineNitroPlugin((nitro) => {
  // Bricht der Client eine Antwort ab (Tab zu, Video-Seek, Range-Abbruch), zerstört h3 den Lesestrom nicht: er bliebe
  // pausiert und hielte bei SFTP-Zielen Pool-Platz und Handle für immer. Darum wird der Strom beim Schließen der Antwort zerstört.
  nitro.hooks.hook('request', (event: any) => {
    const res = event?.node?.res
    res?.once('close', () => {
      const strom = res._data
      if (strom && typeof strom.destroy === 'function' && !strom.destroyed) strom.destroy()
    })
  })

  // Bricht ein Datenstrom NACH dem Senden der Kopfzeilen ab (z. B. SFTP-Server fällt mitten im Download aus), bleibt die
  // Antwort sonst offen und der Client wartet ewig. Hier wird die Verbindung dann hart beendet: der Client sieht einen
  // abgebrochenen Download statt eines Hängers.
  nitro.hooks.hook('error', (_err, ctx: any) => {
    const res = ctx?.event?.node?.res
    if (res?.headersSent && !res.writableEnded) res.destroy()
  })

  // Regelmäßige Zustandsprüfung der SFTP-Speicher-Erweiterungen und Nachholen fehlgeschlagener Löschungen
  if (NUR_WEB) return
  const lauf = () =>
    mitSperre('sftp_status', async () => {
      for (const z of await alleZiele(true)) if (z.aktiv) await mitFrist(sftpPruefen(z.id).catch(() => {}), PRUEFEN_MS)
      const r = await loeschlisteAbarbeiten(sftpNachLoeschen)
      if (r.erledigt) console.log(`[vylariscloud] SFTP: ${r.erledigt} verspätete Löschung(en) nachgeholt.`)
    }).catch((e: any) => console.error('[vylariscloud] SFTP-Prüfung:', e?.message))
  setTimeout(lauf, 25_000).unref?.()
  setInterval(lauf, 120_000).unref?.()
})
