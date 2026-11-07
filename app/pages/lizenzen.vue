<script setup lang="ts">
useHead({ title: () => t('Lizenzen', 'Licences') })
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const { data, refresh, error } = await (useFetch as any)('/api/lizenzen', { key: 'lizenzen' })
const liste = computed<any[]>(() => data.value?.schluessel || [])
const funktionen = computed<string[]>(() => data.value?.funktionen || [])
const server = computed(() => data.value?.server || { url: '', oeffentlich: '' })

const FUNKTION_NAMEN: Record<string, [string, string]> = {
  'multi-server': ['Mehrere Server', 'Multiple servers'],
  s3: ['S3-Speicher', 'S3 storage'],
  teams: ['Teams', 'Teams'],
  sso: ['Single Sign-on', 'Single sign-on'],
  'white-label': ['White-Label', 'White label'],
  sicherung: ['Sicherung', 'Backup'],
  monitoring: ['Monitoring', 'Monitoring'],
  traffic: ['Traffic', 'Traffic']
}
const fname = (f: string) => (FUNKTION_NAMEN[f] ? t(FUNKTION_NAMEN[f][0], FUNKTION_NAMEN[f][1]) : f)

const VORGABEN = [7, 30, 90, 180, 365, 730]
const laufzeit = ref<string>('30') // Tage, 'unbegrenzt' oder 'eigene'
const eigene = ref(14)
const geraete = ref(1)
const anzahl = ref(1)
const notiz = ref('')
const gewaehlt = ref<string[]>([])
const laeuft = ref(false)
const neu = ref<string[]>([])

const tage = computed<number | null>(() =>
  laufzeit.value === 'unbegrenzt' ? null : laufzeit.value === 'eigene' ? Math.max(1, Math.round(eigene.value || 1)) : Number(laufzeit.value)
)
function tageText(n: number | null) {
  if (n == null) return t('unbegrenzt', 'unlimited')
  if (n % 365 === 0) return n / 365 === 1 ? t('1 Jahr', '1 year') : t(`${n / 365} Jahre`, `${n / 365} years`)
  return n === 1 ? t('1 Tag', '1 day') : t(`${n} Tage`, `${n} days`)
}

async function erstellen() {
  if (laeuft.value) return
  laeuft.value = true
  try {
    const r = await api('/api/lizenzen', {
      method: 'POST',
      body: {
        notiz: notiz.value.trim(),
        tage: tage.value,
        maxGeraete: Math.max(1, Math.round(geraete.value || 1)),
        features: gewaehlt.value,
        anzahl: Math.max(1, Math.round(anzahl.value || 1))
      }
    })
    neu.value = r.schluessel
    notiz.value = ''
    await refresh()
    ok(t(`${r.schluessel.length} Schlüssel erstellt`, `${r.schluessel.length} key(s) created`))
  } catch (e: any) {
    fehler(e.message)
  } finally {
    laeuft.value = false
  }
}
async function aendern(x: any, body: Record<string, any>, text: string) {
  try {
    await api(`/api/lizenzen/${x.id}`, { method: 'PATCH', body })
    await refresh()
    ok(text)
  } catch (e: any) {
    fehler(e.message)
  }
}
function loeschen(x: any) {
  bestaetigen(
    t('Schlüssel löschen?', 'Delete key?'),
    t(
      `„${x.schluessel}“ wird ungültig. Installationen mit diesem Schlüssel verlieren Pro beim nächsten Abgleich.`,
      `“${x.schluessel}” becomes invalid. Installations using it lose Pro at the next check.`
    ),
    t('Löschen', 'Delete'),
    async () => {
      try {
        await api(`/api/lizenzen/${x.id}`, { method: 'DELETE' })
        await refresh()
        ok(t('Gelöscht', 'Deleted'))
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}
async function kopie(s: string) {
  if (await kopieren(s)) ok(t('Kopiert', 'Copied'))
}
const alleNeuen = computed(() => neu.value.join('\n'))

const STATUS: Record<string, [string, string]> = {
  neu: ['Noch nicht aktiviert', 'Not activated yet'],
  aktiv: ['Aktiv', 'Active'],
  abgelaufen: ['Abgelaufen', 'Expired'],
  gesperrt: ['Gesperrt', 'Blocked']
}
function rest(x: any) {
  if (x.status === 'neu') return x.tage == null ? t('läuft nie ab', 'never expires') : t(`${tageText(x.tage)} ab Aktivierung`, `${tageText(x.tage)} from activation`)
  if (!x.ablauf) return t('läuft nie ab', 'never expires')
  const d = Math.ceil((new Date(x.ablauf).getTime() - Date.now()) / 86400_000)
  if (d <= 0) return t('abgelaufen', 'expired')
  return t(`noch ${d} Tage (bis ${datum(x.ablauf)})`, `${d} days left (until ${datum(x.ablauf)})`)
}
</script>

<template>
  <section class="rein">
    <div class="kopf">
      <div>
        <div class="eyebrow"><Ico n="key" /> {{ t('Administration', 'Administration') }}</div>
        <h1>{{ t('Lizenzen', 'Licences') }}</h1>
        <p>
          {{
            t(
              'Erstelle Lizenzschlüssel für Pro — ohne E-Mail oder Namen. Du legst fest, wie lange der Schlüssel gilt, auf wie vielen Installationen er läuft und welche Funktionen er freischaltet.',
              'Create licence keys for Pro — no email or name needed. You choose how long a key is valid, on how many installations it runs and which features it unlocks.'
            )
          }}
        </p>
      </div>
    </div>

    <div v-if="error" class="meldung meldung-warn" role="alert">
      {{ t('Das dürfen nur Inhaber.', 'Only the owner can do this.') }}
    </div>
    <template v-else>
      <form class="block lz-form" @submit.prevent="erstellen">
        <h3>{{ t('Neuer Schlüssel', 'New key') }}</h3>
        <div class="lz-gitter">
          <label class="lz-feld">
            <span>{{ t('Laufzeit (ab erster Aktivierung)', 'Duration (from first activation)') }}</span>
            <select v-model="laufzeit" class="eingabe">
              <option v-for="d in VORGABEN" :key="d" :value="String(d)">{{ tageText(d) }}</option>
              <option value="unbegrenzt">{{ t('Unbegrenzt', 'Unlimited') }}</option>
              <option value="eigene">{{ t('Eigene Anzahl Tage …', 'Custom number of days …') }}</option>
            </select>
          </label>
          <label v-if="laufzeit === 'eigene'" class="lz-feld">
            <span>{{ t('Tage', 'Days') }}</span>
            <input v-model.number="eigene" class="eingabe" type="number" min="1" max="36500" />
          </label>
          <label class="lz-feld">
            <span>{{ t('Installationen', 'Installations') }}</span>
            <input v-model.number="geraete" class="eingabe" type="number" min="1" max="1000" />
          </label>
          <label class="lz-feld">
            <span>{{ t('Anzahl Schlüssel', 'Number of keys') }}</span>
            <input v-model.number="anzahl" class="eingabe" type="number" min="1" max="50" />
          </label>
          <label class="lz-feld lz-breit">
            <span>{{ t('Notiz (nur für dich, optional)', 'Note (for you only, optional)') }}</span>
            <input v-model="notiz" class="eingabe" maxlength="120" autocomplete="off" :placeholder="t('z. B. „Test Kunde A“', 'e.g. “test customer A”')" />
          </label>
        </div>
        <fieldset class="lz-funk">
          <legend>{{ t('Funktionen (nichts gewählt = alle Pro-Funktionen)', 'Features (none selected = all Pro features)') }}</legend>
          <label v-for="f in funktionen" :key="f" class="lz-chip">
            <input v-model="gewaehlt" type="checkbox" :value="f" />
            <span>{{ fname(f) }}</span>
          </label>
        </fieldset>
        <button class="knopf rot" :disabled="laeuft">
          <Ico :n="laeuft ? 'loader' : 'plus'" :spin="laeuft" /> {{ t('Schlüssel erstellen', 'Create key') }}
        </button>
      </form>

      <div v-if="neu.length" class="block lz-neu" role="status">
        <div class="reihe zw">
          <b><Ico n="key" /> {{ t('Neu erstellt', 'Newly created') }}</b>
          <span class="reihe">
            <button class="knopf klein" @click="kopie(alleNeuen)"><Ico n="copy" /> {{ t('Alle kopieren', 'Copy all') }}</button>
            <button class="knopf klein" @click="neu = []">{{ t('Ausblenden', 'Hide') }}</button>
          </span>
        </div>
        <pre class="mono lz-code">{{ alleNeuen }}</pre>
        <p class="leise">{{ t('Den Schlüssel trägst du auf der Seite „Pro“ ein.', 'Enter the key on the “Pro” page.') }}</p>
      </div>

      <h2 class="abschnitt">{{ t('Schlüssel', 'Keys') }} ({{ liste.length }})</h2>
      <div v-if="!liste.length" class="block leise">{{ t('Noch keine Schlüssel erstellt.', 'No keys created yet.') }}</div>
      <div v-for="x in liste" :key="x.id" class="block lz-zeile" :class="'st-' + x.status">
        <div class="reihe zw lz-kopf">
          <button class="lz-key mono" :title="t('Kopieren', 'Copy')" @click="kopie(x.schluessel)">{{ x.schluessel }} <Ico n="copy" /></button>
          <span class="lz-status" :class="'st-' + x.status">{{ t(STATUS[x.status]![0], STATUS[x.status]![1]) }}</span>
        </div>
        <div class="leise lz-info">
          <span>{{ rest(x) }}</span>
          <span>{{ x.geraete }} / {{ x.maxGeraete }} {{ t('Installationen', 'installations') }}</span>
          <span>{{ x.features.length ? x.features.map(fname).join(', ') : t('alle Pro-Funktionen', 'all Pro features') }}</span>
          <span v-if="x.notiz">„{{ x.notiz }}“</span>
        </div>
        <div v-if="x.geraeteListe.length" class="leise lz-geraete">
          <span v-for="g in x.geraeteListe" :key="g.hwid" class="mono">{{ g.name || g.hwid }} · {{ datum(g.zuletzt) }}</span>
        </div>
        <div class="reihe lz-aktionen">
          <button v-if="x.tage != null" class="knopf klein" @click="aendern(x, { verlaengernTage: 30 }, t('Um 30 Tage verlängert', 'Extended by 30 days'))">
            <Ico n="plus" /> {{ t('30 Tage', '30 days') }}
          </button>
          <button v-if="x.tage != null" class="knopf klein" @click="aendern(x, { verlaengernTage: 365 }, t('Um ein Jahr verlängert', 'Extended by one year'))">
            <Ico n="plus" /> {{ t('1 Jahr', '1 year') }}
          </button>
          <button class="knopf klein" @click="aendern(x, { maxGeraete: x.maxGeraete + 1 }, t('Eine Installation mehr erlaubt', 'One more installation allowed'))">
            <Ico n="plus" /> {{ t('Installation', 'Installation') }}
          </button>
          <button v-if="x.geraete" class="knopf klein" @click="aendern(x, { geraeteZuruecksetzen: true }, t('Installationen freigegeben', 'Installations released'))">
            <Ico n="undo" /> {{ t('Freigeben', 'Release') }}
          </button>
          <button class="knopf klein" @click="aendern(x, { gesperrt: !x.gesperrt }, x.gesperrt ? t('Entsperrt', 'Unblocked') : t('Gesperrt', 'Blocked'))">
            <Ico :n="x.gesperrt ? 'unlock' : 'lock'" /> {{ x.gesperrt ? t('Entsperren', 'Unblock') : t('Sperren', 'Block') }}
          </button>
          <button class="knopf klein" @click="loeschen(x)"><Ico n="trash" /> {{ t('Löschen', 'Delete') }}</button>
        </div>
      </div>

      <h2 class="abschnitt">{{ t('Für andere Installationen', 'For other installations') }}</h2>
      <div class="block">
        <p class="leise lz-hinweis">
          {{
            t(
              'Diese Cloud prüft ihre eigenen Schlüssel selbst — dafür ist nichts einzustellen. Soll eine andere VylarisCloud-Installation Schlüssel von hier nutzen, trägst du dort diese zwei Werte in die .env ein und startest neu (docker compose up -d). Die Adresse muss von dort erreichbar sein, am besten mit HTTPS.',
              'This cloud checks its own keys itself — nothing to set up. To let another VylarisCloud installation use keys from here, add these two values to its .env and restart (docker compose up -d). The address must be reachable from there, ideally with HTTPS.'
            )
          }}
        </p>
        <div class="lz-zeilen">
          <VdKopierZeile label="VD_LIZENZ_SERVER" :wert="server.url" />
          <VdKopierZeile label="VD_LIZENZ_KEY" :wert="server.oeffentlich" />
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.abschnitt {
  font-family: var(--f-display);
  font-size: 22px;
  letter-spacing: -0.02em;
  margin: 30px 0 8px;
}
.lz-form h3 {
  margin: 0 0 12px;
}
.lz-gitter {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
}
.lz-feld {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12.5px;
}
.lz-feld > span {
  color: var(--text3);
}
.lz-breit {
  grid-column: 1 / -1;
}
.lz-funk {
  border: 1px solid var(--rand, rgba(127, 127, 127, 0.25));
  border-radius: 12px;
  margin: 14px 0;
  padding: 10px 12px 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
}
.lz-funk legend {
  font-size: 12.5px;
  color: var(--text3);
  padding: 0 6px;
}
.lz-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
}
.lz-neu {
  margin-top: 14px;
  border-color: var(--rot, #1e73be);
}
.lz-code {
  margin: 10px 0 4px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(127, 127, 127, 0.12);
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  user-select: all;
}
.lz-zeile {
  margin-bottom: 10px;
}
.lz-kopf {
  gap: 10px;
  flex-wrap: wrap;
}
.lz-key {
  background: none;
  border: 0;
  padding: 0;
  font-size: 15px;
  font-weight: 600;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.lz-status {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 99px;
  background: rgba(127, 127, 127, 0.16);
}
.lz-status.st-aktiv {
  background: rgba(34, 160, 90, 0.18);
}
.lz-status.st-abgelaufen,
.lz-status.st-gesperrt {
  background: rgba(220, 60, 60, 0.18);
}
.lz-info,
.lz-geraete {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin-top: 6px;
  font-size: 12.5px;
}
.lz-aktionen {
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.lz-hinweis {
  margin: 0 0 12px;
}
.lz-zeilen {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
