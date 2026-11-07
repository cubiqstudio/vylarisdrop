<script setup lang="ts">
const route = useRoute()
const id = computed(() => Number(route.params.id))
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const tage = ref(30)
const { data, refresh, error } = await (useFetch as any)(() => `/api/speicher/boxen/${id.value}?tage=${tage.value}`, {
  key: `box-${id.value}`,
  watch: [tage]
})
const box = computed<any>(() => data.value?.box)
const unter = computed<any[]>(() => data.value?.unterkonten || [])
const a = computed<any>(() => data.value?.adresse || {})
useHead({ title: () => box.value?.name || t('Storage-Box', 'Storage box') })
const proz = computed(() =>
  box.value?.kontingent ? Math.min(100, (box.value.belegt / box.value.kontingent) * 100) : 0
)
const stufe = computed(() => (proz.value >= 99.5 ? 'voll' : proz.value >= 80 ? 'warn' : ''))
const einmal = ref<{ titel: string; zeilen: Array<{ label: string; wert: string }> } | null>(null)

async function aendern(body: Record<string, unknown>, meldung = t('Gespeichert', 'Saved')) {
  try {
    await api(`/api/speicher/boxen/${id.value}`, { method: 'PATCH', body })
    await refresh()
    ok(meldung)
    return true
  } catch (e: any) {
    fehler(e.message)
    return false
  }
}
const neuName = ref<string | null>(null)
async function umbenennen() {
  if (await aendern({ name: neuName.value })) neuName.value = null
}
const kont = ref<{ wert: number; e: string } | null>(null)
watch(
  box,
  (b) => {
    if (b && !kont.value) {
      const gb = b.kontingent / 1024 ** 3
      kont.value =
        gb >= 1024 && gb % 1024 === 0 ? { wert: gb / 1024, e: 'TB' } : { wert: Math.round(gb * 100) / 100, e: 'GB' }
    }
  },
  { immediate: true }
)
async function kontSpeichern() {
  await aendern({ kontingentGb: Number(kont.value!.wert) * (kont.value!.e === 'TB' ? 1024 : 1) })
}
function passwortNeu() {
  bestaetigen(
    t('Neues Passwort setzen?', 'Set a new password?'),
    t(
      'Das bisherige Passwort gilt sofort nicht mehr — Programme, die damit verbunden sind, brauchen das neue.',
      'The current password stops working immediately — programs connected with it need the new one.'
    ),
    t('Neu setzen', 'Reset'),
    async () => {
      try {
        const r = await api(`/api/speicher/boxen/${id.value}/passwort`, { method: 'POST' })
        einmal.value = {
          titel: t('Neues Passwort', 'New password'),
          zeilen: [
            { label: t('Benutzer', 'User'), wert: box.value.kennung },
            { label: t('Passwort', 'Password'), wert: r.passwort }
          ]
        }
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}
const ssh = ref<string | null>(null)
async function sshSpeichern() {
  if (
    await aendern({
      sshKeys: ssh
        .value!.split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    })
  )
    ssh.value = null
}
const neuUnter = ref<any>(null)
const bearbeite = ref<any>(null)
const schickt = ref(false)
async function unterAnlegen() {
  schickt.value = true
  try {
    const r = await api(`/api/speicher/boxen/${id.value}/unterkonten`, { method: 'POST', body: neuUnter.value })
    neuUnter.value = null
    await refresh()
    einmal.value = {
      titel: t('Unterkonto angelegt', 'Sub-account created'),
      zeilen: [
        { label: t('Server', 'Server'), wert: a.value.host },
        { label: 'SFTP-Port', wert: String(a.value.sftpPort) },
        { label: t('Benutzer', 'User'), wert: r.konto.login },
        { label: t('Passwort', 'Password'), wert: r.passwort },
        { label: t('Ordner', 'Folder'), wert: `/${r.konto.ordner}` }
      ]
    }
  } catch (e: any) {
    fehler(e.message)
  } finally {
    schickt.value = false
  }
}
async function unterSpeichern() {
  const b = bearbeite.value
  try {
    await api(`/api/speicher/boxen/${id.value}/unterkonten/${b.id}`, {
      method: 'PATCH',
      body: {
        schreiben: b.schreiben,
        notiz: b.notiz,
        sshKeys: String(b.ssh || '')
          .split(/\r?\n/)
          .map((s: string) => s.trim())
          .filter(Boolean)
      }
    })
    bearbeite.value = null
    await refresh()
    ok(t('Gespeichert', 'Saved'))
  } catch (e: any) {
    fehler(e.message)
  }
}
function unterPasswort(u: any) {
  bestaetigen(
    t('Neues Passwort für das Unterkonto?', 'New password for the sub-account?'),
    t(
      `${u.login}: das bisherige Passwort gilt sofort nicht mehr.`,
      `${u.login}: the current password stops working immediately.`
    ),
    t('Neu setzen', 'Reset'),
    async () => {
      try {
        const r = await api(`/api/speicher/boxen/${id.value}/unterkonten/${u.id}`, {
          method: 'PATCH',
          body: { passwort: true }
        })
        einmal.value = {
          titel: t('Neues Passwort', 'New password'),
          zeilen: [
            { label: t('Benutzer', 'User'), wert: u.login },
            { label: t('Passwort', 'Password'), wert: r.passwort }
          ]
        }
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}
function unterLoeschen(u: any) {
  bestaetigen(
    t('Unterkonto löschen?', 'Delete sub-account?'),
    t(
      `${u.login} kann sich danach nicht mehr anmelden. Die Dateien in /${u.ordner} bleiben in der Box.`,
      `${u.login} can no longer sign in. The files in /${u.ordner} stay in the box.`
    ),
    t('Löschen', 'Delete'),
    async () => {
      try {
        await api(`/api/speicher/boxen/${id.value}/unterkonten/${u.id}`, { method: 'DELETE' })
        await refresh()
        ok(t('Gelöscht', 'Deleted'))
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}
function loeschen() {
  bestaetigen(
    t('Storage-Box löschen?', 'Delete storage box?'),
    t(
      `„${box.value.name}“ wird mit allen ${zahl(box.value.dateien)} Dateien (${groesse(box.value.belegt)}) und allen Unterkonten endgültig gelöscht. Das lässt sich nicht rückgängig machen.`,
      `“${box.value.name}” is deleted permanently with all ${zahl(box.value.dateien)} files (${groesse(box.value.belegt)}) and all sub-accounts. This cannot be undone.`
    ),
    t('Endgültig löschen', 'Delete permanently'),
    async () => {
      try {
        await api(`/api/speicher/boxen/${id.value}`, { method: 'DELETE' })
        ok(t('Box gelöscht', 'Box deleted'))
        await navigateTo('/speicher')
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}

const bsp = ref<'sftp' | 'rclone' | 'windows' | 'macos'>('sftp')
const beispiel = computed(() => {
  const u = box.value?.kennung || 'vd000000',
    h = a.value.host || 'cloud.example.com',
    p = a.value.sftpPort || 2222,
    w = a.value.webdav || ''
  return {
    sftp: `# ${t('Verbinden', 'Connect')}\nsftp -P ${p} ${u}@${h}\n\n# ${t('Datei hochladen', 'Upload a file')}\nscp -P ${p} backup.tar.gz ${u}@${h}:/`,
    rclone: `rclone config create meinebox sftp \\\n  host=${h} port=${p} user=${u} pass=$(rclone obscure '${t('PASSWORT', 'PASSWORD')}')\n\nrclone sync /srv/daten meinebox:/daten --progress`,
    windows: `# ${t('Explorer → „Netzlaufwerk verbinden“, Ordner:', 'Explorer → “Map network drive”, folder:')}\n${w}\n\n# ${t('oder in der Eingabeaufforderung', 'or in the command prompt')}\nnet use Z: ${w} /user:${u} *`,
    macos: `# ${t('Finder → Gehe zu → Mit Server verbinden (⌘K)', 'Finder → Go → Connect to Server (⌘K)')}\n${w}\n# ${t('Benutzer', 'User')}: ${u}`
  }[bsp.value]
})
const bspKopiert = ref(false)
async function bspKopieren() {
  if (await kopieren(beispiel.value)) {
    bspKopiert.value = true
    setTimeout(() => {
      bspKopiert.value = false
    }, 1400)
  }
}
const vorher2 = (z: string | null) => (z ? vorher(z) : t('noch nie', 'never'))
</script>

<template>
  <div class="detail">
    <div v-if="error || !box" class="leer-hinweis"><h3>{{ t('Box nicht gefunden', 'Box not found') }}</h3><NuxtLink to="/speicher" class="knopf">{{ t('Zur Übersicht', 'To the overview') }}</NuxtLink></div>
    <template v-else>
      <NuxtLink to="/speicher" class="zurueck"><Ico n="left" /> {{ t('Speicher', 'Storage') }}</NuxtLink>
      <div class="detail-kopf rein">
        <span class="sym"><Ico n="box" /></span>
        <div class="titel"><h1>{{ box.name }}</h1><div class="unter"><span class="mono">{{ box.kennung }}</span><span>· {{ t('angelegt am', 'created on') }} {{ datum(box.angelegt) }}</span><span v-if="box.besitzer">· {{ box.besitzer }}</span></div></div>
        <button type="button" class="knopf" @click="neuName = box.name"><Ico n="edit" /> {{ t('Umbenennen', 'Rename') }}</button>
      </div>
      <div class="raster">
        <div>
          <section class="karte rein">
            <h3><Ico n="gauge" /> {{ t('Belegung', 'Usage') }}
              <span class="seg rechts"><button v-for="z in [7, 30, 90]" :key="z" type="button" :class="{ an: tage === z }" @click="tage = z">{{ z }} {{ t('T', 'd') }}</button></span></h3>
            <div class="bel-gross"><b>{{ groesse(box.belegt) }}</b><span>{{ t('von', 'of') }} {{ groesse(box.kontingent) }}</span><em>{{ zahl(box.dateien) }} {{ t('Dateien', 'files') }} · {{ zahl(proz, 0) }} %</em></div>
            <div class="meter" role="meter" :aria-valuenow="Math.round(proz)" aria-valuemin="0" aria-valuemax="100"><i :class="stufe" :style="{ width: proz + '%' }"></i></div>
            <p v-if="stufe === 'voll'" class="meldung meldung-fehler voll-hinweis">{{ t('Das Kontingent ist voll: neue Dateien werden abgelehnt. Lösche etwas oder erhöhe das Kontingent.', 'The quota is full: new files are rejected. Delete something or raise the quota.') }}</p>
            <VdLinie class="verlauf" :punkte="data.verlauf" :format="groesse" ausschnitt :hoehe="140" :leer-text="t('Noch kein Verlauf — VylarisCloud misst jede Stunde.', 'No history yet — VylarisCloud measures every hour.')" />
          </section>

          <section class="karte rein">
            <h3><Ico n="users" /> {{ t('Unterkonten', 'Sub-accounts') }} <button type="button" class="knopf klein rechts" @click="neuUnter = { ordner: '', schreiben: true, notiz: '' }"><Ico n="plus" /> {{ t('Unterkonto', 'Sub-account') }}</button></h3>
            <p class="sehrleise erkl">{{ t('Eigener Login mit eigenem Ordner — etwa für ein Backup-Programm oder eine Kollegin. Alle teilen sich das Kontingent der Box.', 'Own login with its own folder — e.g. for a backup program or a colleague. All share the quota of the box.') }}</p>
            <div v-if="unter.length" class="tab-wrap"><table class="tab">
              <thead><tr><th>Login</th><th>{{ t('Ordner', 'Folder') }}</th><th>{{ t('Rechte', 'Rights') }}</th><th>{{ t('Zuletzt', 'Last') }}</th><th><span class="versteckt">{{ t('Aktionen', 'Actions') }}</span></th></tr></thead>
              <tbody><tr v-for="u in unter" :key="u.id">
                <td><code>{{ u.login }}</code><small v-if="u.notiz">{{ u.notiz }}</small></td><td><code>/{{ u.ordner }}</code></td>
                <td><span :class="['chip', u.schreiben ? 'info' : 'neutral']"><Ico :n="u.schreiben ? 'edit' : 'eye'" /> {{ u.schreiben ? t('Lesen + Schreiben', 'Read + write') : t('Nur lesen', 'Read only') }}</span></td>
                <td class="sehrleise">{{ vorher2(u.zuletzt) }}</td>
                <td class="aktionen">
                  <button type="button" class="knopf nur-icon" :title="t('Bearbeiten', 'Edit')" :aria-label="t('Bearbeiten', 'Edit')" @click="bearbeite = { ...u, ssh: (u.sshKeys || []).join('\n') }"><Ico n="edit" /></button>
                  <button type="button" class="knopf nur-icon" :title="t('Neues Passwort', 'New password')" :aria-label="t('Neues Passwort', 'New password')" @click="unterPasswort(u)"><Ico n="key" /></button>
                  <button type="button" class="knopf nur-icon" :title="t('Löschen', 'Delete')" :aria-label="t('Löschen', 'Delete')" @click="unterLoeschen(u)"><Ico n="trash" /></button>
                </td>
              </tr></tbody>
            </table></div>
            <p v-else class="sehrleise klein">{{ t('Noch keine Unterkonten.', 'No sub-accounts yet.') }}</p>
          </section>

          <section class="karte rein">
            <h3><Ico n="terminal" /> {{ t('Verbinden', 'Connect') }}</h3>
            <div class="seg bsp-wahl"><button v-for="b in (['sftp', 'rclone', 'windows', 'macos'] as const)" :key="b" type="button" :class="{ an: bsp === b }" @click="bsp = b">{{ { sftp: 'sftp / scp', rclone: 'rclone', windows: 'Windows', macos: 'macOS' }[b] }}</button></div>
            <div class="cmd-box"><pre class="cmd">{{ beispiel }}</pre><button type="button" class="kopier-ecke" :aria-label="t('Kopieren', 'Copy')" @click="bspKopieren"><Ico :n="bspKopiert ? 'check' : 'copy'" /></button></div>
            <p v-if="!box.webdav && (bsp === 'windows' || bsp === 'macos')" class="sehrleise klein">{{ t('WebDAV ist für diese Box ausgeschaltet — rechts unter „Zugriff“ einschalten.', 'WebDAV is switched off for this box — switch it on under “Access” on the right.') }}</p>
          </section>
        </div>

        <div>
          <section class="karte rein">
            <h3><Ico n="key" /> {{ t('Zugangsdaten', 'Credentials') }}</h3>
            <div class="zeilen">
              <VdKopierZeile :label="t('Server', 'Server')" :wert="a.host" />
              <VdKopierZeile label="SFTP-Port" :wert="String(a.sftpPort)" />
              <VdKopierZeile :label="t('Benutzer', 'User')" :wert="box.kennung" />
              <VdKopierZeile label="WebDAV" :wert="a.webdav" />
              <VdKopierZeile :label="t('Passwort', 'Password')" :wert="t('nur beim Anlegen gezeigt', 'only shown when created')" leise><button type="button" class="knopf klein" @click="passwortNeu">{{ t('Neu setzen', 'Reset') }}</button></VdKopierZeile>
            </div>
            <p class="sehrleise klein zuletzt">{{ t('Letzte Anmeldung:', 'Last sign-in:') }} {{ vorher2(box.zuletzt) }}</p>
          </section>

          <section class="karte rein">
            <h3><Ico n="network" /> {{ t('Zugriff', 'Access') }}</h3>
            <div class="protokolle">
              <div class="prot"><span class="psym"><Ico n="terminal" /></span><div><b>SFTP &amp; SCP</b><small>Port {{ a.sftpPort }} · {{ t('Passwort oder SSH-Schlüssel', 'password or SSH key') }}</small></div>
                <button type="button" :class="['schalter', { an: box.sftp }]" :aria-pressed="box.sftp" aria-label="SFTP" @click="aendern({ sftp: !box.sftp })"></button></div>
              <div class="prot"><span class="psym"><Ico n="globe" /></span><div><b>WebDAV</b><small>{{ t('als Netzlaufwerk in Windows, macOS und Apps', 'as a network drive in Windows, macOS and apps') }}</small></div>
                <button type="button" :class="['schalter', { an: box.webdav }]" :aria-pressed="box.webdav" aria-label="WebDAV" @click="aendern({ webdav: !box.webdav })"></button></div>
              <div class="prot"><span class="psym"><Ico n="lock" /></span><div><b>{{ t('SSH-Schlüssel', 'SSH keys') }}</b><small>{{ box.sshKeys.length ? t(`${box.sshKeys.length} hinterlegt`, `${box.sshKeys.length} stored`) : t('keine hinterlegt', 'none stored') }}</small></div>
                <button type="button" class="knopf klein" @click="ssh = box.sshKeys.join('\n')">{{ t('Verwalten', 'Manage') }}</button></div>
            </div>
          </section>

          <section v-if="kont" class="karte rein">
            <h3><Ico n="gauge" /> {{ t('Kontingent', 'Quota') }}</h3>
            <form class="einheit" @submit.prevent="kontSpeichern"><input v-model.number="kont.wert" class="eingabe mono" type="number" min="0.1" step="any" :aria-label="t('Kontingent', 'Quota')"><VdAuswahl v-model="kont.e" class="eingabe" :aria-label="t('Einheit', 'Unit')"><option>GB</option><option>TB</option></VdAuswahl><button class="knopf">{{ t('Speichern', 'Save') }}</button></form>
            <p class="sehrleise klein">{{ t('Ist das Kontingent voll, lehnt die Box neue Dateien ab — Lesen und Löschen gehen weiter. Bei 80 % kommt eine Warnung.', 'When the quota is full, the box rejects new files — reading and deleting keep working. You get a warning at 80%.') }}</p>
          </section>

          <section class="karte gefahr-karte rein">
            <h3><Ico n="alert" /> {{ t('Box löschen', 'Delete box') }}</h3>
            <p class="sehrleise klein">{{ t('Löscht alle Dateien und Unterkonten dieser Box endgültig.', 'Permanently deletes all files and sub-accounts of this box.') }}</p>
            <button type="button" class="knopf gefahr" @click="loeschen"><Ico n="trash" /> {{ t('Box löschen …', 'Delete box …') }}</button>
          </section>
        </div>
      </div>
    </template>

    <VdModal v-if="neuName !== null" :titel="t('Box umbenennen', 'Rename box')" @zu="neuName = null">
      <form @submit.prevent="umbenennen"><label class="feld"><span>{{ t('Name', 'Name') }}</span><input v-model="neuName" class="eingabe" maxlength="60" required></label>
        <div class="modal-fuss"><button type="button" class="knopf" @click="neuName = null">{{ t('Abbrechen', 'Cancel') }}</button><button class="knopf rot" :disabled="!neuName">{{ t('Speichern', 'Save') }}</button></div></form>
    </VdModal>
    <VdModal v-if="ssh !== null" :titel="t('SSH-Schlüssel', 'SSH keys')" breit @zu="ssh = null">
      <form @submit.prevent="sshSpeichern"><label class="feld"><span>{{ t('Öffentliche Schlüssel, einer pro Zeile', 'Public keys, one per line') }}</span><textarea v-model="ssh" class="eingabe mono ssh-feld" rows="6" spellcheck="false" placeholder="ssh-ed25519 AAAA… name@rechner"></textarea>
        <small>{{ t('Nur den öffentlichen Teil (Datei .pub). Mit Schlüssel geht die Anmeldung ohne Passwort.', 'Only the public part (.pub file). With a key, sign-in works without a password.') }}</small></label>
        <div class="modal-fuss"><button type="button" class="knopf" @click="ssh = null">{{ t('Abbrechen', 'Cancel') }}</button><button class="knopf rot">{{ t('Speichern', 'Save') }}</button></div></form>
    </VdModal>
    <VdModal v-if="neuUnter" :titel="t('Neues Unterkonto', 'New sub-account')" @zu="neuUnter = null">
      <form @submit.prevent="unterAnlegen">
        <label class="feld"><span>{{ t('Ordner in der Box', 'Folder in the box') }}</span><input v-model="neuUnter.ordner" class="eingabe mono" maxlength="63" required placeholder="backup-nas"><small>{{ t('Das Unterkonto sieht nur diesen Ordner. Gibt es ihn noch nicht, legt VylarisCloud ihn an.', 'The sub-account only sees this folder. If it does not exist yet, VylarisCloud creates it.') }}</small></label>
        <div class="rechte-wahl"><button type="button" :class="{ an: neuUnter.schreiben }" @click="neuUnter.schreiben = true"><b>{{ t('Lesen + Schreiben', 'Read + write') }}</b><small>{{ t('hochladen, ändern, löschen', 'upload, change, delete') }}</small></button><button type="button" :class="{ an: !neuUnter.schreiben }" @click="neuUnter.schreiben = false"><b>{{ t('Nur lesen', 'Read only') }}</b><small>{{ t('ansehen und herunterladen', 'view and download') }}</small></button></div>
        <label class="feld"><span>{{ t('Notiz', 'Note') }}</span><input v-model="neuUnter.notiz" class="eingabe" maxlength="120" :placeholder="t('z. B. Synology im Büro', 'e.g. Synology in the office')"></label>
        <div class="modal-fuss"><button type="button" class="knopf" @click="neuUnter = null">{{ t('Abbrechen', 'Cancel') }}</button><button class="knopf rot" :disabled="schickt || !neuUnter.ordner"><Ico :n="schickt ? 'loader' : 'users'" :class="{ spin: schickt }" /> {{ t('Anlegen', 'Create') }}</button></div>
      </form>
    </VdModal>
    <VdModal v-if="bearbeite" :titel="bearbeite.login" @zu="bearbeite = null">
      <form @submit.prevent="unterSpeichern">
        <p class="sehrleise klein">{{ t('Ordner', 'Folder') }}: <code class="mono">/{{ bearbeite.ordner }}</code></p>
        <div class="rechte-wahl"><button type="button" :class="{ an: bearbeite.schreiben }" @click="bearbeite.schreiben = true"><b>{{ t('Lesen + Schreiben', 'Read + write') }}</b><small>{{ t('hochladen, ändern, löschen', 'upload, change, delete') }}</small></button><button type="button" :class="{ an: !bearbeite.schreiben }" @click="bearbeite.schreiben = false"><b>{{ t('Nur lesen', 'Read only') }}</b><small>{{ t('ansehen und herunterladen', 'view and download') }}</small></button></div>
        <label class="feld"><span>{{ t('Notiz', 'Note') }}</span><input v-model="bearbeite.notiz" class="eingabe" maxlength="120"></label>
        <label class="feld"><span>{{ t('SSH-Schlüssel (einer pro Zeile)', 'SSH keys (one per line)') }}</span><textarea v-model="bearbeite.ssh" class="eingabe mono ssh-feld" rows="4" spellcheck="false" placeholder="ssh-ed25519 AAAA…"></textarea></label>
        <div class="modal-fuss"><button type="button" class="knopf" @click="bearbeite = null">{{ t('Abbrechen', 'Cancel') }}</button><button class="knopf rot">{{ t('Speichern', 'Save') }}</button></div>
      </form>
    </VdModal>
    <VdEinmal v-if="einmal" :titel="einmal.titel" :zeilen="einmal.zeilen" @zu="einmal = null" />
  </div>
</template>

<style scoped>
.detail {
  max-width: 1180px;
}
.zurueck {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  color: var(--text3);
  font-size: 12.5px;
  margin-bottom: 12px;
}
.zurueck:hover {
  color: var(--text);
}
.zurueck svg {
  width: 14px;
  height: 14px;
}
.rein {
  animation: rein 0.45s var(--kurve) backwards;
}
@keyframes rein {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
.detail-kopf {
  display: flex;
  gap: 16px;
  align-items: center;
  margin-bottom: 22px;
  flex-wrap: wrap;
}
.detail-kopf .sym {
  width: 52px;
  height: 52px;
  border-radius: 15px;
  background: rgba(var(--a-rgb), 0.12);
  color: var(--a);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.detail-kopf .sym svg {
  width: 24px;
  height: 24px;
}
.titel {
  flex: 1;
  min-width: 0;
}
.detail-kopf h1 {
  font-family: var(--f-display);
  font-size: 30px;
  letter-spacing: -0.035em;
  font-weight: 800;
  line-height: 1.1;
  overflow-wrap: anywhere;
}
.unter {
  display: flex;
  gap: 6px;
  color: var(--text3);
  font-size: 12.5px;
  margin-top: 4px;
  flex-wrap: wrap;
}
.raster {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.raster > div {
  display: grid;
  gap: 14px;
  min-width: 0;
}
.karte {
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 16px;
  padding: 18px;
  min-width: 0;
}
.karte h3 {
  font-size: 14.5px;
  font-weight: 600;
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 14px;
}
.karte h3 > svg {
  width: 15px;
  height: 15px;
  color: var(--text3);
}
.karte h3 .rechts {
  margin-left: auto;
}
.bel-gross {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.bel-gross b {
  font-family: var(--f-display);
  font-size: 32px;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}
.bel-gross span {
  color: var(--text2);
}
.bel-gross em {
  margin-left: auto;
  font-style: normal;
  font-size: 12.5px;
  color: var(--text3);
  font-variant-numeric: tabular-nums;
}
.meter {
  height: 8px;
  border-radius: 99px;
  background: var(--flaeche2);
  overflow: hidden;
  position: relative;
}
.meter i {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 99px;
  background: var(--a);
  transition: width 0.8s var(--kurve);
}
.meter i.warn {
  background: var(--warn);
}
.meter i.voll {
  background: var(--rot);
}
.voll-hinweis {
  margin: 12px 0 0;
}
.verlauf {
  margin-top: 18px;
}
.erkl {
  margin: -6px 0 12px;
  font-size: 12.5px;
}
.klein {
  font-size: 12px;
  margin: 8px 0 12px;
}
.zuletzt {
  margin-bottom: 0;
}
.tab-wrap {
  overflow-x: auto;
  margin: 0 -6px;
}
table.tab {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.tab th {
  text-align: left;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text3);
  font-weight: 600;
  padding: 0 8px 8px;
  white-space: nowrap;
}
.tab td {
  padding: 10px 8px;
  border-top: 1px solid var(--linie);
  vertical-align: middle;
}
.tab code {
  font-family: var(--f-mono);
  font-size: 12px;
}
.tab small {
  color: var(--text3);
  display: block;
  font-size: 11.5px;
}
.aktionen {
  text-align: right;
  white-space: nowrap;
}
.aktionen .knopf + .knopf {
  margin-left: 4px;
}
.bsp-wahl {
  margin-bottom: 10px;
}
.cmd-box {
  position: relative;
}
pre.cmd {
  margin: 0;
  background: var(--bg);
  border: 1px solid var(--linie);
  border-radius: 12px;
  padding: 12px 44px 12px 14px;
  font-family: var(--f-mono);
  font-size: 12px;
  line-height: 1.7;
  overflow-x: auto;
  white-space: pre;
}
.kopier-ecke {
  position: absolute;
  top: 8px;
  right: 8px;
  border: 0;
  background: var(--flaeche2);
  color: var(--text2);
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.kopier-ecke:hover {
  color: var(--text);
}
.kopier-ecke svg {
  width: 14px;
  height: 14px;
}
.zeilen {
  display: grid;
  gap: 8px;
}
.protokolle {
  display: grid;
  gap: 8px;
}
.prot {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 11px 12px;
  border-radius: 12px;
  border: 1px solid var(--linie);
}
.psym {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--flaeche2);
  display: grid;
  place-items: center;
  color: var(--text2);
  flex-shrink: 0;
}
.psym svg {
  width: 15px;
  height: 15px;
}
.prot > div {
  flex: 1;
  min-width: 0;
}
.prot b {
  display: block;
  font-size: 13px;
}
.prot small {
  color: var(--text3);
  font-size: 12px;
}
.einheit {
  display: flex;
  gap: 8px;
}
.einheit .eingabe:first-child {
  flex: 1;
  min-width: 0;
}
.einheit .vd-wahl {
  width: 90px;
  flex: none;
}
.gefahr-karte {
  border-color: rgba(185, 28, 28, 0.25);
}
.rechte-wahl {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 14px;
}
.rechte-wahl button {
  text-align: left;
  border: 1px solid var(--linie);
  background: var(--bg);
  border-radius: 12px;
  padding: 10px 12px;
  cursor: pointer;
  display: grid;
  gap: 2px;
  color: var(--text);
  font: inherit;
}
.rechte-wahl button.an {
  border-color: var(--a);
  box-shadow: 0 0 0 3px rgba(var(--a-rgb), 0.1);
}
.rechte-wahl small {
  color: var(--text3);
  font-size: 11.5px;
}
.ssh-feld {
  font-size: 11.5px;
  resize: vertical;
}
@media (max-width: 900px) {
  .raster {
    grid-template-columns: 1fr;
  }
}
@media (prefers-reduced-motion: reduce) {
  .rein,
  .meter i {
    animation: none;
    transition: none;
  }
}
</style>
