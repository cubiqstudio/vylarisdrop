import { requireSetupToken } from '../../utils/setup'
import { istDomain, pruefeDomain } from '../../utils/netz'

export default defineEventHandler(async (event) => {
  const b = await readBody(event)
  await requireSetupToken(event, b?.token)
  const domain = String(b?.domain || '')
    .trim()
    .toLowerCase()
  if (!istDomain(domain))
    throw fehler(
      400,
      'Bitte gib eine gültige Domain ein, z. B. cloud.meinefirma.de',
      'Please enter a valid domain, e.g. cloud.mycompany.com'
    )
  return await pruefeDomain(domain)
})
