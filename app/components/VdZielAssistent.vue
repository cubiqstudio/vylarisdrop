<script setup lang="ts">
// Assistent „SFTP-Speicher hinzufügen / bearbeiten“: Angaben → Fingerabdruck bestätigen → Test → Speichern
const props = defineProps<{ ziel?: any }>()
const emit = defineEmits<{ (e: 'zu'): void; (e: 'gespeichert'): void }>()
const { ok, fehler } = useToast()

const bearb = !!props.ziel
const VORLAGEN = [
  {
    k: 'hetzner',
    name: 'Hetzner Storage Box',
    port: 23,
    host: 'u123456.your-storagebox.de',
    benutzer: 'u123456',
    pfad: '/vylariscloud'
  },
  { k: 'nas', name: 'Synology / QNAP / NAS', port: 22, host: 'nas.local', benutzer: 'vylariscloud', pfad: '/vylariscloud' },
  { k: 'eigen', name: t('Eigener Server (Linux)', 'Own server (Linux)'), port: 22, host: 'speicher.example.org', benutzer: 'vylariscloud', pfad: '/srv/vylariscloud' },
  { k: 'andere', name: t('Anderer SFTP-Anbieter', 'Other SFTP provider'), port: 22, host: '', benutzer: '', pfad: '/vylariscloud' }
]
const z0 = props.ziel
const f = reactive({
  name: z0?.name || '',
  vorlage: z0 ? 'andere' : 'hetzner',
  host: z0?.host || '',
  port: z0?.port || 23,
  benutzer: z0?.benutzer || '',
  auth: (z0?.auth || 'passwort') as 'passwort' | 'schluessel',
  passwort: '',
  schluessel: '',
  passphrase: '',
  basis_pfad: z0?.basisPfad || '/vylariscloud',
  schreibbar: z0 ? !!z0.schreibbar : true
})
const vorlage = computed(() => VORLAGEN.find((v) => v.k === f.vorlage) || VORLAGEN[3]!)
function vorlageWahl() {
  if (bearb) return
  const v = vorlage.value
  f.port = v.port
  f.basis_pfad = v.pfad
}

const pin = ref<string>(z0?.hostKey || '') // bestätigter Fingerabdruck
const zuBestaetigen = ref<{ fp: string; typ: string; geaendert: boolean } | null>(null)
const test = ref<any>(null)
const laeuft = ref<'' | 'test' | 'speichern'>('')
const fehlerText = ref('')

// Verbindungsrelevantes zurücksetzen, sobald es sich ändert
watch(
  () => [f.host, f.port],
  () => {
    if (bearb && f.host.trim().toLowerCase() === z0.host && Number(f.port) === z0.port) pin.value = z0.hostKey
    else pin.value = ''
    zuBestaetigen.value = null
    test.value = null
  }
)
watch(
  () => [f.benutzer, f.auth, f.passwort, f.schluessel, f.passphrase, f.basis_pfad, f.schreibbar],
  () => {
    test.value = null
    fehlerText.value = ''
  }
)

const geheimNeu = computed(() => (f.auth === 'passwort' ? !!f.passwort : !!f.schluessel.trim() || !!f.passphrase))
const verbindungGeaendert = computed(
  () =>
    !bearb ||
    f.host.trim().toLowerCase() !== z0.host ||
    Number(f.port) !== z0.port ||
    f.benutzer.trim() !== z0.benutzer ||
    f.auth !== z0.auth ||
    geheimNeu.value ||
    f.basis_pfad.trim() !== z0.basisPfad ||
    pin.value !== z0.hostKey
)
const hostKeyProblem = computed(() => bearb && (z0.status?.hostKeyGeaendert || z0.status?.fehlerCode === 'HOSTKEY'))
const basisGesperrt = computed(() => bearb && (z0.dateien > 0 || z0.papierkorb > 0))

const formGueltig = computed(
  () =>
    f.name.trim() &&
    f.host.trim() &&
    Number(f.port) >= 1 &&
    Number(f.port) <= 65535 &&
    f.benutzer.trim() &&
    f.basis_pfad.trim().startsWith('/') &&
    (bearb || (f.auth === 'passwort' ? !!f.passwort : !!f.schluessel.trim()))
)

const body = (hostKey?: string) => ({
  ...(bearb ? { id: z0.id } : {}),
  name: f.name.trim(),
  host: f.host.trim(),
  port: Number(f.port),
  benutzer: f.benutzer.trim(),
  auth: f.auth,
  ...(f.auth === 'passwort'
    ? { passwort: f.passwort || undefined }
    : { schluessel: f.schluessel.trim() || undefined, passphrase: f.passphrase || undefined }),
  basis_pfad: f.basis_pfad.trim(),
  schreibbar: f.schreibbar,
  ...(hostKey ? { host_key: hostKey } : {})
})

async function pruefen(hostKey?: string) {
  laeuft.value = 'test'
  fehlerText.value = ''
  test.value = null
  try {
    const r = await api('/api/speicher/ziele/testen', { method: 'POST', body: body(hostKey ?? (pin.value || undefined)) })
    if (r.stufe === 'fingerabdruck' && (r.braucheBestaetigung || r.hostKeyGeaendert)) {
      pin.value = ''
      zuBestaetigen.value = { fp: r.fingerabdruck, typ: r.keyTyp, geaendert: !!r.hostKeyGeaendert }
      test.value = null
      if (r.hostKeyGeaendert) fehlerText.value = r.meldung
    } else {
      test.value = r
      if (!r.ok) fehlerText.value = r.meldung
    }
  } catch (e: any) {
    fehlerText.value = e.message
  } finally {
    laeuft.value = ''
  }
}
async function bestaetigen() {
  if (!zuBestaetigen.value) return
  pin.value = zuBestaetigen.value.fp
  zuBestaetigen.value = null
  fehlerText.value = ''
  await pruefen(pin.value)
}
function neuPruefen() {
  pin.value = ''
  zuBestaetigen.value = null
  test.value = null
  void pruefen('')
}

async function speichern() {
  laeuft.value = 'speichern'
  fehlerText.value = ''
  try {
    const r: any = bearb
      ? await api(`/api/speicher/ziele/${z0.id}`, { method: 'PUT', body: body(pin.value || undefined) })
      : await api('/api/speicher/ziele', { method: 'POST', body: body(pin.value) })
    ok(bearb ? t('Änderungen gespeichert', 'Changes saved') : t('Speicher-Erweiterung hinzugefügt', 'Storage add-on added'))
    // Ablage-Regeln nennen diese Box: Ausschalten/Schreibschutz warnt (wie der Schalter in der Liste)
    if (r?.warnung) fehler(r.warnung)
    emit('gespeichert')
    emit('zu')
  } catch (e: any) {
    fehlerText.value = e.message
  } finally {
    laeuft.value = ''
  }
}

const kannSpeichern = computed(
  () => formGueltig.value && (verbindungGeaendert.value ? !!test.value?.ok : true) && !laeuft.value
)

function schluesselDatei(e: Event) {
  const d = (e.target as HTMLInputElement).files?.[0]
  if (!d) return
  if (d.size > 20000) {
    fehler(t('Die Datei ist zu groß für einen SSH-Schlüssel.', 'The file is too large for an SSH key.'))
    return
  }
  const r = new FileReader()
  r.onload = () => {
    f.schluessel = String(r.result || '')
  }
  r.readAsText(d)
  ;(e.target as HTMLInputElement).value = ''
}

const SCHRITT: Record<string, [string, string]> = {
  verbindung: ['Verbindung', 'Connection'],
  hostkey: ['Host-Schlüssel', 'Host key'],
  anmeldung: ['Anmeldung', 'Login'],
  ordner: ['Zielordner', 'Target folder'],
  schreiben: ['Testdatei schreiben', 'Write test file'],
  lesen: ['Zurücklesen (mit Teilbereich)', 'Read back (with byte range)'],
  loeschen: ['Testdatei löschen', 'Delete test file']
}
const kurz = (fp: string) => (fp.length > 24 ? fp.slice(0, 18) + '…' + fp.slice(-6) : fp)
</script>

<template>
  <VdModal :titel="bearb ? t('Speicher-Erweiterung bearbeiten', 'Edit storage add-on') : t('SFTP-Speicher hinzufügen', 'Add SFTP storage')" breit @zu="emit('zu')">
    <form class="za" autocomplete="off" @submit.prevent="pruefen()">
      <div v-if="hostKeyProblem" class="meldung meldung-fehler za-warn" role="alert">
        <Ico n="alert" />
        <span>
          <b>{{ t('Host-Schlüssel hat sich geändert.', 'Host key has changed.') }}</b>
          {{
            t(
              'Der Server meldet einen anderen Schlüssel als beim Einrichten. Das kann eine Neuinstallation sein — oder ein Angriff. Prüfe den neuen Fingerabdruck beim Anbieter, bevor du ihn bestätigst.',
              'The server reports a different key than when it was set up. This may be a reinstall — or an attack. Check the new fingerprint with your provider before confirming it.'
            )
          }}
          <span class="za-warn-knopf">
            <button type="button" class="knopf klein" @click="neuPruefen"><Ico n="shield" /> {{ t('Neuen Fingerabdruck prüfen', 'Check new fingerprint') }}</button>
          </span>
        </span>
      </div>

      <label v-if="!bearb" class="feld">
        <span>{{ t('Anbieter', 'Provider') }}</span>
        <VdAuswahl v-model="f.vorlage" class="eingabe" @change="vorlageWahl">
          <option v-for="v in VORLAGEN" :key="v.k" :value="v.k">{{ v.name }}</option>
        </VdAuswahl>
      </label>
      <label class="feld">
        <span>{{ t('Name', 'Name') }}</span>
        <input v-model="f.name" class="eingabe" maxlength="60" required :placeholder="t('z. B. Hetzner Archiv', 'e.g. Hetzner archive')" />
      </label>
      <div class="za-zeile">
        <label class="feld">
          <span>{{ t('Host (Name oder IP)', 'Host (name or IP)') }}</span>
          <input v-model="f.host" class="eingabe mono" required autocapitalize="off" spellcheck="false" :placeholder="vorlage.host" />
        </label>
        <label class="feld za-port">
          <span>Port</span>
          <input v-model.number="f.port" class="eingabe mono" type="number" min="1" max="65535" required />
        </label>
      </div>
      <label class="feld">
        <span>{{ t('Benutzer', 'User') }}</span>
        <input v-model="f.benutzer" class="eingabe mono" required autocapitalize="off" spellcheck="false" :placeholder="vorlage.benutzer" />
      </label>

      <div class="feld">
        <span>{{ t('Anmeldung', 'Sign-in') }}</span>
        <div class="seg" role="group" :aria-label="t('Anmeldung', 'Sign-in')">
          <button type="button" :class="{ an: f.auth === 'passwort' }" :aria-pressed="f.auth === 'passwort'" @click="f.auth = 'passwort'">
            <Ico n="lock" /> {{ t('Passwort', 'Password') }}
          </button>
          <button type="button" :class="{ an: f.auth === 'schluessel' }" :aria-pressed="f.auth === 'schluessel'" @click="f.auth = 'schluessel'">
            <Ico n="key" /> {{ t('SSH-Schlüssel', 'SSH key') }}
          </button>
        </div>
      </div>
      <label v-if="f.auth === 'passwort'" class="feld">
        <span>{{ t('Passwort', 'Password') }}</span>
        <input
          v-model="f.passwort"
          class="eingabe"
          type="password"
          autocomplete="new-password"
          :required="!bearb"
          :placeholder="bearb && z0.hatGeheim && z0.auth === 'passwort' ? t('gespeichert — leer lassen, um es zu behalten', 'saved — leave empty to keep it') : ''"
        />
      </label>
      <template v-else>
        <div class="feld">
          <span class="za-kopf">
            {{ t('Privater Schlüssel', 'Private key') }}
            <label class="knopf klein za-datei">
              <Ico n="upload" /> {{ t('Datei wählen', 'Choose file') }}
              <input type="file" class="za-nur-sr" @change="schluesselDatei" />
            </label>
          </span>
          <textarea
            v-model="f.schluessel"
            class="eingabe mono za-schluessel"
            rows="5"
            spellcheck="false"
            autocomplete="off"
            :required="!bearb || z0.auth !== 'schluessel'"
            :placeholder="
              bearb && z0.hatGeheim && z0.auth === 'schluessel'
                ? t('gespeichert — leer lassen, um ihn zu behalten', 'saved — leave empty to keep it')
                : '-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----'
            "
          ></textarea>
          <small>{{ t('Wird verschlüsselt gespeichert und nie wieder angezeigt.', 'Stored encrypted and never shown again.') }}</small>
        </div>
        <label class="feld">
          <span>{{ t('Passphrase (falls der Schlüssel eine hat)', 'Passphrase (if the key has one)') }}</span>
          <input v-model="f.passphrase" class="eingabe" type="password" autocomplete="new-password" />
        </label>
      </template>

      <label class="feld">
        <span>{{ t('Zielordner auf dem Server', 'Target folder on the server') }}</span>
        <input v-model="f.basis_pfad" class="eingabe mono" required spellcheck="false" :disabled="basisGesperrt" :placeholder="vorlage.pfad" />
        <small v-if="basisGesperrt">{{ t('Ändern nicht möglich, solange Dateien dort liegen.', 'Cannot be changed while files are stored there.') }}</small>
        <small v-else>{{ t('Absoluter Pfad. Wird bei Bedarf angelegt; VylarisCloud legt darin den Ordner „dateien“ an.', 'Absolute path. Created if needed; VylarisCloud creates a “dateien” folder inside it.') }}</small>
      </label>
      <label class="za-opt">
        <input v-model="f.schreibbar" type="checkbox" />
        <span>
          <b>{{ t('Schreiben erlauben', 'Allow writing') }}</b>
          <small>{{ t('Ohne Haken wird die Erweiterung nur zum Lesen genutzt (z. B. ein Archiv).', 'Without the tick the add-on is read-only (e.g. an archive).') }}</small>
        </span>
      </label>

      <!-- Fingerabdruck bestätigen -->
      <div v-if="zuBestaetigen" class="za-fp" role="group" :aria-label="t('Host-Schlüssel bestätigen', 'Confirm host key')">
        <div class="reihe">
          <Ico n="shield" />
          <b>{{ zuBestaetigen.geaendert ? t('Neuer Fingerabdruck des Servers', 'New fingerprint of the server') : t('Fingerabdruck des Servers', 'Fingerprint of the server') }}</b>
          <span class="chip neutral mono">{{ zuBestaetigen.typ }}</span>
        </div>
        <code class="za-fp-wert" :title="zuBestaetigen.fp">{{ zuBestaetigen.fp }}</code>
        <p class="leise">
          {{
            t(
              'Vergleiche diesen Wert mit dem deines Anbieters (bei Hetzner: Konsole → Storage Box → „SSH-Fingerprints“; bei eigenen Servern: ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub). Erst nach deiner Bestätigung werden Zugangsdaten gesendet.',
              'Compare this value with the one from your provider (Hetzner: console → Storage Box → “SSH fingerprints”; own servers: ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub). Credentials are only sent after you confirm.'
            )
          }}
        </p>
        <div class="reihe">
          <button type="button" class="knopf rot" :disabled="!!laeuft" @click="bestaetigen">
            <Ico n="check" /> {{ t('Fingerabdruck stimmt — bestätigen', 'Fingerprint matches — confirm') }}
          </button>
          <button type="button" class="knopf" @click="zuBestaetigen = null">{{ t('Verwerfen', 'Discard') }}</button>
        </div>
      </div>

      <!-- Testergebnis -->
      <div v-if="test" class="za-test" :class="{ gut: test.ok }" role="status">
        <div class="reihe zw">
          <b class="za-t"><Ico :n="test.ok ? 'check' : 'alert'" /> <span>{{ test.meldung }}</span></b>
          <span v-if="pin" class="chip neutral mono" :title="pin"><Ico n="shield" /> {{ kurz(pin) }}</span>
        </div>
        <ul class="za-schritte">
          <li v-for="s in test.schritte" :key="s.name" :class="{ f: !s.ok }">
            <Ico :n="s.ok ? 'check' : 'x'" /> {{ t(SCHRITT[s.name]?.[0] || s.name, SCHRITT[s.name]?.[1] || s.name) }}
            <small v-if="s.ms != null" class="mono">{{ s.ms }} ms</small>
          </li>
        </ul>
        <div v-if="test.ok" class="za-werte">
          <span v-if="test.latenzMs != null"><Ico n="gauge" /> {{ t('Antwortzeit', 'Latency') }}: <b>{{ test.latenzMs }} ms</b></span>
          <span v-if="test.banner"><Ico n="server" /> <b class="mono">{{ test.banner }}</b></span>
          <span v-if="test.platz"><Ico n="database" /> {{ t('frei', 'free') }}: <b>{{ groesse(test.platz.frei) }}</b> / {{ groesse(test.platz.gesamt) }}</span>
        </div>
      </div>
      <p v-if="fehlerText && !(test && !test.ok)" class="meldung meldung-fehler" role="alert">{{ fehlerText }}</p>

      <div class="modal-fuss">
        <button type="button" class="knopf" @click="emit('zu')">{{ t('Abbrechen', 'Cancel') }}</button>
        <button type="submit" class="knopf" :disabled="!formGueltig || !!laeuft">
          <Ico :n="laeuft === 'test' ? 'loader' : 'network'" :spin="laeuft === 'test'" />
          {{ t('Verbindung testen', 'Test connection') }}
        </button>
        <button type="button" class="knopf rot" :disabled="!kannSpeichern" @click="speichern">
          <Ico :n="laeuft === 'speichern' ? 'loader' : 'check'" :spin="laeuft === 'speichern'" />
          {{ bearb ? t('Speichern', 'Save') : t('Hinzufügen', 'Add') }}
        </button>
      </div>
    </form>
  </VdModal>
</template>

<style scoped>
.za {
  display: block;
}
.za-zeile {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 110px;
  gap: 10px;
}
.za-port input {
  text-align: center;
}
.za-kopf {
  display: flex !important;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.za-datei {
  position: relative;
  cursor: pointer;
  margin: 0;
}
.za-datei:focus-within {
  outline: 2px solid var(--a);
  outline-offset: 2px;
}
.za-nur-sr {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  font-size: 0;
}
.za-schluessel {
  resize: vertical;
  min-height: 96px;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre;
  overflow: auto;
}
.za-opt {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin: 2px 0 14px;
  cursor: pointer;
}
.za-opt input {
  margin-top: 4px;
  accent-color: var(--a);
}
.za-opt small {
  display: block;
  color: var(--text3);
  font-size: 12px;
}
.za-warn {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  line-height: 1.5;
}
.za-warn > svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  margin-top: 2px;
}
.za-warn-knopf {
  display: block;
  margin-top: 10px;
}
.za-warn-knopf .knopf svg {
  width: 14px;
  height: 14px;
  margin: 0;
}
.za-fp {
  border: 1.5px solid var(--a);
  background: rgba(var(--a-rgb), 0.05);
  border-radius: 14px;
  padding: 14px;
  margin: 4px 0 14px;
  display: grid;
  gap: 10px;
}
.za-fp > .reihe > svg {
  width: 16px;
  height: 16px;
  color: var(--a);
}
.za-fp-wert {
  display: block;
  font-family: var(--f-mono);
  font-size: 13px;
  word-break: break-all;
  background: var(--bg);
  border: 1px solid var(--linie);
  border-radius: 10px;
  padding: 10px 12px;
  user-select: all;
}
.za-fp p {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.55;
}
.za-test {
  border-radius: 14px;
  padding: 12px 14px;
  background: var(--rot-bg);
  color: var(--rot);
  font-size: 13px;
  margin: 4px 0 8px;
}
.za-test.gut {
  background: var(--ok-bg);
  color: var(--ok);
}
.za-test svg {
  width: 15px;
  height: 15px;
}
.za-t {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  min-width: 0;
}
.za-t svg {
  flex-shrink: 0;
  margin-top: 2px;
}
.za-schritte {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: grid;
  gap: 4px;
  color: var(--text2);
  font-size: 12.5px;
}
.za-schritte li {
  display: flex;
  gap: 8px;
  align-items: center;
}
.za-schritte li svg {
  color: var(--ok);
  width: 13px;
  height: 13px;
}
.za-schritte li.f svg,
.za-schritte li.f {
  color: var(--rot);
}
.za-schritte small {
  margin-left: auto;
  color: var(--text3);
}
.za-werte {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  margin-top: 10px;
  color: var(--text2);
  font-size: 12.5px;
}
.za-werte span {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}
.za-werte b {
  color: var(--text);
}
@media (max-width: 520px) {
  .za-zeile {
    grid-template-columns: 1fr;
  }
  .za-port {
    max-width: 130px;
  }
  .modal-fuss .knopf {
    flex: 1 1 auto;
  }
}
</style>
