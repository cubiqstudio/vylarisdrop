<script setup lang="ts">
useHead({ title: () => t('Speicher-Erweiterungen', 'Storage add-ons') })
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const { data, error, refresh } = await (useFetch as any)('/api/speicher/ziele', { key: 'speicher-ziele' })
const ziele = computed<any[]>(() => data.value?.ziele || [])
const ort = computed<any>(() => data.value?.ort || {})
const umzug = computed<any>(() => data.value?.umzug || null)
const verteilung = computed<Record<string, { anzahl: number; bytes: number }>>(() => data.value?.verteilung || {})
const umzugLaeuft = computed(() => umzug.value?.status === 'laeuft')

// Assistent
const assistent = reactive<{ offen: boolean; ziel: any }>({ offen: false, ziel: null })
function neu() {
  assistent.ziel = null
  assistent.offen = true
}
function bearbeiten(z: any) {
  assistent.ziel = z
  assistent.offen = true
}
async function nachSpeichern() {
  await refresh()
}

// Verbindung testen
const testet = ref<Record<number, boolean>>({})
const ergebnisse = ref<Record<number, any>>({})
async function testen(z: any) {
  testet.value = { ...testet.value, [z.id]: true }
  try {
    const r = await api(`/api/speicher/ziele/${z.id}/testen`, { method: 'POST' })
    ergebnisse.value = { ...ergebnisse.value, [z.id]: r }
    await refresh()
  } catch (e: any) {
    fehler(e.message)
  } finally {
    testet.value = { ...testet.value, [z.id]: false }
  }
}
const pruefend = ref(false)
async function allePruefen() {
  pruefend.value = true
  try {
    await api('/api/speicher/ziele/status', { method: 'POST' })
    await refresh()
  } catch (e: any) {
    fehler(e.message)
  } finally {
    pruefend.value = false
  }
}

async function umschalten(z: any) {
  try {
    const r: any = await api(`/api/speicher/ziele/${z.id}`, { method: 'PUT', body: { aktiv: !z.aktiv } })
    await refresh()
    ok(z.aktiv ? t('Erweiterung deaktiviert', 'Add-on disabled') : t('Erweiterung aktiviert', 'Add-on enabled'))
    // Ablage-Regeln nennen diese Erweiterung noch: Hinweis (die Regeln überspringen sie, solange sie aus ist)
    if (r?.warnung) fehler(r.warnung)
  } catch (e: any) {
    fehler(e.message)
  }
}
function entfernen(z: any) {
  if (z.dateien || z.papierkorb) {
    fehler(
      t(
        `Auf „${z.name}“ liegen noch ${zahl(z.dateien)} Datei(en)${z.papierkorb ? ` und ${zahl(z.papierkorb)} im Papierkorb` : ''}. Bitte zuerst alle Dateien umziehen (Bereich „Wo deine Dateien liegen“) bzw. den Papierkorb leeren.`,
        `“${z.name}” still holds ${zahl(z.dateien)} file(s)${z.papierkorb ? ` and ${zahl(z.papierkorb)} in the trash` : ''}. Please move all files away first (section “Where your files live”) or empty the trash.`
      )
    )
    return
  }
  bestaetigen(
    t(`„${z.name}“ entfernen?`, `Remove “${z.name}”?`),
    t(
      'Die Verbindungsdaten werden gelöscht. Auf dem Server selbst wird nichts verändert.',
      'The connection details are deleted. Nothing is changed on the server itself.'
    ),
    t('Entfernen', 'Remove'),
    async () => {
      try {
        await api(`/api/speicher/ziele/${z.id}`, { method: 'DELETE' })
        await refresh()
        ok(t('Erweiterung entfernt', 'Add-on removed'))
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}

// Speicherort für neue Uploads
const wechselt = ref(false)
async function ortSetzen(art: 'lokal' | 's3' | 'sftp', zielId?: number) {
  wechselt.value = true
  try {
    await api('/api/speicher/ziele/ort', { method: 'PUT', body: { art, ...(zielId ? { ziel: zielId } : {}) } })
    await refresh()
    ok(
      art === 'sftp'
        ? t('Neue Dateien landen jetzt auf der Erweiterung', 'New files now go to the add-on')
        : art === 's3'
          ? t('Neue Dateien landen jetzt in S3', 'New files now go to S3')
          : t('Neue Dateien landen jetzt auf diesem Server', 'New files now stay on this server')
    )
  } catch (e: any) {
    fehler(e.message)
  } finally {
    wechselt.value = false
  }
}
const istOrt = (z: any) => ort.value.art === 'sftp' && ort.value.sftpZiel === z.id

// Speicher-Pool: mehrere Speicher wie einer
const modus = ref<'einzeln' | 'pool'>('einzeln')
const auswahl = ref<string[]>(['lokal'])
const strategie = ref<'frei' | 'abwechselnd'>('frei')
const poolEntwurf = ref(false) // Nutzer bearbeitet gerade: Auffrischen überschreibt nichts
function poolLaden() {
  modus.value = ort.value.art === 'pool' ? 'pool' : 'einzeln'
  auswahl.value = [...(ort.value.mitglieder || ['lokal'])]
  strategie.value = ort.value.strategie === 'abwechselnd' ? 'abwechselnd' : 'frei'
  poolEntwurf.value = false
}
poolLaden()
const platz = computed<any>(() => data.value?.platz || null)
const istPool = computed(() => ort.value.art === 'pool')
const platzProzent = (m: any) => (m.gesamt ? Math.min(100, Math.max(0, Math.round((m.belegt / m.gesamt) * 100))) : 0)
const mitgliedName = (m: any) => (m.art === 'lokal' ? t('Dieser Server', 'This server') : m.name)
function mitgliedWechsel(id: string, an: boolean) {
  poolEntwurf.value = true
  auswahl.value = an ? [...new Set([...auswahl.value, id])] : auswahl.value.filter((x) => x !== id)
}
async function poolSpeichern() {
  if (!auswahl.value.length) return fehler(t('Bitte mindestens ein Mitglied wählen.', 'Please choose at least one member.'))
  wechselt.value = true
  try {
    await api('/api/speicher/ziele/ort', {
      method: 'PUT',
      body: { art: 'pool', mitglieder: auswahl.value, strategie: strategie.value }
    })
    await refresh()
    poolLaden()
    ok(t('Speicher-Pool gespeichert', 'Storage pool saved'))
  } catch (e: any) {
    fehler(e.message)
  } finally {
    wechselt.value = false
  }
}
const aktive = computed(() => ziele.value.filter((z) => z.aktiv && z.schreibbar))
const gesperrt = computed(() => !!ort.value.ausUmgebung || wechselt.value)

const umzugPanel = ref<any>(null)
function hierherUmziehen(z: any) {
  umzugPanel.value?.starten(`sftp${z.id}`)
}

// Live: Verteilung der Dateien auf die Speicher und freier Platz. Bei Datei-Meldungen (höchstens alle 5 s) und im
// Hintergrund-Abgleich (alle 2 s während eines Umzugs, sonst alle 5 s), nur bei sichtbarem Tab; nie bei offenem Assistenten
// oder Pool-Entwurf. Fehler bleiben still, die Anzeige behält die letzten Werte.
useLiveDaten({
  daten: [{ schluessel: 'speicher-ziele', url: '/api/speicher/ziele' }],
  themen: ['dateien'],
  mind: () => (umzugLaeuft.value ? 2000 : 5000),
  intervall: 2000,
  pausiert: () => assistent.offen || !!poolEntwurf.value
})
</script>

<template>
  <section class="rein">
    <div class="kopf">
      <div>
        <div class="eyebrow"><Ico n="database" /> {{ t('Administration', 'Administration') }}</div>
        <h1>{{ t('Speicher-Erweiterungen', 'Storage add-ons') }}</h1>
        <p>
          {{
            t(
              'Binde SFTP-Speicher — z. B. eine Hetzner Storage Box, ein NAS oder einen eigenen Server — online als zusätzlichen Speicherort ein. Ohne Neustart und ohne Zugriff auf den Server.',
              'Connect SFTP storage — e.g. a Hetzner Storage Box, a NAS or your own server — online as an extra storage location. No restart and no access to the server needed.'
            )
          }}
        </p>
      </div>
      <div class="reihe" v-if="!error">
        <button type="button" class="knopf" :disabled="pruefend || !ziele.length" @click="allePruefen">
          <Ico :n="pruefend ? 'loader' : 'clock'" :spin="pruefend" /> {{ t('Status prüfen', 'Check status') }}
        </button>
        <button type="button" class="knopf rot" @click="neu"><Ico n="plus" /> {{ t('SFTP-Speicher hinzufügen', 'Add SFTP storage') }}</button>
      </div>
    </div>

    <div v-if="error" class="block leer-hinweis">
      <h3>{{ t('Nur für Administratoren', 'Administrators only') }}</h3>
      <p>{{ t('Dafür fehlt dir die Berechtigung.', 'You do not have permission for this.') }}</p>
    </div>

    <template v-else>
      <!-- Speicherort für neue Uploads -->
      <section class="block zo" aria-labelledby="zo-titel">
        <div class="reihe zw">
          <h3 id="zo-titel">{{ t('Wohin mit neuen Dateien?', 'Where do new files go?') }}</h3>
          <span v-if="ort.ausUmgebung" class="chip neutral"><Ico n="lock" /> {{ t('über VD_S3_* festgelegt', 'set via VD_S3_*') }}</span>
        </div>
        <p class="leise zo-text">
          {{
            t(
              'Gilt für alle neuen Uploads. Vorhandene Dateien bleiben, wo sie sind — mit „Dateien umziehen“ unten holst du sie nach.',
              'Applies to all new uploads. Existing files stay where they are — use “Move files” below to bring them over.'
            )
          }}
        </p>
        <div v-if="ort.ausgewichen" class="meldung meldung-warn" role="status">
          <Ico n="alert" />
          {{
            t(
              'Die gewählte Erweiterung ist deaktiviert, schreibgeschützt oder entfernt — neue Dateien landen vorerst auf diesem Server.',
              'The selected add-on is disabled, write-protected or removed — new files currently go to this server.'
            )
          }}
        </div>
        <div class="zo-wahl zo-modus" role="radiogroup" :aria-label="t('Art der Speicherwahl', 'Kind of storage choice')">
          <label :class="{ an: modus === 'einzeln' }">
            <input v-model="modus" type="radio" name="modus" value="einzeln" :disabled="gesperrt" @change="poolEntwurf = true" />
            <Ico n="server" />
            <span><b>{{ t('Nur ein Speicher', 'One storage only') }}</b><small>{{ t('Alle neuen Dateien an einen Ort', 'All new files to one place') }}</small></span>
          </label>
          <label :class="{ an: modus === 'pool' }">
            <input v-model="modus" type="radio" name="modus" value="pool" :disabled="gesperrt" @change="poolEntwurf = true" />
            <Ico n="knoten" />
            <span><b>{{ t('Speicher-Pool', 'Storage pool') }}</b><small>{{ t('Mehrere Speicher zu einem zusammenlegen', 'Combine several storages into one') }}</small></span>
          </label>
        </div>

        <form v-if="modus === 'pool'" class="zo-pool" @submit.prevent="poolSpeichern">
          <fieldset :disabled="gesperrt">
            <legend>{{ t('Mitglieder des Pools', 'Pool members') }}</legend>
            <div class="zo-wahl">
              <label :class="{ an: auswahl.includes('lokal') }">
                <input type="checkbox" :checked="auswahl.includes('lokal')" @change="mitgliedWechsel('lokal', ($event.target as HTMLInputElement).checked)" />
                <Ico n="server" />
                <span><b>{{ t('Dieser Server', 'This server') }}</b><small>{{ t('Ordner /data (Docker-Volume)', 'Folder /data (Docker volume)') }}</small></span>
              </label>
              <label v-for="z in ziele" :key="z.id" :class="{ an: auswahl.includes('sftp' + z.id) }">
                <input type="checkbox" :checked="auswahl.includes('sftp' + z.id)" @change="mitgliedWechsel('sftp' + z.id, ($event.target as HTMLInputElement).checked)" />
                <Ico n="knoten" />
                <span><b>{{ z.name }}</b><small class="mono">{{ z.host }}{{ z.basisPfad }}</small></span>
                <span v-if="!z.aktiv" class="chip neutral">{{ t('aus', 'off') }}</span>
                <span v-else-if="!z.schreibbar" class="chip neutral">{{ t('nur lesen', 'read-only') }}</span>
                <span v-else-if="z.status?.online === false" class="chip rot">{{ t('offline', 'offline') }}</span>
              </label>
            </div>
          </fieldset>
          <label class="feld zo-strategie">
            <span>{{ t('Verteilung neuer Dateien', 'How new files are spread') }}</span>
            <select v-model="strategie" class="eingabe" :disabled="gesperrt" @change="poolEntwurf = true">
              <option value="frei">{{ t('Meisten freien Platz (Standard)', 'Most free space (default)') }}</option>
              <option value="abwechselnd">{{ t('Abwechselnd (reihum)', 'Round robin') }}</option>
            </select>
          </label>
          <p class="leise zo-text">
            {{
              t(
                'Offline, deaktivierte oder schreibgeschützte Mitglieder werden übersprungen; fällt alles aus, bleibt es auf diesem Server. Vorhandene Dateien bleiben, wo sie sind.',
                'Offline, disabled or write-protected members are skipped; if all fail, files stay on this server. Existing files stay where they are.'
              )
            }}
          </p>
          <button type="submit" class="knopf rot" :disabled="gesperrt || !auswahl.length"><Ico n="check" /> {{ t('Pool speichern', 'Save pool') }}</button>
        </form>

        <div v-else class="zo-wahl" role="radiogroup" :aria-label="t('Speicherort für neue Dateien', 'Storage location for new files')">
          <label :class="{ an: ort.art === 'lokal' || (ort.ausgewichen && false) }">
            <input type="radio" name="ort" :checked="ort.art === 'lokal'" :disabled="gesperrt" @change="ortSetzen('lokal')" />
            <Ico n="server" />
            <span><b>{{ t('Dieser Server', 'This server') }}</b><small>{{ t('Ordner /data (Docker-Volume)', 'Folder /data (Docker volume)') }}</small></span>
          </label>
          <label v-if="ort.s3Bereit" :class="{ an: ort.art === 's3' }">
            <input type="radio" name="ort" :checked="ort.art === 's3'" :disabled="gesperrt || !ort.s3Pro" @change="ortSetzen('s3')" />
            <Ico n="wolke" />
            <span><b>S3</b><small>{{ ort.s3Pro ? t('eingerichtet unter „Speicher & Server“', 'set up under “Storage & servers”') : t('nur mit Pro', 'Pro only') }}</small></span>
          </label>
          <label v-for="z in aktive" :key="z.id" :class="{ an: istOrt(z) }">
            <input type="radio" name="ort" :checked="istOrt(z)" :disabled="gesperrt || z.status?.online === false" @change="ortSetzen('sftp', z.id)" />
            <Ico n="knoten" />
            <span><b>{{ z.name }}</b><small class="mono">{{ z.host }}{{ z.basisPfad }}</small></span>
            <span v-if="z.status?.online === false" class="chip rot">{{ t('offline', 'offline') }}</span>
          </label>
        </div>
        <p v-if="!aktive.length && modus !== 'pool'" class="leer-text leise zo-text">{{ t('Sobald du eine SFTP-Erweiterung hinzugefügt hast, erscheint sie hier zur Auswahl.', 'Once you add an SFTP add-on it appears here to choose from.') }}</p>
      </section>

      <!-- Gesamtplatz -->
      <section v-if="platz?.mitglieder?.length" class="block zp" aria-labelledby="zp-titel">
        <div class="reihe zw">
          <h3 id="zp-titel">{{ istPool ? t('Gesamtplatz des Pools', 'Total space of the pool') : t('Platz aller Speicher', 'Space of all storages') }}</h3>
          <span v-if="istPool" class="chip info">{{ ort.strategie === 'abwechselnd' ? t('abwechselnd', 'round robin') : t('meisten freien Platz', 'most free space') }}</span>
        </div>
        <div v-if="platz.summe.bekannt" class="zp-summe">
          <b class="mono">{{ groesse(platz.summe.frei) }}</b>
          <span>{{ t('frei von', 'free of') }} {{ groesse(platz.summe.gesamt) }} · {{ t('belegt', 'used') }} {{ groesse(platz.summe.belegt) }}</span>
          <div class="zp-balken" role="meter" :aria-label="t('Belegung insgesamt', 'Total usage')" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="platz.summe.gesamt ? Math.round((platz.summe.belegt / platz.summe.gesamt) * 100) : 0">
            <i :style="{ width: (platz.summe.gesamt ? (platz.summe.belegt / platz.summe.gesamt) * 100 : 0) + '%' }"></i>
          </div>
          <small v-if="platz.unbekannt" class="leise">{{ t(`Ohne Angabe und nicht in der Summe: ${platz.unbekannt} Mitglied(er).`, `Unknown and not in the total: ${platz.unbekannt} member(s).`) }}</small>
        </div>
        <p v-else class="leise">{{ t('Keine Platzangabe verfügbar.', 'No space information available.') }}</p>
        <ul class="zp-liste">
          <li v-for="m in platz.mitglieder" :key="m.ort">
            <div class="reihe zw">
              <b>{{ mitgliedName(m) }}</b>
              <span v-if="m.online === false" class="chip rot">{{ t('offline', 'offline') }}</span>
              <span v-else-if="m.gesamt == null" class="chip neutral">{{ t('Platz unbekannt', 'space unknown') }}</span>
              <span v-else class="mono zp-zahl">{{ groesse(m.frei) }} {{ t('frei von', 'free of') }} {{ groesse(m.gesamt) }}</span>
            </div>
            <div v-if="m.gesamt != null" class="zp-balken klein" role="meter" :aria-label="mitgliedName(m)" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="platzProzent(m)">
              <i :style="{ width: platzProzent(m) + '%' }"></i>
            </div>
          </li>
        </ul>
      </section>
      <!-- Erweiterungen -->
      <div v-if="ziele.length" class="zl" aria-live="polite">
        <VdZielKarte
          v-for="z in ziele"
          :key="z.id"
          :ziel="z"
          :ist-ort="istOrt(z)"
          :testet="!!testet[z.id]"
          :ergebnis="ergebnisse[z.id]"
          :umzug-laeuft="umzugLaeuft"
          @testen="testen(z)"
          @bearbeiten="bearbeiten(z)"
          @entfernen="entfernen(z)"
          @umschalten="umschalten(z)"
          @ort="ortSetzen('sftp', z.id)"
          @umziehen="hierherUmziehen(z)"
        />
      </div>
      <div v-else class="block leer-hinweis">
        <Ico n="knoten" class="leer-ico" />
        <h3>{{ t('Noch keine Erweiterung', 'No add-on yet') }}</h3>
        <p>
          {{
            t(
              'Füge einen SFTP-Speicher hinzu, um mehr Platz zu bekommen oder Dateien auf ein NAS oder eine Storage Box auszulagern.',
              'Add an SFTP storage to get more space or to move files to a NAS or a storage box.'
            )
          }}
        </p>
        <button type="button" class="knopf rot" @click="neu"><Ico n="plus" /> {{ t('SFTP-Speicher hinzufügen', 'Add SFTP storage') }}</button>
      </div>

      <VdZielUmzug ref="umzugPanel" :ziele="ziele" :verteilung="verteilung" :umzug="umzug" :ort="ort" @refresh="refresh" />
      <VdZielHilfe />
    </template>

    <VdZielAssistent v-if="assistent.offen" :ziel="assistent.ziel" @zu="assistent.offen = false" @gespeichert="nachSpeichern" />
  </section>
</template>

<style scoped>
.zo-modus {
  margin-bottom: 18px;
}
.zo-pool {
  margin: 0 0 14px;
}
.zo-pool fieldset {
  border: 0;
  padding: 0;
  margin: 0 0 12px;
  min-width: 0;
}
.zo-pool legend {
  font-weight: 600;
  margin-bottom: 8px;
  padding: 0;
}
.zo-strategie {
  max-width: 420px;
  margin-bottom: 8px;
}
.zp-summe {
  display: grid;
  gap: 6px;
  margin: 8px 0 14px;
}
.zp-summe > b {
  font-size: 26px;
}
.zp-balken {
  height: 10px;
  border-radius: 6px;
  background: var(--linie);
  overflow: hidden;
}
.zp-balken.klein {
  height: 6px;
  margin-top: 6px;
}
.zp-balken i {
  display: block;
  height: 100%;
  background: var(--a);
  border-radius: 6px;
}
.zp-liste {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 12px;
}
.zp-zahl {
  font-size: 13px;
  color: var(--text2);
}

.block + .block,
.zl + .block,
.block + .zl,
.zl + section {
  margin-top: 14px;
}
.zl {
  display: grid;
  gap: 14px;
  margin-top: 14px;
}
.zo-text {
  margin: 6px 0 0;
  font-size: 13px;
}
.zo .meldung {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 12px 0 0;
}
.zo .meldung svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}
.zo-wahl {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 10px;
  margin: 14px 0 4px;
}
.zo-wahl label {
  display: flex;
  gap: 12px;
  align-items: center;
  border: 1.5px solid var(--linie);
  border-radius: 14px;
  padding: 14px;
  cursor: pointer;
  position: relative;
  transition: border-color 0.2s, background 0.2s;
  min-width: 0;
}
.zo-wahl label:hover {
  border-color: var(--linie2);
}
.zo-wahl label.an {
  border-color: var(--a);
  background: rgba(var(--a-rgb), 0.05);
}
.zo-wahl label:has(input:focus-visible) {
  outline: 2px solid var(--a);
  outline-offset: 2px;
}
.zo-wahl label:has(input:disabled) {
  cursor: default;
  opacity: 0.6;
}
.zo-wahl input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.zo-wahl svg {
  width: 20px;
  height: 20px;
  color: var(--text3);
  flex-shrink: 0;
}
.zo-wahl label.an svg {
  color: var(--a);
}
.zo-wahl span:not(.chip) {
  min-width: 0;
  flex: 1;
}
.zo-wahl b {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zo-wahl small {
  display: block;
  color: var(--text3);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.leer-ico {
  width: 34px;
  height: 34px;
  color: var(--a);
  margin-bottom: 10px;
}
.leer-hinweis .knopf {
  margin-top: 14px;
}
@media (max-width: 560px) {
  .kopf .reihe {
    width: 100%;
  }
  .kopf .reihe .knopf {
    flex: 1 1 auto;
  }
}
</style>
