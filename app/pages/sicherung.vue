<script setup lang="ts">
useHead({ title: () => t('Sicherung', 'Backup') })
const theme = useTheme()
const { ok, fehler } = useToast()
const istInhaber = computed(() => theme.value.user?.role === 'owner')
const { data, refresh } = await (useFetch as any)('/api/pro/sicherung', {
  key: 'sicherung',
  immediate: istInhaber.value
})
const an = computed(() => !!data.value?.pro)

const laedt = ref(false)
function herunterladen() {
  laedt.value = true
  window.location.href = '/api/pro/sicherung/download'
  setTimeout(() => {
    laedt.value = false
  }, 4000)
}

const auswahl = ref<{ datei?: string; server?: string; kopf?: any; name: string } | null>(null)
const hoch = ref(0)
const hochLaeuft = ref(false)
const feld = ref<HTMLInputElement | null>(null)
function waehlen() {
  feld.value?.click()
}
function hochladen(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!f) return
  hochLaeuft.value = true
  hoch.value = 0
  const x = new XMLHttpRequest()
  x.open('POST', '/api/pro/sicherung/hochladen')
  x.setRequestHeader('Content-Type', 'application/zip')
  x.upload.onprogress = (ev) => {
    if (ev.lengthComputable) hoch.value = ev.loaded / ev.total
  }
  x.onload = () => {
    hochLaeuft.value = false
    let r: any = {}
    try {
      r = JSON.parse(x.responseText)
    } catch {}
    if (x.status >= 400) return fehler(r.message || t('Hochladen fehlgeschlagen.', 'Upload failed.'))
    auswahl.value = { datei: r.datei, kopf: r.kopf, name: f.name }
  }
  x.onerror = () => {
    hochLaeuft.value = false
    fehler(t('Verbindung abgebrochen.', 'Connection lost.'))
  }
  x.send(f)
}
function vomServer(s: any) {
  auswahl.value = { server: s.name, name: s.name }
}

const best = ref('')
const aufraeumen = ref(true)
const lauf = ref<any>(null)
const laufId = ref('')
let uhr: any = null
async function einspielen() {
  if (!auswahl.value) return
  try {
    const r = await api('/api/pro/sicherung/starten', {
      method: 'POST',
      body: {
        datei: auswahl.value.datei,
        server: auswahl.value.server,
        aufraeumen: aufraeumen.value,
        bestaetigung: best.value.trim()
      }
    })
    laufId.value = r.lauf
    lauf.value = { status: 'laeuft', schritt: 'pruefen', anteil: 0 }
    auswahl.value = null
    best.value = ''
    beobachten()
  } catch (e: any) {
    fehler(e.message)
  }
}
function beobachten() {
  clearInterval(uhr)
  uhr = setInterval(async () => {
    try {
      lauf.value = await $fetch(`/api/pro/sicherung/lauf/${laufId.value}`)
    } catch {}
    if (lauf.value?.status !== 'laeuft') clearInterval(uhr)
  }, 1500)
}
onBeforeUnmount(() => clearInterval(uhr))
const SCHRITTE = computed<Record<string, string>>(() => ({
  pruefen: t('Sicherung prüfen', 'Checking backup'),
  dateien: t('Dateien einspielen', 'Restoring files'),
  datenbank: t('Datenbank ersetzen', 'Replacing database'),
  abschluss: t('Abschließen', 'Finishing'),
  fertig: t('Fertig', 'Done')
}))
const zahlen = computed(() => {
  const k = auswahl.value?.kopf
  if (!k) return null
  return {
    konten: k.zahlen?.users || 0,
    dateien: k.dateien || 0,
    bytes: k.bytes || 0,
    version: k.version,
    erstellt: k.erstellt
  }
})
</script>

<template>
  <section class="rein">
    <div class="kopf"><div><div class="eyebrow"><Ico n="krone" /> Pro</div><h1>{{ t('Sicherung', 'Backup') }}</h1>
      <p>{{ t('Die ganze Installation in einer Datei — zum Aufbewahren oder für den Umzug auf einen neuen Server.', 'The whole instance in one file — to keep, or to move to a new server.') }}</p></div></div>

    <p v-if="!istInhaber" class="meldung meldung-warn">{{ t('Sicherungen darf nur der Inhaber erstellen und einspielen.', 'Only the owner can create and restore backups.') }}</p>
    <VdProSperre v-else-if="data && !an" ic="database" :titel="t('Sicherung per Knopf', 'One-click backup')" :text="t('Ein Klick, eine ZIP-Datei: Konten, Einstellungen, Ordner, Links und jede Datei — lokal wie aus S3.', 'One click, one ZIP file: accounts, settings, folders, links and every file — local or from S3.')"
      :punkte="[t('Auch Hunderte Gigabyte — die Datei wird gestreamt', 'Even hundreds of gigabytes — the file is streamed'), t('Auf jedem VylarisCloud-Server wieder einspielbar', 'Restorable on any VylarisCloud server'), t('Links bleiben gleich, Vorschaubilder entstehen neu', 'Links stay the same, previews are rebuilt')]" />

    <template v-else-if="data">
      <div v-if="lauf" class="block lauf">
        <div class="reihe zw"><h3>{{ t('Wiederherstellung', 'Restore') }}</h3>
          <span :class="['chip', lauf.status === 'fertig' ? 'ok' : lauf.status === 'fehler' ? 'rot' : 'info']"><Ico :n="lauf.status === 'laeuft' ? 'loader' : lauf.status === 'fertig' ? 'check' : 'alert'" :spin="lauf.status === 'laeuft'" /> {{ SCHRITTE[lauf.schritt] || lauf.schritt }}</span></div>
        <div class="balken"><i :style="{ transform: `scaleX(${(lauf.anteil || 0) / 100})` }"></i></div>
        <p v-if="lauf.status === 'laeuft'" class="leise klein">{{ t('Bitte warten — du wirst danach abgemeldet und meldest dich mit einem Konto aus der Sicherung an.', 'Please wait — you will be signed out afterwards and sign in with an account from the backup.') }}</p>
        <div v-else-if="lauf.status === 'fertig'" class="reihe"><p class="leise klein" style="margin:0;flex:1">{{ t('Alles eingespielt. Vorschaubilder entstehen jetzt im Hintergrund neu.', 'Everything restored. Previews are now rebuilt in the background.') }}</p><a href="/login" class="knopf rot"><Ico n="key" /> {{ t('Neu anmelden', 'Sign in again') }}</a></div>
        <p v-else class="meldung meldung-fehler">{{ t('Abgebrochen — der alte Stand ist unverändert.', 'Aborted — the previous state is unchanged.') }} {{ lauf.meldung }}</p>
      </div>

      <div class="raster2">
        <div class="block">
          <span class="gross-ic"><Ico n="download" /></span>
          <h3>{{ t('Sicherung herunterladen', 'Download backup') }}</h3>
          <p class="leise klein">{{ t('Datenbank und alle Dateien als ZIP. Bei vielen Dateien dauert das — der Download beginnt sofort und läuft durch.', 'Database and all files as a ZIP. With many files this takes a while — the download starts right away and keeps going.') }}</p>
          <ul class="liste"><li><Ico n="check" /> {{ t('Konten, Rollen, Teams, Passkeys', 'Accounts, roles, teams, passkeys') }}</li><li><Ico n="check" /> {{ t('Einstellungen, Marke, Lizenz', 'Settings, branding, licence') }}</li><li><Ico n="check" /> {{ t('Ordner, Links, Tags, Statistik, Papierkorb', 'Folders, links, tags, statistics, trash') }}</li><li><Ico n="check" /> {{ t('Jede Datei — lokal oder aus S3', 'Every file — local or from S3') }}</li></ul>
          <button class="knopf rot" :disabled="laedt" @click="herunterladen"><Ico :n="laedt ? 'loader' : 'download'" :spin="laedt" /> {{ t('Jetzt sichern', 'Back up now') }}</button>
        </div>

        <div class="block">
          <span class="gross-ic warn"><Ico n="upload" /></span>
          <h3>{{ t('Sicherung einspielen', 'Restore backup') }}</h3>
          <p class="leise klein">{{ t('Ersetzt ALLES auf diesem Server durch den Stand aus der Sicherung. Klappt etwas nicht, bleibt der alte Stand.', 'Replaces EVERYTHING on this server with the state from the backup. If something fails, the old state stays.') }}</p>
          <input ref="feld" type="file" accept=".zip,application/zip" hidden @change="hochladen">
          <template v-if="!auswahl">
            <button class="knopf" :disabled="hochLaeuft" @click="waehlen"><Ico :n="hochLaeuft ? 'loader' : 'upload'" :spin="hochLaeuft" /> {{ hochLaeuft ? `${Math.round(hoch * 100)} %` : t('ZIP-Datei wählen', 'Choose ZIP file') }}</button>
            <div v-if="hochLaeuft" class="balken"><i :style="{ transform: `scaleX(${hoch})` }"></i></div>
            <div class="server-liste">
              <small class="sehrleise">{{ t('Sehr große Sicherung? Lege sie in den Ordner import/ neben der docker-compose.yml:', 'Very large backup? Put it into the import/ folder next to docker-compose.yml:') }}</small>
              <button v-for="s in data.server" :key="s.name" class="server-datei" @click="vomServer(s)"><Ico n="database" /><span>{{ s.name }}</span><small class="mono">{{ groesse(s.groesse) }}</small></button>
              <button class="knopf klein" style="align-self:flex-start" @click="refresh()"><Ico n="undo" /> {{ t('Ordner neu lesen', 'Re-read folder') }}</button>
            </div>
          </template>
          <form v-else class="bestaetigen" @submit.prevent="einspielen">
            <div class="kopfdaten">
              <b>{{ auswahl.name }}</b>
              <small v-if="zahlen">{{ t(`${zahlen.konten} Konten · ${zahlen.dateien} Dateien · ${groesse(zahlen.bytes)} · VylarisCloud ${zahlen.version} · ${zeitpunkt(zahlen.erstellt)}`, `${zahlen.konten} accounts · ${zahlen.dateien} files · ${groesse(zahlen.bytes)} · VylarisCloud ${zahlen.version} · ${zeitpunkt(zahlen.erstellt)}`) }}</small>
            </div>
            <label class="frage-opt"><button type="button" :class="['schalter', { an: aufraeumen }]" role="switch" :aria-checked="aufraeumen" @click="aufraeumen = !aufraeumen"></button><span><b>{{ t('Bisherige Dateien danach löschen', 'Delete current files afterwards') }}</b><small>{{ t('Sonst bleiben sie als ungenutzter Ballast im Speicher.', 'Otherwise they stay behind as unused clutter in storage.') }}</small></span></label>
            <label class="feld"><span>{{ t('Zur Bestätigung ERSETZEN eintippen', 'Type ERSETZEN to confirm') }}</span><input v-model="best" class="eingabe mono" autocomplete="off" spellcheck="false" placeholder="ERSETZEN"></label>
            <div class="reihe"><button type="button" class="knopf" @click="auswahl = null">{{ t('Abbrechen', 'Cancel') }}</button><button class="knopf gefahr" :disabled="best.trim() !== 'ERSETZEN'"><Ico n="upload" /> {{ t('Alles ersetzen', 'Replace everything') }}</button></div>
          </form>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.raster2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  align-items: start;
}
.raster2 > .block {
  margin-top: 0;
}
.gross-ic {
  width: 44px;
  height: 44px;
  border-radius: 13px;
  background: rgba(var(--a-rgb), 0.1);
  color: var(--a);
  display: grid;
  place-items: center;
  margin-bottom: 12px;
}
.gross-ic.warn {
  background: var(--warn-bg);
  color: var(--warn);
}
.gross-ic svg {
  width: 20px;
  height: 20px;
}
.klein {
  font-size: 12.5px;
  margin: 2px 0 12px;
}
.liste {
  list-style: none;
  padding: 0;
  margin: 0 0 16px;
  display: grid;
  gap: 6px;
  font-size: 13px;
}
.liste li {
  display: flex;
  gap: 8px;
  align-items: center;
}
.liste svg {
  width: 14px;
  height: 14px;
  color: var(--ok);
}
.balken {
  height: 6px;
  border-radius: 99px;
  background: var(--flaeche2);
  overflow: hidden;
  margin: 12px 0;
}
.balken i {
  display: block;
  height: 100%;
  background: var(--a);
  transform-origin: left;
  transition: transform 0.4s;
}
.lauf {
  margin-bottom: 14px;
}
.server-liste {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--linie);
}
.server-datei {
  display: flex;
  gap: 10px;
  align-items: center;
  border: 1px solid var(--linie);
  background: var(--bg);
  border-radius: 10px;
  padding: 8px 12px;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  color: var(--text);
  text-align: left;
}
.server-datei span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.server-datei svg {
  width: 15px;
  height: 15px;
  color: var(--text3);
}
.server-datei:hover {
  border-color: var(--linie2);
}
.kopfdaten {
  display: flex;
  flex-direction: column;
  gap: 3px;
  background: var(--bg);
  border: 1px solid var(--linie);
  border-radius: 12px;
  padding: 10px 12px;
  margin-bottom: 14px;
  font-size: 13px;
}
.kopfdaten small {
  color: var(--text3);
  font-size: 12px;
}
.frage-opt {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 14px;
  cursor: pointer;
}
.frage-opt small {
  display: block;
  color: var(--text3);
  font-size: 12px;
}
@media (max-width: 860px) {
  .raster2 {
    grid-template-columns: 1fr;
  }
}
</style>
