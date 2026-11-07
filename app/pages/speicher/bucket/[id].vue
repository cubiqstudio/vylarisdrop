<script setup lang="ts">
const route = useRoute()
const id = computed(() => Number(route.params.id))
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const tage = ref(30)
const { data, refresh, error } = await (useFetch as any)(() => `/api/speicher/buckets/${id.value}?tage=${tage.value}`, {
  key: `bucket-${id.value}`,
  watch: [tage]
})
const bucket = computed<any>(() => data.value?.bucket)
const schluessel = computed<any[]>(() => data.value?.schluessel || [])
const a = computed<any>(() => data.value?.adresse || {})
useHead({ title: () => bucket.value?.name || 'Bucket' })
const proz = computed(() =>
  bucket.value?.kontingent ? Math.min(100, (bucket.value.belegt / bucket.value.kontingent) * 100) : 0
)
const stufe = computed(() => (proz.value >= 99.5 ? 'voll' : proz.value >= 80 ? 'warn' : ''))
const einmal = ref<{ titel: string; zeilen: Array<{ label: string; wert: string }> } | null>(null)

const kont = ref<{ wert: number; e: string } | null>(null)
watch(
  bucket,
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
  try {
    await api(`/api/speicher/buckets/${id.value}`, {
      method: 'PATCH',
      body: { kontingentGb: Number(kont.value!.wert) * (kont.value!.e === 'TB' ? 1024 : 1) }
    })
    await refresh()
    ok(t('Gespeichert', 'Saved'))
  } catch (e: any) {
    fehler(e.message)
  }
}
const neuS = ref<any>(null)
const schickt = ref(false)
async function sAnlegen() {
  schickt.value = true
  try {
    const r = await api(`/api/speicher/buckets/${id.value}/schluessel`, { method: 'POST', body: neuS.value })
    neuS.value = null
    await refresh()
    einmal.value = {
      titel: t('Schlüssel angelegt', 'Key created'),
      zeilen: [
        { label: t('Endpunkt', 'Endpoint'), wert: a.value.s3 },
        { label: 'Bucket', wert: bucket.value.name },
        { label: 'Region', wert: a.value.region },
        { label: 'Access Key', wert: r.schluessel.accessKey },
        { label: 'Secret', wert: r.schluessel.secret }
      ]
    }
  } catch (e: any) {
    fehler(e.message)
  } finally {
    schickt.value = false
  }
}
function sLoeschen(s: any) {
  bestaetigen(
    t('Schlüssel löschen?', 'Delete key?'),
    t(
      `„${s.name}“ (${s.accessKey}) gilt sofort nicht mehr — Programme, die ihn nutzen, verlieren den Zugriff.`,
      `“${s.name}” (${s.accessKey}) stops working immediately — programs using it lose access.`
    ),
    t('Löschen', 'Delete'),
    async () => {
      try {
        await api(`/api/speicher/buckets/${id.value}/schluessel/${s.id}`, { method: 'DELETE' })
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
    t('Bucket löschen?', 'Delete bucket?'),
    t(
      `„${bucket.value.name}“ wird mit allen ${zahl(bucket.value.objekte)} Objekten (${groesse(bucket.value.belegt)}) und allen Schlüsseln endgültig gelöscht. Das lässt sich nicht rückgängig machen.`,
      `“${bucket.value.name}” is deleted permanently with all ${zahl(bucket.value.objekte)} objects (${groesse(bucket.value.belegt)}) and all keys. This cannot be undone.`
    ),
    t('Endgültig löschen', 'Delete permanently'),
    async () => {
      try {
        await api(`/api/speicher/buckets/${id.value}`, { method: 'DELETE' })
        ok(t('Bucket gelöscht', 'Bucket deleted'))
        await navigateTo('/speicher')
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}

const bsp = ref<'aws' | 'rclone' | 'restic' | 'node'>('rclone')
const beispiel = computed(() => {
  const b = bucket.value?.name || 'bucket',
    e = a.value.s3 || 'https://cloud.example.com',
    k = schluessel.value[0]?.accessKey || 'ACCESS_KEY'
  return {
    aws: `aws configure set default.s3.addressing_style path\naws configure set default.region ${a.value.region}\nexport AWS_ACCESS_KEY_ID=${k} AWS_SECRET_ACCESS_KEY=SECRET\n\naws --endpoint-url ${e} s3 ls s3://${b}/\naws --endpoint-url ${e} s3 cp datei.zip s3://${b}/`,
    rclone: `rclone config create cloud s3 provider=Other \\\n  endpoint=${e} region=${a.value.region} force_path_style=true \\\n  access_key_id=${k} secret_access_key=SECRET\n\nrclone copy ./fotos cloud:${b}/fotos --progress`,
    restic: `export AWS_ACCESS_KEY_ID=${k} AWS_SECRET_ACCESS_KEY=SECRET\nexport RESTIC_PASSWORD=${t('ein-langes-passwort', 'a-long-password')}\n\nrestic -r s3:${e}/${b}/server1 init\nrestic -r s3:${e}/${b}/server1 backup /srv`,
    node: `import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'\n\nconst s3 = new S3Client({\n  endpoint: '${e}', region: '${a.value.region}', forcePathStyle: true,\n  credentials: { accessKeyId: '${k}', secretAccessKey: process.env.S3_SECRET },\n})\nawait s3.send(new PutObjectCommand({ Bucket: '${b}', Key: 'hallo.txt', Body: 'Hallo' }))`,
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
</script>

<template>
  <div class="detail">
    <div v-if="error || !bucket" class="leer-hinweis"><h3>{{ t('Bucket nicht gefunden', 'Bucket not found') }}</h3><NuxtLink to="/speicher" class="knopf">{{ t('Zur Übersicht', 'To the overview') }}</NuxtLink></div>
    <template v-else>
      <NuxtLink to="/speicher" class="zurueck"><Ico n="left" /> {{ t('Speicher', 'Storage') }}</NuxtLink>
      <div class="detail-kopf rein">
        <span class="sym"><Ico n="database" /></span>
        <div class="titel"><h1 class="mono-titel">{{ bucket.name }}</h1><div class="unter"><span>{{ t('S3-kompatibel', 'S3-compatible') }} · Region <span class="mono">{{ a.region }}</span></span><span>· {{ t('angelegt am', 'created on') }} {{ datum(bucket.angelegt) }}</span><span v-if="bucket.besitzer">· {{ bucket.besitzer }}</span></div></div>
      </div>
      <div class="raster">
        <div>
          <section class="karte rein">
            <h3><Ico n="gauge" /> {{ t('Belegung', 'Usage') }}
              <span class="seg rechts"><button v-for="z in [7, 30, 90]" :key="z" type="button" :class="{ an: tage === z }" @click="tage = z">{{ z }} {{ t('T', 'd') }}</button></span></h3>
            <div class="bel-gross"><b>{{ groesse(bucket.belegt) }}</b><span>{{ t('von', 'of') }} {{ groesse(bucket.kontingent) }}</span><em>{{ zahl(bucket.objekte) }} {{ t('Objekte', 'objects') }} · {{ zahl(proz, 0) }} %</em></div>
            <div class="meter" role="meter" :aria-valuenow="Math.round(proz)" aria-valuemin="0" aria-valuemax="100"><i :class="stufe" :style="{ width: proz + '%' }"></i></div>
            <p v-if="stufe === 'voll'" class="meldung meldung-fehler voll-hinweis">{{ t('Das Kontingent ist voll: neue Objekte werden abgelehnt (S3-Fehler 403).', 'The quota is full: new objects are rejected (S3 error 403).') }}</p>
            <VdLinie class="verlauf" :punkte="data.verlauf" :format="groesse" ausschnitt :hoehe="140" :leer-text="t('Noch kein Verlauf — VylarisCloud misst jede Stunde.', 'No history yet — VylarisCloud measures every hour.')" />
          </section>

          <section class="karte rein">
            <h3><Ico n="key" /> {{ t('Zugangsschlüssel', 'Access keys') }} <button type="button" class="knopf klein rechts" @click="neuS = { name: '', schreiben: true }"><Ico n="plus" /> {{ t('Schlüssel', 'Key') }}</button></h3>
            <div v-if="schluessel.length" class="tab-wrap"><table class="tab">
              <thead><tr><th>{{ t('Name', 'Name') }}</th><th>Access Key</th><th>{{ t('Rechte', 'Rights') }}</th><th>{{ t('Erstellt', 'Created') }}</th><th><span class="versteckt">{{ t('Aktionen', 'Actions') }}</span></th></tr></thead>
              <tbody><tr v-for="s in schluessel" :key="s.id">
                <td>{{ s.name }}</td><td><code>{{ s.accessKey }}</code></td>
                <td><span :class="['chip', s.schreiben ? 'info' : 'neutral']"><Ico :n="s.schreiben ? 'edit' : 'eye'" /> {{ s.schreiben ? t('Lesen + Schreiben', 'Read + write') : t('Nur lesen', 'Read only') }}</span></td>
                <td class="sehrleise">{{ datum(s.angelegt) }}</td>
                <td class="aktionen"><button type="button" class="knopf nur-icon" :title="t('Löschen', 'Delete')" :aria-label="t('Löschen', 'Delete')" @click="sLoeschen(s)"><Ico n="trash" /></button></td>
              </tr></tbody>
            </table></div>
            <p v-else class="sehrleise klein">{{ t('Noch kein Schlüssel — ohne Schlüssel kommt niemand an den Bucket.', 'No key yet — without a key nobody can access the bucket.') }}</p>
          </section>

          <section class="karte rein">
            <h3><Ico n="terminal" /> {{ t('Einbinden', 'Connect') }}</h3>
            <div class="seg bsp-wahl"><button v-for="b in (['aws', 'rclone', 'restic', 'node'] as const)" :key="b" type="button" :class="{ an: bsp === b }" @click="bsp = b">{{ { aws: 'aws-cli', rclone: 'rclone', restic: 'restic', node: 'Node.js' }[b] }}</button></div>
            <div class="cmd-box"><pre class="cmd">{{ beispiel }}</pre><button type="button" class="kopier-ecke" :aria-label="t('Kopieren', 'Copy')" @click="bspKopieren"><Ico :n="bspKopiert ? 'check' : 'copy'" /></button></div>
            <p class="sehrleise klein">{{ t('SECRET durch das Secret des Schlüssels ersetzen. Wichtig: Path-Style (nicht Virtual-Host) verwenden.', 'Replace SECRET with the key’s secret. Important: use path style (not virtual host).') }}</p>
          </section>
        </div>
        <div>
          <section class="karte rein">
            <h3><Ico n="link" /> {{ t('Endpunkt', 'Endpoint') }}</h3>
            <div class="zeilen">
              <VdKopierZeile :label="t('Endpunkt', 'Endpoint')" :wert="a.s3" />
              <VdKopierZeile label="Bucket" :wert="bucket.name" />
              <VdKopierZeile label="Region" :wert="a.region" />
              <VdKopierZeile :label="t('Adressierung', 'Addressing')" wert="Path-Style"><span></span></VdKopierZeile>
            </div>
          </section>
          <section v-if="kont" class="karte rein">
            <h3><Ico n="gauge" /> {{ t('Kontingent', 'Quota') }}</h3>
            <form class="einheit" @submit.prevent="kontSpeichern"><input v-model.number="kont.wert" class="eingabe mono" type="number" min="0.1" step="any" :aria-label="t('Kontingent', 'Quota')"><VdAuswahl v-model="kont.e" class="eingabe" :aria-label="t('Einheit', 'Unit')"><option>GB</option><option>TB</option></VdAuswahl><button class="knopf">{{ t('Speichern', 'Save') }}</button></form>
            <p class="sehrleise klein">{{ t('Ist es voll, lehnt der Bucket neue Objekte sofort ab. Bei 80 % kommt eine Warnung.', 'When it is full, the bucket rejects new objects immediately. You get a warning at 80%.') }}</p>
          </section>
          <section class="karte gefahr-karte rein">
            <h3><Ico n="alert" /> {{ t('Bucket löschen', 'Delete bucket') }}</h3>
            <p class="sehrleise klein">{{ t('Löscht alle Objekte und Schlüssel dieses Buckets endgültig.', 'Permanently deletes all objects and keys of this bucket.') }}</p>
            <button type="button" class="knopf gefahr" @click="loeschen"><Ico n="trash" /> {{ t('Bucket löschen …', 'Delete bucket …') }}</button>
          </section>
        </div>
      </div>
    </template>

    <VdModal v-if="neuS" :titel="t('Neuer Zugangsschlüssel', 'New access key')" @zu="neuS = null">
      <form @submit.prevent="sAnlegen">
        <label class="feld"><span>{{ t('Name', 'Name') }}</span><input v-model="neuS.name" class="eingabe" maxlength="60" required :placeholder="t('z. B. restic auf dem NAS', 'e.g. restic on the NAS')"></label>
        <div class="rechte-wahl"><button type="button" :class="{ an: neuS.schreiben }" @click="neuS.schreiben = true"><b>{{ t('Lesen + Schreiben', 'Read + write') }}</b><small>{{ t('für Backups und Apps', 'for backups and apps') }}</small></button><button type="button" :class="{ an: !neuS.schreiben }" @click="neuS.schreiben = false"><b>{{ t('Nur lesen', 'Read only') }}</b><small>{{ t('nur herunterladen', 'download only') }}</small></button></div>
        <div class="modal-fuss"><button type="button" class="knopf" @click="neuS = null">{{ t('Abbrechen', 'Cancel') }}</button><button class="knopf rot" :disabled="schickt || !neuS.name"><Ico :n="schickt ? 'loader' : 'key'" :class="{ spin: schickt }" /> {{ t('Anlegen', 'Create') }}</button></div>
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
.klein {
  font-size: 12px;
  margin: 8px 0 12px;
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
.aktionen {
  text-align: right;
  white-space: nowrap;
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
