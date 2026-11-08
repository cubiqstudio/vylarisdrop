import { createReadStream } from 'node:fs'
import { apkInfo, apkPfad, APK_DATEI } from '../../utils/app'

// Die Android-App (data/VylarisCloud.apk im Datenordner) als Anhang. Ohne hinterlegte Datei: 404 mit freundlichem Text.
export default defineEventHandler(async (event) => {
  const a = await apkInfo()
  if (!a.vorhanden)
    throw fehler(
      404,
      'Die App-Datei ist auf diesem Server noch nicht hinterlegt. Bitte den Betreiber, VylarisCloud.apk in den Datenordner zu legen.',
      'The app file has not been placed on this server yet. Please ask the operator to put VylarisCloud.apk into the data folder.'
    )
  setResponseHeaders(event, {
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': `attachment; filename="${APK_DATEI}"`,
    'Content-Length': String(a.groesse),
    'Cache-Control': 'no-cache'
  })
  if (event.method === 'HEAD') return ''
  return sendStream(event, createReadStream(apkPfad()))
})
