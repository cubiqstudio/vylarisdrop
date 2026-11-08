// Node beendet jede Anfrage, die nicht innerhalb von "requestTimeout" (Standard 300 s) vollstaendig angekommen ist.
// Fuer grosse WebDAV-Uploads (eine einzige Anfrage, z. B. 2 GB ueber eine langsame Leitung) ist das zu knapp: bei 5 MB/s
// bricht ab etwa 1,5 GB die Verbindung ab. Hier wird das Limit angehoben (Standard 12 Stunden), nicht ganz abgeschaltet,
// damit haengende Verbindungen irgendwann freigegeben werden. Die Frist fuer die Anfrage-Kopfzeilen (headersTimeout, 60 s)
// bleibt unveraendert. Einstellbar mit VD_ANFRAGE_TIMEOUT_S (Sekunden, 0 = unbegrenzt).
const STANDARD_S = 12 * 3600

export default defineNitroPlugin((nitroApp) => {
  const roh = process.env.VD_ANFRAGE_TIMEOUT_S
  const sek = roh != null && /^\d+$/.test(roh.trim()) ? Number(roh.trim()) : STANDARD_S
  let gesetzt = false
  // Den Server gibt Nitro nicht heraus; er haengt an der Verbindung der ersten Anfrage. requestTimeout wird bei Node
  // laufend neu gelesen, die Aenderung gilt also auch fuer schon offene Verbindungen.
  nitroApp.hooks.hook('request', (event) => {
    if (gesetzt) return
    const server: any = (event.node.req.socket as any)?.server
    if (!server || typeof server.requestTimeout !== 'number') return
    server.requestTimeout = sek * 1000
    gesetzt = true
  })
})
