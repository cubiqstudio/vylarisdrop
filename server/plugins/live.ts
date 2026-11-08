import { liveSchliessen, liveStarten } from '../utils/live'

export default defineNitroPlugin((nitro) => {
  liveStarten()
  // Offene Event-Streams enden nie von selbst: beim Herunterfahren zuerst schließen, sonst wartet Nitro bis zum
  // Zeitlimit (30 s) und Docker beendet den Prozess nach stop_grace_period (20 s) hart. Die Browser verbinden sich neu.
  nitro.hooks.hook('close', () => liveSchliessen())
  // Nitro ruft den close-Hook erst NACH dem Ende aller Verbindungen auf, deshalb zusätzlich beim Signal selbst
  if (process.env.NODE_ENV === 'production' && !process.env.NITRO_SHUTDOWN_DISABLED)
    for (const signal of (process.env.NITRO_SHUTDOWN_SIGNALS || 'SIGTERM SIGINT').split(' ').filter(Boolean))
      process.once(signal as NodeJS.Signals, () => liveSchliessen())
})
