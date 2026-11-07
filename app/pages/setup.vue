<script setup lang="ts">
definePageMeta({ layout: 'leer' })
useHead({ title: () => t('Einrichtung', 'Setup') })
const theme = useTheme()

async function sprachWahl(l: 'de' | 'en') {
  theme.value = { ...theme.value, lang: l }
  sprache.value = l
  try {
    sessionStorage.setItem('vd_sprache', '1')
  } catch {}
  try {
    await api('/api/setup/lang', { method: 'POST', body: { lang: l } })
  } catch {}
}
onMounted(() => {
  let gewaehlt = false
  try {
    gewaehlt = sessionStorage.getItem('vd_sprache') === '1'
  } catch {}
  if (!gewaehlt && theme.value.lang !== 'en' && !/^de\b/i.test(navigator.language || 'de')) void sprachWahl('en')
})

const schritt = ref(1)
const richtung = ref<'vor' | 'zurueck'>('vor')
const fehler = ref('')
const laeuft = ref(false)
const fehlerEl = ref<HTMLElement | null>(null)
watch(fehler, async (f) => {
  if (f) {
    await nextTick()
    fehlerEl.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
})
const token = ref('')
const ip = ref('')
const FARBEN = ['#1e73be', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#ef4444', '#8b5cf6', '#ec4899']
const farbe = ref('#1e73be')
const name = ref('VylarisCloud')
const modus = ref<'domain' | 'ip' | 'proxy' | 'tunnel'>('domain')
const domain = ref('')
const admin = reactive({ username: '', email: '', password: '', password2: '' })
const proxy = computed(() => theme.value.proxy || null)
const direkt = computed(() => !!proxy.value && proxy.value.bind !== '127.0.0.1' && !proxy.value.domain)
const ohneCaddy = computed(() => !!proxy.value)
if (proxy.value) {
  modus.value = 'proxy'
  domain.value = proxy.value.domain || ''
}
const aufgerufen = ref('')
watch([farbe, name], () => {
  theme.value = { ...theme.value, color: farbe.value, name: name.value.trim() || 'VylarisCloud' }
})
onMounted(async () => {
  aufgerufen.value = location.host
  try {
    ip.value = (await api('/api/setup/status')).ip || ''
  } catch {}
})

function gehe(n: number) {
  richtung.value = n > schritt.value ? 'vor' : 'zurueck'
  fehler.value = ''
  schritt.value = n
}
async function codePruefen() {
  fehler.value = ''
  laeuft.value = true
  try {
    await api('/api/setup/verify', { method: 'POST', body: { token: token.value } })
    gehe(2)
  } catch (e: any) {
    fehler.value = e.message
  } finally {
    laeuft.value = false
  }
}

type Stand = 'offen' | 'laeuft' | 'ok' | 'fehler'
const pruefung = reactive<{ dns: Stand; https: Stand; dnsText: string; httpsText: string }>({
  dns: 'offen',
  https: 'offen',
  dnsText: '',
  httpsText: ''
})
const domainOk = computed(() => pruefung.dns === 'ok' && pruefung.https === 'ok')
watch(domain, () => {
  pruefung.dns = 'offen'
  pruefung.https = 'offen'
  pruefung.dnsText = ''
  pruefung.httpsText = ''
})
async function domainPruefen() {
  fehler.value = ''
  laeuft.value = true
  pruefung.dns = 'laeuft'
  pruefung.https = 'offen'
  const zeit = setTimeout(() => {
    if (pruefung.dns === 'laeuft') {
      pruefung.dns = 'ok'
      pruefung.https = 'laeuft'
    }
  }, 2500)
  try {
    const r = await api('/api/setup/domain-check', {
      method: 'POST',
      body: { token: token.value, domain: domain.value.trim().toLowerCase() }
    })
    if (r.ip) ip.value = r.ip
    pruefung.dns = r.dns.ok ? 'ok' : 'fehler'
    pruefung.dnsText = r.dns.error || ''
    pruefung.https = r.https.ok ? 'ok' : r.dns.ok ? 'fehler' : 'offen'
    pruefung.httpsText = r.dns.ok ? r.https.error || '' : ''
  } catch (e: any) {
    fehler.value = e.message
    pruefung.dns = 'offen'
    pruefung.https = 'offen'
  } finally {
    clearTimeout(zeit)
    laeuft.value = false
  }
}
const tf = reactive({
  weg: 'token' as 'token' | 'auto',
  domain: '',
  tunnelToken: '',
  apiToken: '',
  ueberschreiben: false
})
const tun = ref<any>(null)
let tunUhr: any = null
async function tunnelStand() {
  try {
    tun.value = await api('/api/setup/tunnel-status', { method: 'POST', body: { token: token.value } })
  } catch {}
}
watch(modus, (m) => {
  if (m === 'tunnel' && !tun.value) void tunnelStand()
})
function tunnelBeobachten() {
  clearInterval(tunUhr)
  const bis = Date.now() + 3 * 60_000
  tunUhr = setInterval(async () => {
    await tunnelStand()
    if (Date.now() > bis || tun.value?.zustand?.bereit) clearInterval(tunUhr)
  }, 3000)
}
onBeforeUnmount(() => clearInterval(tunUhr))
async function tunnelStarten() {
  fehler.value = ''
  laeuft.value = true
  try {
    const body =
      tf.weg === 'token'
        ? { token: token.value, aktion: 'token', tunnelToken: tf.tunnelToken, domain: tf.domain }
        : {
            token: token.value,
            aktion: 'auto',
            apiToken: tf.apiToken,
            domain: tf.domain,
            ueberschreiben: tf.ueberschreiben
          }
    await api('/api/setup/tunnel', { method: 'POST', body })
    tf.tunnelToken = ''
    tf.apiToken = ''
    await tunnelStand()
    tunnelBeobachten()
  } catch (e: any) {
    fehler.value = e.message
  } finally {
    laeuft.value = false
  }
}
const tunnelText = computed(() => {
  const x = tun.value
  if (!x?.an) return ''
  if (x.zustand?.bereit) return ''
  if (x.lauf?.status === 'fehler')
    return x.lauf.meldung || t('Der Tunnel konnte nicht gestartet werden.', 'The tunnel could not be started.')
  if (!x.zustand?.erreichbar && x.lauf?.status === 'fertig')
    return t(
      'cloudflared läuft nicht — meist ist der Tunnel-Token ungültig.',
      'cloudflared is not running — usually the tunnel token is invalid.'
    )
  return t('Tunnel startet …', 'Tunnel is starting …')
})
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const domainSauber = computed(() => domain.value.trim().toLowerCase())
const domainGueltig = computed(() => DOMAIN_RE.test(domainSauber.value))
const ws = ref<any>(null)
const wsArt = ref<'nginx' | 'apache'>('nginx')
const wsAuftrag = ref('')
const wsSchickt = ref(false)
let wsUhr: any = null
onBeforeUnmount(() => clearInterval(wsUhr))
async function wsStand(pruefen = false) {
  try {
    ws.value = await api('/api/setup/webserver-status', { method: 'POST', body: { token: token.value, pruefen } })
  } catch {}
}
const wsBefehl = computed(
  () =>
    `curl -fsSL https://raw.githubusercontent.com/cubiqstudio/vylarisdrop/main/deploy/install.sh | sudo bash -s -- --webserver=${wsArt.value}${domainGueltig.value ? ` --domain ${domainSauber.value}` : ''}`
)
const wsName = computed(
  () =>
    (({ nginx: 'nginx', apache2: 'Apache', httpd: 'Apache (httpd)' }) as Record<string, string>)[
      ws.value?.info?.webserver
    ] || ''
)
const wsLaeuft = computed(
  () =>
    wsSchickt.value ||
    (!!wsAuftrag.value && ws.value?.lauf?.id !== wsAuftrag.value) ||
    (ws.value?.lauf?.status === 'laeuft' && !ws.value?.lauf?.haengt)
)
const wsAnsicht = computed(() => {
  const x = ws.value
  if (!x) return 'laden'
  if (!x.dienst || !x.kann) return 'befehl'
  if (wsLaeuft.value) return 'laeuft'
  if (!x.info) return x.nichtAbgeholt ? 'befehl' : 'laden'
  if (x.info.webserver) return 'vhost'
  if (!x.info.portsFrei) return 'belegt'
  return x.info.paketverwaltung ? 'installieren' : 'ohnepaket'
})
const wsErgebnis = computed(() => {
  const l = ws.value?.lauf
  if (!l || wsLaeuft.value || l.domain !== domainSauber.value) return null
  if (l.status === 'fehler')
    return {
      art: 'fehler',
      text:
        l.meldung ||
        t('Die Einrichtung ist fehlgeschlagen — Einzelheiten im Protokoll.', 'The setup failed — details in the log.')
    }
  if (l.status !== 'fertig') return null
  return l.https
    ? {
        art: 'ok',
        text: t(
          `Virtual Host für ${l.domain} eingerichtet, HTTPS aktiv (Let's Encrypt, HSTS).`,
          `Virtual host for ${l.domain} set up, HTTPS active (Let's Encrypt, HSTS).`
        )
      }
    : {
        art: 'warn',
        text:
          l.meldung ||
          t(
            `Virtual Host für ${l.domain} steht — HTTPS noch nicht. Zeigt die Domain auf diesen Server, nochmal versuchen.`,
            `Virtual host for ${l.domain} is in place — no HTTPS yet. Once the domain points to this server, try again.`
          )
      }
})
async function wsLaden() {
  clearInterval(wsUhr)
  await wsStand(true)
  const vorher = ws.value?.info?.zeit || ''
  if (!ws.value?.pruefungAngefragt) return
  const bis = Date.now() + 100_000
  wsUhr = setInterval(async () => {
    await wsStand()
    if ((ws.value?.info?.zeit || '') !== vorher || !ws.value?.angefragt || Date.now() > bis) clearInterval(wsUhr)
  }, 2000)
}
watch(
  [schritt, modus],
  ([s, m]) => {
    if (s === 3 && m === 'proxy' && ohneCaddy.value && !ws.value) void wsLaden()
  },
  { immediate: true }
)
let befehlUhr: any = null
onBeforeUnmount(() => clearInterval(befehlUhr))
watch(wsAnsicht, (a) => {
  clearInterval(befehlUhr)
  if (a !== 'befehl' || (ws.value?.dienst && ws.value?.kann)) return
  befehlUhr = setInterval(async () => {
    await wsStand()
    if (ws.value?.dienst && ws.value?.kann) {
      clearInterval(befehlUhr)
      void wsLaden()
    }
  }, 5000)
})
async function wsEinrichten() {
  fehler.value = ''
  if (!domainGueltig.value) {
    fehler.value = t(
      'Bitte gib eine gültige Domain ein, z. B. cloud.meinefirma.de',
      'Please enter a valid domain, e.g. cloud.mycompany.com'
    )
    return
  }
  wsSchickt.value = true
  try {
    const art = ws.value?.info?.webserver ? (ws.value.info.webserver === 'nginx' ? 'nginx' : 'apache') : wsArt.value
    const r = await api('/api/setup/webserver', {
      method: 'POST',
      body: { token: token.value, art, domain: domainSauber.value }
    })
    wsAuftrag.value = r.id
  } catch (e: any) {
    fehler.value = e.message
    return
  } finally {
    wsSchickt.value = false
  }
  clearInterval(wsUhr)
  const bis = Date.now() + 25 * 60_000
  wsUhr = setInterval(async () => {
    await wsStand()
    const l = ws.value?.lauf
    if (l?.id === wsAuftrag.value && (l.status === 'fertig' || l.status === 'fehler')) {
      clearInterval(wsUhr)
      wsAuftrag.value = ''
      setTimeout(() => void wsStand(), 3000)
      if (l.status === 'fertig') void domainPruefen()
      return
    }
    if (ws.value?.nichtAbgeholt) {
      clearInterval(wsUhr)
      wsAuftrag.value = ''
      fehler.value = t(
        `Der Dienst auf dem Server hat den Auftrag nicht abgeholt. Einmal auf dem Server ausführen: ${wsBefehl.value}`,
        `The server service did not pick up the job. Run once on the server: ${wsBefehl.value}`
      )
    } else if (Date.now() > bis) {
      clearInterval(wsUhr)
      wsAuftrag.value = ''
      fehler.value = t(
        'Die Einrichtung dauert ungewöhnlich lange — bitte das Protokoll prüfen.',
        'The setup is taking unusually long — please check the log.'
      )
    }
  }, 2500)
}
function weiterNetz() {
  if (modus.value === 'tunnel' && !tun.value?.zustand?.bereit) {
    fehler.value = t(
      'Bitte starte zuerst den Tunnel — weiter geht es, sobald er verbunden ist.',
      'Please start the tunnel first — you can continue once it is connected.'
    )
    return
  }
  if (modus.value === 'domain' && !domainOk.value) {
    fehler.value = t(
      'Bitte prüfe zuerst die Domain — erst mit gültigem Zertifikat geht es weiter.',
      'Please check the domain first — you can only continue with a valid certificate.'
    )
    return
  }
  gehe(4)
}
const fertigUrl = ref('')
async function abschliessen() {
  fehler.value = ''
  if (admin.password !== admin.password2) {
    fehler.value = t('Die beiden Passwörter stimmen nicht überein.', 'The two passwords do not match.')
    return
  }
  laeuft.value = true
  try {
    const r = await api('/api/setup/complete', {
      method: 'POST',
      body: {
        token: token.value,
        color: farbe.value,
        name: name.value.trim() || 'VylarisCloud',
        mode: modus.value,
        domain: modus.value === 'ip' || modus.value === 'tunnel' ? '' : domain.value.trim().toLowerCase(),
        admin: { username: admin.username, email: admin.email, password: admin.password }
      }
    })
    fertigUrl.value = r.url
    gehe(5)
  } catch (e: any) {
    fehler.value = e.message
  } finally {
    laeuft.value = false
  }
}
async function weiterZumPanel() {
  if (/^https?:/.test(fertigUrl.value)) {
    window.location.href = fertigUrl.value
    return
  }
  theme.value = await api('/api/public/theme')
  await navigateTo('/')
}
const standIcon = (s: Stand) => (s === 'ok' ? 'check' : s === 'fehler' ? 'alert' : s === 'laeuft' ? 'loader' : 'circle')
const sub = computed(() => {
  const x = domain.value.trim().toLowerCase().split('.')
  return x.length > 2 ? x.slice(0, -2).join('.') : '@'
})
</script>

<template>
  <div class="mitte">
    <div class="karte-gross">
      <div class="kopfzeile">
        <VdMarke />
        <div v-if="schritt <= 4" class="seg" role="group" :aria-label="t('Sprache', 'Language')">
          <button type="button" :class="{ an: theme.lang !== 'en' }" @click="sprachWahl('de')">Deutsch</button>
          <button type="button" :class="{ an: theme.lang === 'en' }" @click="sprachWahl('en')">English</button>
        </div>
      </div>
      <div v-if="schritt <= 4" class="punkte" aria-hidden="true"><span v-for="n in 4" :key="n" :class="{ an: n <= schritt }"></span></div>
      <div v-if="fehler" ref="fehlerEl" class="meldung meldung-fehler" role="alert">{{ fehler }}</div>

      <Transition :name="'gleiten-' + richtung" mode="out-in">
        <form v-if="schritt === 1" key="1" class="schritt" @submit.prevent="codePruefen">
          <h1>{{ t('Willkommen bei VylarisCloud', 'Welcome to VylarisCloud') }}</h1>
          <p class="leise">{{ t('Dein eigenes Medien- und Datei-Hosting. Zum Schutz brauchst du den Setup-Code aus dem Server-Log:', 'Your own media and file hosting. For protection you need the setup code from the server log:') }}</p>
          <code class="befehl">docker compose logs app | grep Setup-Code</code>
          <label class="feld"><span>Setup-Code</span><input v-model="token" class="eingabe mono code" placeholder="XXXX-XXXX" maxlength="9" autocomplete="off" required autofocus></label>
          <button class="knopf rot gross" :disabled="laeuft"><Ico v-if="laeuft" n="loader" spin />{{ t('Weiter', 'Continue') }}</button>
        </form>

        <form v-else-if="schritt === 2" key="2" class="schritt" @submit.prevent="gehe(3)">
          <h1>{{ t('Name und Farbe', 'Name and colour') }}</h1>
          <p class="leise">{{ t('So heißt deine Installation für Besucher. Die Farbe färbt Knöpfe, Links und die Vorschau in Chats.', 'This is what visitors see. The colour tints buttons, links and chat previews.') }}</p>
          <label class="feld"><span>{{ t('Name', 'Name') }}</span><input v-model="name" class="eingabe" maxlength="40"></label>
          <div class="feld"><span>{{ t('Akzentfarbe', 'Accent colour') }}</span>
            <div class="farben"><button v-for="c in FARBEN" :key="c" type="button" :class="{ an: farbe === c }" :style="{ '--c': c }" :aria-label="c" @click="farbe = c"></button><input v-model="farbe" type="color" :aria-label="t('Eigene Farbe', 'Custom colour')"></div></div>
          <div class="vorschau-marke"><VdMarke /><button type="button" class="knopf rot klein"><Ico n="upload" /> {{ t('Hochladen', 'Upload') }}</button></div>
          <div class="reihe zw"><button type="button" class="knopf" @click="gehe(1)">{{ t('Zurück', 'Back') }}</button><button class="knopf rot">{{ t('Weiter', 'Continue') }}</button></div>
        </form>

        <div v-else-if="schritt === 3" key="3" class="schritt">
          <h1>{{ t('Adresse & HTTPS', 'Address & HTTPS') }}</h1>
          <div class="modi">
            <button type="button" :class="{ an: modus === 'domain' }" :disabled="ohneCaddy" :title="ohneCaddy ? t('Nur mit eigenem Caddy (Port 80/443)', 'Only with its own Caddy (port 80/443)') : undefined" @click="modus = 'domain'"><Ico n="globe" /><b>{{ t('Eigene Domain', 'Own domain') }}</b><small>{{ ohneCaddy ? t('hier nicht verfügbar', 'not available here') : t('HTTPS automatisch (empfohlen)', 'Automatic HTTPS (recommended)') }}</small></button>
            <button type="button" :class="{ an: modus === 'proxy' }" @click="modus = 'proxy'"><Ico n="server" /><b>{{ t('Hinter eigenem Webserver', 'Behind your web server') }}</b><small>nginx, Apache, Plesk …</small></button>
            <button type="button" :class="{ an: modus === 'tunnel' }" @click="modus = 'tunnel'"><Ico n="wolke" /><b>Cloudflare Tunnel</b><small>{{ t('ohne offene Ports, z. B. zu Hause', 'no open ports, e.g. at home') }}</small></button>
            <button type="button" :class="{ an: modus === 'ip' }" @click="modus = 'ip'"><Ico n="network" /><b>{{ t('Nur über die IP', 'IP address only') }}</b><small>{{ t('zum Ausprobieren', 'for testing') }}</small></button>
          </div>
          <p v-if="ohneCaddy" class="sehrleise modi-hinweis"><Ico n="alert" /> <span>{{ t('Diese Installation läuft ohne eigenen Caddy — nutze „Hinter eigenem Webserver“ oder richte den Webserver direkt hier ein.', 'This installation runs without its own Caddy — use “Behind your web server” or set up the web server right here.') }}</span></p>
          <template v-if="modus === 'domain'">
            <p class="leise">{{ t('Lege bei deinem DNS-Anbieter einen A-Eintrag an, der auf diesen Server zeigt:', 'Create an A record at your DNS provider pointing to this server:') }}</p>
            <div class="dns"><span>A</span><code>{{ sub }}</code><Ico n="right" /><code>{{ ip || '…' }}</code></div>
            <label class="feld"><span>Domain</span><input v-model="domain" class="eingabe mono" placeholder="cloud.example.com" spellcheck="false" autocomplete="off"></label>
            <div class="pruefung">
              <div :class="pruefung.dns"><Ico :n="standIcon(pruefung.dns)" :spin="pruefung.dns === 'laeuft'" /> {{ t('DNS zeigt auf diesen Server', 'DNS points to this server') }}<small v-if="pruefung.dnsText">{{ pruefung.dnsText }}</small></div>
              <div :class="pruefung.https"><Ico :n="standIcon(pruefung.https)" :spin="pruefung.https === 'laeuft'" /> {{ t('Zertifikat ausgestellt', 'Certificate issued') }}<small v-if="pruefung.httpsText">{{ pruefung.httpsText }}</small></div>
            </div>
            <button type="button" class="knopf" :disabled="laeuft || !domain" @click="domainPruefen"><Ico n="shield" /> {{ t('Domain prüfen', 'Check domain') }}</button>
          </template>
          <template v-else-if="modus === 'proxy'">
            <p class="leise">{{ t('Dein Webserver leitet die Domain an VylarisCloud weiter und macht HTTPS. Wichtig für große Uploads: keine Größengrenze (nginx: client_max_body_size 0).', 'Your web server forwards the domain to VylarisCloud and handles HTTPS. Important for large uploads: no size limit (nginx: client_max_body_size 0).') }}</p>
            <label class="feld"><span>{{ t('Domain (optional)', 'Domain (optional)') }}</span><input v-model="domain" class="eingabe mono" placeholder="cloud.example.com" spellcheck="false"></label>
            <div v-if="ohneCaddy" class="ws">
              <div class="ws-kopf"><Ico n="server" /> <b>{{ t('Webserver auf diesem Server', 'Web server on this server') }}</b><span v-if="wsName" class="chip neutral">{{ wsName }}</span></div>
              <p v-if="wsAnsicht === 'laden'" class="sehrleise ws-zeile"><Ico n="loader" spin /> {{ t('Der Dienst auf dem Server sieht nach, ob nginx oder Apache da ist …', 'The server service is checking whether nginx or Apache is installed …') }}</p>
              <template v-else-if="wsAnsicht === 'befehl'">
                <div class="wege" role="group">
                  <button type="button" :class="{ an: wsArt === 'nginx' }" @click="wsArt = 'nginx'"><Ico n="server" /><span><b>nginx</b><small>{{ t('empfohlen', 'recommended') }}</small></span></button>
                  <button type="button" :class="{ an: wsArt === 'apache' }" @click="wsArt = 'apache'"><Ico n="server" /><span><b>Apache</b><small>{{ t('falls du ihn schon kennst', 'if you already know it') }}</small></span></button>
                </div>
                <VdServerBefehl :befehl="wsBefehl" :text="t('Der Dienst auf dem Server ist zu alt dafür (oder fehlt). Einmal auf dem Server ausführen — richtet Webserver, Virtual Host und HTTPS ein (die Daten bleiben):', 'The server service is too old for this (or missing). Run this once on the server — it sets up the web server, virtual host and HTTPS (data is kept):')" />
              </template>
              <p v-else-if="wsAnsicht === 'laeuft'" class="ws-zeile"><Ico n="loader" spin /> {{ t(`Wird eingerichtet: ${domainSauber} …`, `Setting up: ${domainSauber} …`) }}</p>
              <template v-else-if="wsAnsicht === 'vhost'">
                <p class="sehrleise">{{ t(`${wsName} ist installiert. VylarisCloud legt den Virtual Host an (vorhandene Dateien werden gesichert), holt das Zertifikat per certbot und schaltet HSTS ein.`, `${wsName} is installed. VylarisCloud creates the virtual host (existing files are backed up), gets the certificate via certbot and enables HSTS.`) }}</p>
                <button type="button" class="knopf rot" :disabled="!domainGueltig || wsLaeuft" @click="wsEinrichten"><Ico n="shield" /> {{ t(`Virtual Host für ${domainGueltig ? domainSauber : 'die Domain'} einrichten`, `Set up virtual host for ${domainGueltig ? domainSauber : 'the domain'}`) }}</button>
              </template>
              <template v-else-if="wsAnsicht === 'installieren'">
                <p class="sehrleise">{{ t('Auf diesem Server läuft weder nginx noch Apache. VylarisCloud kann einen installieren, den Virtual Host anlegen und HTTPS per certbot holen (mit HSTS):', 'Neither nginx nor Apache is installed on this server. VylarisCloud can install one, create the virtual host and get HTTPS via certbot (with HSTS):') }}</p>
                <div class="wege" role="group">
                  <button type="button" :class="{ an: wsArt === 'nginx' }" @click="wsArt = 'nginx'"><Ico n="server" /><span><b>nginx</b><small>{{ t('empfohlen', 'recommended') }}</small></span></button>
                  <button type="button" :class="{ an: wsArt === 'apache' }" @click="wsArt = 'apache'"><Ico n="server" /><span><b>Apache</b><small>{{ t('falls du ihn schon kennst', 'if you already know it') }}</small></span></button>
                </div>
                <button type="button" class="knopf rot" :disabled="!domainGueltig || wsLaeuft" @click="wsEinrichten"><Ico n="download" /> {{ t('Jetzt installieren und einrichten', 'Install and set up now') }}</button>
              </template>
              <p v-else-if="wsAnsicht === 'belegt'" class="tunnel-warn">{{ t(`Port 80/443 ist schon belegt (${ws?.info?.belegtVon || 'unbekannter Dienst'}) — einen zweiten Webserver installiere ich daneben nicht. Leite die Domain dort auf 127.0.0.1:${ws?.port || proxy?.port} weiter.`, `Port 80/443 is already in use (${ws?.info?.belegtVon || 'unknown service'}) — I will not install a second web server next to it. Forward the domain there to 127.0.0.1:${ws?.port || proxy?.port}.`) }}</p>
              <p v-else class="tunnel-warn">{{ t('Hier lässt sich kein Webserver installieren (weder apt-get noch dnf/yum gefunden). Bitte nginx oder Apache selbst installieren — danach geht der Rest hier per Klick.', 'No web server can be installed here (neither apt-get nor dnf/yum found). Please install nginx or Apache yourself — the rest then works here with one click.') }}</p>
              <p v-if="wsAnsicht !== 'befehl' && wsAnsicht !== 'laden' && !domainGueltig" class="sehrleise">{{ t('Trag oben zuerst deine Domain ein — sie muss per A-Eintrag auf diesen Server zeigen:', 'Enter your domain above first — it must point to this server with an A record:') }} <code class="mono">{{ ip || '…' }}</code></p>
              <div v-if="wsErgebnis" :class="['ws-ergebnis', wsErgebnis.art]" role="status"><Ico :n="wsErgebnis.art === 'ok' ? 'check' : 'alert'" /> <span>{{ wsErgebnis.text }}</span></div>
              <VdLiveLog v-if="wsLaeuft || (ws?.protokoll && ws?.lauf?.domain === domainSauber)" :text="ws?.protokoll || ''" :laeuft="wsLaeuft" />
              <div v-if="pruefung.dns !== 'offen' || pruefung.https !== 'offen'" class="pruefung">
                <div :class="pruefung.dns"><Ico :n="standIcon(pruefung.dns)" :spin="pruefung.dns === 'laeuft'" /> {{ t('DNS zeigt auf diesen Server', 'DNS points to this server') }}<small v-if="pruefung.dnsText">{{ pruefung.dnsText }}</small></div>
                <div :class="pruefung.https"><Ico :n="standIcon(pruefung.https)" :spin="pruefung.https === 'laeuft'" /> {{ t('HTTPS antwortet mit VylarisCloud', 'HTTPS answers with VylarisCloud') }}<small v-if="pruefung.httpsText">{{ pruefung.httpsText }}</small></div>
              </div>
              <button v-if="domainGueltig && !wsLaeuft" type="button" class="knopf klein" :disabled="laeuft" @click="domainPruefen"><Ico n="shield" /> {{ t('Domain prüfen', 'Check domain') }}</button>
            </div>
          </template>
          <template v-else-if="modus === 'tunnel'">
            <p class="leise">{{ t('Für Server ohne offene Ports, etwa zu Hause hinter dem Router: cloudflared baut die Verbindung zu Cloudflare auf, Cloudflare liefert deine Domain samt HTTPS aus.', 'For servers without open ports, e.g. at home behind a router: cloudflared connects to Cloudflare, and Cloudflare serves your domain including HTTPS.') }}</p>
            <div v-if="tun?.zustand?.bereit" class="tunnel-ok"><Ico n="check" /> {{ t(`Verbunden — VylarisCloud ist unter https://${tun.domain} erreichbar.`, `Connected — VylarisCloud is reachable at https://${tun.domain}.`) }}</div>
            <template v-else>
              <VdServerBefehl v-if="tun && !tun.dienst" :text="t('Der Dienst auf dem Server ist zu alt dafür. Einmal auf dem Server ausführen, danach geht der Tunnel hier per Klick:', 'The service on the server is too old for this. Run this once on the server, then the tunnel works here with one click:')" />
              <div class="wege" role="group">
                <button type="button" :class="{ an: tf.weg === 'token' }" @click="tf.weg = 'token'"><Ico n="key" /><span><b>{{ t('Tunnel-Token', 'Tunnel token') }}</b><small>{{ t('im Cloudflare-Dashboard anlegen', 'create it in the Cloudflare dashboard') }}</small></span></button>
                <button type="button" :class="{ an: tf.weg === 'auto' }" @click="tf.weg = 'auto'"><Ico n="sparkle" /><span><b>{{ t('Automatisch', 'Automatic') }}</b><small>{{ t('per API-Token, VylarisCloud legt alles an', 'with an API token, VylarisCloud sets it all up') }}</small></span></button>
              </div>
              <ol v-if="tf.weg === 'token'" class="schritte">
                <li>{{ t('Cloudflare-Dashboard → Zero Trust → Networks → Tunnels → „Create a tunnel“ → Cloudflared.', 'Cloudflare dashboard → Zero Trust → Networks → Tunnels → “Create a tunnel” → Cloudflared.') }}</li>
                <li>{{ t('Unter „Public Hostname“ deine Domain eintragen, als Service', 'Under “Public Hostname” enter your domain, as service') }} <code class="mono">HTTP</code> · <code class="mono">app:3000</code></li>
                <li>{{ t('Bei „Install connector“ den langen Wert hinter --token kopieren und unten einfügen.', 'At “Install connector” copy the long value after --token and paste it below.') }}</li>
              </ol>
              <ol v-else class="schritte">
                <li>{{ t('dash.cloudflare.com → Profil → API-Tokens → „Create Token“ → „Custom token“.', 'dash.cloudflare.com → Profile → API Tokens → “Create Token” → “Custom token”.') }} <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener">{{ t('Öffnen', 'Open') }} <Ico n="external" /></a></li>
                <li>{{ t('Rechte: „Account → Cloudflare Tunnel → Edit“ und „Zone → DNS → Edit“.', 'Permissions: “Account → Cloudflare Tunnel → Edit” and “Zone → DNS → Edit”.') }}</li>
              </ol>
              <label class="feld"><span>Domain</span><input v-model="tf.domain" class="eingabe mono" placeholder="cloud.example.com" spellcheck="false" autocomplete="off"></label>
              <label v-if="tf.weg === 'token'" class="feld"><span>{{ t('Tunnel-Token', 'Tunnel token') }}</span><input v-model="tf.tunnelToken" class="eingabe mono" type="password" placeholder="eyJhIjoi…" autocomplete="off" spellcheck="false"></label>
              <template v-else>
                <label class="feld"><span>{{ t('Cloudflare-API-Token', 'Cloudflare API token') }}</span><input v-model="tf.apiToken" class="eingabe mono" type="password" autocomplete="off" spellcheck="false"></label>
                <label class="ersetzen"><input v-model="tf.ueberschreiben" type="checkbox"> {{ t('Vorhandenen DNS-Eintrag für die Domain ersetzen', 'Replace an existing DNS record for the domain') }}</label>
              </template>
              <button type="button" class="knopf" :disabled="laeuft || !tf.domain || (tf.weg === 'token' ? !tf.tunnelToken : !tf.apiToken) || (tun && !tun.dienst)" @click="tunnelStarten"><Ico :n="laeuft ? 'loader' : 'wolke'" :spin="laeuft" /> {{ tf.weg === 'auto' ? t('Einrichten & starten', 'Set up & start') : t('Tunnel starten', 'Start tunnel') }}</button>
              <p v-if="tunnelText" class="sehrleise tunnel-stand">{{ tunnelText }}</p>
            </template>
          </template>
          <p v-else class="leise">{{ t(`VylarisCloud bleibt unter http://${(direkt && aufgerufen) || ip || 'IP'} erreichbar — ohne HTTPS. Eine Domain kannst du später einrichten.`, `VylarisCloud stays reachable at http://${(direkt && aufgerufen) || ip || 'IP'} — without HTTPS. You can add a domain later.`) }}</p>
          <div class="reihe zw"><button type="button" class="knopf" @click="gehe(2)">{{ t('Zurück', 'Back') }}</button><button type="button" class="knopf rot" @click="weiterNetz">{{ t('Weiter', 'Continue') }}</button></div>
        </div>

        <form v-else-if="schritt === 4" key="4" class="schritt" @submit.prevent="abschliessen">
          <h1>{{ t('Dein Konto', 'Your account') }}</h1>
          <p class="leise">{{ t('Das Inhaber-Konto darf alles — weitere Konten legst du später an.', 'The owner account can do everything — you can add more accounts later.') }}</p>
          <label class="feld"><span>{{ t('Benutzername', 'Username') }}</span><input v-model="admin.username" class="eingabe" autocomplete="username" required minlength="3" maxlength="40"></label>
          <label class="feld"><span>E-Mail</span><input v-model="admin.email" class="eingabe" type="email" autocomplete="email" required></label>
          <div class="zwei">
            <label class="feld"><span>{{ t('Passwort', 'Password') }}</span><input v-model="admin.password" class="eingabe" type="password" autocomplete="new-password" required minlength="10"></label>
            <label class="feld"><span>{{ t('Wiederholen', 'Repeat') }}</span><input v-model="admin.password2" class="eingabe" type="password" autocomplete="new-password" required minlength="10"></label>
          </div>
          <div class="reihe zw"><button type="button" class="knopf" @click="gehe(3)">{{ t('Zurück', 'Back') }}</button><button class="knopf rot" :disabled="laeuft"><Ico v-if="laeuft" n="loader" spin />{{ t('Einrichtung abschließen', 'Finish setup') }}</button></div>
        </form>

        <div v-else key="5" class="schritt fertig">
          <span class="haken"><Ico n="check" /></span>
          <h1>{{ t('Fertig!', 'Done!') }}</h1>
          <p class="leise">{{ t('VylarisCloud ist eingerichtet. Zieh gleich die erste Datei hinein.', 'VylarisCloud is ready. Drop in your first file.') }}</p>
          <button class="knopf rot gross" @click="weiterZumPanel">{{ t('Zum Panel', 'Open panel') }} <Ico n="right" /></button>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.mitte {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px 16px;
  position: relative;
}
.karte-gross {
  width: 100%;
  max-width: 520px;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 22px;
  padding: 28px;
  box-shadow: 0 40px 90px -40px rgba(0, 0, 0, 0.55);
  overflow: hidden;
}
.kopfzeile {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}
.punkte {
  display: flex;
  gap: 6px;
  margin-bottom: 22px;
}
.punkte span {
  flex: 1;
  height: 4px;
  border-radius: 4px;
  background: var(--flaeche2);
  position: relative;
  overflow: hidden;
}
.punkte span::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--a);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.5s var(--kurve);
}
.punkte span.an::after {
  transform: scaleX(1);
}
.schritt {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.schritt .feld {
  margin: 0;
}
h1 {
  font-family: var(--f-display);
  font-size: 27px;
  letter-spacing: -0.03em;
}
p {
  margin: 0;
  font-size: 13.5px;
}
.befehl {
  font-family: var(--f-mono);
  font-size: 12.5px;
  background: var(--bg);
  border: 1px solid var(--linie);
  border-radius: 10px;
  padding: 10px 12px;
}
.code {
  font-size: 20px;
  letter-spacing: 0.25em;
  text-align: center;
  text-transform: uppercase;
}
.gross {
  padding: 11px 16px;
  font-size: 14px;
}
.farben {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.farben button {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 2px solid var(--flaeche);
  background: var(--c);
  cursor: pointer;
  box-shadow: 0 0 0 1px var(--linie2);
  transition: transform 0.2s;
}
.farben button.an {
  box-shadow: 0 0 0 2px var(--text);
  transform: scale(1.1);
}
.farben input[type='color'] {
  width: 34px;
  height: 34px;
  border: 0;
  background: none;
  cursor: pointer;
  padding: 0;
}
.vorschau-marke {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--bg);
  border: 1px dashed var(--linie2);
  border-radius: 14px;
  padding: 14px 16px;
}
.modi {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.wege {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin: 4px 0 12px;
}
.wege button {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  text-align: left;
  border: 1px solid var(--linie);
  background: var(--bg);
  border-radius: 12px;
  padding: 10px 12px;
  cursor: pointer;
  font: inherit;
  color: var(--text);
  transition: border-color 0.2s;
}
.wege button.an {
  border-color: var(--a);
}
.wege svg {
  width: 16px;
  height: 16px;
  margin-top: 2px;
  color: var(--a);
  flex-shrink: 0;
}
.wege span {
  display: flex;
  flex-direction: column;
  font-size: 13px;
}
.wege small {
  color: var(--text3);
  font-size: 11.5px;
}
.schritte {
  margin: 0 0 14px;
  padding-left: 20px;
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: var(--text2);
}
.schritte code {
  font-size: 12px;
  background: var(--flaeche2);
  padding: 1px 6px;
  border-radius: 6px;
}
.schritte a {
  color: var(--a);
  display: inline-flex;
  gap: 4px;
  align-items: center;
}
.schritte a svg {
  width: 12px;
  height: 12px;
}
.ersetzen {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12.5px;
  color: var(--text2);
  margin: -4px 0 14px;
  cursor: pointer;
}
.tunnel-ok {
  display: flex;
  gap: 8px;
  align-items: center;
  background: var(--ok-bg);
  color: var(--ok);
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 14px;
}
.tunnel-ok svg {
  width: 16px;
  height: 16px;
}
.tunnel-warn {
  background: var(--warn-bg);
  color: var(--warn);
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 13px;
}
.tunnel-stand {
  font-size: 12.5px;
  margin: 10px 0 0;
}
.modi button {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
  text-align: left;
  border: 1px solid var(--linie);
  background: var(--bg);
  border-radius: 12px;
  padding: 12px;
  cursor: pointer;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}
.modi button svg {
  width: 18px;
  height: 18px;
  color: var(--a);
  margin-bottom: 4px;
}
.modi button b {
  font-size: 13px;
}
.modi button small {
  font-size: 11.5px;
  color: var(--text3);
}
.modi button.an {
  border-color: var(--a);
  box-shadow: 0 0 0 3px rgba(var(--a-rgb), 0.14);
}
.modi button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.modi-hinweis {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 12.5px;
  margin-top: -4px;
}
.modi-hinweis svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  margin-top: 2px;
}
.ws {
  display: grid;
  gap: 10px;
  border: 1px solid var(--linie);
  border-radius: 14px;
  padding: 14px;
  background: var(--bg);
}
.ws .wege {
  margin: 0;
}
.ws-kopf {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13.5px;
}
.ws-kopf svg {
  width: 16px;
  height: 16px;
  color: var(--a);
}
.ws-kopf .chip {
  margin-left: auto;
}
.ws-zeile {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
}
.ws-zeile svg {
  width: 14px;
  height: 14px;
}
.ws-ergebnis {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 13px;
}
.ws-ergebnis svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  margin-top: 2px;
}
.ws-ergebnis.ok {
  background: var(--ok-bg);
  color: var(--ok);
}
.ws-ergebnis.warn {
  background: var(--warn-bg);
  color: var(--warn);
}
.ws-ergebnis.fehler {
  background: var(--rot-bg);
  color: var(--rot);
}
.dns {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--f-mono);
  font-size: 13px;
  background: var(--bg);
  border: 1px solid var(--linie);
  border-radius: 10px;
  padding: 10px 12px;
}
.dns span {
  font-weight: 700;
  color: var(--a);
}
.dns svg {
  width: 14px;
  height: 14px;
  color: var(--text3);
}
.pruefung {
  display: grid;
  gap: 6px;
}
.pruefung div {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  color: var(--text3);
}
.pruefung div svg {
  width: 15px;
  height: 15px;
}
.pruefung div.ok {
  color: var(--ok);
}
.pruefung div.fehler {
  color: var(--rot);
}
.pruefung div.laeuft {
  color: var(--text);
}
.pruefung small {
  flex-basis: 100%;
  padding-left: 23px;
  font-size: 12px;
}
.zwei {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.fertig {
  align-items: center;
  text-align: center;
  padding: 10px 0;
}
.haken {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--a);
  color: #fff;
  display: grid;
  place-items: center;
  animation: plopp 0.6s cubic-bezier(0.2, 0.9, 0.2, 1.4) backwards;
  box-shadow: 0 0 0 0 rgba(var(--a-rgb), 0.5);
}
.haken svg {
  width: 30px;
  height: 30px;
}
@keyframes plopp {
  from {
    transform: scale(0.3);
    opacity: 0;
  }
}
.gleiten-vor-enter-active,
.gleiten-vor-leave-active,
.gleiten-zurueck-enter-active,
.gleiten-zurueck-leave-active {
  transition:
    opacity 0.3s,
    transform 0.35s var(--kurve);
}
.gleiten-vor-enter-from {
  opacity: 0;
  transform: translateX(30px);
}
.gleiten-vor-leave-to {
  opacity: 0;
  transform: translateX(-30px);
}
.gleiten-zurueck-enter-from {
  opacity: 0;
  transform: translateX(-30px);
}
.gleiten-zurueck-leave-to {
  opacity: 0;
  transform: translateX(30px);
}
@media (max-width: 560px) {
  .modi,
  .zwei {
    grid-template-columns: 1fr;
  }
}
</style>
