<script setup lang="ts">
useHead({ title: () => t('Speicher', 'Storage') })
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const { data, refresh } = await (useFetch as any)('/api/speicher', { key: 'speicher' })
const d = computed<any>(() => data.value || {})
const stand = computed<any>(() => d.value.stand || {})
const GiB = 1024 ** 3

const port = ref(2222)
const schaltet = ref(false)
const laeuft = computed(
  () => schaltet.value || stand.value.lauf?.status === 'laeuft' || (stand.value.angefragt && !stand.value.nichtAbgeholt)
)
let uhr: any = null
watch(
  laeuft,
  (l) => {
    clearInterval(uhr)
    if (l)
      uhr = setInterval(() => {
        refresh().catch(() => {})
      }, 3000)
  },
  { immediate: true }
)
onBeforeUnmount(() => clearInterval(uhr))
async function schalten(an: boolean) {
  schaltet.value = true
  try {
    await api('/api/speicher/dienst', { method: 'POST', body: { an, port: Number(port.value) } })
    ok(
      an
        ? t(
            'Wird eingeschaltet — das dauert beim ersten Mal ein, zwei Minuten.',
            'Switching on — the first time takes a minute or two.'
          )
        : t('Wird ausgeschaltet', 'Switching off')
    )
    await refresh()
  } catch (e: any) {
    fehler(e.message)
  } finally {
    setTimeout(() => {
      schaltet.value = false
    }, 4000)
  }
}
function ausschalten() {
  bestaetigen(
    t('Speicherdienst ausschalten?', 'Switch off the storage service?'),
    t(
      'SFTP, WebDAV und S3 sind danach nicht mehr erreichbar. Alle Boxen, Buckets und Dateien bleiben erhalten und sind nach dem Einschalten wieder da.',
      'SFTP, WebDAV and S3 will no longer be reachable. All boxes, buckets and files are kept and come back when you switch it on again.'
    ),
    t('Ausschalten', 'Switch off'),
    () => schalten(false)
  )
}

const alle = computed<any[]>(() => [...(d.value.boxen || []), ...(d.value.buckets || [])])
const belegt = computed(() => alle.value.reduce((s, x) => s + x.belegt, 0))
const vergeben = computed(() => alle.value.reduce((s, x) => s + x.kontingent, 0))
const proz = (x: any) => (x.kontingent ? Math.min(100, (x.belegt / x.kontingent) * 100) : 0)
const stufe = (x: any) => (proz(x) >= 99.5 ? 'voll' : proz(x) >= 80 ? 'warn' : '')

const einheit = (gb: number) => (gb >= 1024 && gb % 1024 === 0 ? { wert: gb / 1024, e: 'TB' } : { wert: gb, e: 'GB' })
const neuBox = ref<any>(null)
const neuBucket = ref<any>(null)
const einmal = ref<{ titel: string; zeilen: Array<{ label: string; wert: string }> } | null>(null)
const schickt = ref(false)
const gb = (f: any) => Number(f.wert) * (f.e === 'TB' ? 1024 : 1)
async function boxAnlegen() {
  schickt.value = true
  try {
    const r = await api('/api/speicher/boxen', {
      method: 'POST',
      body: { name: neuBox.value.name, kontingentGb: gb(neuBox.value) }
    })
    neuBox.value = null
    await refresh()
    const a = d.value.adresse
    einmal.value = {
      titel: t('Storage-Box angelegt', 'Storage box created'),
      zeilen: [
        { label: t('Server', 'Server'), wert: a.host },
        { label: 'SFTP-Port', wert: String(a.sftpPort) },
        { label: t('Benutzer', 'User'), wert: r.box.kennung },
        { label: t('Passwort', 'Password'), wert: r.passwort },
        { label: 'WebDAV', wert: a.webdav }
      ]
    }
  } catch (e: any) {
    fehler(e.message)
  } finally {
    schickt.value = false
  }
}
async function bucketAnlegen() {
  schickt.value = true
  const f = neuBucket.value
  try {
    const r = await api('/api/speicher/buckets', {
      method: 'POST',
      body: {
        name: f.name,
        kontingentGb: gb(f),
        ...(f.schluessel ? { schluessel: { name: t('Standard', 'Default'), schreiben: true } } : {})
      }
    })
    neuBucket.value = null
    await refresh()
    const a = d.value.adresse
    if (r.schluessel)
      einmal.value = {
        titel: t('Bucket angelegt', 'Bucket created'),
        zeilen: [
          { label: t('Endpunkt', 'Endpoint'), wert: a.s3 },
          { label: 'Bucket', wert: r.bucket.name },
          { label: 'Region', wert: a.region },
          { label: 'Access Key', wert: r.schluessel.accessKey },
          { label: 'Secret', wert: r.schluessel.secret }
        ]
      }
    else {
      ok(t('Bucket angelegt', 'Bucket created'))
      await navigateTo(`/speicher/bucket/${r.bucket.id}`)
    }
  } catch (e: any) {
    fehler(e.message)
  } finally {
    schickt.value = false
  }
}
const bucketName = computed(() => String(neuBucket.value?.name || ''))
const bucketNameOk = computed(() => /^(?!\d+\.\d+\.\d+\.\d+$)[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucketName.value))

const einst = ref<any>(null)
watch(
  () => d.value.einstellungen,
  (e) => {
    if (e && !einst.value) einst.value = { ...e }
  },
  { immediate: true }
)
async function einstSpeichern() {
  try {
    await api('/api/speicher/einstellungen', {
      method: 'PUT',
      body: {
        wer: einst.value.wer,
        grenzeGb: Number(einst.value.grenzeGb) || 0,
        maxAnzahl: Number(einst.value.maxAnzahl) || 0
      }
    })
    ok(t('Gespeichert', 'Saved'))
    await refresh()
  } catch (e: any) {
    fehler(e.message)
  }
}
</script>

<template>
  <div class="seite-speicher">
    <template v-if="!stand.konfiguriert">
      <div class="kopf rein"><div><div class="eyebrow"><Ico n="box" /> {{ t('Speicher', 'Storage') }}</div><h1>{{ t('Dein eigener Speicher-Anbieter', 'Your own storage provider') }}</h1>
        <p>{{ t('Storage-Boxen und S3-Buckets auf diesem Server — zum Einbinden in eigene Apps, Backups und Programme.', 'Storage boxes and S3 buckets on this server — for your own apps, backups and programs.') }}</p></div></div>
      <div class="einricht rein">
        <div>
          <h2>{{ t('Speicherdienst einschalten', 'Switch on the storage service') }}</h2>
          <p>{{ t('VylarisCloud startet dafür zwei kleine Zusatz-Container auf deinem Server. Deine Daten bleiben auf diesem Server, kein fremder Dienst ist beteiligt.', 'VylarisCloud starts two small extra containers on your server. Your data stays on this server, no third-party service is involved.') }}</p>
          <ul>
            <li><Ico n="check" /> {{ t('Storage-Boxen mit SFTP, SCP und WebDAV, Unterkonten mit eigenem Ordner', 'Storage boxes with SFTP, SCP and WebDAV, sub-accounts with their own folder') }}</li>
            <li><Ico n="check" /> {{ t('S3-kompatible Buckets mit Zugangsschlüsseln — für rclone, restic, aws-cli und Apps', 'S3-compatible buckets with access keys — for rclone, restic, aws-cli and apps') }}</li>
            <li><Ico n="check" /> {{ t('Feste Kontingente je Box und Bucket, Belegung mit Verlauf', 'Fixed quotas per box and bucket, usage with history') }}</li>
            <li><Ico n="check" /> {{ t('Kostenlos, braucht rund 30 MB Arbeitsspeicher', 'Free, needs about 30 MB of memory') }}</li>
          </ul>
          <template v-if="d.inhaber">
            <VdServerBefehl v-if="stand.dienst === false || stand.kann === false" :text="t('Der Dienst auf dem Server ist zu alt dafür. Einmal auf dem Server ausführen, danach geht es hier per Klick:', 'The service on the server is too old for this. Run this once on the server, then it works here with one click:')" />
            <template v-else>
              <label class="feld port"><span>{{ t('Port für SFTP', 'Port for SFTP') }}</span><input v-model.number="port" class="eingabe mono" type="number" min="1" max="65535" :disabled="laeuft">
                <small>{{ t('Port 22 nutzt meist schon SSH. Er muss in der Firewall offen sein (ufw/firewalld öffnet VylarisCloud selbst).', 'Port 22 is usually taken by SSH. It must be open in the firewall (VylarisCloud opens ufw/firewalld itself).') }}</small></label>
              <div v-if="stand.lauf?.status === 'fehler'" class="meldung meldung-fehler">{{ stand.lauf.meldung || t('Das Einschalten ist fehlgeschlagen.', 'Switching on failed.') }}</div>
              <div v-if="stand.nichtAbgeholt" class="meldung meldung-warn">{{ t('Der Dienst auf dem Server hat den Auftrag nicht abgeholt. Einmal auf dem Server ausführen:', 'The server service did not pick up the job. Run once on the server:') }} <code class="mono">{{ stand.befehl }}</code></div>
              <button type="button" class="knopf rot" :disabled="laeuft" @click="schalten(true)"><Ico :n="laeuft ? 'loader' : 'box'" :class="{ spin: laeuft }" /> {{ laeuft ? t('Wird eingeschaltet …', 'Switching on …') : t('Einschalten', 'Switch on') }}</button>
            </template>
          </template>
          <p v-else class="meldung meldung-warn">{{ t('Den Speicherdienst schaltet der Inhaber dieser Installation ein.', 'The owner of this installation switches on the storage service.') }}</p>
        </div>
        <div class="stapel" aria-hidden="true">
          <div class="ebene"><Ico n="globe" /><div><b>{{ d.adresse?.host || 'cloud.example.com' }}</b><small>{{ t('VylarisCloud wie bisher — S3 und WebDAV laufen über dieselbe Adresse', 'VylarisCloud as before — S3 and WebDAV use the same address') }}</small></div></div>
          <div class="ebene"><Ico n="terminal" /><div><b>SFTP · Port {{ port }}</b><small>{{ t('SFTPGo, unverändert, im eigenen Container', 'SFTPGo, unmodified, in its own container') }}</small></div></div>
          <div class="ebene"><Ico n="database" /><div><b>S3 · Path-Style</b><small>{{ t('Garage, unverändert, im eigenen Container', 'Garage, unmodified, in its own container') }}</small></div></div>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="kopf rein">
        <div><div class="eyebrow"><Ico n="box" /> {{ t('Speicher', 'Storage') }}</div><h1>{{ t('Boxen & Buckets', 'Boxes & buckets') }}</h1>
          <p>{{ t('Speicher für Apps, Backups und Programme — direkt auf diesem Server.', 'Storage for apps, backups and programs — right on this server.') }}</p></div>
        <div v-if="d.darfAnlegen" class="reihe">
          <button type="button" class="knopf" @click="neuBucket = { name: '', wert: 50, e: 'GB', schluessel: true }"><Ico n="plus" /> Bucket</button>
          <button type="button" class="knopf rot" @click="neuBox = { name: '', wert: 100, e: 'GB' }"><Ico n="plus" /> {{ t('Storage-Box', 'Storage box') }}</button>
        </div>
      </div>
      <div v-if="d.admin && (!stand.sftpgo || !stand.garage)" class="meldung meldung-warn rein">
        <b>{{ t('Ein Teil des Speicherdienstes antwortet nicht', 'Part of the storage service is not responding') }}</b> ({{ [!stand.sftpgo && 'SFTPGo', !stand.garage && 'Garage'].filter(Boolean).join(', ') }}).
        {{ t('Auf dem Server: docker compose ps — oder hier unten aus- und wieder einschalten.', 'On the server: docker compose ps — or switch it off and on again below.') }} <span v-if="stand.fehler" class="mono">{{ stand.fehler }}</span>
      </div>
      <div class="kennzahlen rein">
        <div class="kz"><small><Ico n="gauge" /> {{ t('Belegt', 'Used') }}</small><b>{{ groesse(belegt) }}</b><span>{{ t('von', 'of') }} {{ groesse(vergeben) }} {{ t('vergeben', 'allocated') }}</span></div>
        <div v-if="d.platte" class="kz"><small><Ico n="server" /> {{ t('Frei auf dem Server', 'Free on the server') }}</small><b>{{ groesse(d.platte.frei) }}</b>
          <div class="meter" role="meter" :aria-valuenow="Math.round((1 - d.platte.frei / d.platte.gesamt) * 100)" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: ((1 - d.platte.frei / d.platte.gesamt) * 100) + '%' }"></i></div>
          <span v-if="vergeben > d.platte.frei + belegt" class="warn-text">{{ t('Mehr vergeben als frei', 'More allocated than free') }}</span></div>
        <div class="kz"><small><Ico n="box" /> {{ t('Storage-Boxen', 'Storage boxes') }}</small><b>{{ d.boxen?.length || 0 }}</b><span>{{ (d.boxen || []).reduce((s: number, b: any) => s + b.unterkonten, 0) }} {{ t('Unterkonten', 'sub-accounts') }}</span></div>
        <div class="kz"><small><Ico n="database" /> Buckets</small><b>{{ d.buckets?.length || 0 }}</b><span>{{ (d.buckets || []).reduce((s: number, b: any) => s + b.schluessel, 0) }} {{ t('Zugangsschlüssel', 'access keys') }}</span></div>
      </div>

      <section class="abschnitt rein">
        <div class="abschnitt-kopf"><div><h2><Ico n="box" /> {{ t('Storage-Boxen', 'Storage boxes') }}</h2><p>{{ t('Ordner mit Zugang per SFTP, SCP und WebDAV — wie eine Festplatte im Netz.', 'Folders with SFTP, SCP and WebDAV access — like a disk on the network.') }}</p></div></div>
        <div v-if="d.boxen?.length" class="liste">
          <NuxtLink v-for="b in d.boxen" :key="b.id" :to="`/speicher/box/${b.id}`" class="zeile">
            <div class="name"><span class="sym"><Ico n="box" /></span><div><b>{{ b.name }}</b><small class="mono">{{ b.kennung }}<template v-if="d.admin && b.besitzer"> · {{ b.besitzer }}</template></small></div></div>
            <div class="zugang"><span v-if="b.sftp" class="chip neutral"><Ico n="terminal" /> SFTP</span><span v-if="b.webdav" class="chip neutral"><Ico n="globe" /> WebDAV</span><span v-if="b.unterkonten" class="chip info"><Ico n="users" /> {{ b.unterkonten }}</span></div>
            <div class="bel"><small><span>{{ groesse(b.belegt) }}</span><span>{{ groesse(b.kontingent) }}</span></small><div class="meter"><i :class="stufe(b)" :style="{ width: proz(b) + '%' }"></i></div></div>
            <Ico n="right" class="pfeil" />
          </NuxtLink>
        </div>
        <div v-else class="leer block"><b>{{ t('Noch keine Storage-Box', 'No storage box yet') }}</b><span>{{ t('Etwa für Backups eines Servers oder als Team-Laufwerk.', 'For example for server backups or as a team drive.') }}</span>
          <button v-if="d.darfAnlegen" type="button" class="knopf" @click="neuBox = { name: '', wert: 100, e: 'GB' }"><Ico n="plus" /> {{ t('Storage-Box anlegen', 'Create storage box') }}</button></div>
      </section>

      <section class="abschnitt rein">
        <div class="abschnitt-kopf"><div><h2><Ico n="database" /> Buckets</h2><p>{{ t('S3-kompatibel — für rclone, restic, aws-cli, Backups und eigene Apps.', 'S3-compatible — for rclone, restic, aws-cli, backups and your own apps.') }}</p></div></div>
        <div v-if="d.buckets?.length" class="liste">
          <NuxtLink v-for="b in d.buckets" :key="b.id" :to="`/speicher/bucket/${b.id}`" class="zeile">
            <div class="name"><span class="sym"><Ico n="database" /></span><div><b>{{ b.name }}</b><small>{{ zahl(b.objekte) }} {{ t('Objekte', 'objects') }}<template v-if="d.admin && b.besitzer"> · {{ b.besitzer }}</template></small></div></div>
            <div class="zugang"><span class="chip neutral"><Ico n="key" /> {{ b.schluessel }} {{ t('Schlüssel', b.schluessel === 1 ? 'key' : 'keys') }}</span></div>
            <div class="bel"><small><span>{{ groesse(b.belegt) }}</span><span>{{ groesse(b.kontingent) }}</span></small><div class="meter"><i :class="stufe(b)" :style="{ width: proz(b) + '%' }"></i></div></div>
            <Ico n="right" class="pfeil" />
          </NuxtLink>
        </div>
        <div v-else class="leer block"><b>{{ t('Noch kein Bucket', 'No bucket yet') }}</b><span>{{ t('Etwa für Uploads einer App oder verschlüsselte Backups mit restic.', 'For example for app uploads or encrypted backups with restic.') }}</span>
          <button v-if="d.darfAnlegen" type="button" class="knopf" @click="neuBucket = { name: '', wert: 50, e: 'GB', schluessel: true }"><Ico n="plus" /> {{ t('Bucket anlegen', 'Create bucket') }}</button></div>
      </section>

      <section v-if="d.inhaber && einst" class="abschnitt rein">
        <div class="abschnitt-kopf"><div><h2><Ico n="gear" /> {{ t('Einstellungen', 'Settings') }}</h2><p>{{ t('Nur für dich als Inhaber sichtbar.', 'Only visible to you as the owner.') }}</p></div></div>
        <div class="einst-raster">
          <div class="block">
            <h3>{{ t('Wer darf Speicher anlegen?', 'Who may create storage?') }}</h3>
            <div class="seg" style="margin: 10px 0 14px"><button type="button" :class="{ an: einst.wer === 'admins' }" @click="einst.wer = 'admins'">{{ t('Nur Admins', 'Admins only') }}</button><button type="button" :class="{ an: einst.wer === 'alle' }" @click="einst.wer = 'alle'">{{ t('Alle Konten', 'All accounts') }}</button></div>
            <template v-if="einst.wer === 'alle'">
              <label class="feld"><span>{{ t('Zusammen höchstens (GB je Konto, 0 = unbegrenzt)', 'In total at most (GB per account, 0 = unlimited)') }}</span><input v-model.number="einst.grenzeGb" class="eingabe mono" type="number" min="0"></label>
              <label class="feld"><span>{{ t('Höchstens Boxen + Buckets je Konto (0 = unbegrenzt)', 'At most boxes + buckets per account (0 = unlimited)') }}</span><input v-model.number="einst.maxAnzahl" class="eingabe mono" type="number" min="0"></label>
            </template>
            <p class="sehrleise klein">{{ t('Admins und du sind nie begrenzt.', 'Admins and you are never limited.') }}</p>
            <button type="button" class="knopf" @click="einstSpeichern">{{ t('Speichern', 'Save') }}</button>
          </div>
          <div class="block">
            <h3>{{ t('Dienst', 'Service') }}</h3>
            <div class="dienst-zeilen">
              <div><span>SFTPGo</span><span :class="['chip', stand.sftpgo ? 'ok' : 'rot']">{{ stand.sftpgo ? t('läuft', 'running') : t('antwortet nicht', 'not responding') }}</span></div>
              <div><span>Garage</span><span :class="['chip', stand.garage ? 'ok' : 'rot']">{{ stand.garage ? t('läuft', 'running') : t('antwortet nicht', 'not responding') }}</span></div>
              <div><span>{{ t('SFTP-Port', 'SFTP port') }}</span><code class="mono">{{ stand.port }}</code></div>
            </div>
            <p class="sehrleise klein">{{ t('SFTPGo und Garage laufen unverändert unter der AGPL-3.0 — Quellcode: github.com/drakkan/sftpgo und git.deuxfleurs.fr/Deuxfleurs/garage.', 'SFTPGo and Garage run unmodified under the AGPL-3.0 — source code: github.com/drakkan/sftpgo and git.deuxfleurs.fr/Deuxfleurs/garage.') }}</p>
            <button type="button" class="knopf gefahr" :disabled="laeuft" @click="ausschalten"><Ico n="x" /> {{ t('Speicherdienst ausschalten', 'Switch off storage service') }}</button>
          </div>
        </div>
      </section>
    </template>

    <VdModal v-if="neuBox" :titel="t('Neue Storage-Box', 'New storage box')" @zu="neuBox = null">
      <form @submit.prevent="boxAnlegen">
        <label class="feld"><span>{{ t('Name', 'Name') }}</span><input v-model="neuBox.name" class="eingabe" maxlength="60" required :placeholder="t('z. B. Backups Webserver', 'e.g. Web server backups')"></label>
        <label class="feld"><span>{{ t('Kontingent', 'Quota') }}</span><span class="einheit"><input v-model.number="neuBox.wert" class="eingabe mono" type="number" min="0.1" step="any" required><VdAuswahl v-model="neuBox.e" class="eingabe"><option>GB</option><option>TB</option></VdAuswahl></span>
          <small v-if="d.platte">{{ t('Frei auf dem Server:', 'Free on the server:') }} {{ groesse(d.platte.frei) }}</small></label>
        <p class="sehrleise klein">{{ t('Benutzername und Passwort bekommst du gleich danach — das Passwort nur einmal.', 'You get the user name and password right afterwards — the password only once.') }}</p>
        <div class="modal-fuss"><button type="button" class="knopf" @click="neuBox = null">{{ t('Abbrechen', 'Cancel') }}</button><button class="knopf rot" :disabled="schickt || !neuBox.name"><Ico :n="schickt ? 'loader' : 'box'" :class="{ spin: schickt }" /> {{ t('Anlegen', 'Create') }}</button></div>
      </form>
    </VdModal>
    <VdModal v-if="neuBucket" :titel="t('Neuer Bucket', 'New bucket')" @zu="neuBucket = null">
      <form @submit.prevent="bucketAnlegen">
        <label class="feld"><span>{{ t('Name', 'Name') }}</span><input v-model="neuBucket.name" class="eingabe mono" maxlength="63" required placeholder="mein-bucket" autocapitalize="off" spellcheck="false" @input="neuBucket.name = neuBucket.name.toLowerCase()">
          <small :class="{ 'warn-text': bucketName && !bucketNameOk }">{{ t('3–63 Zeichen: Kleinbuchstaben, Ziffern und Bindestriche. Der Name gilt für die ganze Installation.', '3–63 characters: lowercase letters, digits and hyphens. The name is unique across the installation.') }}</small></label>
        <label class="feld"><span>{{ t('Kontingent', 'Quota') }}</span><span class="einheit"><input v-model.number="neuBucket.wert" class="eingabe mono" type="number" min="0.1" step="any" required><VdAuswahl v-model="neuBucket.e" class="eingabe"><option>GB</option><option>TB</option></VdAuswahl></span></label>
        <label class="schalter-zeile"><button type="button" :class="['schalter', { an: neuBucket.schluessel }]" :aria-pressed="neuBucket.schluessel" @click="neuBucket.schluessel = !neuBucket.schluessel"></button> {{ t('Gleich einen Zugangsschlüssel anlegen (Lesen + Schreiben)', 'Create an access key right away (read + write)') }}</label>
        <div class="modal-fuss"><button type="button" class="knopf" @click="neuBucket = null">{{ t('Abbrechen', 'Cancel') }}</button><button class="knopf rot" :disabled="schickt || !bucketNameOk"><Ico :n="schickt ? 'loader' : 'database'" :class="{ spin: schickt }" /> {{ t('Anlegen', 'Create') }}</button></div>
      </form>
    </VdModal>
    <VdEinmal v-if="einmal" :titel="einmal.titel" :zeilen="einmal.zeilen" @zu="einmal = null" />
  </div>
</template>

<style scoped>
.seite-speicher {
  max-width: 1180px;
}
.rein {
  animation: rein 0.45s var(--kurve) backwards;
}
.rein:nth-child(2) {
  animation-delay: 0.05s;
}
.rein:nth-child(3) {
  animation-delay: 0.1s;
}
.rein:nth-child(4) {
  animation-delay: 0.15s;
}
.rein:nth-child(5) {
  animation-delay: 0.2s;
}
@keyframes rein {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
.kennzahlen {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 26px;
}
.kz {
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 16px;
  padding: 16px;
  display: grid;
  gap: 4px;
  align-content: start;
}
.kz small {
  color: var(--text3);
  font-size: 12px;
  display: flex;
  gap: 6px;
  align-items: center;
}
.kz small svg {
  width: 13px;
  height: 13px;
}
.kz b {
  font-family: var(--f-display);
  font-size: 26px;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}
.kz > span {
  color: var(--text2);
  font-size: 12px;
}
.warn-text {
  color: var(--warn) !important;
}
.meter {
  height: 8px;
  border-radius: 99px;
  background: var(--flaeche2);
  overflow: hidden;
  position: relative;
  margin-top: 4px;
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
.abschnitt {
  margin-bottom: 28px;
}
.abschnitt-kopf {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.abschnitt-kopf h2 {
  font-family: var(--f-display);
  font-size: 20px;
  letter-spacing: -0.02em;
  display: flex;
  gap: 10px;
  align-items: center;
}
.abschnitt-kopf h2 svg {
  width: 18px;
  height: 18px;
  color: var(--a);
}
.abschnitt-kopf p {
  margin: 2px 0 0;
  color: var(--text3);
  font-size: 12.5px;
}
.liste {
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 16px;
  overflow: hidden;
}
.zeile {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1.1fr) minmax(0, 1.3fr) auto;
  gap: 18px;
  align-items: center;
  padding: 14px 18px;
  border-top: 1px solid var(--linie);
  transition: background 0.15s;
}
.zeile:first-child {
  border-top: 0;
}
.zeile:hover {
  background: var(--flaeche2);
}
.zeile .name {
  display: flex;
  gap: 12px;
  align-items: center;
  min-width: 0;
}
.zeile .name > div {
  min-width: 0;
}
.zeile .sym {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(var(--a-rgb), 0.1);
  color: var(--a);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.zeile .sym svg {
  width: 17px;
  height: 17px;
}
.zeile b {
  display: block;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.zeile .name small {
  color: var(--text3);
  font-size: 11.5px;
}
.zeile .zugang {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.zeile .bel small {
  display: flex;
  justify-content: space-between;
  font-size: 11.5px;
  color: var(--text2);
  margin-bottom: 2px;
  font-variant-numeric: tabular-nums;
}
.pfeil {
  width: 16px;
  height: 16px;
  color: var(--text3);
}
.leer {
  display: grid;
  gap: 6px;
  justify-items: start;
}
.leer span {
  color: var(--text2);
  font-size: 13px;
  margin-bottom: 6px;
}
.einricht {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 24px;
  align-items: center;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 20px;
  padding: 28px;
}
.einricht h2 {
  font-family: var(--f-display);
  font-size: 26px;
  letter-spacing: -0.03em;
  margin-bottom: 8px;
}
.einricht p {
  color: var(--text2);
  margin: 0 0 16px;
}
.einricht ul {
  margin: 0 0 18px;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 7px;
  font-size: 13px;
  color: var(--text2);
}
.einricht li {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.einricht li svg {
  width: 15px;
  height: 15px;
  color: var(--ok);
  margin-top: 2px;
  flex-shrink: 0;
}
.port {
  max-width: 320px;
}
.stapel {
  display: grid;
  gap: 10px;
}
.ebene {
  border: 1px solid var(--linie);
  background: var(--bg);
  border-radius: 14px;
  padding: 12px 14px;
  display: flex;
  gap: 12px;
  align-items: center;
}
.ebene svg {
  width: 18px;
  height: 18px;
  color: var(--a);
  flex-shrink: 0;
}
.ebene b {
  display: block;
  font-size: 13px;
}
.ebene small {
  color: var(--text3);
  font-size: 12px;
}
.einst-raster {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.einst-raster .block + .block {
  margin-top: 0;
}
.klein {
  font-size: 12px;
  margin: 0 0 12px;
}
.dienst-zeilen {
  display: grid;
  gap: 8px;
  margin: 10px 0 12px;
}
.dienst-zeilen > div {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}
.einheit {
  display: flex;
  gap: 8px;
}
.einheit .eingabe:first-child {
  flex: 1;
}
.einheit .vd-wahl {
  width: 90px;
  flex: none;
}
.schalter-zeile {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 13px;
  margin: 2px 0 6px;
  cursor: pointer;
}
@media (max-width: 980px) {
  .kennzahlen {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 820px) {
  .einricht,
  .einst-raster {
    grid-template-columns: 1fr;
  }
  .zeile {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .zeile .zugang,
  .zeile .bel {
    display: none;
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
