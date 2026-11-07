import { mitSperre, NUR_WEB } from '../utils/knoten'
import { sftpNachLoeschen } from '../utils/speicher'
import { loeschlisteAbarbeiten, sftpPruefen } from '../utils/sftpClient'
import { alleZiele } from '../utils/sftpZiele'

export default defineNitroPlugin((nitro) => {
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
      for (const z of await alleZiele(true)) if (z.aktiv) await sftpPruefen(z.id).catch(() => {})
      const r = await loeschlisteAbarbeiten(sftpNachLoeschen)
      if (r.erledigt) console.log(`[vylariscloud] SFTP: ${r.erledigt} verspätete Löschung(en) nachgeholt.`)
    }).catch((e: any) => console.error('[vylariscloud] SFTP-Prüfung:', e?.message))
  setTimeout(lauf, 25_000).unref?.()
  setInterval(lauf, 120_000).unref?.()
})
