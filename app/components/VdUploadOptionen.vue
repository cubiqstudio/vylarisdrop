<script setup lang="ts">
const { wartend, hochladen } = useUploads()
const theme = useTheme()
const offen = computed(() => !!wartend.value?.dateien.length)
const { data: konto } = (useFetch as any)('/api/account', { key: 'konto', server: false })
const { data: ord } = (useFetch as any)('/api/folders', { key: 'ordner', server: false })
const ordner = computed<any[]>(() => {
  const alle = ord.value?.ordner || [],
    aus: any[] = []
  const kinder = (p: number | null, tiefe: number) => {
    for (const o of alle.filter((x: any) => x.parent_id === p)) {
      aus.push({ ...o, tiefe })
      kinder(o.id, tiefe + 1)
    }
  }
  kinder(null, 0)
  return aus
})
const f = reactive({
  stil: '',
  ablauf: '',
  maxAufrufe: '',
  passwort: '',
  ordner: null as number | null,
  nichtFragen: false,
  e2e: false
})
const kannE2e = ref(false)
onMounted(() => {
  kannE2e.value = !!(window.isSecureContext && crypto?.subtle)
})
watch(offen, (an) => {
  if (!an) return
  Object.assign(f, {
    stil: konto.value?.prefs?.stil || '',
    ablauf: konto.value?.prefs?.ablauf || '',
    maxAufrufe: '',
    passwort: '',
    ordner: wartend.value?.opt.ordner ?? null,
    nichtFragen: false,
    e2e: false
  })
})
const STILE = computed(() => [
  { v: '', text: t('Standard', 'Default'), bsp: '' },
  { v: 'zufall', text: t('Zufall', 'Random'), bsp: 'kX9q2Rb' },
  { v: 'woerter', text: t('Wörter', 'Words'), bsp: t('ruhiger-falke', 'calm-falcon') },
  { v: 'uuid', text: 'UUID', bsp: '3f2b8c1e-…' },
  { v: 'datum', text: t('Datum', 'Date'), bsp: '2026-10-23_…' },
  { v: 'original', text: t('Dateiname', 'File name'), bsp: 'urlaub-x7k' },
  { v: 'unsichtbar', text: t('Unsichtbar', 'Invisible'), bsp: '' }
])
const ABLAUF = computed(() => [
  { v: '', t: t('Nie', 'Never') },
  { v: '1h', t: t('1 Stunde', '1 hour') },
  { v: '1d', t: t('1 Tag', '1 day') },
  { v: '7d', t: t('7 Tage', '7 days') },
  { v: '30d', t: t('30 Tage', '30 days') },
  { v: '365d', t: t('1 Jahr', '1 year') }
])
const summe = computed(() => (wartend.value?.dateien || []).reduce((a, d) => a + d.size, 0))
function los() {
  const w = wartend.value
  if (!w) return
  if (f.nichtFragen) {
    try {
      localStorage.setItem('vd_upload_direkt', '1')
    } catch {}
  }
  hochladen(w.dateien, {
    ordner: f.ordner,
    stil: f.stil || undefined,
    ablauf: f.ablauf || null,
    maxAufrufe: f.maxAufrufe ? Math.max(1, Math.floor(Number(f.maxAufrufe))) : null,
    passwort: f.passwort || undefined,
    verschluesseln: f.e2e && kannE2e.value
  })
  wartend.value = null
}
const abbrechen = () => {
  wartend.value = null
}
const entfernen = (i: number) => {
  if (wartend.value) wartend.value = { ...wartend.value, dateien: wartend.value.dateien.filter((_, k) => k !== i) }
}
</script>

<template>
  <VdModal
    v-if="offen"
    breit
    :titel="
      wartend!.dateien.length === 1
        ? t('Datei hochladen', 'Upload file')
        : t(`${wartend!.dateien.length} Dateien hochladen`, `Upload ${wartend!.dateien.length} files`)
    "
    @zu="abbrechen"
  >
    <form @submit.prevent="los">
      <ul class="dateien">
        <li v-for="(d, i) in wartend!.dateien.slice(0, 50)" :key="i + d.name" :style="{ '--i': Math.min(i, 10) }">
          <Ico
            :n="
              d.type.startsWith('image/')
                ? 'image'
                : d.type.startsWith('video/')
                  ? 'film'
                  : d.type.startsWith('audio/')
                    ? 'music'
                    : 'file'
            "
          />
          <span class="n">{{ d.name || t('Eingefügt', 'Pasted') }}</span
          ><span class="g zahl">{{ groesse(d.size) }}</span>
          <button type="button" class="knopf nur-icon" :aria-label="t('Entfernen', 'Remove')" @click="entfernen(i)">
            <Ico n="x" />
          </button>
        </li>
        <li v-if="wartend!.dateien.length > 50" class="mehr">+ {{ wartend!.dateien.length - 50 }}</li>
      </ul>
      <div class="feld">
        <span>{{ t('Link', 'Link') }}</span>
        <div class="stile">
          <button v-for="s in STILE" :key="s.v" type="button" :class="{ an: f.stil === s.v }" @click="f.stil = s.v">
            <b>{{ s.text }}</b
            ><code v-if="s.bsp">{{ s.bsp }}</code>
          </button>
        </div>
      </div>
      <div class="zwei">
        <label class="feld"
          ><span>{{ t('Läuft ab', 'Expires') }}</span
          ><VdAuswahl v-model="f.ablauf" class="eingabe"
            ><option v-for="a in ABLAUF" :key="a.v" :value="a.v">{{ a.t }}</option></VdAuswahl
          ></label
        >
        <label class="feld"
          ><span>{{ t('Max. Aufrufe', 'Max. views') }}</span
          ><input
            v-model="f.maxAufrufe"
            class="eingabe"
            type="number"
            min="1"
            :placeholder="t('unbegrenzt', 'unlimited')"
        /></label>
        <label class="feld"
          ><span>{{ t('Passwort', 'Password') }}</span
          ><input
            v-model="f.passwort"
            class="eingabe"
            type="password"
            autocomplete="new-password"
            :placeholder="t('kein Passwort', 'no password')"
        /></label>
        <label class="feld"
          ><span>{{ t('Ordner', 'Folder') }}</span
          ><VdAuswahl v-model="f.ordner" class="eingabe"
            ><option :value="null">{{ t('Ohne Ordner', 'No folder') }}</option>
            <option v-for="o in ordner" :key="o.id" :value="o.id">
              {{ '— '.repeat(o.tiefe) }}{{ o.name }}{{ o.team ? ` · ${o.team.name}` : '' }}
            </option></VdAuswahl
          ></label
        >
      </div>
      <div :class="['e2e', { an: f.e2e }]">
        <button
          type="button"
          :class="['schalter', { an: f.e2e }]"
          role="switch"
          :aria-checked="f.e2e"
          :disabled="!kannE2e"
          @click="f.e2e = !f.e2e"
        ></button>
        <span
          ><b><Ico n="lock" /> {{ t('Ende-zu-Ende verschlüsseln', 'End-to-end encrypt') }}</b>
          <small v-if="!kannE2e">{{ t('Geht nur über HTTPS.', 'Only works over HTTPS.') }}</small>
          <small v-else>{{
            t(
              'Verschlüsselt wird hier im Browser. Der Schlüssel steckt nur im Link — ohne ihn kann niemand die Datei öffnen, auch der Server nicht. Keine Vorschau; der Dateiname bleibt sichtbar.',
              'Encrypted right here in your browser. The key lives only in the link — without it nobody can open the file, not even the server. No preview; the file name stays visible.'
            )
          }}</small></span
        >
      </div>
      <label class="nicht"
        ><input v-model="f.nichtFragen" type="checkbox" />
        {{
          t(
            'Nicht mehr fragen — künftig sofort mit meinen Vorgaben hochladen',
            'Don’t ask again — upload right away with my defaults from now on'
          )
        }}</label
      >
      <div class="modal-fuss">
        <span class="sehrleise klein">{{ groesse(summe) }}</span>
        <button type="button" class="knopf" @click="abbrechen">{{ t('Abbrechen', 'Cancel') }}</button>
        <button class="knopf rot" :disabled="!wartend!.dateien.length">
          <Ico n="upload" /> {{ t('Hochladen', 'Upload') }}
        </button>
      </div>
    </form>
  </VdModal>
</template>

<style scoped>
.dateien {
  list-style: none;
  padding: 0;
  margin: 0 0 16px;
  display: grid;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
}
.dateien li {
  display: flex;
  gap: 10px;
  align-items: center;
  background: var(--bg);
  border: 1px solid var(--linie);
  border-radius: 10px;
  padding: 6px 6px 6px 12px;
  font-size: 13px;
  animation: rein 0.35s var(--kurve) backwards;
  animation-delay: calc(var(--i) * 30ms);
}
.dateien li > svg {
  width: 15px;
  height: 15px;
  color: var(--text3);
  flex-shrink: 0;
}
.dateien .n {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dateien .g {
  color: var(--text3);
  font-size: 12px;
}
.dateien .mehr {
  justify-content: center;
  color: var(--text3);
}
.stile {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  gap: 6px;
}
.stile button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  border: 1.5px solid var(--linie);
  background: var(--bg);
  border-radius: 10px;
  padding: 8px 10px;
  cursor: pointer;
  color: var(--text);
  text-align: left;
  transition:
    border-color 0.2s,
    background 0.2s;
}
.stile button.an {
  border-color: var(--a);
  background: rgba(var(--a-rgb), 0.06);
}
.stile b {
  font-size: 12.5px;
}
.stile code {
  font-family: var(--f-mono);
  font-size: 10.5px;
  color: var(--text3);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zwei {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 12px;
  margin-top: 4px;
}
.e2e {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  border: 1.5px solid var(--linie);
  background: var(--bg);
  border-radius: 12px;
  padding: 12px;
  margin: 2px 0 14px;
  transition:
    border-color 0.2s,
    background 0.2s;
}
.e2e.an {
  border-color: var(--a);
  background: rgba(var(--a-rgb), 0.05);
}
.e2e span {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 13px;
}
.e2e b {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}
.e2e b svg {
  width: 14px;
  height: 14px;
}
.e2e small {
  color: var(--text3);
  font-size: 12px;
  line-height: 1.5;
}
.nicht {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12.5px;
  color: var(--text2);
  cursor: pointer;
}
.modal-fuss .klein {
  margin-right: auto;
  align-self: center;
  font-size: 12px;
}
@media (max-width: 560px) {
  .zwei {
    grid-template-columns: 1fr;
  }
}
</style>
