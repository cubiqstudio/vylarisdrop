<script setup lang="ts">
// Anleitungen zum Einbinden der Cloud per WebDAV mit kopierfertigen Beispielen
const props = defineProps<{ adresse: string; benutzer: string; passwort?: string; https: boolean }>()

type Plattform = 'windows' | 'macos' | 'mobil' | 'linux' | 'rclone' | 'cyberduck' | 'curl'
const wahl = ref<Plattform>('windows')
onMounted(() => {
  const ua = navigator.userAgent || ''
  wahl.value = /iPhone|iPad|Android/i.test(ua) ? 'mobil' : /Mac/i.test(ua) ? 'macos' : /Linux|X11/i.test(ua) ? 'linux' : 'windows'
})
const TABS = computed<Array<{ k: Plattform; text: string; ic: string }>>(() => [
  { k: 'windows', text: 'Windows', ic: 'monitor' },
  { k: 'macos', text: 'macOS', ic: 'laptop' },
  { k: 'mobil', text: t('iOS & Android', 'iOS & Android'), ic: 'grid' },
  { k: 'linux', text: 'Linux', ic: 'terminal' },
  { k: 'rclone', text: 'rclone', ic: 'umzug' },
  { k: 'cyberduck', text: 'Cyberduck', ic: 'server' },
  { k: 'curl', text: 'curl', ic: 'code' }
])
const PW = computed(() => props.passwort || 'APP-PASSWORT')
const url = computed(() => props.adresse)
const host = computed(() => {
  try {
    return new URL(props.adresse).host
  } catch {
    return props.adresse
  }
})
const hostname = computed(() => host.value.replace(/:\d+$/, ''))
const port = computed(() => {
  try {
    const u = new URL(props.adresse)
    return u.port || (u.protocol === 'https:' ? '443' : '80')
  } catch {
    return '443'
  }
})
const ohneProtokoll = computed(() => props.adresse.replace(/^https?:\/\//, ''))
const dav = computed(() => (props.https ? 'davs' : 'dav') + '://' + ohneProtokoll.value)
const webdav = computed(() => (props.https ? 'webdavs' : 'webdav') + '://' + ohneProtokoll.value)
const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
function wechsel(e: KeyboardEvent) {
  const i = TABS.value.findIndex((x) => x.k === wahl.value)
  const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null
  if (n == null) return
  e.preventDefault()
  wahl.value = TABS.value[(n + TABS.value.length) % TABS.value.length]!.k
  nextTick(() => document.getElementById('sa-tab-' + wahl.value)?.focus())
}
</script>

<template>
  <div class="sa">
    <div class="seg sa-tabs" role="tablist" :aria-label="t('Gerät oder Programm', 'Device or program')" @keydown="wechsel">
      <button
        v-for="x in TABS"
        :id="'sa-tab-' + x.k"
        :key="x.k"
        type="button"
        role="tab"
        :class="{ an: wahl === x.k }"
        :aria-selected="wahl === x.k"
        :tabindex="wahl === x.k ? 0 : -1"
        @click="wahl = x.k"
      >
        <Ico :n="x.ic" /> {{ x.text }}
      </button>
    </div>

    <div class="block sa-tafel" role="tabpanel" :aria-labelledby="'sa-tab-' + wahl">
      <!-- Windows -->
      <template v-if="wahl === 'windows'">
        <h3>{{ t('Netzlaufwerk in Windows', 'Network drive in Windows') }}</h3>
        <ol>
          <li>{{ t('Explorer öffnen, Rechtsklick auf „Dieser PC“ → „Netzwerklaufwerk verbinden“.', 'Open Explorer, right-click “This PC” → “Map network drive”.') }}</li>
          <li>{{ t('Ordner:', 'Folder:') }} <code class="mono">{{ url }}</code></li>
          <li>{{ t('„Verbindung mit anderen Anmeldeinformationen herstellen“ anhaken, Fertig stellen.', 'Tick “Connect using different credentials”, then Finish.') }}</li>
          <li>{{ t('Benutzername:', 'Username:') }} <code class="mono">{{ benutzer }}</code> · {{ t('Kennwort: dein App-Passwort.', 'Password: your app password.') }}</li>
        </ol>
        <p class="leise">{{ t('Oder in der Eingabeaufforderung:', 'Or from the command prompt:') }}</p>
        <VdSyncCode :code="`net use Z: ${url} /user:${benutzer} ${PW} /persistent:yes`" />
        <div v-if="!https" class="meldung meldung-warn">
          <b>{{ t('Nur HTTP:', 'HTTP only:') }}</b>
          {{ t('Windows übergibt Passwörter bei http:// nicht im Klartext und lehnt die Anmeldung ab. Richte HTTPS ein (Einstellungen → Netzwerk) oder erlaube es einmalig in der Registry (Administrator-Eingabeaufforderung), danach den Dienst neu starten:', 'Windows refuses to send passwords in clear text over http://. Set up HTTPS (Settings → Network) or allow it once in the registry (administrator prompt), then restart the service:') }}
        </div>
        <VdSyncCode v-if="!https" :code="`reg add HKLM\\SYSTEM\\CurrentControlSet\\Services\\WebClient\\Parameters /v BasicAuthLevel /t REG_DWORD /d 2 /f\nnet stop webclient && net start webclient`" />
        <p class="sehrleise">{{ t('Große Dateien: Windows begrenzt WebDAV-Dateien standardmäßig auf 50 MB. Mit diesem Befehl (Administrator) steigt die Grenze auf 4 GB:', 'Large files: Windows limits WebDAV files to 50 MB by default. This command (administrator) raises the limit to 4 GB:') }}</p>
        <VdSyncCode code="reg add HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters /v FileSizeLimitInBytes /t REG_DWORD /d 4294967295 /f" />
      </template>

      <!-- macOS -->
      <template v-else-if="wahl === 'macos'">
        <h3>{{ t('Finder (macOS)', 'Finder (macOS)') }}</h3>
        <ol>
          <li>{{ t('Im Finder: „Gehe zu“ → „Mit Server verbinden …“ (⌘K).', 'In Finder: “Go” → “Connect to Server…” (⌘K).') }}</li>
          <li>{{ t('Serveradresse:', 'Server address:') }} <code class="mono">{{ url }}</code></li>
          <li>{{ t('Als „Registrierter Benutzer“ anmelden:', 'Sign in as “Registered User”:') }} <code class="mono">{{ benutzer }}</code> · {{ t('Passwort: dein App-Passwort.', 'Password: your app password.') }}</li>
          <li>{{ t('Mit „+“ in der Server-Liste und dem Schlüsselbund merkt sich der Mac die Verbindung.', 'Use “+” in the server list and Keychain so the Mac remembers the connection.') }}</li>
        </ol>
        <p class="leise">{{ t('Oder im Terminal:', 'Or in Terminal:') }}</p>
        <VdSyncCode :code="`open ${url}\n# oder:\nmkdir -p ~/Cloud && mount_webdav -i ${url} ~/Cloud`" />
        <p class="sehrleise">{{ t('Der Finder sperrt Dateien beim Bearbeiten (LOCK) — das unterstützt die Cloud. Nur-Lesen-App-Passwörter bindet der Finder schreibgeschützt ein.', 'Finder locks files while you edit (LOCK) — the cloud supports that. Finder mounts read-only app passwords as read-only.') }}</p>
      </template>

      <!-- iOS / Android -->
      <template v-else-if="wahl === 'mobil'">
        <h3>iOS / iPadOS</h3>
        <ol>
          <li>{{ t('App „Dateien“ → „···“ (oben rechts) → „Mit Server verbinden“.', 'Files app → “···” (top right) → “Connect to Server”.') }}</li>
          <li>{{ t('Server:', 'Server:') }} <code class="mono">{{ url }}</code></li>
          <li>{{ t('„Registrierter Benutzer“:', '“Registered User”:') }} <code class="mono">{{ benutzer }}</code> · {{ t('Passwort: dein App-Passwort.', 'Password: your app password.') }}</li>
        </ol>
        <h3 class="sa-h">Android</h3>
        <p class="leise">{{ t('Android bringt keinen WebDAV-Client mit. Bewährt: Solid Explorer, Cx Datei-Explorer, FolderSync (Sync) oder Material Files. Trage dort ein:', 'Android has no built-in WebDAV client. Proven choices: Solid Explorer, Cx File Explorer, FolderSync (sync) or Material Files. Enter:') }}</p>
        <dl class="sa-felder">
          <div><dt>{{ t('Protokoll', 'Protocol') }}</dt><dd class="mono">WebDAV ({{ https ? 'HTTPS' : 'HTTP' }})</dd></div>
          <div><dt>Server / Host</dt><dd class="mono">{{ hostname }}</dd></div>
          <div><dt>Port</dt><dd class="mono">{{ port }}</dd></div>
          <div><dt>{{ t('Pfad / Remote-Ordner', 'Path / remote folder') }}</dt><dd class="mono">/dav/</dd></div>
          <div><dt>{{ t('Benutzername', 'Username') }}</dt><dd class="mono">{{ benutzer }}</dd></div>
          <div><dt>{{ t('Passwort', 'Password') }}</dt><dd>{{ t('dein App-Passwort', 'your app password') }}</dd></div>
        </dl>
        <p class="sehrleise">{{ t('FolderSync: „Konto hinzufügen“ → WebDAV, danach einen Ordnerpaar-Abgleich (z. B. Kamera-Ordner → Cloud/Fotos) einrichten. Mit einem Nur-Lesen-Passwort funktioniert nur „Download“.', 'FolderSync: “Add account” → WebDAV, then create a folder pair (e.g. camera folder → Cloud/Photos). With a read-only password only “download” works.') }}</p>
      </template>

      <!-- Linux -->
      <template v-else-if="wahl === 'linux'">
        <h3>{{ t('Dateimanager (GNOME, KDE)', 'File manager (GNOME, KDE)') }}</h3>
        <ul>
          <li>{{ t('GNOME Dateien: „Andere Orte“ → „Mit Server verbinden“:', 'GNOME Files: “Other locations” → “Connect to server”:') }} <code class="mono">{{ dav }}</code></li>
          <li>{{ t('KDE Dolphin: Adressleiste:', 'KDE Dolphin: address bar:') }} <code class="mono">{{ webdav }}</code></li>
        </ul>
        <VdSyncCode :code="`gio mount ${dav.replace('://', '://' + benutzer + '@')}`" :titel="t('Im Terminal (GVfs)', 'In the terminal (GVfs)')" />
        <h3 class="sa-h">davfs2</h3>
        <VdSyncCode
          :code="`sudo apt install davfs2\nsudo mkdir -p /mnt/cloud\necho '${url} ${benutzer} ${PW}' | sudo tee -a /etc/davfs2/secrets\nsudo chmod 600 /etc/davfs2/secrets\nsudo mount -t davfs ${url} /mnt/cloud`"
          :titel="t('Einmalig einrichten und einbinden', 'Set up once and mount')"
        />
        <VdSyncCode
          :code="`${url} /mnt/cloud davfs _netdev,noauto,user,rw 0 0`"
          :titel="t('Optional: /etc/fstab (Einbinden mit „mount /mnt/cloud“)', 'Optional: /etc/fstab (mount with “mount /mnt/cloud”)')"
        />
        <p class="sehrleise">{{ t('Große Dateien: in /etc/davfs2/davfs2.conf „cache_size“ und „use_locks 1“ prüfen; davfs2 puffert Uploads zuerst lokal.', 'Large files: check “cache_size” and “use_locks 1” in /etc/davfs2/davfs2.conf; davfs2 buffers uploads locally first.') }}</p>
      </template>

      <!-- rclone -->
      <template v-else-if="wahl === 'rclone'">
        <h3>rclone</h3>
        <p class="leise">{{ t('Ideal für Backups und Abgleich per Skript. Einmal einrichten:', 'Ideal for backups and scripted sync. Set up once:') }}</p>
        <VdSyncCode :code="`rclone config create vylaris webdav url ${url} vendor other user ${benutzer} pass $(rclone obscure ${sq(PW)})`" :titel="t('Fertig in einer Zeile', 'Done in one line')" />
        <VdSyncCode
          :code="`[vylaris]\ntype = webdav\nurl = ${url}\nvendor = other\nuser = ${benutzer}\npass = <rclone obscure '${PW}'>`"
          :titel="t('… oder in ~/.config/rclone/rclone.conf (pass mit „rclone obscure“ erzeugen)', '… or in ~/.config/rclone/rclone.conf (create pass with “rclone obscure”)')"
        />
        <VdSyncCode
          :code="`rclone lsd vylaris:                                  # Ordner auflisten\nrclone copy ~/Fotos vylaris:Fotos --progress          # hochladen\nrclone sync ~/Dokumente vylaris:Dokumente --progress  # Spiegel (löscht im Ziel!)\nrclone check ~/Dokumente vylaris:Dokumente            # vergleichen\nrclone mount vylaris: ~/Cloud --vfs-cache-mode writes # als Laufwerk`"
          :titel="t('Die wichtigsten Befehle', 'The most useful commands')"
        />
        <p class="sehrleise">{{ t('Gelöschte Dateien landen im Papierkorb der Cloud (30 Tage). Team-Ordner findest du unter „Team-Ordner/<Teamname>“.', 'Deleted files go to the cloud trash (30 days). Team folders live under “Team-Ordner/<team name>”.') }}</p>
      </template>

      <!-- Cyberduck -->
      <template v-else-if="wahl === 'cyberduck'">
        <h3>Cyberduck / Mountain Duck</h3>
        <ol>
          <li>{{ t('„Neue Verbindung“ → Auswahl oben:', '“Open Connection” → choose at the top:') }} <b>WebDAV ({{ https ? 'HTTPS' : 'HTTP' }})</b></li>
        </ol>
        <dl class="sa-felder">
          <div><dt>Server</dt><dd class="mono">{{ hostname }}</dd></div>
          <div><dt>Port</dt><dd class="mono">{{ port }}</dd></div>
          <div><dt>{{ t('Benutzername', 'Username') }}</dt><dd class="mono">{{ benutzer }}</dd></div>
          <div><dt>{{ t('Passwort', 'Password') }}</dt><dd>{{ t('dein App-Passwort', 'your app password') }}</dd></div>
          <div><dt>{{ t('Weitere Optionen → Pfad', 'More options → Path') }}</dt><dd class="mono">/dav/</dd></div>
        </dl>
        <p class="sehrleise">{{ t('Cyberduck speichert die Anmeldung im Schlüsselbund. Mit Mountain Duck erscheint die Cloud als Laufwerk.', 'Cyberduck stores the login in your keychain. With Mountain Duck the cloud shows up as a drive.') }}</p>
      </template>

      <!-- curl -->
      <template v-else>
        <h3>curl</h3>
        <p class="leise">{{ t('Für Skripte und schnelle Tests:', 'For scripts and quick tests:') }}</p>
        <VdSyncCode
          :code="`# Inhalt auflisten\ncurl -u ${benutzer}:${PW} -X PROPFIND -H 'Depth: 1' ${url}\n\n# Datei hochladen\ncurl -u ${benutzer}:${PW} -T bericht.pdf ${url}Dokumente/bericht.pdf\n\n# Datei herunterladen\ncurl -u ${benutzer}:${PW} -O ${url}Dokumente/bericht.pdf\n\n# Ordner anlegen / Datei verschieben / löschen (Papierkorb)\ncurl -u ${benutzer}:${PW} -X MKCOL ${url}Neu/\ncurl -u ${benutzer}:${PW} -X MOVE -H 'Destination: ${url}Neu/b.pdf' ${url}Dokumente/bericht.pdf\ncurl -u ${benutzer}:${PW} -X DELETE ${url}Neu/b.pdf`"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.sa-tabs {
  max-width: 100%;
  margin-bottom: 12px;
}
.sa-tafel {
  min-width: 0;
}
.sa-tafel h3 {
  font-size: 16px;
  margin-bottom: 8px;
}
.sa-tafel .sa-h {
  margin-top: 18px;
}
.sa-tafel ol,
.sa-tafel ul {
  margin: 0 0 10px;
  padding-left: 22px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.sa-tafel p {
  margin: 8px 0;
}
.sa-tafel code.mono {
  font-size: 12.5px;
  background: var(--flaeche2);
  border-radius: 6px;
  padding: 1px 6px;
  word-break: break-all;
}
.sa-felder {
  margin: 8px 0 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px;
}
.sa-felder > div {
  background: var(--bg);
  border: 1px solid var(--linie);
  border-radius: 10px;
  padding: 8px 12px;
  min-width: 0;
}
.sa-felder dt {
  font-size: 11.5px;
  color: var(--text3);
  font-weight: 600;
}
.sa-felder dd {
  margin: 2px 0 0;
  font-size: 13px;
  word-break: break-all;
}
.sa-tafel .meldung {
  margin: 10px 0;
}
@media (max-width: 640px) {
  .sa-tabs {
    display: flex;
    overflow-x: auto;
    flex-wrap: nowrap;
  }
  .sa-tabs button {
    flex-shrink: 0;
  }
}
</style>
