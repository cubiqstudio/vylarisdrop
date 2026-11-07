import { requireAdmin } from '../../utils/auth'
import { getAuslieferung, getDesign, getMedien, getNet, getTraffic, getUploads, sLang } from '../../utils/settings'
import { ffmpegVorhanden } from '../../utils/medien'
import { getMail } from '../../utils/benachrichtigen'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const m = await getMail()
  const mail = m ? { host: m.host, port: m.port, sicher: m.sicher, user: m.user, von: m.von, hatPass: !!m.pass } : null
  return {
    mail,
    design: await getDesign(),
    uploads: await getUploads(),
    medien: await getMedien(),
    auslieferung: await getAuslieferung(),
    traffic: await getTraffic(),
    ffmpeg: await ffmpegVorhanden(),
    net: await getNet(),
    lang: sLang()
  }
})
