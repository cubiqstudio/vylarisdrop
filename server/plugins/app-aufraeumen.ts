import { appAufraeumen } from '../utils/app'

// Kopplungscodes der Android-App: abgelaufene und benutzte regelmaessig entfernen
export default defineNitroPlugin(() => {
  const lauf = () => void appAufraeumen().catch(() => {})
  setTimeout(lauf, 30_000).unref?.()
  setInterval(lauf, 30 * 60_000).unref?.()
})
