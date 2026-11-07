<script setup lang="ts">
// Kurze Anleitung: Zugang für VylarisCloud bei Hetzner, auf dem NAS oder auf einem eigenen Server anlegen
const wahl = ref<'hetzner' | 'nas' | 'eigen'>('hetzner')
const tabs = computed<Array<{ k: 'hetzner' | 'nas' | 'eigen'; text: string }>>(() => [
  { k: 'hetzner', text: 'Hetzner' },
  { k: 'nas', text: 'NAS' },
  { k: 'eigen', text: t('Eigener Server', 'Own server') }
])
const kopiert = ref('')
async function kopier(text: string, k: string) {
  if (await kopieren(text)) {
    kopiert.value = k
    setTimeout(() => {
      if (kopiert.value === k) kopiert.value = ''
    }, 1400)
  }
}
const CODE = {
  hetznerKey: `ssh-keygen -t ed25519 -N "" -C vylariscloud -f vylariscloud_box
cat vylariscloud_box.pub | ssh -p 23 u123456@u123456.your-storagebox.de install-ssh-key`,
  hetznerFp: `ssh-keyscan -p 23 -t ed25519 u123456.your-storagebox.de 2>/dev/null | ssh-keygen -lf -`,
  nasFp: `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`,
  eigenUser: `sudo adduser --disabled-password --gecos "" vylariscloud
sudo mkdir -p /srv/vylariscloud && sudo chown vylariscloud: /srv/vylariscloud`,
  eigenKey: `ssh-keygen -t ed25519 -N "" -C vylariscloud -f vylariscloud_key
ssh-copy-id -i vylariscloud_key.pub vylariscloud@speicher.example.org`,
  eigenFp: `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`
}
</script>

<template>
  <section class="zh block" aria-labelledby="zh-titel">
    <div class="reihe zw">
      <h3 id="zh-titel"><Ico n="terminal" /> {{ t('So legst du einen Zugang an', 'How to create an access') }}</h3>
      <div class="seg" role="tablist" :aria-label="t('Anbieter', 'Provider')">
        <button v-for="p in tabs" :key="p.k" type="button" role="tab" :aria-selected="wahl === p.k" :class="{ an: wahl === p.k }" @click="wahl = p.k">{{ p.text }}</button>
      </div>
    </div>
    <p class="leise zh-intro">
      {{
        t(
          'VylarisCloud meldet sich per SFTP an und legt im Zielordner den Ordner „dateien“ an. Am besten richtest du dafür einen eigenen Benutzer (bei Hetzner: ein Unterkonto) ein, der nur diesen Ordner sehen darf.',
          'VylarisCloud signs in via SFTP and creates a “dateien” folder in the target folder. Best create a dedicated user for it (Hetzner: a sub-account) that can only see this folder.'
        )
      }}
    </p>

    <ol v-if="wahl === 'hetzner'" class="zh-schritte">
      <li>{{ t('In der Hetzner-Konsole die Storage Box öffnen und unter „Einstellungen“ „SSH-Unterstützung“ und „Externe Erreichbarkeit“ einschalten.', 'Open the Storage Box in the Hetzner console and enable “SSH support” and “External reachability” under “Settings”.') }}</li>
      <li>{{ t('Empfohlen: ein Unterkonto „vylariscloud“ mit eigenem Verzeichnis anlegen. Benutzername und Host stehen danach in der Konsole (z. B. u123456-sub1 @ u123456.your-storagebox.de).', 'Recommended: create a sub-account “vylariscloud” with its own directory. User name and host are shown in the console afterwards (e.g. u123456-sub1 @ u123456.your-storagebox.de).') }}</li>
      <li>
        {{ t('Anmeldung per Passwort (Konsole) — oder besser per Schlüssel:', 'Sign in with the password (console) — or better with a key:') }}
        <div class="zh-code"><pre>{{ CODE.hetznerKey }}</pre><button type="button" class="knopf klein" @click="kopier(CODE.hetznerKey, 'hk')"><Ico :n="kopiert === 'hk' ? 'check' : 'copy'" /> {{ t('Kopieren', 'Copy') }}</button></div>
        {{ t('Der Inhalt von „vylariscloud_box“ (privat) kommt in das Feld „Privater Schlüssel“.', 'The content of “vylariscloud_box” (private) goes into the “Private key” field.') }}
      </li>
      <li>
        {{ t('Port 23 verwenden. Den Fingerabdruck des Servers kannst du vorab selbst prüfen:', 'Use port 23. You can check the server fingerprint yourself beforehand:') }}
        <div class="zh-code"><pre>{{ CODE.hetznerFp }}</pre><button type="button" class="knopf klein" @click="kopier(CODE.hetznerFp, 'hf')"><Ico :n="kopiert === 'hf' ? 'check' : 'copy'" /> {{ t('Kopieren', 'Copy') }}</button></div>
      </li>
    </ol>

    <ol v-else-if="wahl === 'nas'" class="zh-schritte">
      <li>{{ t('Synology: „Systemsteuerung → Terminal & SNMP → SFTP-Dienst aktivieren“ (Port 22 oder dein eigener). QNAP: „Netzwerk- & Dateidienste → Telnet/SSH → SFTP erlauben“.', 'Synology: “Control Panel → Terminal & SNMP → enable SFTP service” (port 22 or your own). QNAP: “Network & File Services → Telnet/SSH → allow SFTP”.') }}</li>
      <li>{{ t('Einen Benutzer „vylariscloud“ anlegen, ihm den Zugriff auf den SFTP-Dienst und Lese-/Schreibrechte auf einen freigegebenen Ordner (z. B. „vylariscloud“) geben.', 'Create a user “vylariscloud”, give it access to the SFTP service and read/write rights on a shared folder (e.g. “vylariscloud”).') }}</li>
      <li>{{ t('Als Zielordner den Pfad eintragen, den der Benutzer per SFTP sieht — meist /vylariscloud. Die Adresse im Heimnetz (z. B. 192.168.1.20) ist erlaubt; localhost und 169.254.x.x nicht.', 'Enter the path the user sees via SFTP as target folder — usually /vylariscloud. A home-network address (e.g. 192.168.1.20) is allowed; localhost and 169.254.x.x are not.') }}</li>
      <li>
        {{ t('Den Fingerabdruck zeigt dir der Assistent beim ersten Test; vergleichen kannst du ihn auf dem NAS (per SSH):', 'The wizard shows you the fingerprint on the first test; you can compare it on the NAS (via SSH):') }}
        <div class="zh-code"><pre>{{ CODE.nasFp }}</pre><button type="button" class="knopf klein" @click="kopier(CODE.nasFp, 'nf')"><Ico :n="kopiert === 'nf' ? 'check' : 'copy'" /> {{ t('Kopieren', 'Copy') }}</button></div>
      </li>
    </ol>

    <ol v-else class="zh-schritte">
      <li>
        {{ t('Auf dem Server einen Benutzer und einen Ordner anlegen:', 'Create a user and a folder on the server:') }}
        <div class="zh-code"><pre>{{ CODE.eigenUser }}</pre><button type="button" class="knopf klein" @click="kopier(CODE.eigenUser, 'eu')"><Ico :n="kopiert === 'eu' ? 'check' : 'copy'" /> {{ t('Kopieren', 'Copy') }}</button></div>
      </li>
      <li>
        {{ t('Schlüsselpaar erzeugen (auf deinem Rechner) und den öffentlichen Teil auf dem Server hinterlegen:', 'Create a key pair (on your computer) and install the public part on the server:') }}
        <div class="zh-code"><pre>{{ CODE.eigenKey }}</pre><button type="button" class="knopf klein" @click="kopier(CODE.eigenKey, 'ek')"><Ico :n="kopiert === 'ek' ? 'check' : 'copy'" /> {{ t('Kopieren', 'Copy') }}</button></div>
        {{ t('Die Datei „vylariscloud_key“ (privat) kommt in das Feld „Privater Schlüssel“.', 'The file “vylariscloud_key” (private) goes into the “Private key” field.') }}
      </li>
      <li>
        {{ t('Fingerabdruck des Servers (zum Vergleich mit der Anzeige im Assistenten):', 'Server fingerprint (to compare with what the wizard shows):') }}
        <div class="zh-code"><pre>{{ CODE.eigenFp }}</pre><button type="button" class="knopf klein" @click="kopier(CODE.eigenFp, 'ef')"><Ico :n="kopiert === 'ef' ? 'check' : 'copy'" /> {{ t('Kopieren', 'Copy') }}</button></div>
      </li>
      <li>{{ t('Optional härten: den Benutzer in /etc/ssh/sshd_config per „Match User vylariscloud“ mit „ForceCommand internal-sftp“ und „ChrootDirectory“ auf SFTP und den Ordner beschränken.', 'Optional hardening: restrict the user to SFTP and the folder in /etc/ssh/sshd_config with “Match User vylariscloud”, “ForceCommand internal-sftp” and “ChrootDirectory”.') }}</li>
    </ol>
  </section>
</template>

<style scoped>
.zh h3 {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0;
}
.zh h3 svg {
  width: 16px;
  height: 16px;
  color: var(--a);
}
.zh-intro {
  margin: 10px 0 4px;
  font-size: 13px;
  line-height: 1.55;
}
.zh-schritte {
  margin: 12px 0 0;
  padding-left: 20px;
  display: grid;
  gap: 12px;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--text2);
}
.zh-code {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  background: var(--bg);
  border: 1px solid var(--linie);
  border-radius: 10px;
  padding: 8px 8px 8px 12px;
  margin: 6px 0;
}
.zh-code pre {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-family: var(--f-mono);
  font-size: 12px;
  line-height: 1.55;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-all;
}
@media (max-width: 560px) {
  .zh-code {
    flex-direction: column;
  }
}
</style>
