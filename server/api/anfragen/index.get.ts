import { q } from '../../utils/db'
import { requireUser } from '../../utils/auth'
import { basisUrl } from '../../utils/dateien'
import { anfrageOffen, type Anfrage } from '../../utils/anfragen'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const basis = await basisUrl(event)
  const zeilen = await q<Anfrage & { ordner: string | null }>(
    `SELECT a.*, o.name AS ordner FROM anfragen a LEFT JOIN folders o ON o.id = a.folder_id WHERE a.user_id = $1 ORDER BY a.created_at DESC`,
    [u.id]
  )
  return {
    anfragen: zeilen.map((a) => ({
      id: a.id,
      titel: a.titel,
      nachricht: a.nachricht,
      folder_id: a.folder_id,
      ordner: a.ordner,
      max_bytes: a.max_bytes != null ? Number(a.max_bytes) : null,
      max_dateien: a.max_dateien,
      laeuft_ab: a.laeuft_ab,
      passwort: !!a.password_hash,
      aktiv: a.aktiv,
      anzahl: a.anzahl,
      created_at: a.created_at,
      aufnahme: a.aufnahme,
      aufnahme_min: a.aufnahme_min,
      link: `${basis}/a/${a.token}`,
      ...anfrageOffen(a)
    }))
  }
})
