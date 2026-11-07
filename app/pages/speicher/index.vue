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

// Budget des eigenen Kontos (Server rechnet; hier nur Anzeige): Kontingent, belegt, reserviert, frei zum Einplanen
const bud = computed<any>(() => d.value.budget || null)
const GB1 = 1024 ** 3
const gesperrtText = computed(() => {
  const g = bud.value?.gesperrt
  if (!g || g === 'dienst') return ''
  return g === 'keinBudget'
    ? t('Für dein Konto ist noch kein Speicher für Boxen und Buckets freigegeben. Bitte den Admin, dir ein Kontingent zuzuweisen.', 'No storage for boxes and buckets is enabled for your account yet. Please ask the admin to assign you a quota.')
    : g === 'admins'
      ? t('Neue Boxen und Buckets legen hier nur Admins an.', 'Only admins create new boxes and buckets here.')
      : g === 'anzahl'
        ? t(`Du hast die höchste erlaubte Anzahl erreicht (${bud.value.maxAnzahl} Boxen und Buckets zusammen). Lösche eine, um eine neue anzulegen.`, `You have reached the maximum number (${bud.value.maxAnzahl} boxes and buckets together). Delete one to create a new one.`)
        : g === 'ueberplant'
          ? t('Dein Konto ist überplant. Es wurde nichts gelöscht, aber neue Boxen, Buckets, Vergrößerungen und Uploads werden abgelehnt, bis du Platz schaffst oder der Admin das Kontingent erhöht.', 'Your account is over-planned. Nothing was deleted, but new boxes, buckets, enlargements and uploads are rejected until you free up space or the admin raises the quota.')
          : t('Du hast kein Budget mehr frei zum Einplanen. Gib Platz frei (Dateien löschen, Papierkorb leeren, Boxen oder Buckets verkleinern oder löschen) oder bitte den Admin um mehr Kontingent.', 'You have no budget left to plan. Free up space (delete files, empty the trash, shrink or delete boxes or buckets) or ask the admin for more quota.')
})
const kannAnlegen = computed(() => !bud.value || !bud.value.gesperrt)
const budgetSegmente = computed(() => [
  { bytes: Number(bud.value?.belegt || 0), farbe: '#1e73be' },
  { bytes: Number(bud.value?.eingeplant || 0), farbe: '#8b5cf6' }
])
const budgetGesamt = computed(() => (bud.value?.quelle === 'grenze' ? bud.value.grenze : bud.value?.limit))
const startBytes = (wunsch: number) => {
  const f = bud.value?.frei
  return Math.max(1024 ** 2, f == null ? wunsch : Math.min(wunsch, f))
}
const neuBox = ref<any>(null)
const neuBucket = ref<any>(null)
const maxNeu = computed<number | null>(() => (bud.value?.frei == null ? null : Number(bud.value.frei)))
function boxOeffnen() {
  neuBox.value = { name: '', bytes: startBytes(100 * GB1) }
}
function bucketOeffnen() {
  neuBucket.value = { name: '', bytes: startBytes(50 * GB1), schluessel: true }
}
const einmal = ref<{ titel: string; zeilen: Array<{ label: string; wert: string }> } | null>(null)
const schickt = ref(false)
async function boxAnlegen() {
  schickt.value = true
  try {
    const r = await api('/api/speicher/boxen', {
      method: 'POST',
      body: { name: neuBox.value.name, kontingentBytes: Math.floor(neuBox.value.bytes) }
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
    refresh().catch(() => {})
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
        kontingentBytes: Math.floor(f.bytes),
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
    refresh().catch(() => {})
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
          <button type="button" class="knopf" :disabled="!kannAnlegen" :title="gesperrtText" @click="bucketOeffnen"><Ico n="plus" /> Bucket</button>
          <button type="button" class="knopf rot" :disabled="!kannAnlegen" :title="gesperrtText" @click="boxOeffnen"><Ico n="plus" /> {{ t('Storage-Box', 'Storage box') }}</button>
        </div>
      </div>
      <div v-if="d.admin && (!stand.sftpgo || !stand.garage)" class="meldung meldung-warn rein">
        <b>{{ t('Ein Teil des Speicherdienstes antwortet nicht', 'Part of the storage service is not responding') }}</b> ({{ [!stand.sftpgo && 'SFTPGo', !stand.garage && 'Garage'].filter(Boolean).join(', ') }}).
        {{ t('Auf dem Server: docker compose ps — oder hier unten aus- und wieder einschalten.', 'On the server: docker compose ps — or switch it off and on again below.') }} <span v-if="stand.fehler" class="mono">{{ stand.fehler }}</span>
      </div>
      <section v-if="bud && bud.gesperrt !== 'dienst'" class="budget block rein" aria-labelledby="bud-titel">
        <div class="reihe zw">
          <h2 id="bud-titel">{{ t('Dein Budget', 'Your budget') }}</h2>
          <span v-if="bud.ueberplant" class="chip rot">{{ t('überplant', 'over-planned') }}</span>
          <span v-else-if="bud.frei === null" class="chip neutral">{{ t('Unbegrenzt', 'Unlimited') }}</span>
        </div>
        <dl class="bud-zahlen">
          <div><dt>{{ t('Gesamt', 'Total') }}</dt><dd>{{ budgetGesamt ? groesse(budgetGesamt) : t('Unbegrenzt', 'Unlimited') }}</dd></div>
          <div v-if="bud.quelle === 'kontingent'"><dt>{{ t('Belegt (Dateien + Papierkorb)', 'Used (files + trash)') }}</dt><dd>{{ groesse(bud.belegt) }}</dd></div>
          <div><dt><i class="bud-punkt" aria-hidden="true"></i>{{ t('Für Boxen & Buckets reserviert', 'Reserved for boxes & buckets') }}</dt><dd>{{ groesse(bud.eingeplant) }}</dd></div>
          <div><dt>{{ t('Frei zum Einplanen', 'Free to plan') }}</dt><dd :class="{ 'warn-text': bud.frei === 0 }">{{ bud.frei === null ? t('Unbegrenzt', 'Unlimited') : groesse(bud.frei) }}</dd></div>
        </dl>
        <VdQuotaBalken v-if="budgetGesamt" :used="bud.belegt + bud.eingeplant" :limit="budgetGesamt" :segmente="budgetSegmente" gross :beschriftung="t('Budget: belegt und reserviert', 'Budget: used and reserved')" />
        <p v-if="bud.ueberplant" class="meldung meldung-warn" role="alert">{{ gesperrtText }} {{ t('Überplant um', 'Over-planned by') }} {{ groesse(bud.ueberBytes) }}.</p>
        <p v-else-if="gesperrtText" class="meldung meldung-warn">{{ gesperrtText }}</p>
        <p class="sehrleise klein">
          {{ t('Das Kontingent einer Box oder eines Buckets ist fest für sie reserviert und zählt zu deinem Speicher — auch wenn noch nicht alles belegt ist. Mehr als du frei hast, kannst du nicht einplanen. Löschen und Verkleinern geben den Platz sofort wieder frei.', 'The quota of a box or bucket is reserved for it and counts towards your storage — even if it is not full yet. You cannot plan more than you have free. Deleting and shrinking free the space immediately.') }}
          <template v-if="bud.maxAnzahl > 0"> {{ t(`Höchstens ${bud.maxAnzahl} Boxen und Buckets zusammen (${bud.anzahl} belegt).`, `At most ${bud.maxAnzahl} boxes and buckets together (${bud.anzahl} used).`) }}</template>
          <template v-if="bud.grenze > 0 && bud.quelle === 'kontingent'"> {{ t(`Zusätzlich gilt eine Obergrenze von ${groesse(bud.grenze)} für Boxen und Buckets zusammen.`, `An additional cap of ${groesse(bud.grenze)} applies to boxes and buckets together.`) }}</template>
        </p>
      </section>
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
          <button v-if="d.darfAnlegen" type="button" class="knopf" :disabled="!kannAnlegen" @click="boxOeffnen"><Ico n="plus" /> {{ t('Storage-Box anlegen', 'Create storage box') }}</button></div>
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
          <button v-if="d.darfAnlegen" type="button" class="knopf" :disabled="!kannAnlegen" @click="bucketOeffnen"><Ico n="plus" /> {{ t('Bucket anlegen', 'Create bucket') }}</button></div>
      </section>

      <section v-if="d.inhaber && einst" class="abschnitt rein">
        <div class="abschnitt-kopf"><div><h2><Ico n="gear" /> {{ t('Einstellungen', 'Settings') }}</h2><p>{{ t('Nur für dich als Inhaber sichtbar.', 'Only visible to you as the owner.') }}</p></div></div>
        <div class="einst-raster">
          <div class="block">
            <h3>{{ t('Wer darf Speicher anlegen?', 'Who may create storage?') }}</h3>
            <div class="seg" style="margin: 10px 0 14px"><button type="button" :class="{ an: einst.wer === 'admins' }" @click="einst.wer = 'admins'">{{ t('Nur Admins', 'Admins only') }}</button><button type="button" :class="{ an: einst.wer === 'alle' }" @click="einst.wer = 'alle'">{{ t('Alle Konten', 'All accounts') }}</button></div>
            <template v-if="einst.wer === 'alle'">
              <label class="feld"><span>{{ t('Obergrenze je Konto für Boxen + Buckets zusammen (GB, 0 = keine zusätzliche)', 'Cap per account for boxes + buckets together (GB, 0 = no additional cap)') }}</span><input v-model.number="einst.grenzeGb" class="eingabe mono" type="number" min="0" step="1"></label>
              <label class="feld"><span>{{ t('Höchstens Boxen + Buckets je Konto (0 = unbegrenzt)', 'At most boxes + buckets per account (0 = unlimited)') }}</span><input v-model.number="einst.maxAnzahl" class="eingabe mono" type="number" min="0" step="1"></label>
              <div class="regeln">
                <b>{{ t('So funktioniert das Budget', 'How the budget works') }}</b>
                <ul>
                  <li>{{ t('Jeder Nutzer darf höchstens das einplanen, was ihm als Kontingent zugewiesen ist (Nutzer-Seite, Rolle oder Standard) — abzüglich seiner Dateien, seines Papierkorbs und dessen, was er schon für Boxen und Buckets eingeplant hat.', 'Every user may plan at most the quota assigned to them (users page, role or default) — minus their files, their trash and what they already planned for boxes and buckets.') }}</li>
                  <li>{{ t('Das Eingeplante zählt zum Speicher des Kontos: Uploads, Kopieren und WebDAV passen nur noch in den Rest.', 'What is planned counts towards the account storage: uploads, copying and WebDAV only fit into the rest.') }}</li>
                  <li>{{ t('Konten ohne Limit (nur Rolle „Nutzer“) dürfen nur bis zur Obergrenze oben einplanen. Ist sie 0, dürfen sie nichts anlegen. Für begrenzte Konten gilt die Obergrenze zusätzlich zum Kontingent.', 'Accounts without a limit (role “user” only) may only plan up to the cap above. If it is 0, they may not create anything. For limited accounts the cap applies in addition to the quota.') }}</li>
                  <li>{{ t('Senkst du ein Kontingent unter das Belegte plus Eingeplante, wird nichts gelöscht: Das Konto ist dann „überplant“ und lehnt neue Boxen, Buckets und Uploads ab.', 'If you lower a quota below used plus planned, nothing is deleted: the account is then “over-planned” and rejects new boxes, buckets and uploads.') }}</li>
                  <li>{{ t('Admins und du seid nicht durch Anzahl und Obergrenze begrenzt; hat ein Konto aber ein eigenes Limit, gilt es auch für dich.', 'Admins and you are not limited by count and cap; but if an account has its own limit, it applies to you too.') }}</li>
                </ul>
              </div>
            </template>
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
        <div class="feld"><span>{{ t('Kontingent', 'Quota') }}</span>
          <VdBudgetEingabe v-model="neuBox.bytes" :min="bud?.min || 1048576" :max="maxNeu" :beschriftung="t('Kontingent der Box', 'Box quota')" hinweis-id="hint-box" />
          <small id="hint-box">{{ maxNeu != null ? t('Mehr als dein freies Budget kannst du nicht einplanen.', 'You cannot plan more than your free budget.') : t('Du hast kein Limit.', 'You have no limit.') }}<template v-if="d.platte"> {{ t('Frei auf dem Server:', 'Free on the server:') }} {{ groesse(d.platte.frei) }}</template></small></div>
        <p class="sehrleise klein">{{ t('Benutzername und Passwort bekommst du gleich danach — das Passwort nur einmal.', 'You get the user name and password right afterwards — the password only once.') }}</p>
        <div class="modal-fuss"><button type="button" class="knopf" @click="neuBox = null">{{ t('Abbrechen', 'Cancel') }}</button><button class="knopf rot" :disabled="schickt || !neuBox.name || (maxNeu != null && maxNeu < (bud?.min || 1048576))"><Ico :n="schickt ? 'loader' : 'box'" :class="{ spin: schickt }" /> {{ t('Anlegen', 'Create') }}</button></div>
      </form>
    </VdModal>
    <VdModal v-if="neuBucket" :titel="t('Neuer Bucket', 'New bucket')" @zu="neuBucket = null">
      <form @submit.prevent="bucketAnlegen">
        <label class="feld"><span>{{ t('Name', 'Name') }}</span><input v-model="neuBucket.name" class="eingabe mono" maxlength="63" required placeholder="mein-bucket" autocapitalize="off" spellcheck="false" @input="neuBucket.name = neuBucket.name.toLowerCase()">
          <small :class="{ 'warn-text': bucketName && !bucketNameOk }">{{ t('3–63 Zeichen: Kleinbuchstaben, Ziffern und Bindestriche. Der Name gilt für die ganze Installation.', '3–63 characters: lowercase letters, digits and hyphens. The name is unique across the installation.') }}</small></label>
        <div class="feld"><span>{{ t('Kontingent', 'Quota') }}</span>
          <VdBudgetEingabe v-model="neuBucket.bytes" :min="bud?.min || 1048576" :max="maxNeu" :beschriftung="t('Kontingent des Buckets', 'Bucket quota')" hinweis-id="hint-bucket" />
          <small id="hint-bucket">{{ maxNeu != null ? t('Mehr als dein freies Budget kannst du nicht einplanen.', 'You cannot plan more than your free budget.') : t('Du hast kein Limit.', 'You have no limit.') }}</small></div>
        <label class="schalter-zeile"><button type="button" :class="['schalter', { an: neuBucket.schluessel }]" :aria-pressed="neuBucket.schluessel" @click="neuBucket.schluessel = !neuBucket.schluessel"></button> {{ t('Gleich einen Zugangsschlüssel anlegen (Lesen + Schreiben)', 'Create an access key right away (read + write)') }}</label>
        <div class="modal-fuss"><button type="button" class="knopf" @click="neuBucket = null">{{ t('Abbrechen', 'Cancel') }}</button><button class="knopf rot" :disabled="schickt || !bucketNameOk || (maxNeu != null && maxNeu < (bud?.min || 1048576))"><Ico :n="schickt ? 'loader' : 'database'" :class="{ spin: schickt }" /> {{ t('Anlegen', 'Create') }}</button></div>
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
.budget {
  display: grid;
  gap: 12px;
  margin-bottom: 18px;
}
.budget h2 {
  font-family: var(--f-display);
  font-size: 18px;
  letter-spacing: -0.02em;
  margin: 0;
}
.bud-zahlen {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 10px 18px;
  margin: 0;
}
.bud-zahlen dt {
  color: var(--text3);
  font-size: 12px;
}
.bud-zahlen dd {
  margin: 2px 0 0;
  font-family: var(--f-display);
  font-size: 20px;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.bud-punkt {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 3px;
  background: #8b5cf6;
  margin-right: 6px;
}
.regeln {
  background: var(--flaeche2);
  border-radius: 12px;
  padding: 10px 14px;
  margin: 4px 0 14px;
  font-size: 12.5px;
  color: var(--text2);
}
.regeln ul {
  margin: 6px 0 0;
  padding-left: 18px;
  display: grid;
  gap: 4px;
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
