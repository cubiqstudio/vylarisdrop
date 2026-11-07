<script setup lang="ts">
const theme = useTheme()
const route = useRoute()
const ich = computed(() => theme.value.user)
const istAdmin = computed(() => ich.value?.role === 'owner' || ich.value?.role === 'admin')
const istInhaber = computed(() => ich.value?.role === 'owner')
const { vorbereiten: hochladen, neu } = useUploads()
const { ok } = useToast()

const { data: stats } = await (useFetch as any)('/api/files/stats', { key: 'stats' })
// EINE gemeinsame, gebündelte Aktualisierung der Zähler/Belegung für den ganzen Rahmen (und alle Seiten, die den Schlüssel
// 'stats' teilen): Änderungen von überall (anderer Tab, Gerät, WebDAV, Team, API) und eigene Uploads laufen hier zusammen.
const { aktualisieren: statsNeu } = useLiveDaten({
  daten: [{ schluessel: 'stats', url: '/api/files/stats' }],
  themen: ['dateien', 'ordner', 'papierkorb'],
  mind: 1500
})
watch(neu, () => statsNeu())
const belegt = useHochzaehlen(() => Number(stats.value?.belegt || 0))
const ARTEN = [
  { k: 'bild', c: '#1e73be', de: 'Bilder', en: 'Images' },
  { k: 'video', c: '#f59e0b', de: 'Videos', en: 'Videos' },
  { k: 'audio', c: '#3b82f6', de: 'Audio', en: 'Audio' },
  { k: 'text', c: '#22c55e', de: 'Text', en: 'Text' },
  { k: 'datei', c: 'var(--text3)', de: 'Sonst.', en: 'Other' }
]
// Kontingent: stats.quota = { limit, used, free, prozent, stufe, source, papierkorb } (siehe server/utils/quota.ts)
const quota = computed(() => stats.value?.quota)
const segmente = computed(() => [
  ...ARTEN.map((a) => ({ bytes: Number(stats.value?.proArt?.[a.k]?.bytes || 0), farbe: a.c })),
  { bytes: Number(stats.value?.papierkorb || 0), farbe: '', muster: true },
  // für Storage-Boxen und S3-Buckets reserviert (Summe deren Kontingente) — eigene Farbe
  { bytes: Number(quota.value?.eingeplant || 0), farbe: '#8b5cf6' }
])
const speicherText = computed(() => {
  const q = quota.value
  if (!q?.limit || q.stufe === 'ok') return ''
  const p = Math.floor(q.prozent || 0)
  return q.stufe === 'voll'
    ? t('Speicher voll — Uploads werden abgelehnt', 'Storage full — uploads are rejected')
    : q.stufe === 'kritisch'
      ? t(`Fast voll: ${p} % belegt`, `Almost full: ${p}% used`)
      : t(`${p} % belegt`, `${p}% used`)
})

interface NavPunkt {
  zu: string
  ic: string
  text: string
  zahl?: number
  chip?: string
}
const NAV = computed<Array<{ gruppe: string; punkte: NavPunkt[] }>>(() => [
  {
    gruppe: 'Cloud',
    punkte: [
      { zu: '/', ic: 'cloud', text: t('Meine Dateien', 'My files'), zahl: stats.value?.dateien },
      { zu: '/sync', ic: 'umzug', text: t('Sync & WebDAV', 'Sync & WebDAV') },
      { zu: '/geraete', ic: 'laptop', text: t('Verbundene Geräte', 'Connected devices') },
      ...(stats.value?.speicherSichtbar === false ? [] : [{ zu: '/speicher', ic: 'box', text: t('Speicher', 'Storage') }]),
      { zu: '/statistik', ic: 'chart', text: t('Statistik', 'Statistics') },
      { zu: '/aufraeumen', ic: 'gauge', text: t('Aufräumen', 'Clean up') },
      { zu: '/papierkorb', ic: 'trash', text: t('Papierkorb', 'Trash') }
    ]
  },
  {
    gruppe: 'Drop',
    punkte: [
      { zu: '/drop', ic: 'grid', text: t('Uploads & Links', 'Uploads & links') },
      { zu: '/ordner', ic: 'folder', text: t('Ordner', 'Folders'), zahl: stats.value?.ordner },
      { zu: '/paste', ic: 'code', text: t('Text & Code', 'Text & code') },
      { zu: '/anfragen', ic: 'mail', text: t('Datei-Anfragen', 'File requests') },
      { zu: '/werkzeuge', ic: 'upload', text: t('Upload-Werkzeuge', 'Upload tools') },
      { zu: '/embed', ic: 'sparkle', text: t('Embed-Designer', 'Embed designer') }
    ]
  },
  {
    gruppe: t('Verwaltung', 'Manage'),
    punkte: [
      { zu: '/import', ic: 'umzug', text: t('Import', 'Import') },
      { zu: '/protokoll', ic: 'list', text: t('Protokoll', 'Activity log') },
      { zu: '/regeln', ic: 'clock', text: t('Speicher-Regeln', 'Storage rules') },
      { zu: '/webhooks', ic: 'network', text: 'Webhooks' },
      { zu: '/api-doku', ic: 'code', text: t('API-Doku', 'API docs') },
      { zu: '/einstellungen', ic: 'gear', text: t('Einstellungen', 'Settings') },
      ...(istAdmin.value
        ? [
            { zu: '/nutzer', ic: 'users', text: t('Nutzer', 'Users') },
            { zu: '/speicher/ziele', ic: 'database', text: t('Speicher-Erweiterungen', 'Storage add-ons') },
            { zu: '/lizenzen', ic: 'key', text: t('Lizenzen', 'Licences') }
          ]
        : [])
    ]
  },
  ...(istAdmin.value
    ? [
        {
          gruppe: 'Pro',
          punkte: [
            {
              zu: '/pro',
              ic: 'krone',
              text: t('Pro & Lizenz', 'Pro & licence'),
              chip: theme.value.pro ? 'Pro' : 'Free'
            },
            { zu: '/server', ic: 'knoten', text: t('Speicher & Server', 'Storage & servers') },
            { zu: '/teams', ic: 'users', text: t('Teams & Rollen', 'Teams & roles') },
            ...(istInhaber.value ? [{ zu: '/sso', ic: 'tuer', text: t('Anmeldung (SSO)', 'Sign-in (SSO)') }] : []),
            { zu: '/marke', ic: 'palette', text: t('Eigene Marke', 'Own branding') },
            { zu: '/sicherung', ic: 'database', text: t('Sicherung', 'Backup') },
            { zu: '/system', ic: 'gauge', text: 'System' }
          ]
        }
      ]
    : [])
])
const istAn = (zu: string) =>
  zu === '/'
    ? route.path === '/'
    : zu === '/speicher'
      ? route.path.startsWith('/speicher') && !route.path.startsWith('/speicher/ziele')
      : route.path.startsWith(zu)

const navEl = ref<HTMLElement | null>(null)
const balken = reactive({ top: 0, hoehe: 0, sicht: false })
function balkenSetzen() {
  const an = navEl.value?.querySelector<HTMLElement>('a.an')
  if (!an || !navEl.value) {
    balken.sicht = false
    return
  }
  const r = an.getBoundingClientRect(),
    p = navEl.value.getBoundingClientRect()
  balken.top = r.top - p.top + 9
  balken.hoehe = r.height - 18
  balken.sicht = true
}
watch(
  () => route.path,
  () => nextTick(balkenSetzen)
)
onMounted(() => {
  nextTick(balkenSetzen)
  window.addEventListener('resize', balkenSetzen)
})

const intro = ref(false)
onMounted(() => {
  try {
    if (!sessionStorage.getItem('vd_intro') && !ruhig()) {
      intro.value = true
      sessionStorage.setItem('vd_intro', '1')
      setTimeout(() => {
        intro.value = false
      }, 2500)
    }
  } catch {}
})

const zieht = ref(false)
let ziehZaehler = 0
function istDatei(e: DragEvent) {
  return Array.from(e.dataTransfer?.types || []).includes('Files')
}
function rein(e: DragEvent) {
  if (!istDatei(e)) return
  e.preventDefault()
  ziehZaehler++
  zieht.value = true
}
function raus() {
  if (--ziehZaehler <= 0) {
    ziehZaehler = 0
    zieht.value = false
  }
}
function ab(e: DragEvent) {
  if (!istDatei(e)) return
  e.preventDefault()
  ziehZaehler = 0
  zieht.value = false
  if (e.dataTransfer?.files.length) hochladen(e.dataTransfer.files, ordnerAusRoute())
}
function einfuegen(e: ClipboardEvent) {
  const ziel = e.target as HTMLElement | null
  if (ziel && ziel.closest('input, textarea, [contenteditable], .vd-wahl')) return
  const dateien = Array.from(e.clipboardData?.files || [])
  if (dateien.length) {
    e.preventDefault()
    hochladen(dateien, ordnerAusRoute())
  }
}
const ordnerAusRoute = () => ({ ordner: Number(route.query.ordner) > 0 ? Number(route.query.ordner) : null })
onMounted(() => {
  window.addEventListener('dragenter', rein)
  window.addEventListener('dragleave', raus)
  window.addEventListener('dragover', (e) => {
    if (istDatei(e)) e.preventDefault()
  })
  window.addEventListener('drop', ab)
  window.addEventListener('paste', einfuegen)
})
onBeforeUnmount(() => {
  window.removeEventListener('dragenter', rein)
  window.removeEventListener('dragleave', raus)
  window.removeEventListener('drop', ab)
  window.removeEventListener('paste', einfuegen)
  window.removeEventListener('resize', balkenSetzen)
})

const aufnahmeAuf = ref(false)
function aufnahmeFertig(d: File) {
  aufnahmeAuf.value = false
  hochladen([d], ordnerAusRoute())
  return true
}
const dateiFeld = ref<HTMLInputElement | null>(null)
function gewaehlt(e: Event) {
  const f = (e.target as HTMLInputElement).files
  if (f?.length) hochladen(f, ordnerAusRoute())
  ;(e.target as HTMLInputElement).value = ''
}

const suche = ref(String(route.query.suche || ''))
let sucheTimer: any = null
watch(suche, (v) => {
  clearTimeout(sucheTimer)
  sucheTimer = setTimeout(() => navigateTo({ path: route.path.startsWith('/drop') ? '/drop' : '/', query: { ...(v ? { suche: v } : {}) } }), 280)
})
const sucheEl = ref<HTMLInputElement | null>(null)
onMounted(() =>
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      sucheEl.value?.focus()
    }
  })
)

async function themaUm(e: MouseEvent) {
  const alt = ich.value?.theme || 'dark'
  const neuT = alt === 'dark' ? 'light' : 'dark'
  themaWechseln(neuT, e, () => {
    if (theme.value.user) theme.value = { ...theme.value, user: { ...theme.value.user, theme: neuT } }
  })
  try {
    await api('/api/account/prefs', { method: 'PUT', body: { theme: neuT } })
  } catch {}
}

const menu = ref(false)
async function abmelden() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
  theme.value = { ...theme.value, user: null }
  ok(t('Abgemeldet', 'Signed out'))
  await navigateTo('/login')
}
const mobilNav = ref(false)
watch(
  () => route.fullPath,
  () => {
    mobilNav.value = false
    menu.value = false
  }
)
</script>

<template>
  <div class="app" :class="{ 'mit-intro': intro }">
    <div v-if="intro" class="intro" aria-hidden="true">
      <span class="boden"></span><span class="boden b2"></span>
      <span class="tropfen"><Ico n="cloud" /></span>
      <span class="wort"
        ><span
          v-for="(c, i) in (theme.name || 'VylarisCloud').split('')"
          :key="i"
          :style="{ '--k': i }"
          :class="{ r: theme.name === 'VylarisCloud' && i > 2 }"
          >{{ c }}</span
        ></span
      >
    </div>

    <aside class="seite" :class="{ offen: mobilNav }">
      <NuxtLink to="/" class="marke-link"><VdMarke /></NuxtLink>
      <nav ref="navEl" class="nav-alle" :aria-label="t('Bereiche', 'Sections')">
        <span
          class="schieber"
          :style="{ top: balken.top + 'px', height: balken.hoehe + 'px', opacity: balken.sicht ? 1 : 0 }"
        ></span>
        <div v-for="(g, gi) in NAV" :key="gi" class="nav">
          <div class="nav-titel">{{ g.gruppe }}</div>
          <NuxtLink
            v-for="(p, i) in g.punkte"
            :key="p.zu"
            :to="p.zu"
            :class="{ an: istAn(p.zu) }"
            :style="{ '--n': gi * 3 + i }"
          >
            <Ico :n="p.ic" /> {{ p.text }} <span v-if="p.zahl != null" class="zahl-chip">{{ zahl(p.zahl) }}</span>
            <span v-if="p.chip" :class="['ed-chip', { pro: p.chip === 'Pro' }]">{{ p.chip }}</span>
          </NuxtLink>
        </div>
      </nav>
      <div class="speicher">
        <div class="oben">
          <span>{{ t('Speicher', 'Storage') }}</span
          ><span
            ><b class="zahl">{{ groesse(Math.round(belegt)) }}</b
            ><template v-if="stats?.kontingent">&nbsp;{{ t('von', 'of') }} {{ groesse(stats.kontingent) }}</template></span
          >
        </div>
        <VdQuotaBalken class="q-balken" :used="Number(stats?.belegt || 0)" :limit="stats?.kontingent || null" :segmente="segmente" klein />
        <div v-if="speicherText" class="q-status" :class="quota?.stufe">
          <Ico n="alert" /> {{ speicherText }}
        </div>
        <div class="legende">
          <span v-for="a in ARTEN.slice(0, 4)" :key="a.k" :style="{ '--c': a.c }">{{
            lang() === 'en' ? a.en : a.de
          }}</span>
        </div>
        <NuxtLink v-if="Number(quota?.eingeplant) > 0" to="/speicher" class="q-korb q-reserviert">
          <i class="q-punkt" aria-hidden="true"></i>{{ t('Für Boxen & Buckets reserviert:', 'Reserved for boxes & buckets:') }} {{ groesse(quota.eingeplant) }}
        </NuxtLink>
        <NuxtLink v-if="Number(stats?.papierkorb) > 0" to="/papierkorb" class="q-korb">
          {{ t('Papierkorb zählt mit:', 'Trash counts:') }} {{ groesse(stats.papierkorb) }}
        </NuxtLink>
        <div v-if="stats?.pool?.summe?.bekannt && !stats?.kontingent" class="platte">
          {{ t('Frei im Pool:', 'Free in pool:') }} {{ groesse(stats.pool.summe.frei) }} {{ t('von', 'of') }} {{ groesse(stats.pool.summe.gesamt) }}<template v-if="stats.pool.unbekannt"> {{ t(`(+ ${stats.pool.unbekannt} ohne Angabe)`, `(+ ${stats.pool.unbekannt} unknown)`) }}</template>
        </div>
        <div v-else-if="stats?.platte && !stats?.kontingent" class="platte">
          {{ t('Frei auf dem Server:', 'Free on server:') }} {{ groesse(stats.platte.frei) }}
        </div>
      </div>
      <VdVersion v-if="istAdmin" class="version-fuss" />
    </aside>
    <div v-if="mobilNav" class="seite-hg" @click="mobilNav = false"></div>

    <div class="haupt">
      <header class="leiste">
        <button class="knopf rund mobil" :aria-label="t('Menü', 'Menu')" @click="mobilNav = !mobilNav">
          <Ico n="menu" />
        </button>
        <label class="suche"
          ><Ico n="search" /><input
            ref="sucheEl"
            v-model="suche"
            :placeholder="t('Dateien durchsuchen …', 'Search files …')"
            :aria-label="t('Suche', 'Search')"
          /><kbd>Strg K</kbd></label
        >
        <div class="rechts">
          <button class="knopf rund" :aria-label="t('Hell/Dunkel umschalten', 'Toggle light/dark')" @click="themaUm">
            <Ico :n="ich?.theme === 'light' ? 'moon' : 'sun'" />
          </button>
          <button
            class="knopf rund"
            :aria-label="t('Aufnehmen', 'Record')"
            :title="t('Sprache oder Video aufnehmen', 'Record voice or video')"
            @click="aufnahmeAuf = true"
          >
            <Ico n="mic" />
          </button>
          <button class="knopf rot" @click="dateiFeld?.click()">
            <Ico n="upload" /><span class="text-hochladen">{{ t('Hochladen', 'Upload') }}</span>
          </button>
          <input ref="dateiFeld" type="file" multiple class="versteckt" @change="gewaehlt" />
          <div class="konto">
            <button class="avatar" :aria-label="t('Konto', 'Account')" :aria-expanded="menu" @click="menu = !menu">
              {{ (ich?.username || '?').slice(0, 1).toUpperCase() }}
            </button>
            <Transition name="menu">
              <div v-if="menu" class="konto-menu" role="menu">
                <div class="wer">
                  <b>{{ ich?.username }}</b
                  ><small>{{
                    ich?.role === 'owner'
                      ? t('Inhaber', 'Owner')
                      : ich?.role === 'admin'
                        ? 'Admin'
                        : t('Nutzer', 'User')
                  }}</small>
                </div>
                <NuxtLink to="/einstellungen" role="menuitem"
                  ><Ico n="gear" /> {{ t('Einstellungen', 'Settings') }}</NuxtLink
                >
                <button role="menuitem" @click="abmelden"><Ico n="logout" /> {{ t('Abmelden', 'Sign out') }}</button>
              </div>
            </Transition>
          </div>
        </div>
      </header>
      <main class="inhalt">
        <VdQuotaBanner :quota="quota" />
        <slot />
      </main>
    </div>

    <Transition name="ziehen">
      <div v-if="zieht" class="zieh-flaeche" aria-hidden="true">
        <div class="zieh-karte">
          <span class="welle"></span><span class="welle zwei"></span><span class="kreis"><Ico n="upload" /></span
          ><b>{{ t('Loslassen zum Hochladen', 'Drop to upload') }}</b>
        </div>
      </div>
    </Transition>
    <VdBestaetigen />
    <VdUploadOptionen />
    <VdModal v-if="aufnahmeAuf" :titel="t('Aufnehmen', 'Record')" @zu="aufnahmeAuf = false"
      ><VdAufnahme schluessel="konto" :max-min="60" :senden="aufnahmeFertig"
    /></VdModal>
  </div>
</template>

<style scoped>
.app {
  display: grid;
  grid-template-columns: 248px 1fr;
  min-height: 100vh;
}
.mit-intro .seite,
.mit-intro .haupt {
  animation: appRein 0.9s 1.85s var(--kurve) backwards;
}
@keyframes appRein {
  from {
    opacity: 0;
    transform: scale(0.985);
    filter: blur(6px);
  }
}

.intro {
  position: fixed;
  inset: 0;
  z-index: 500;
  background: var(--bg);
  display: grid;
  place-items: center;
  pointer-events: none;
  animation: introWeg 0.6s 1.85s cubic-bezier(0.7, 0, 0.3, 1) forwards;
}
.intro .tropfen {
  width: 46px;
  height: 46px;
  color: var(--a);
  animation: fallen 0.75s cubic-bezier(0.55, 0, 0.9, 0.5) both;
  display: grid;
  place-items: center;
}
.intro .tropfen svg {
  width: 100%;
  height: 100%;
}
.intro .boden {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--a);
  opacity: 0;
  animation: platsch 0.9s 0.72s ease-out both;
}
.intro .boden.b2 {
  animation-delay: 0.86s;
}
.intro .wort {
  position: absolute;
  font-family: var(--f-display);
  font-weight: 800;
  font-size: 44px;
  letter-spacing: -0.04em;
  display: flex;
  overflow: hidden;
  margin-top: 110px;
}
.intro .wort span {
  display: inline-block;
  animation: buchstabe 0.55s var(--kurve) backwards;
  animation-delay: calc(0.85s + var(--k) * 45ms);
  white-space: pre;
}
.intro .wort span.r {
  color: var(--a);
}
@keyframes fallen {
  0% {
    transform: translateY(-46vh) scaleY(1.25);
    opacity: 0;
  }
  15% {
    opacity: 1;
  }
  88% {
    transform: translateY(0) scaleY(1.15);
  }
  94% {
    transform: translateY(4px) scale(1.25, 0.7);
  }
  100% {
    transform: translateY(0) scale(1);
  }
}
@keyframes platsch {
  from {
    transform: scale(1);
    opacity: 0.9;
  }
  to {
    transform: scale(14, 3.2);
    opacity: 0;
  }
}
@keyframes buchstabe {
  from {
    transform: translateY(110%);
    opacity: 0;
  }
}
@keyframes introWeg {
  to {
    opacity: 0;
    transform: scale(1.04);
    visibility: hidden;
  }
}

.seite {
  border-right: 1px solid var(--linie);
  padding: 20px 14px;
  display: flex;
  flex-direction: column;
  gap: 22px;
  position: sticky;
  top: 0;
  height: 100vh;
  background: var(--bg);
  overflow-y: auto;
  z-index: 30;
}
.marke-link {
  padding: 4px 8px;
}
.nav-alle {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.schieber {
  position: absolute;
  left: -14px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--a);
  transition:
    top 0.45s cubic-bezier(0.2, 0.9, 0.2, 1.1),
    height 0.45s cubic-bezier(0.2, 0.9, 0.2, 1.1),
    opacity 0.3s;
  pointer-events: none;
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-titel {
  font-size: 11px;
  color: var(--text3);
  text-transform: uppercase;
  letter-spacing: 0.09em;
  font-weight: 600;
  padding: 0 10px 6px;
}
.nav a {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 8px 10px;
  border-radius: 9px;
  color: var(--text2);
  font-size: 13.5px;
  font-weight: 500;
  transition:
    background 0.15s,
    color 0.15s;
  animation: rein 0.5s var(--kurve) backwards;
  animation-delay: calc(0.1s + var(--n, 0) * 50ms);
}
.mit-intro .nav a {
  animation-delay: calc(2.05s + var(--n, 0) * 50ms);
}
.nav a svg {
  width: 16px;
  height: 16px;
}
.nav a:hover {
  background: var(--flaeche2);
  color: var(--text);
}
.nav a.an {
  background: var(--flaeche);
  color: var(--text);
  box-shadow: var(--schatten);
}
.zahl-chip {
  margin-left: auto;
  font-size: 11px;
  color: var(--text3);
  font-family: var(--f-mono);
}
.ed-chip {
  margin-left: auto;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--flaeche2);
  color: var(--text3);
}
.ed-chip.pro {
  background: rgba(var(--a-rgb), 0.14);
  color: var(--a);
}
.version-fuss {
  margin-top: -16px;
}
.speicher {
  margin-top: auto;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: var(--r);
  padding: 14px;
}
.speicher .oben {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--text2);
}
.speicher .oben b {
  color: var(--text);
  font-weight: 600;
}
.speicher .q-balken {
  margin: 10px 0 8px;
}
.q-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 600;
  margin: 0 0 8px;
  color: var(--warn);
}
.q-status.kritisch,
.q-status.voll {
  color: var(--rot);
}
.q-status svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.q-korb {
  display: block;
  margin-top: 8px;
  font-size: 11px;
  color: var(--text3);
}
.q-korb:hover {
  color: var(--text);
}
.q-reserviert .q-punkt {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 3px;
  background: #8b5cf6;
  margin-right: 6px;
}
.speicher .legende {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--text3);
}
.speicher .legende span::before {
  content: '';
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 2px;
  margin-right: 5px;
  background: var(--c);
}
.speicher .platte {
  font-size: 11px;
  color: var(--text3);
  margin-top: 8px;
}

.haupt {
  min-width: 0;
}
.leiste {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 28px;
  background: var(--glas);
  backdrop-filter: blur(16px) saturate(1.4);
  border-bottom: 1px solid var(--linie);
}
.suche {
  flex: 1;
  max-width: 460px;
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 10px;
  padding: 8px 12px;
  color: var(--text3);
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}
.suche svg {
  width: 15px;
  height: 15px;
}
.suche:focus-within {
  border-color: rgba(var(--a-rgb), 0.5);
  box-shadow: 0 0 0 4px rgba(var(--a-rgb), 0.1);
}
.suche input {
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  flex: 1;
  min-width: 0;
}
.suche kbd {
  font-family: var(--f-mono);
  font-size: 11px;
  border: 1px solid var(--linie2);
  border-bottom-width: 2px;
  border-radius: 5px;
  padding: 0 5px;
  color: var(--text3);
  white-space: nowrap;
}
.rechts {
  margin-left: auto;
  display: flex;
  gap: 8px;
  align-items: center;
}
.mobil {
  display: none;
}
.konto {
  position: relative;
}
.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 0;
  background: linear-gradient(135deg, var(--a), color-mix(in srgb, var(--a) 55%, #000));
  color: #fff;
  font-weight: 700;
  cursor: pointer;
  font-family: var(--f-display);
  font-size: 15px;
}
.konto-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 14px;
  padding: 6px;
  min-width: 210px;
  box-shadow: 0 20px 50px -16px rgba(0, 0, 0, 0.5);
  transform-origin: top right;
}
.konto-menu .wer {
  padding: 8px 10px 10px;
  border-bottom: 1px solid var(--linie);
  margin-bottom: 4px;
  display: flex;
  flex-direction: column;
}
.konto-menu .wer small {
  color: var(--text3);
  font-size: 11.5px;
}
.konto-menu a,
.konto-menu button {
  display: flex;
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--text2);
  text-align: left;
}
.konto-menu a:hover,
.konto-menu button:hover {
  background: var(--flaeche2);
  color: var(--text);
}
.konto-menu svg {
  width: 15px;
  height: 15px;
}
.menu-enter-active {
  transition:
    opacity 0.2s,
    transform 0.25s var(--kurve);
}
.menu-leave-active {
  transition: opacity 0.12s;
}
.menu-enter-from {
  opacity: 0;
  transform: scale(0.95) translateY(-4px);
}
.menu-leave-to {
  opacity: 0;
}
.inhalt {
  padding: 28px;
  max-width: 1320px;
}

.zieh-flaeche {
  position: fixed;
  inset: 0;
  z-index: 250;
  background: rgba(var(--a-rgb), 0.08);
  backdrop-filter: blur(3px);
  display: grid;
  place-items: center;
  pointer-events: none;
}
.zieh-karte {
  position: relative;
  background: var(--flaeche);
  border: 2px dashed var(--a);
  border-radius: 24px;
  padding: 40px 56px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  font-size: 17px;
  box-shadow: 0 30px 80px -30px rgba(var(--a-rgb), 0.6);
}
.zieh-karte .kreis {
  width: 64px;
  height: 64px;
  border-radius: 18px;
  background: rgba(var(--a-rgb), 0.12);
  color: var(--a);
  display: grid;
  place-items: center;
  animation: hopsen 0.7s ease-in-out infinite;
}
.zieh-karte .kreis svg {
  width: 26px;
  height: 26px;
}
.zieh-karte .welle {
  position: absolute;
  width: 64px;
  height: 64px;
  top: 40px;
  border-radius: 18px;
  border: 2px solid var(--a);
  animation: welle 1.4s ease-out infinite;
}
.zieh-karte .welle.zwei {
  animation-delay: 0.5s;
}
@keyframes welle {
  from {
    transform: scale(1);
    opacity: 0.5;
  }
  to {
    transform: scale(2.6);
    opacity: 0;
  }
}
@keyframes hopsen {
  50% {
    transform: translateY(-5px);
  }
}
.ziehen-enter-active,
.ziehen-leave-active {
  transition: opacity 0.2s;
}
.ziehen-enter-active .zieh-karte {
  animation: modalRein 0.35s var(--kurve) backwards;
}
.ziehen-enter-from,
.ziehen-leave-to {
  opacity: 0;
}

.seite-hg {
  display: none;
}
@media (max-width: 860px) {
  .app {
    grid-template-columns: 1fr;
  }
  .seite {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    width: 260px;
    transform: translateX(-100%);
    transition:
      transform 0.35s var(--kurve),
      box-shadow 0.35s;
  }
  .seite.offen {
    transform: none;
    box-shadow: 0 0 60px rgba(0, 0, 0, 0.5);
  }
  .seite-hg {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 25;
    background: rgba(0, 0, 0, 0.4);
  }
  .mobil {
    display: inline-flex;
  }
  .leiste {
    padding: 12px 16px;
  }
  .suche kbd,
  .text-hochladen {
    display: none;
  }
  .leiste {
    gap: 8px;
  }
  .suche {
    min-width: 0;
    padding: 8px 10px;
  }
  .inhalt {
    padding: 18px 16px;
  }
}
</style>
