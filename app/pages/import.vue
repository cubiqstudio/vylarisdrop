<script setup lang="ts">
useHead({ title: () => t('Import', 'Import') })
const route = useRoute()
const router = useRouter()
const theme = useTheme()
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const { data: uebersicht, refresh: uebersichtNeu } = await (useFetch as any)('/api/import', { key: 'importe' })
const admin = computed(() => !!uebersicht.value?.admin)
const bisher = computed<any[]>(() => uebersicht.value?.importe || [])

type Quelle =
  'zipline' | 'xbackbone' | 'chibisafe' | 'sharex' | 'imgur' | 'takeout' | 'icloud' | 'tinyfilemanager' | 'ordner'
type Weg = 'live' | 'datei' | 'ordner' | 'konto'
const QUELLEN = computed(() => [
  {
    id: 'zipline' as Quelle,
    lg: 'Z',
    farbe: '#7c3aed',
    name: 'Zipline',
    text: t('v3 und v4 · Konten, Ordner, Tags', 'v3 and v4 · accounts, folders, tags')
  },
  {
    id: 'xbackbone' as Quelle,
    lg: 'X',
    farbe: '#0f766e',
    name: 'XBackBone',
    text: t('Datenbank + Speicher-Ordner', 'Database + storage folder')
  },
  {
    id: 'chibisafe' as Quelle,
    lg: 'C',
    farbe: '#db2777',
    name: 'Chibisafe',
    text: t('API-Schlüssel oder Ordner', 'API key or folder')
  },
  {
    id: 'sharex' as Quelle,
    lg: 'S',
    farbe: '#2563eb',
    name: 'ShareX',
    text: t('Verlauf, Ordner oder ZIP', 'History, folder or ZIP')
  },
  {
    id: 'imgur' as Quelle,
    lg: 'i',
    farbe: '#16a34a',
    name: 'Imgur',
    text: t('Alben und ganzes Konto', 'Albums and whole account')
  },
  {
    id: 'takeout' as Quelle,
    lg: 'G',
    farbe: '#ea580c',
    name: 'Google Fotos',
    text: t('Takeout-Archiv', 'Takeout archive')
  },
  {
    id: 'icloud' as Quelle,
    lg: '',
    ic: 'wolke',
    farbe: '#0a84ff',
    name: 'iCloud',
    text: t('Fotos und Drive · Export, Link oder Apple-ID', 'Photos and Drive · export, link or Apple ID')
  },
  {
    id: 'tinyfilemanager' as Quelle,
    lg: 'T',
    farbe: '#0284c7',
    name: 'Tiny File Manager',
    text: t('Webordner + Konten aus der config', 'Web folder + accounts from the config')
  },
  {
    id: 'ordner' as Quelle,
    lg: '',
    ic: 'folder',
    farbe: '#52525b',
    name: t('Eigene Dateien', 'Own files'),
    text: t('Ordner oder ZIP, Unterordner bleiben', 'Folder or ZIP, subfolders stay')
  }
])
const WEG_TEXT = computed<Record<Weg, { ic: string; text: string }>>(() => ({
  live: { ic: 'link', text: quelle.value === 'icloud' ? t('Link', 'Link') : t('Verbindung', 'Connection') },
  datei: {
    ic: 'upload',
    text: quelle.value === 'icloud' ? t('Apple-Export', 'Apple export') : t('Datei hochladen', 'Upload file')
  },
  ordner: { ic: 'server', text: t('Server-Ordner', 'Server folder') },
  konto: { ic: 'key', text: t('Apple-ID', 'Apple ID') }
}))
const erlaubt = (q: Quelle, w: Weg) =>
  admin.value ||
  (q === 'imgur' && w === 'live') ||
  (q === 'icloud' && (w === 'live' || w === 'konto')) ||
  (w === 'datei' && q !== 'zipline')
const wegeVon = (q: Quelle): Weg[] => ((uebersicht.value?.wege?.[q] || []) as Weg[]).filter((w) => erlaubt(q, w))

const quelle = ref<Quelle | null>(null)
const weg = ref<Weg>('live')
const zugang = reactive({
  url: '',
  token: '',
  apiKey: '',
  clientId: '',
  accessToken: '',
  alben: '',
  ordner: '',
  inhalt: 'fotos' as 'fotos' | 'drive' | 'beides',
  mysql: { host: '', port: '', user: '', password: '', database: '' }
})
const mysqlOffen = ref(false)
function quelleWaehlen(q: Quelle) {
  if (!wegeVon(q).length) return
  quelle.value = q
  weg.value = wegeVon(q)[0]!
  Object.assign(zugang, { url: '', token: '', apiKey: '', clientId: '', accessToken: '', alben: '', ordner: '' })
  imp.value = null
  if (route.query.id) router.replace({ query: {} })
}

const imp = ref<any>(null)
const fehlerListe = ref<any[]>([])
const hochgeladen = ref<any[]>([])
let uhr: ReturnType<typeof setTimeout> | null = null
const verlauf: Array<{ z: number; bytes: number; n: number }> = []

async function laden(id: number) {
  try {
    const r = await api(`/api/import/${id}`)
    const vorher = imp.value?.status
    imp.value = r.import
    fehlerListe.value = r.fehler
    hochgeladen.value = r.hochgeladen
    quelle.value = r.import.quelle
    weg.value = r.import.weg
    if (r.import.status === 'laeuft') {
      verlauf.push({ z: Date.now(), bytes: r.import.bytes, n: erledigtGesamt.value })
      while (verlauf.length > 20) verlauf.shift()
    }
    if (vorher === 'laeuft' && r.import.status === 'fertig') {
      ok(
        t(
          `Import abgeschlossen — ${zahl(r.import.erledigt)} Dateien übernommen`,
          `Import finished — ${zahl(r.import.erledigt)} files taken over`
        )
      )
      uebersichtNeu()
    }
    if (vorher === 'analyse' && r.import.status === 'entwurf' && r.import.meldung) fehler(r.import.meldung)
  } catch (e: any) {
    fehler(e.message)
  }
  planen()
}
function planen() {
  if (uhr) clearTimeout(uhr)
  const s = imp.value?.status
  if (s === 'analyse' || s === 'laeuft') uhr = setTimeout(() => laden(imp.value.id), 1200)
  else if (s === 'pausiert') uhr = setTimeout(() => laden(imp.value.id), 4000)
}
onBeforeUnmount(() => {
  if (uhr) clearTimeout(uhr)
})
onMounted(() => {
  const id = Number(route.query.id)
  if (id) laden(id)
})

async function entwurf(): Promise<number> {
  if (imp.value?.id) return imp.value.id
  const r = await api('/api/import', { method: 'POST', body: { quelle: quelle.value, weg: weg.value } })
  router.replace({ query: { id: r.id } })
  await laden(r.id)
  return r.id
}

const TEIL = 8 * 1024 * 1024
const ladend = ref<Array<{ name: string; groesse: number; fertig: number; fehler?: string }>>([])
const ziehen = ref(false)
const dateiFeld = ref<HTMLInputElement | null>(null)
async function dateienHinzu(liste: FileList | File[] | null) {
  const dateien = Array.from(liste || [])
  if (!dateien.length) return
  let id: number
  try {
    id = await entwurf()
  } catch (e: any) {
    return fehler(e.message)
  }
  for (const f of dateien) {
    const eintrag = reactive({ name: f.name, groesse: f.size, fertig: 0, fehler: '' as string | undefined })
    ladend.value.push(eintrag)
    const teile = Math.max(1, Math.ceil(f.size / TEIL))
    try {
      for (let nr = 0; nr < teile; nr++) {
        const res = await fetch(`/api/import/${id}/datei?name=${encodeURIComponent(f.name)}&nr=${nr}&teile=${teile}`, {
          method: 'PUT',
          body: f.slice(nr * TEIL, (nr + 1) * TEIL),
          credentials: 'same-origin'
        })
        if (res.status === 409) {
          const j = await res.json().catch(() => ({}))
          if (typeof j.weiterAb === 'number') {
            nr = j.weiterAb - 1
            continue
          }
        }
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.message || `HTTP ${res.status}`)
        }
        eintrag.fertig = Math.min(f.size, (nr + 1) * TEIL)
      }
    } catch (e: any) {
      eintrag.fehler = e.message
      fehler(`${f.name}: ${e.message}`)
    }
  }
  ladend.value = ladend.value.filter((x) => x.fehler || x.fertig < x.groesse)
  await laden(id)
}
function abgelegt(e: DragEvent) {
  ziehen.value = false
  dateienHinzu(e.dataTransfer?.files || null)
}
async function dateiWeg(name: string) {
  try {
    await api(`/api/import/${imp.value.id}/datei?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
    await laden(imp.value.id)
  } catch (e: any) {
    fehler(e.message)
  }
}

const ordnerBlick = ref<any>(null)
async function ordnerOeffnen(pfad: string) {
  try {
    ordnerBlick.value = await api(`/api/import/ordner?pfad=${encodeURIComponent(pfad)}`)
    zugang.ordner = ordnerBlick.value.pfad
  } catch (e: any) {
    fehler(e.message)
  }
}
watch(
  weg,
  (w) => {
    if (w === 'ordner' && !ordnerBlick.value) ordnerOeffnen('')
  },
  { immediate: true }
)
const brotkrumen = computed(() => (ordnerBlick.value?.pfad ? String(ordnerBlick.value.pfad).split('/') : []))

const sendet = ref(false)
const kannAnalysieren = computed(() => {
  if (!quelle.value) return false
  if (weg.value === 'datei')
    return hochgeladen.value.some((h) => h.fertig) && (quelle.value !== 'zipline' || !!zugang.url)
  if (weg.value === 'ordner') return !!ordnerBlick.value?.vorhanden
  if (quelle.value === 'imgur') return !!(zugang.clientId || zugang.accessToken || imp.value?.zugang?.hatToken)
  if (quelle.value === 'icloud')
    return weg.value === 'konto' ? imp.value?.zugang?.icloud?.schritt === 'fertig' : !!zugang.alben.trim()
  return !!zugang.url && !!(zugang.token || zugang.apiKey || imp.value?.zugang?.hatToken)
})
async function analysieren() {
  sendet.value = true
  try {
    const id = await entwurf()
    const z: Record<string, any> = {}
    for (const k of ['url', 'token', 'apiKey', 'clientId', 'accessToken', 'alben', 'ordner'] as const)
      if (zugang[k]) z[k] = zugang[k]
    if (quelle.value === 'icloud' && weg.value === 'konto') z.inhalt = zugang.inhalt
    if (quelle.value === 'xbackbone' && mysqlOffen.value && zugang.mysql.host)
      z.mysql = { ...zugang.mysql, port: zugang.mysql.port ? Number(zugang.mysql.port) : undefined }
    await api(`/api/import/${id}/analysieren`, { method: 'POST', body: { zugang: z } })
    await laden(id)
  } catch (e: any) {
    fehler(e.message)
  } finally {
    sendet.value = false
  }
}

const apple = reactive({
  appleId: '',
  passwort: '',
  code: '',
  telefone: [] as Array<{ id: number; nummer: string }>,
  laeuft: false
})
const appleStand = computed(() => imp.value?.zugang?.icloud || null)
async function appleAktion(body: Record<string, any>) {
  apple.laeuft = true
  try {
    const id = await entwurf()
    const r = await api(`/api/import/${id}/icloud`, { method: 'POST', body })
    if (r.import) imp.value = r.import
    if (r.telefone) apple.telefone = r.telefone
    if (body.aktion === 'anmelden') {
      apple.passwort = ''
      ok(
        r.schritt === 'fertig'
          ? t('Bei iCloud angemeldet', 'Signed in to iCloud')
          : t('Code wurde an deine Apple-Geräte geschickt', 'A code was sent to your Apple devices')
      )
    }
    if (body.aktion === 'sms') ok(t('Code per SMS geschickt', 'Code sent by SMS'))
    if (body.aktion === 'code') {
      apple.code = ''
      ok(t('Bei iCloud angemeldet', 'Signed in to iCloud'))
    }
    if (body.aktion === 'abmelden') {
      apple.telefone = []
      ok(t('Abgemeldet', 'Signed out'))
    }
  } catch (e: any) {
    fehler(e.message)
  } finally {
    apple.laeuft = false
  }
}

const opt = reactive({
  konten: true,
  linknamen: true,
  weiterleiten: true,
  grenzen: true,
  aufrufe: true,
  ordnerName: '',
  zielNutzer: 0
})
const { data: nutzerDaten } = await (useFetch as any)('/api/users', {
  key: 'nutzer-import',
  immediate: false,
  server: false
})
watch(
  () => imp.value?.status,
  (s) => {
    if (s !== 'bereit') return
    const p = imp.value.plan || {}
    opt.konten = admin.value && (p.nutzer?.length || 0) > 0
    opt.linknamen = (p.mitLinkname || 0) > 0
    opt.weiterleiten = (p.weiterleitungen || 0) > 0
    opt.ordnerName = opt.konten || quelle.value === 'ordner' ? '' : String(imp.value.titel || '')
    opt.zielNutzer = theme.value.user?.id || 0
    if (admin.value && !nutzerDaten.value) (nutzerDaten as any).execute?.()
  }
)
const nutzerListe = computed<any[]>(() => nutzerDaten.value?.users || [])
async function starten() {
  sendet.value = true
  try {
    await api(`/api/import/${imp.value.id}/start`, {
      method: 'POST',
      body: { optionen: { ...opt, zielNutzer: opt.zielNutzer || undefined } }
    })
    verlauf.length = 0
    await laden(imp.value.id)
  } catch (e: any) {
    fehler(e.message)
  } finally {
    sendet.value = false
  }
}
async function steuern(aktion: 'pausieren' | 'abbrechen' | 'wiederholen') {
  const los = async () => {
    try {
      const r = await api(`/api/import/${imp.value.id}/steuern`, { method: 'POST', body: { aktion } })
      if (aktion === 'wiederholen')
        ok(t(`${zahl(r.wiederholt)} Dateien werden erneut versucht`, `Retrying ${zahl(r.wiederholt)} files`))
      verlauf.length = 0
      await laden(imp.value.id)
    } catch (e: any) {
      fehler(e.message)
    }
  }
  if (aktion === 'abbrechen')
    bestaetigen(
      t('Import abbrechen?', 'Cancel import?'),
      t(
        'Bereits übernommene Dateien bleiben. Die übrigen werden nicht mehr geholt.',
        'Files already taken over stay. The rest will not be fetched.'
      ),
      t('Abbrechen', 'Cancel import'),
      los
    )
  else await los()
}
async function fortsetzen() {
  try {
    await api(`/api/import/${imp.value.id}/start`, { method: 'POST', body: {} })
    verlauf.length = 0
    await laden(imp.value.id)
  } catch (e: any) {
    fehler(e.message)
  }
}
function neu() {
  imp.value = null
  quelle.value = null
  ladend.value = []
  router.replace({ query: {} })
  uebersichtNeu()
}
function oeffnen(id: number) {
  router.replace({ query: { id } })
  laden(id)
}
function entfernen(x: any) {
  bestaetigen(
    t('Import entfernen?', 'Remove import?'),
    t(
      `Der Eintrag und hochgeladene Archive werden gelöscht. Übernommene Dateien bleiben in ${theme.value.name}.`,
      `The entry and uploaded archives are deleted. Files already taken over stay in ${theme.value.name}.`
    ),
    t('Entfernen', 'Remove'),
    async () => {
      try {
        await api(`/api/import/${x.id}`, { method: 'DELETE' })
        if (imp.value?.id === x.id) neu()
        else uebersichtNeu()
        ok(t('Entfernt', 'Removed'))
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}

const schritt = computed(() => {
  const s = imp.value?.status
  if (!quelle.value) return 0
  if (!s || s === 'entwurf' || s === 'analyse') return 1
  if (s === 'bereit') return 2
  if (s === 'laeuft' || s === 'pausiert') return 3
  return 4
})
const SCHRITTE = computed(() => [
  t('Verbinden', 'Connect'),
  t('Auswählen', 'Choose'),
  t('Übertragen', 'Transfer'),
  t('Fertig', 'Done')
])
const aktiveQuelle = computed(() => QUELLEN.value.find((x) => x.id === quelle.value))
const erledigtGesamt = computed(
  () =>
    Number(imp.value?.erledigt || 0) + Number(imp.value?.uebersprungen || 0) + Number(imp.value?.fehlgeschlagen || 0)
)
const anteil = computed(() => (imp.value?.gesamt ? Math.min(100, (erledigtGesamt.value / imp.value.gesamt) * 100) : 0))
const zaehler = useHochzaehlen(() => erledigtGesamt.value, 900)
const tempo = computed(() => {
  if (verlauf.length < 2 || imp.value?.status !== 'laeuft') return null
  const a = verlauf[0]!,
    b = verlauf[verlauf.length - 1]!
  const s = (b.z - a.z) / 1000
  if (s < 2) return null
  const proSek = (b.n - a.n) / s
  const rest = proSek > 0 ? (imp.value.gesamt - erledigtGesamt.value) / proSek : null
  return { mbs: (b.bytes - a.bytes) / s, rest }
})
const restText = (s: number | null | undefined) =>
  s == null
    ? ''
    : s < 90
      ? t(`noch ca. ${Math.max(1, Math.round(s))} Sek.`, `about ${Math.max(1, Math.round(s))} s left`)
      : s < 5400
        ? t(`noch ca. ${Math.round(s / 60)} Min.`, `about ${Math.round(s / 60)} min left`)
        : t(`noch ca. ${Math.round(s / 3600)} Std.`, `about ${Math.round(s / 3600)} h left`)
const protokoll = computed<any[]>(() => (imp.value?.protokoll || []).slice(-8))
const STATUS = computed<Record<string, { text: string; k: string }>>(() => ({
  entwurf: { text: t('Entwurf', 'Draft'), k: 'neutral' },
  analyse: { text: t('Analyse', 'Analysing'), k: 'info' },
  bereit: { text: t('Bereit', 'Ready'), k: 'info' },
  laeuft: { text: t('Läuft', 'Running'), k: 'info' },
  pausiert: { text: t('Pausiert', 'Paused'), k: 'warn' },
  fertig: { text: t('Fertig', 'Done'), k: 'ok' },
  fehler: { text: t('Fehler', 'Error'), k: 'warn' },
  abgebrochen: { text: t('Abgebrochen', 'Cancelled'), k: 'neutral' }
}))
const quelleVon = (id: string) => QUELLEN.value.find((x) => x.id === id)
</script>

<template>
  <section class="rein">
    <div class="kopf">
      <div>
        <div class="eyebrow"><Ico n="umzug" /> {{ t('Umzug', 'Move in') }}</div>
        <h1>{{ t('Von anderen Diensten übernehmen', 'Bring files from other services') }}</h1>
        <p>{{ t('Dateien, Ordner, Ablaufdaten und Aufrufe kommen mit — alte Links leiten auf Wunsch weiter.', 'Files, folders, expiry dates and views come along — old links can keep working.') }}</p>
      </div>
      <button v-if="quelle" class="knopf" @click="neu"><Ico n="left" /> {{ t('Andere Quelle', 'Other source') }}</button>
    </div>

    <div v-if="!quelle" class="quellen">
      <button v-for="(x, i) in QUELLEN" :key="x.id" class="quelle" :class="{ aus: !wegeVon(x.id).length }" :style="{ '--c': x.farbe, animationDelay: i * 45 + 'ms' }" :disabled="!wegeVon(x.id).length" @click="quelleWaehlen(x.id)">
        <span class="lg"><template v-if="x.lg">{{ x.lg }}</template><Ico v-else :n="x.ic || 'folder'" /></span>
        <b>{{ x.name }}</b><small>{{ wegeVon(x.id).length ? x.text : t('Nur für Admins', 'Admins only') }}</small>
      </button>
    </div>

    <template v-else>
      <div class="strom" :class="{ steht: imp?.status !== 'laeuft' && imp?.status !== 'analyse' }" aria-hidden="true">
        <span class="ende" :style="{ background: aktiveQuelle?.farbe }"><template v-if="aktiveQuelle?.lg">{{ aktiveQuelle.lg }}</template><Ico v-else :n="aktiveQuelle?.ic || 'folder'" /></span>
        <div class="bahn"><i v-for="p in 4" :key="p" class="paket" :style="{ '--p': p - 1 }"></i></div>
        <span class="ende ziel"><Ico n="cloud" /></span>
      </div>
      <div class="schritte">
        <div v-for="(s, i) in SCHRITTE" :key="s" class="schritt" :class="{ ok: schritt > i + 1 || schritt === 4, jetzt: schritt === i + 1 && schritt < 4 }">
          <span class="p"><Ico v-if="schritt > i + 1 || schritt === 4" n="check" /><template v-else>{{ i + 1 }}</template></span><span class="st">{{ s }}</span>
        </div>
      </div>

      <Transition name="wechsel" mode="out-in">
        <div v-if="schritt === 1" key="s1" class="block verbinden">
          <div class="reihe zw kopfzeile">
            <h3>{{ aktiveQuelle?.name }}</h3>
            <div v-if="wegeVon(quelle).length > 1 && !imp" class="seg" role="tablist">
              <button v-for="w in wegeVon(quelle)" :key="w" :class="{ an: weg === w }" role="tab" @click="weg = w"><Ico :n="WEG_TEXT[w].ic" /> {{ WEG_TEXT[w].text }}</button>
            </div>
          </div>

          <div v-if="imp?.status === 'analyse'" class="analyse">
            <Ico n="loader" spin /><div><b>{{ t('Quelle wird gelesen …', 'Reading the source …') }}</b><small>{{ imp.meldung || t('Das kann bei großen Sammlungen ein paar Minuten dauern.', 'This can take a few minutes for large collections.') }}</small></div>
          </div>
          <template v-else>
            <div v-if="imp?.meldung" class="hinweis warn"><Ico n="alert" /><span>{{ imp.meldung }}</span></div>

            <template v-if="weg === 'live' && quelle === 'icloud'">
              <label class="feld"><span>{{ t('iCloud-Links', 'iCloud links') }}</span><textarea v-model="zugang.alben" class="eingabe mono" rows="4" placeholder="https://www.icloud.com/sharedalbum/#B0…&#10;https://www.icloud.com/iclouddrive/0abc…#Datei"></textarea>
                <small>{{ t('Einer pro Zeile: geteilte Alben (Fotos-App → Album → Personen → „Öffentliche Website“) und Freigaben einzelner Dateien aus iCloud Drive. Geteilte Ordner gibt Apple nur mit Anmeldung heraus — dafür „Apple-ID“ wählen.', 'One per line: shared albums (Photos app → album → people → “Public Website”) and shares of single files from iCloud Drive. Apple only hands out shared folders after signing in — choose “Apple ID” for that.') }}</small></label>
            </template>
            <template v-else-if="weg === 'konto'">
              <div v-if="appleStand?.schritt === 'fertig'" class="apple-ok">
                <span class="ic"><Ico n="check" /></span>
                <div><b>{{ t('Angemeldet als', 'Signed in as') }} {{ appleStand.konto }}</b><small>{{ t('Die Anmeldung gilt nur für diesen Import und wird danach gelöscht.', 'The sign-in is only used for this import and deleted afterwards.') }}</small></div>
                <button class="knopf klein" :disabled="apple.laeuft" @click="appleAktion({ aktion: 'abmelden' })">{{ t('Abmelden', 'Sign out') }}</button>
              </div>
              <form v-else-if="appleStand?.schritt === 'code'" class="apple-code" @submit.prevent="appleAktion({ aktion: 'code', code: apple.code })">
                <p class="leise klein">{{ appleStand.sms ? t('Gib den Code aus der SMS ein.', 'Enter the code from the SMS.') : t('Apple hat einen sechsstelligen Code an deine Geräte geschickt (iPhone, iPad oder Mac). Bitte dort „Erlauben“ tippen und den Code hier eingeben.', 'Apple sent a six-digit code to your devices (iPhone, iPad or Mac). Tap “Allow” there and enter the code here.') }}</p>
                <div class="reihe" style="gap:10px;flex-wrap:wrap">
                  <input v-model="apple.code" class="eingabe mono code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123456" aria-label="Code">
                  <button class="knopf rot" :disabled="apple.laeuft || apple.code.replace(/\D/g, '').length !== 6"><Ico :n="apple.laeuft ? 'loader' : 'check'" :spin="apple.laeuft" /> {{ t('Bestätigen', 'Confirm') }}</button>
                  <button v-if="!apple.telefone.length" type="button" class="knopf" :disabled="apple.laeuft" @click="appleAktion({ aktion: 'telefone' })">{{ t('Code per SMS', 'Code by SMS') }}</button>
                  <button v-for="tel in apple.telefone" :key="tel.id" type="button" class="knopf" :disabled="apple.laeuft" @click="appleAktion({ aktion: 'sms', telefon: tel.id })"><Ico n="mail" /> {{ tel.nummer }}</button>
                </div>
              </form>
              <form v-else class="raster2" @submit.prevent="appleAktion({ aktion: 'anmelden', appleId: apple.appleId, passwort: apple.passwort })">
                <label class="feld"><span>Apple-ID</span><input v-model="apple.appleId" class="eingabe" type="email" autocomplete="username" placeholder="name@icloud.com" required></label>
                <label class="feld"><span>{{ t('Passwort', 'Password') }}</span><input v-model="apple.passwort" class="eingabe" type="password" autocomplete="current-password" required></label>
                <p class="voll leise klein">{{ t(`Holt deine ganze Fotos-Mediathek im Original (HEIC, Live Photos, Alben) und/oder iCloud Drive. Das Passwort geht nur an Apple und wird nicht gespeichert. Mit „Erweitertem Datenschutz“ muss am iPhone „Zugriff auf iCloud-Daten im Web“ an sein.`, `Fetches your whole Photos library in original quality (HEIC, Live Photos, albums) and/or iCloud Drive. The password only goes to Apple and is not stored. With “Advanced Data Protection”, “Access iCloud Data on the Web” must be on on the iPhone.`) }}</p>
                <div class="voll"><button class="knopf rot" :disabled="apple.laeuft || !apple.appleId || !apple.passwort"><Ico :n="apple.laeuft ? 'loader' : 'key'" :spin="apple.laeuft" /> {{ t('Bei iCloud anmelden', 'Sign in to iCloud') }}</button></div>
              </form>
              <div v-if="appleStand?.schritt === 'fertig'" class="seg inhalt" role="radiogroup" :aria-label="t('Was übernehmen?', 'What to take over?')">
                <button v-for="w in (['fotos', 'drive', 'beides'] as const)" :key="w" type="button" role="radio" :aria-checked="zugang.inhalt === w" :class="{ an: zugang.inhalt === w }" @click="zugang.inhalt = w">
                  <Ico :n="w === 'fotos' ? 'image' : w === 'drive' ? 'folder' : 'grid'" /> {{ w === 'fotos' ? t('Fotos', 'Photos') : w === 'drive' ? 'iCloud Drive' : t('Beides', 'Both') }}
                </button>
              </div>
            </template>
            <template v-else-if="weg === 'live'">
              <div v-if="quelle === 'imgur'" class="raster2">
                <label class="feld"><span>Client-ID</span><input v-model="zugang.clientId" class="eingabe mono" autocomplete="off" :placeholder="imp?.zugang?.hatToken ? t('gespeichert', 'saved') : 'a1b2c3d4e5f6a7b'"><small>{{ t('Für öffentliche Alben: api.imgur.com → Anwendung registrieren.', 'For public albums: api.imgur.com → register an application.') }}</small></label>
                <label class="feld"><span>{{ t('Zugriffs-Token (optional)', 'Access token (optional)') }}</span><input v-model="zugang.accessToken" class="eingabe mono" type="password" autocomplete="off"><small>{{ t('Für das ganze Konto inklusive geheimer Alben.', 'For the whole account including hidden albums.') }}</small></label>
                <label class="feld voll"><span>{{ t('Album-Links', 'Album links') }}</span><textarea v-model="zugang.alben" class="eingabe mono" rows="3" placeholder="https://imgur.com/a/AbC12xy"></textarea><small>{{ t('Einer pro Zeile — leer lassen, wenn ein Zugriffs-Token alles holt.', 'One per line — leave empty if an access token fetches everything.') }}</small></label>
              </div>
              <div v-else class="raster2">
                <label class="feld"><span>{{ t('Adresse der alten Instanz', 'Address of the old instance') }}</span><input v-model="zugang.url" class="eingabe" type="url" :placeholder="quelle === 'zipline' ? 'https://zipline.example.com' : 'https://chibisafe.example.com'"></label>
                <label v-if="quelle === 'zipline'" class="feld"><span>{{ t('API-Token', 'API token') }}</span><input v-model="zugang.token" class="eingabe mono" type="password" autocomplete="off" :placeholder="imp?.zugang?.hatToken ? t('gespeichert', 'saved') : ''"><small>{{ t('Zipline → Einstellungen → Token kopieren. Ein Super-Admin-Token bringt alle Konten, Ordner und Tags mit.', 'Zipline → settings → copy token. A super admin token brings all accounts, folders and tags.') }}</small></label>
                <label v-else class="feld"><span>{{ t('API-Schlüssel', 'API key') }}</span><input v-model="zugang.apiKey" class="eingabe mono" type="password" autocomplete="off" :placeholder="imp?.zugang?.hatToken ? t('gespeichert', 'saved') : ''"><small>{{ t('Chibisafe → Profil → API-Schlüssel.', 'Chibisafe → profile → API key.') }}</small></label>
              </div>
            </template>

            <template v-else-if="weg === 'datei'">
              <p class="leise klein">
                <template v-if="quelle === 'zipline'">{{ t('Export-Datei aus Zipline (Einstellungen → Server → Exportieren). Die Dateien selbst werden von der alten Adresse geladen.', 'Export file from Zipline (settings → server → export). The files themselves are loaded from the old address.') }}</template>
                <template v-else-if="quelle === 'sharex'">{{ t('History.json oder History.db aus Dokumente\\ShareX — am besten den ganzen ShareX-Ordner als ZIP, dann kommen die Bilder direkt mit.', 'History.json or History.db from Documents\\ShareX — best the whole ShareX folder as ZIP, then the images come along directly.') }}</template>
                <template v-else-if="quelle === 'tinyfilemanager'">{{ t('Den Webordner als ZIP hochladen — samt tinyfilemanager.php und config.php, damit die Konten mitkommen.', 'Upload the web folder as a ZIP — including tinyfilemanager.php and config.php so the accounts come along.') }}</template>
                <template v-else-if="quelle === 'takeout'">{{ t('Die ZIP-Archive aus takeout.google.com (nur „Google Fotos“ auswählen). Mehrere Teile einfach alle hochladen.', 'The ZIP archives from takeout.google.com (select only “Google Photos”). Just upload all parts.') }}</template>
                <template v-else-if="quelle === 'icloud'">{{ t('Die ZIP-Archive aus privacy.apple.com (Kopie deiner Daten anfordern → „iCloud Fotos“ und/oder „iCloud Drive“). Alle Teile hochladen — Datum, Favoriten, Alben und Live Photos kommen mit.', 'The ZIP archives from privacy.apple.com (request a copy of your data → “iCloud Photos” and/or “iCloud Drive”). Upload all parts — dates, favourites, albums and Live Photos come along.') }}</template>
                <template v-else>{{ t('Einzelne Dateien oder ZIP-Archive — Ordner im Archiv werden zu eigenen Ordnern.', 'Single files or ZIP archives — folders in the archive become folders here.') }}</template>
              </p>
              <div class="ablage" :class="{ ziehen }" @click="dateiFeld?.click()" @dragover.prevent="ziehen = true" @dragleave="ziehen = false" @drop.prevent="abgelegt">
                <span class="ic"><Ico n="upload" /></span>
                <div><b>{{ t('Dateien hier ablegen', 'Drop files here') }}</b><small>{{ t('oder klicken — große Archive gehen in Stücken und setzen nach Abbruch fort', 'or click — large archives go in pieces and resume after interruptions') }}</small></div>
                <input ref="dateiFeld" type="file" multiple class="versteckt" @change="(e) => dateienHinzu((e.target as HTMLInputElement).files)">
              </div>
              <div v-if="hochgeladen.length || ladend.length" class="dateiliste">
                <div v-for="h in hochgeladen.filter(x => x.fertig)" :key="'h' + h.name" class="dzeile"><Ico n="file" /><span class="n">{{ h.name }}</span><span class="sehrleise">{{ groesse(h.groesse) }}</span><button class="knopf nur-icon" :aria-label="t('Entfernen', 'Remove')" @click="dateiWeg(h.name)"><Ico n="x" /></button></div>
                <div v-for="l in ladend" :key="'l' + l.name" class="dzeile laed"><Ico :n="l.fehler ? 'alert' : 'loader'" :spin="!l.fehler" /><span class="n">{{ l.name }}</span><span class="sehrleise">{{ l.fehler || `${groesse(l.fertig)} / ${groesse(l.groesse)}` }}</span><div class="mini"><i :style="{ width: (l.groesse ? l.fertig / l.groesse * 100 : 100) + '%' }"></i></div></div>
              </div>
              <label v-if="quelle === 'zipline'" class="feld" style="margin-top:14px"><span>{{ t('Adresse der alten Instanz', 'Address of the old instance') }}</span><input v-model="zugang.url" class="eingabe" type="url" placeholder="https://zipline.example.com"></label>
            </template>

            <template v-else>
              <div v-if="ordnerBlick && !ordnerBlick.vorhanden" class="hinweis">
                <Ico n="server" />
                <span>{{ t('Kein Import-Ordner eingehängt. In der docker-compose.yml steht dafür', 'No import folder mounted. The docker-compose.yml has') }} <code class="mono">./import:/import:ro</code> — {{ t('alte Upload-Ordner in den Ordner „import“ neben der docker-compose.yml kopieren und die Seite neu laden.', 'copy old upload folders into the “import” folder next to docker-compose.yml and reload the page.') }}</span>
              </div>
              <div v-else-if="ordnerBlick" class="ordnerwahl">
                <div class="krumen">
                  <button class="knopf klein" :title="ordnerBlick.wurzel" @click="ordnerOeffnen('')"><Ico n="server" /> /import</button>
                  <template v-for="(k, i) in brotkrumen" :key="i"><span class="sehrleise">/</span><button class="knopf klein" @click="ordnerOeffnen(brotkrumen.slice(0, i + 1).join('/'))">{{ k }}</button></template>
                </div>
                <div class="unter">
                  <button v-for="o in ordnerBlick.ordner" :key="o" class="uo" @click="ordnerOeffnen((ordnerBlick.pfad ? ordnerBlick.pfad + '/' : '') + o)"><Ico n="folder" /> {{ o }}</button>
                  <p v-if="!ordnerBlick.ordner.length" class="sehrleise klein">{{ t('Keine Unterordner.', 'No subfolders.') }}</p>
                </div>
                <p class="sehrleise klein">{{ t(`Gewählt: /import/${ordnerBlick.pfad} · ${ordnerBlick.dateien} Dateien direkt darin`, `Selected: /import/${ordnerBlick.pfad} · ${ordnerBlick.dateien} files directly inside`) }}</p>
                <p class="leise klein">
                  <template v-if="quelle === 'zipline'">{{ t('Den Upload-Ordner von Zipline wählen und die Export-Datei (zipline_export_….json) mit hineinlegen — so kommen auch passwortgeschützte Dateien mit.', 'Select Zipline’s upload folder and put the export file (zipline_export_….json) inside — this way password-protected files come along too.') }}</template>
                  <template v-else-if="quelle === 'xbackbone'">{{ t('Den XBackBone-Ordner wählen (mit config.php, storage/ und resources/database/).', 'Select the XBackBone folder (with config.php, storage/ and resources/database/).') }}</template>
                  <template v-else-if="quelle === 'chibisafe'">{{ t('Den Chibisafe-Ordner wählen (mit database/database.sqlite und uploads/).', 'Select the Chibisafe folder (with database/database.sqlite and uploads/).') }}</template>
                  <template v-else-if="quelle === 'sharex'">{{ t('Den ShareX-Ordner wählen (mit History.db/History.json und Screenshots/).', 'Select the ShareX folder (with History.db/History.json and Screenshots/).') }}</template>
                  <template v-else-if="quelle === 'tinyfilemanager'">{{ t('Den Ordner wählen, den Tiny File Manager verwaltet hat — am besten samt tinyfilemanager.php und config.php, dann kommen auch die Konten mit.', 'Select the folder Tiny File Manager managed — ideally including tinyfilemanager.php and config.php, so the accounts come along too.') }}</template>
                  <template v-else-if="quelle === 'takeout'">{{ t('Den ausgepackten Takeout-Ordner oder einen Ordner mit den Takeout-ZIPs wählen.', 'Select the extracted Takeout folder or a folder with the Takeout ZIPs.') }}</template>
                  <template v-else-if="quelle === 'icloud'">{{ t('Den Ordner mit den Apple-Export-ZIPs („iCloud Photos Part 1 of …“) oder den ausgepackten Export wählen.', 'Select the folder with the Apple export ZIPs (“iCloud Photos Part 1 of …”) or the extracted export.') }}</template>
                </p>
              </div>
              <div v-if="quelle === 'xbackbone'" class="mysql">
                <label class="reihe"><input v-model="mysqlOffen" type="checkbox"> {{ t('XBackBone nutzt MySQL/MariaDB — Zugang eintragen', 'XBackBone uses MySQL/MariaDB — enter access') }}</label>
                <div v-if="mysqlOffen" class="raster2" style="margin-top:12px">
                  <label class="feld"><span>Host</span><input v-model="zugang.mysql.host" class="eingabe" placeholder="db"></label>
                  <label class="feld"><span>Port</span><input v-model="zugang.mysql.port" class="eingabe" inputmode="numeric" placeholder="3306"></label>
                  <label class="feld"><span>{{ t('Datenbank', 'Database') }}</span><input v-model="zugang.mysql.database" class="eingabe" placeholder="xbackbone"></label>
                  <label class="feld"><span>{{ t('Benutzer', 'User') }}</span><input v-model="zugang.mysql.user" class="eingabe" autocomplete="off"></label>
                  <label class="feld voll"><span>{{ t('Passwort', 'Password') }}</span><input v-model="zugang.mysql.password" class="eingabe" type="password" autocomplete="off"><small>{{ t('Leer lassen, wenn es in der config.php steht.', 'Leave empty if it is in config.php.') }}</small></label>
                </div>
              </div>
            </template>

            <div v-if="!(weg === 'konto' && appleStand?.schritt !== 'fertig')" class="modal-fuss">
              <button class="knopf rot" :disabled="!kannAnalysieren || sendet" @click="analysieren"><Ico :n="sendet ? 'loader' : 'search'" :spin="sendet" /> {{ t('Quelle prüfen', 'Check source') }}</button>
            </div>
          </template>
        </div>

        <div v-else-if="schritt === 2" key="s2" class="auswahl">
          <div class="zahlen">
            <div class="wert"><small>{{ t('Dateien', 'Files') }}</small><b class="zahl">{{ zahl(imp.plan.dateien) }}</b></div>
            <div class="wert"><small>{{ t('Größe', 'Size') }}</small><b>{{ imp.plan.bytes ? groesse(imp.plan.bytes) : '—' }}</b></div>
            <div class="wert"><small>{{ t('Ordner', 'Folders') }}</small><b class="zahl">{{ zahl(imp.plan.ordner) }}</b></div>
            <div class="wert"><small>Tags</small><b class="zahl">{{ zahl(imp.plan.tags) }}</b></div>
            <div v-if="imp.plan.nutzer?.length" class="wert"><small>{{ t('Konten', 'Accounts') }}</small><b class="zahl">{{ zahl(imp.plan.nutzer.length) }}</b></div>
            <div v-if="imp.plan.weiterleitungen" class="wert"><small>{{ t('Alte Links', 'Old links') }}</small><b class="zahl">{{ zahl(imp.plan.weiterleitungen) }}</b></div>
          </div>
          <div v-if="imp.plan.hinweise?.length" class="block hinweise">
            <div v-for="(h, i) in imp.plan.hinweise" :key="i" class="h"><Ico n="alert" /><span>{{ h }}</span></div>
          </div>
          <div class="raster-auswahl">
            <div class="block">
              <h3>{{ t('Was übernommen wird', 'What is taken over') }}</h3>
              <div class="optionen">
                <label v-if="admin && imp.plan.nutzer?.length" class="opt"><input v-model="opt.konten" type="checkbox"><span><b>{{ t('Konten anlegen', 'Create accounts') }}</b><small>{{ t('Jede Datei landet beim richtigen Konto. Alte Passwörter funktionieren weiter.', 'Each file goes to the right account. Old passwords keep working.') }}</small></span></label>
                <label v-if="imp.plan.mitLinkname" class="opt"><input v-model="opt.linknamen" type="checkbox"><span><b>{{ t('Linknamen behalten', 'Keep link names') }}</b><small>{{ t(`${zahl(imp.plan.mitLinkname)} Dateien behalten ihren Namen im Link (z. B. „${imp.plan.beispiele?.find((b: any) => b.slug)?.slug || 'abc123'}“).`, `${zahl(imp.plan.mitLinkname)} files keep their name in the link (e.g. “${imp.plan.beispiele?.find((b: any) => b.slug)?.slug || 'abc123'}”).`) }}</small></span></label>
                <label v-if="imp.plan.weiterleitungen" class="opt"><input v-model="opt.weiterleiten" type="checkbox"><span><b>{{ t('Alte Links weiterleiten', 'Redirect old links') }}</b><small>{{ t(`Zieht die Domain auf ${theme.name} um, landen alte Pfade wie /u/abc.png auf der neuen Datei.`, `If the domain moves to ${theme.name}, old paths like /u/abc.png land on the new file.`) }}</small></span></label>
                <label class="opt"><input v-model="opt.grenzen" type="checkbox"><span><b>{{ t('Ablauf, Aufrufgrenze und Passwort', 'Expiry, view limit and password') }}</b><small>{{ t('Schon abgelaufene Dateien werden übersprungen.', 'Files that already expired are skipped.') }}</small></span></label>
                <label class="opt"><input v-model="opt.aufrufe" type="checkbox"><span><b>{{ t('Aufrufe und Favoriten', 'Views and favourites') }}</b><small>{{ t('Zähler und Sterne aus dem alten Dienst.', 'Counters and stars from the old service.') }}</small></span></label>
              </div>
            </div>
            <div class="block">
              <h3>{{ t('Wohin', 'Where to') }}</h3>
              <label v-if="admin && !opt.konten && nutzerListe.length" class="feld"><span>{{ t('Konto', 'Account') }}</span>
                <VdAuswahl v-model.number="opt.zielNutzer" class="eingabe"><option v-for="n in nutzerListe" :key="n.id" :value="n.id">{{ n.username }}</option></VdAuswahl></label>
              <label class="feld"><span>{{ t('Sammelordner', 'Collection folder') }}</span><input v-model="opt.ordnerName" class="eingabe" maxlength="80" :placeholder="t('leer = oberste Ebene', 'empty = top level')"><small>{{ t('Ordner aus der Quelle liegen darunter.', 'Folders from the source go inside it.') }}</small></label>
              <div class="zuordnung">
                <span class="von">{{ imp.titel }}</span><span class="pfeil"><Ico n="right" /></span><span class="nach">{{ theme.name }}{{ opt.ordnerName ? ` / ${opt.ordnerName}` : '' }}</span>
                <template v-if="opt.konten && imp.plan.nutzer?.length"><span class="von">{{ t('Konten', 'accounts') }}</span><span class="pfeil"><Ico n="right" /></span><span class="nach">{{ t(`${imp.plan.nutzer.length} Konten`, `${imp.plan.nutzer.length} accounts`) }}</span></template>
                <template v-if="opt.grenzen && imp.plan.mitAblauf"><span class="von">expiresAt</span><span class="pfeil"><Ico n="right" /></span><span class="nach">{{ t('Ablauf', 'Expiry') }}</span></template>
                <template v-if="opt.weiterleiten && imp.plan.weiterleitungen"><span class="von">/u/{{ imp.plan.beispiele?.find((b: any) => b.slug)?.slug || 'abc' }}…</span><span class="pfeil"><Ico n="right" /></span><span class="nach">{{ t('Weiterleitung', 'Redirect') }}</span></template>
              </div>
            </div>
          </div>
          <div v-if="opt.konten && imp.plan.nutzer?.length" class="block konten">
            <h3>{{ t('Konten aus der Quelle', 'Accounts from the source') }}</h3>
            <div class="ktab">
              <div v-for="n in imp.plan.nutzer.slice(0, 40)" :key="n.schluessel" class="kz">
                <span class="av">{{ String(n.username || '?').slice(0, 1).toUpperCase() }}</span><b>{{ n.username }}</b>
                <span v-if="n.admin" class="chip info">Admin</span>
                <span v-if="n.vorhanden" class="chip neutral">{{ t('gibt es schon — Dateien kommen dorthin', 'already exists — files go there') }}</span>
                <span v-else :class="['chip', n.passwort ? 'ok' : 'warn']">{{ n.passwort ? t('Passwort übernommen', 'password kept') : t('ohne Passwort', 'no password') }}</span>
                <span class="sehrleise klein rechts">{{ zahl(n.anzahl) }} {{ t('Dateien', 'files') }} · {{ groesse(n.bytes) }}</span>
              </div>
            </div>
          </div>
          <div class="reihe zw unten">
            <button class="knopf" @click="analysieren"><Ico n="drehenl" /> {{ t('Neu prüfen', 'Check again') }}</button>
            <button class="knopf rot" :disabled="sendet" @click="starten"><Ico :n="sendet ? 'loader' : 'play'" :spin="sendet" /> {{ t(`${zahl(imp.plan.dateien)} Dateien übertragen`, `Transfer ${zahl(imp.plan.dateien)} files`) }}</button>
          </div>
        </div>

        <div v-else key="s3" class="importlauf" :class="{ fertig: schritt === 4 }">
          <div class="reihe zw" style="align-items:flex-end">
            <div class="gross"><b class="zahl">{{ zahl(zaehler) }}</b><span class="leise">{{ t(`von ${zahl(imp.gesamt)} Dateien aus`, `of ${zahl(imp.gesamt)} files from`) }} <b class="q">{{ imp.titel }}</b></span></div>
            <span class="mono sehrleise klein">
              <template v-if="imp.status === 'laeuft'">{{ tempo ? `${restText(tempo.rest)} · ${groesse(tempo.mbs)}/s` : t('läuft an …', 'starting …') }}</template>
              <template v-else>{{ STATUS[imp.status]?.text }}</template>
            </span>
          </div>
          <div class="fortschritt" :class="{ steht: imp.status !== 'laeuft' }"><i :style="{ width: anteil + '%' }"></i></div>
          <div class="stand">
            <span><i class="punkt ok"></i>{{ zahl(imp.erledigt) }} {{ t('übernommen', 'taken over') }}</span>
            <span v-if="imp.uebersprungen"><i class="punkt"></i>{{ zahl(imp.uebersprungen) }} {{ t('übersprungen', 'skipped') }}</span>
            <span v-if="imp.fehlgeschlagen"><i class="punkt rot"></i>{{ zahl(imp.fehlgeschlagen) }} {{ t('fehlgeschlagen', 'failed') }}</span>
            <span class="sehrleise">{{ groesse(imp.bytes) }}<template v-if="imp.bytes_gesamt"> / {{ groesse(imp.bytes_gesamt) }}</template></span>
          </div>
          <div class="protokoll" aria-live="polite">
            <div v-for="(z, i) in protokoll" :key="z.z + '-' + i" :class="z.a">
              <span class="zeichen"><Ico :n="z.a === 'ok' ? 'check' : z.a === 'fehler' ? 'x' : z.a === 'weg' ? 'right' : 'circle'" /></span>{{ z.t }}
            </div>
          </div>
          <div v-if="schritt === 4 && fehlerListe.length" class="fehlerliste">
            <b>{{ t('Fehlgeschlagen', 'Failed') }}</b>
            <div v-for="(f, i) in fehlerListe" :key="i" class="fz"><span class="n">{{ f.name }}</span><span class="sehrleise">{{ f.meldung }}</span></div>
          </div>
          <div class="reihe zw unten">
            <div class="reihe">
              <button v-if="imp.status === 'laeuft'" class="knopf" @click="steuern('pausieren')"><Ico n="pause" /> {{ t('Pausieren', 'Pause') }}</button>
              <button v-if="imp.status === 'pausiert'" class="knopf rot" @click="fortsetzen"><Ico n="play" /> {{ t('Fortsetzen', 'Resume') }}</button>
              <button v-if="imp.status === 'laeuft' || imp.status === 'pausiert'" class="knopf gefahr" @click="steuern('abbrechen')">{{ t('Abbrechen', 'Cancel') }}</button>
              <button v-if="(imp.status === 'fertig' || imp.status === 'pausiert') && imp.fehlgeschlagen" class="knopf" @click="steuern('wiederholen')"><Ico n="drehenl" /> {{ t('Fehlgeschlagene wiederholen', 'Retry failed') }}</button>
            </div>
            <div class="reihe">
              <span v-if="imp.status === 'laeuft'" class="sehrleise klein">{{ t('Läuft auf dem Server weiter — die Seite darf zu.', 'Keeps running on the server — you can close the page.') }}</span>
              <NuxtLink v-if="schritt === 4" to="/" class="knopf rot"><Ico n="grid" /> {{ t('Zu den Dateien', 'Go to files') }}</NuxtLink>
            </div>
          </div>
        </div>
      </Transition>
    </template>

    <template v-if="bisher.length">
      <h2 class="abschnitt">{{ t('Bisherige Importe', 'Previous imports') }}</h2>
      <div class="liste">
        <div v-for="(x, i) in bisher" :key="x.id" class="zeile" :class="{ an: imp?.id === x.id }" :style="{ animationDelay: Math.min(i, 12) * 35 + 'ms' }">
          <span class="lg" :style="{ background: quelleVon(x.quelle)?.farbe }"><template v-if="quelleVon(x.quelle)?.lg">{{ quelleVon(x.quelle)!.lg }}</template><Ico v-else :n="quelleVon(x.quelle)?.ic || 'folder'" /></span>
          <button class="ziel" @click="oeffnen(x.id)">
            <b>{{ x.titel || quelleVon(x.quelle)?.name }}</b>
            <small>{{ zeitpunkt(x.created_at) }}<template v-if="admin"> · {{ x.username }}</template><template v-if="x.gesamt"> · {{ zahl(x.erledigt) }} / {{ zahl(x.gesamt) }} {{ t('Dateien', 'files') }}</template></small>
          </button>
          <span :class="['chip', STATUS[x.status]?.k || 'neutral']">{{ STATUS[x.status]?.text || x.status }}</span>
          <button class="knopf nur-icon" :aria-label="t('Entfernen', 'Remove')" :disabled="x.status === 'laeuft' || x.status === 'analyse'" @click="entfernen(x)"><Ico n="trash" /></button>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.quellen {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(165px, 1fr));
  gap: 12px;
}
.quelle {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  border: 1px solid var(--linie);
  background: var(--flaeche);
  border-radius: 14px;
  padding: 16px;
  cursor: pointer;
  transition:
    transform 0.25s var(--kurve),
    border-color 0.25s,
    box-shadow 0.25s;
  text-align: left;
  animation: rein 0.5s var(--kurve) backwards;
}
.quelle:hover:not(:disabled) {
  transform: translateY(-3px);
  border-color: var(--linie2);
  box-shadow: var(--schatten);
}
.quelle:hover:not(:disabled) .lg {
  transform: rotate(-6deg) scale(1.06);
}
.quelle.aus {
  opacity: 0.5;
  cursor: not-allowed;
}
.quelle .lg,
.zeile .lg {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-weight: 800;
  font-family: var(--f-display);
  font-size: 17px;
  color: #fff;
  background: var(--c);
  margin-bottom: 12px;
  transition: transform 0.35s cubic-bezier(0.2, 0.9, 0.2, 1.4);
}
.quelle .lg svg,
.zeile .lg svg {
  width: 18px;
  height: 18px;
}
.quelle b {
  display: block;
  font-size: 14px;
}
.quelle small {
  color: var(--text3);
  font-size: 12px;
}
.strom {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 4px 0 4px;
}
.strom .ende {
  width: 46px;
  height: 46px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  color: #fff;
  font-family: var(--f-display);
  font-weight: 800;
  font-size: 19px;
  flex-shrink: 0;
}
.strom .ende svg {
  width: 20px;
  height: 20px;
}
.strom .bahn {
  flex: 1;
  height: 2px;
  position: relative;
  background: repeating-linear-gradient(90deg, var(--linie2) 0 6px, transparent 6px 12px);
}
.strom .paket {
  position: absolute;
  top: 50%;
  width: 22px;
  height: 6px;
  margin-top: -3px;
  border-radius: 3px;
  background: var(--a);
  box-shadow: 0 0 14px rgba(var(--a-rgb), 0.6);
  animation: paket 1.6s linear infinite;
  animation-delay: calc(var(--p) * -0.4s);
  opacity: 0;
}
.strom .ziel {
  background: var(--a);
  animation: empfang 1.6s ease-in-out infinite;
}
.strom.steht .paket {
  animation: none;
  opacity: 0;
}
.strom.steht .ziel {
  animation: none;
}
@keyframes paket {
  0% {
    left: 0;
    opacity: 0;
  }
  10% {
    opacity: 1;
  }
  90% {
    opacity: 1;
  }
  100% {
    left: calc(100% - 22px);
    opacity: 0;
  }
}
@keyframes empfang {
  85% {
    transform: scale(1);
  }
  92% {
    transform: scale(1.08);
  }
}

.schritte {
  display: flex;
  margin: 22px 0 18px;
}
.schritt {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text3);
}
.schritt .p {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1.5px solid var(--linie2);
  display: grid;
  place-items: center;
  font-size: 11.5px;
  font-weight: 600;
  flex-shrink: 0;
  transition: all 0.35s var(--kurve);
}
.schritt .p svg {
  width: 13px;
  height: 13px;
}
.schritt::after {
  content: '';
  flex: 1;
  height: 1.5px;
  background: var(--linie);
  margin: 0 12px;
}
.schritt:last-child::after {
  display: none;
}
.schritt.ok {
  color: var(--text2);
}
.schritt.ok .p {
  background: var(--a);
  border-color: var(--a);
  color: #fff;
}
.schritt.jetzt {
  color: var(--text);
  font-weight: 500;
}
.schritt.jetzt .p {
  border-color: var(--a);
  color: var(--a);
  box-shadow: 0 0 0 4px rgba(var(--a-rgb), 0.12);
}

.kopfzeile {
  margin-bottom: 16px;
  gap: 12px;
  flex-wrap: wrap;
}
.kopfzeile h3 {
  font-family: var(--f-display);
  font-size: 20px;
  letter-spacing: -0.02em;
  margin: 0;
}
.raster2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 14px;
}
.raster2 .voll {
  grid-column: 1 / -1;
}
.analyse {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 18px;
  border-radius: 12px;
  background: rgba(var(--a-rgb), 0.05);
  border: 1px dashed rgba(var(--a-rgb), 0.35);
}
.analyse > svg {
  width: 22px;
  height: 22px;
  color: var(--a);
}
.analyse small {
  display: block;
  color: var(--text2);
  font-size: 12.5px;
}
.hinweis {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--flaeche2);
  font-size: 13px;
  color: var(--text2);
  margin-bottom: 14px;
}
.hinweis.warn {
  background: var(--warn-bg);
  color: var(--warn);
}
.hinweis svg {
  width: 16px;
  height: 16px;
  margin-top: 2px;
}
.hinweis code {
  font-size: 12px;
  background: var(--bg);
  padding: 1px 5px;
  border-radius: 5px;
}

.ablage {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 22px;
  border: 1.5px dashed var(--linie2);
  border-radius: 14px;
  cursor: pointer;
  transition:
    border-color 0.2s,
    background 0.2s,
    transform 0.25s var(--kurve);
}
.ablage:hover,
.ablage.ziehen {
  border-color: var(--a);
  background: rgba(var(--a-rgb), 0.04);
}
.ablage.ziehen {
  transform: scale(1.01);
}
.ablage .ic {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: rgba(var(--a-rgb), 0.1);
  color: var(--a);
  display: grid;
  place-items: center;
  transition: transform 0.3s var(--kurve);
}
.ablage:hover .ic,
.ablage.ziehen .ic {
  transform: translateY(-3px);
}
.ablage small {
  display: block;
  color: var(--text3);
  font-size: 12px;
}
.dateiliste {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
}
.dzeile {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--flaeche2);
  position: relative;
  overflow: hidden;
  font-size: 13px;
  animation: rein 0.35s var(--kurve) backwards;
}
.dzeile > svg {
  width: 15px;
  height: 15px;
  color: var(--text3);
}
.dzeile .n {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dzeile .mini {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
}
.dzeile .mini i {
  display: block;
  height: 100%;
  background: var(--a);
  transition: width 0.3s;
}

.ordnerwahl {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.krumen {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.unter {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 6px;
  max-height: 240px;
  overflow: auto;
  padding: 2px;
}
.uo {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--linie);
  background: var(--bg);
  border-radius: 9px;
  padding: 8px 10px;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  transition:
    border-color 0.2s,
    transform 0.2s var(--kurve);
}
.uo:hover {
  border-color: var(--a);
  transform: translateX(2px);
}
.uo svg {
  width: 14px;
  height: 14px;
  color: var(--a);
}
.mysql {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--linie);
  font-size: 13px;
}
.mysql > label {
  gap: 8px;
  cursor: pointer;
}

.zahlen {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}
.wert {
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 14px;
  padding: 14px 16px;
  animation: rein 0.5s var(--kurve) backwards;
}
.wert:nth-child(2) {
  animation-delay: 50ms;
}
.wert:nth-child(3) {
  animation-delay: 100ms;
}
.wert:nth-child(4) {
  animation-delay: 150ms;
}
.wert:nth-child(5) {
  animation-delay: 200ms;
}
.wert:nth-child(6) {
  animation-delay: 250ms;
}
.wert small {
  display: block;
  color: var(--text3);
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
}
.wert b {
  font-family: var(--f-display);
  font-size: 28px;
  letter-spacing: -0.03em;
  font-weight: 700;
}
.hinweise {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}
.hinweise .h {
  display: flex;
  gap: 10px;
  font-size: 13px;
  color: var(--text2);
}
.hinweise svg {
  width: 15px;
  height: 15px;
  color: var(--warn);
  margin-top: 2px;
}
.raster-auswahl {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 14px;
}
.raster-auswahl .block + .block {
  margin-top: 0;
}
.optionen {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
}
.opt {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.2s;
}
.opt:hover {
  background: var(--flaeche2);
}
.opt input {
  margin-top: 3px;
  accent-color: var(--a);
  width: 16px;
  height: 16px;
}
.opt b {
  display: block;
  font-weight: 500;
  font-size: 13.5px;
}
.opt small {
  color: var(--text3);
  font-size: 12px;
}
.zuordnung {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 8px 14px;
  align-items: center;
  font-size: 13px;
  margin-top: 6px;
}
.zuordnung .von {
  color: var(--text2);
  font-family: var(--f-mono);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zuordnung .pfeil {
  color: var(--text3);
  display: grid;
}
.zuordnung .pfeil svg {
  width: 14px;
  height: 14px;
}
.zuordnung .nach {
  font-weight: 500;
}
.konten {
  margin-top: 14px;
}
.ktab {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
  max-height: 320px;
  overflow: auto;
}
.kz {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 4px;
  font-size: 13px;
  flex-wrap: wrap;
}
.kz .av {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--a), color-mix(in srgb, var(--a) 55%, #000));
  color: #fff;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 12px;
}
.kz .rechts {
  margin-left: auto;
}
.unten {
  margin-top: 16px;
  gap: 10px;
  flex-wrap: wrap;
}
.unten .reihe {
  gap: 8px;
  flex-wrap: wrap;
}

.importlauf {
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 16px;
  padding: 20px;
}
.importlauf .gross {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.importlauf .gross > b {
  font-family: var(--f-display);
  font-size: 44px;
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1;
}
.importlauf .gross .q {
  color: var(--text);
  font-weight: 600;
}
.importlauf.fertig .gross > b {
  color: var(--a);
  animation: fertigPuls 1.2s var(--kurve);
}
@keyframes fertigPuls {
  30% {
    transform: scale(1.06);
  }
}
.fortschritt {
  height: 8px;
  background: var(--flaeche2);
  border-radius: 99px;
  overflow: hidden;
  margin: 14px 0 10px;
}
.fortschritt i {
  display: block;
  height: 100%;
  width: 0;
  background: var(--a);
  border-radius: 99px;
  transition: width 0.6s var(--kurve);
  position: relative;
  overflow: hidden;
}
.fortschritt i::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.35), transparent);
  animation: glanz2 1.3s linear infinite;
}
.fortschritt.steht i::after {
  display: none;
}
@keyframes glanz2 {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(100%);
  }
}
.stand {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 12.5px;
  color: var(--text2);
}
.stand span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.punkt {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text3);
  display: inline-block;
}
.punkt.ok {
  background: var(--ok);
}
.punkt.rot {
  background: var(--rot);
}
.protokoll {
  margin-top: 14px;
  font-family: var(--f-mono);
  font-size: 11.5px;
  color: var(--text2);
  background: var(--bg);
  border-radius: 10px;
  padding: 10px 12px;
  min-height: 142px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  border: 1px solid var(--linie);
  overflow: hidden;
}
.protokoll div {
  animation: rein 0.3s backwards;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  gap: 8px;
  align-items: center;
  line-height: 1.7;
}
.protokoll .zeichen {
  display: grid;
}
.protokoll .zeichen svg {
  width: 12px;
  height: 12px;
}
.protokoll .ok .zeichen {
  color: var(--ok);
}
.protokoll .fehler {
  color: var(--rot);
}
.protokoll .weg {
  color: var(--text3);
}
.protokoll .info {
  color: var(--text);
}
.fehlerliste {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12.5px;
  max-height: 220px;
  overflow: auto;
}
.fz {
  display: flex;
  gap: 10px;
}
.fz .n {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 50%;
}

.abschnitt {
  font-family: var(--f-display);
  font-size: 22px;
  letter-spacing: -0.02em;
  margin: 34px 0 12px;
}
.liste {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.zeile {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 12px;
  padding: 8px 10px;
  animation: rein 0.45s var(--kurve) backwards;
  transition: border-color 0.2s;
}
.zeile.an {
  border-color: rgba(var(--a-rgb), 0.5);
}
.zeile .lg {
  margin: 0;
  width: 32px;
  height: 32px;
  font-size: 14px;
  border-radius: 9px;
}
.zeile .ziel {
  flex: 1;
  min-width: 0;
  text-align: left;
  border: 0;
  background: none;
  cursor: pointer;
  padding: 0;
}
.zeile .ziel b {
  display: block;
  font-weight: 500;
}
.zeile .ziel small {
  color: var(--text3);
  font-size: 12px;
}
.klein {
  font-size: 12px;
}
.leise {
  color: var(--text2);
}
.wechsel-enter-active {
  transition:
    opacity 0.3s,
    transform 0.35s var(--kurve);
}
.wechsel-leave-active {
  transition: opacity 0.12s;
}
.wechsel-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.wechsel-leave-to {
  opacity: 0;
}
.apple-ok {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--ok-bg, rgba(22, 163, 74, 0.08));
  margin-bottom: 14px;
  animation: rein 0.4s var(--kurve) backwards;
}
.apple-ok .ic {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--ok);
  color: #fff;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.apple-ok .ic svg {
  width: 16px;
  height: 16px;
}
.apple-ok > div {
  flex: 1;
  min-width: 0;
}
.apple-ok small {
  display: block;
  color: var(--text2);
  font-size: 12.5px;
}
.apple-code .code {
  width: 9.5em;
  font-size: 20px;
  letter-spacing: 0.3em;
  text-align: center;
}
.seg.inhalt {
  margin: 4px 0 14px;
}
@media (max-width: 760px) {
  .raster2,
  .raster-auswahl {
    grid-template-columns: 1fr;
  }
  .schritt .st {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .strom .paket,
  .strom .ziel,
  .fortschritt i::after {
    animation: none;
  }
}
</style>
