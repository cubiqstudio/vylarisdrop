import { requireSetupToken } from '../../utils/setup'
import { webserverInfoAnfragen, webserverStand } from '../../utils/webserver'

export default defineEventHandler(async (event) => {
  const b = await readBody(event)
  await requireSetupToken(event, b?.token, 'setup-webserver', 600)
  const neu = b?.pruefen === true ? await webserverInfoAnfragen() : false
  return { ...(await webserverStand()), pruefungAngefragt: neu }
})
