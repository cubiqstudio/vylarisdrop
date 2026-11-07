import { q1 } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { basisUrl } from '../../utils/dateien'
import { freierPlatz, kontingentVon } from '../../utils/hochladen'

// Angaben fuer die Seite /sync: WebDAV-Adresse, Benutzername und Speicher des Kontos
export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const basis = await basisUrl(event)
  const url = new URL(basis)
  const belegt = await q1<{ s: string }>('SELECT coalesce(sum(size), 0) AS s FROM files WHERE user_id = $1', [u.id])
  const kontingent = await kontingentVon(u)
  const frei = await freierPlatz(u)
  return {
    adresse: `${basis}/dav/`,
    host: url.host,
    https: url.protocol === 'https:',
    lokal: /^(localhost|127\.|\[::1\])/.test(url.hostname),
    benutzer: u.username,
    belegt: Number(belegt?.s || 0),
    kontingent,
    frei: Number.isFinite(frei) ? frei : null
  }
})
