import { q, ereignis } from '../../utils/db'
import { clientIp, neuesToken, requireUser } from '../../utils/auth'
import { basisUrl } from '../../utils/dateien'
import { getDesign } from '../../utils/settings'

export default defineEventHandler(async (event) => {
  const u = await requireUser(event)
  const tool = String(getRouterParam(event, 'tool') || '')
  if (!['sharex', 'flameshot', 'curl'].includes(tool)) throw fehler(404, 'Unbekanntes Werkzeug.', 'Unknown tool.')
  const b = await readBody(event).catch(() => ({}))
  const basis = await basisUrl(event)
  const name = (await getDesign()).name || 'VylarisCloud'
  const t = neuesToken()
  const label = { sharex: 'ShareX', flameshot: 'Flameshot', curl: 'curl / Skript' }[tool]!
  await q('INSERT INTO upload_tokens (user_id, name, prefix, key_hash) VALUES ($1, $2, $3, $4)', [
    u.id,
    label,
    t.prefix,
    t.hash
  ])
  await ereignis('token_created', u.id, { name: label }, clientIp(event))
  const kopf: Record<string, string> = { Authorization: t.klar }
  if (typeof b?.ablauf === 'string' && /^(\d{1,4}[mhdw]|)$/.test(b.ablauf) && b.ablauf) kopf['x-vd-expires'] = b.ablauf
  if (typeof b?.stil === 'string' && ['zufall', 'woerter', 'datum', 'original', 'unsichtbar', 'uuid'].includes(b.stil))
    kopf['x-vd-name-style'] = b.stil

  if (tool === 'sharex') {
    const sxcu = {
      Version: '17.0.0',
      Name: `${name} (${new URL(basis).host})`,
      DestinationType: 'ImageUploader, TextUploader, FileUploader',
      RequestMethod: 'POST',
      RequestURL: `${basis}/api/upload`,
      Headers: kopf,
      Body: 'MultipartFormData',
      FileFormName: 'file',
      URL: '{json:url}',
      ThumbnailURL: '{json:raw}',
      ErrorMessage: '{json:message}'
    }
    return {
      dateiname: `${name.replace(/[^A-Za-z0-9]+/g, '-')}.sxcu`,
      inhalt: JSON.stringify(sxcu, null, 2),
      typ: 'application/json'
    }
  }
  const h = Object.entries(kopf)
    .map(([k, v]) => `-H '${k}: ${v}'`)
    .join(' ')
  if (tool === 'curl')
    return {
      inhalt: `curl -sf ${h} -F 'file=@DATEI' ${basis}/api/upload | sed -E 's/.*"url":"([^"]+)".*/\\1/'`,
      typ: 'text/plain'
    }
  const skript = `#!/usr/bin/env bash
# ${name} — Flameshot: Bereich aufnehmen, hochladen, Link in die Zwischenablage.
# Ausfuehrbar machen (chmod +x) und z. B. auf eine Tastenkombination legen.
set -euo pipefail
datei="$(mktemp --suffix=.png)"
trap 'rm -f "$datei"' EXIT
flameshot gui --raw > "$datei"
[ -s "$datei" ] || exit 0
antwort="$(curl -sf ${h} -F "file=@$datei" ${basis}/api/upload)"
link="$(printf '%s' "$antwort" | sed -E 's/.*"url":"([^"]+)".*/\\1/')"
if command -v wl-copy >/dev/null; then printf '%s' "$link" | wl-copy; elif command -v xclip >/dev/null; then printf '%s' "$link" | xclip -selection clipboard; fi
command -v notify-send >/dev/null && notify-send "${name}" "Link kopiert: $link" || echo "$link"
`
  return { dateiname: 'vylariscloud-flameshot.sh', inhalt: skript, typ: 'text/x-shellscript' }
})
