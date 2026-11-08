<script setup lang="ts">
useHead({ title: () => t('Einstellungen', 'Settings') })
const theme = useTheme()
const { ok, fehler } = useToast()
const { data: konto, refresh: kontoNeu } = await (useFetch as any)('/api/account', { key: 'konto' })
const istInhaber = computed(() => theme.value.user?.role === 'owner')
const istAdmin = computed(() => istInhaber.value || theme.value.user?.role === 'admin')
const { data: inst, refresh: instNeu } = await (useFetch as any)('/api/settings', {
  key: 'inst',
  immediate: istAdmin.value
})

const route = useRoute()
const REITER = ['darstellung', 'konto', 'benachrichtigung', 'installation'] as const
// Der Reiter „Installation“ gehört nur Admins und dem Inhaber: für alle anderen fällt ein Aufruf mit ?reiter=installation zurück
const reiter = ref<(typeof REITER)[number]>(
  REITER.includes(route.query.reiter as any) && (route.query.reiter !== 'installation' || istAdmin.value)
    ? (route.query.reiter as any)
    : 'darstellung'
)
const { data: ids, refresh: idsNeu } = await (useFetch as any)('/api/account/identitaeten', { key: 'identitaeten' })
onMounted(() => {
  if (route.query.sso === 'verknuepft') ok(t('Anmeldung verknüpft', 'Sign-in linked'))
  if (route.query.sso_fehler) fehler(String(route.query.sso_fehler).slice(0, 300))
  if (route.query.sso || route.query.sso_fehler) navigateTo({ query: { reiter: 'konto' } }, { replace: true })
})
async function idLoesen(anbieter: string) {
  try {
    await api(`/api/account/identitaeten?anbieter=${encodeURIComponent(anbieter)}`, { method: 'DELETE' })
    await idsNeu()
    ok(t('Verknüpfung gelöst', 'Link removed'))
  } catch (e: any) {
    fehler(e.message)
  }
}
const nichtVerknuepft = computed(() =>
  (ids.value?.verfuegbar || []).filter((a: any) => !(ids.value?.verknuepft || []).some((v: any) => v.anbieter === a.id))
)
const prefs = reactive({ theme: 'dark', lang: 'de', stil: '', ablauf: '' })
watch(
  konto,
  (k) => {
    if (k)
      Object.assign(prefs, {
        theme: k.prefs?.theme || 'dark',
        lang: k.prefs?.lang || theme.value.lang,
        stil: k.prefs?.stil || '',
        ablauf: k.prefs?.ablauf || ''
      })
  },
  { immediate: true }
)
async function prefsSpeichern(teil: Record<string, any>, e?: MouseEvent) {
  try {
    await api('/api/account/prefs', { method: 'PUT', body: teil })
    if (teil.theme)
      themaWechseln(teil.theme, e, () => {
        if (theme.value.user) theme.value = { ...theme.value, user: { ...theme.value.user, theme: teil.theme } }
      })
    if (teil.lang) {
      theme.value = { ...theme.value, lang: teil.lang }
      sprache.value = teil.lang
    }
    ok(t('Gespeichert', 'Saved'))
  } catch (err: any) {
    fehler(err.message)
  }
}

const ben = reactive({
  discord: '',
  email: false,
  arten: {
    upload: false,
    anfrage: true,
    speicher: true,
    virus: true,
    webhook: true,
    system: true,
    traffic: true,
    quota: true
  } as Record<string, boolean>
})
watch(
  konto,
  (k) => {
    const b = k?.prefs?.benachrichtigung
    if (b)
      Object.assign(ben, { discord: b.discord || '', email: !!b.email, arten: { ...ben.arten, ...(b.arten || {}) } })
  },
  { immediate: true }
)
const ARTEN = computed(() => [
  {
    k: 'anfrage',
    ic: 'mail',
    text: t('Datei-Anfragen', 'File requests'),
    info: t(
      'Jemand hat dir etwas über eine Datei-Anfrage geschickt.',
      'Someone sent you something through a file request.'
    )
  },
  {
    k: 'quota',
    ic: 'cloud',
    text: t('Dein Speicher wird knapp', 'Your storage is running low'),
    info: t('Einmal bei 80 % und einmal bei 100 % deines Kontingents.', 'Once at 80% and once at 100% of your quota.')
  },
  {
    k: 'speicher',
    ic: 'database',
    text: t('Speicher-Box oder Bucket fast voll', 'Storage box or bucket almost full'),
    info: t('Einmal, wenn eine Box oder ein Bucket zu 80 % belegt ist.', 'Once, when a box or bucket is 80% used.')
  },
  {
    k: 'traffic',
    ic: 'chart',
    text: t('Traffic-Grenze (Pro)', 'Traffic limit (Pro)'),
    info: t('Bei 80 % und 100 % deines monatlichen Traffics.', 'At 80% and 100% of your monthly traffic.')
  },
  {
    k: 'virus',
    ic: 'shield',
    text: t('Virenfund', 'Malware found'),
    info: t('Der Virenscan hat eine Datei in Quarantäne gelegt.', 'The virus scan quarantined a file.')
  },
  {
    k: 'system',
    ic: 'gauge',
    text: t('System-Warnungen (Pro)', 'System alerts (Pro)'),
    info: t(
      'Platte fast voll, viele Fehler, Server ausgefallen — nur für den Inhaber.',
      'Disk almost full, many errors, server down — owner only.'
    )
  },
  {
    k: 'webhook',
    ic: 'network',
    text: t('Webhook abgeschaltet', 'Webhook disabled'),
    info: t('Ein Webhook ist zu oft fehlgeschlagen.', 'A webhook failed too often.')
  },
  {
    k: 'upload',
    ic: 'upload',
    text: t('Jeder Upload', 'Every upload'),
    info: t(
      'Auch eigene Uploads, z. B. aus ShareX — kann viel werden.',
      'Includes your own uploads, e.g. from ShareX — can get busy.'
    )
  }
])
const benLaeuft = ref(false)
async function benSpeichern() {
  benLaeuft.value = true
  try {
    await api('/api/account/prefs', {
      method: 'PUT',
      body: { benachrichtigung: { discord: ben.discord.trim(), email: ben.email, arten: ben.arten } }
    })
    await kontoNeu()
    ok(t('Gespeichert', 'Saved'))
  } catch (e: any) {
    fehler(e.message)
  } finally {
    benLaeuft.value = false
  }
}
async function benTesten() {
  try {
    await benSpeichern()
    const r = await api('/api/account/benachrichtigung-test', { method: 'POST' })
    const teile = [
      r.discord && `Discord: ${r.discord === 'ok' ? t('gesendet', 'sent') : t('fehlgeschlagen', 'failed')}`,
      r.email &&
        `E-Mail: ${r.email === 'ok' ? t('gesendet', 'sent') : r.email === 'kein-smtp' ? t('Versand ist nicht eingerichtet', 'sending is not set up') : t('fehlgeschlagen', 'failed')}`
    ].filter(Boolean)
    if (r.discord === 'ok' || r.email === 'ok') ok(teile.join(' · '))
    else fehler(teile.join(' · '))
  } catch (e: any) {
    fehler(e.message)
  }
}

const fragen = ref(true)
onMounted(() => {
  try {
    fragen.value = localStorage.getItem('vd_upload_direkt') !== '1'
  } catch {}
})
function fragenUm() {
  fragen.value = !fragen.value
  try {
    if (fragen.value) localStorage.removeItem('vd_upload_direkt')
    else localStorage.setItem('vd_upload_direkt', '1')
  } catch {}
}

const pw = reactive({ current: '', password: '', password2: '' })
async function pwAendern() {
  if (pw.password !== pw.password2)
    return fehler(t('Die beiden Passwörter stimmen nicht überein.', 'The two passwords do not match.'))
  try {
    await api('/api/account/password', { method: 'POST', body: { current: pw.current, password: pw.password } })
    Object.assign(pw, { current: '', password: '', password2: '' })
    ok(t('Passwort geändert — andere Geräte wurden abgemeldet', 'Password changed — other devices were signed out'))
    await kontoNeu()
  } catch (e: any) {
    fehler(e.message)
  }
}
const zf = reactive({ qr: '', secret: '', code: '', codes: [] as string[], aus: false, pw: '' })
async function zfStart() {
  try {
    const r = await api('/api/account/2fa', { method: 'POST', body: { action: 'begin' } })
    zf.qr = r.qr
    zf.secret = r.secret
  } catch (e: any) {
    fehler(e.message)
  }
}
async function zfAn() {
  try {
    const r = await api('/api/account/2fa', { method: 'POST', body: { action: 'enable', code: zf.code } })
    zf.codes = r.backupCodes
    zf.qr = ''
    zf.code = ''
    await kontoNeu()
    ok(t('Zwei-Faktor aktiv', 'Two-factor enabled'))
  } catch (e: any) {
    fehler(e.message)
  }
}
async function zfAus() {
  try {
    await api('/api/account/2fa', { method: 'POST', body: { action: 'disable', password: zf.pw } })
    zf.aus = false
    zf.pw = ''
    await kontoNeu()
    ok(t('Zwei-Faktor abgeschaltet', 'Two-factor disabled'))
  } catch (e: any) {
    fehler(e.message)
  }
}
const { data: pks, refresh: pksNeu } = await (useFetch as any)('/api/account/passkeys', { key: 'passkeys' })
const kannPasskey = ref(true)
onMounted(() => {
  kannPasskey.value = !!(window.isSecureContext && window.PublicKeyCredential)
})
const pkLaeuft = ref(false)
async function pkAnlegen() {
  pkLaeuft.value = true
  try {
    const { startRegistration } = await import('@simplewebauthn/browser')
    const optionsJSON = await api('/api/passkey/registrieren/start', { method: 'POST' })
    const antwort = await startRegistration({ optionsJSON })
    await api('/api/passkey/registrieren/ende', { method: 'POST', body: { antwort } })
    await pksNeu()
    ok(t('Passkey angelegt', 'Passkey added'))
  } catch (e: any) {
    if (e?.name === 'InvalidStateError')
      fehler(
        t('Dieses Gerät hat schon einen Passkey für dein Konto.', 'This device already has a passkey for your account.')
      )
    else if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') fehler(e.message)
  } finally {
    pkLaeuft.value = false
  }
}
function pkWeg(p: any) {
  bestaetigen(
    t('Passkey entfernen?', 'Remove passkey?'),
    t(
      `„${p.name}“ kann sich danach nicht mehr anmelden. Lösche ihn am besten auch im Passwort-Manager des Geräts.`,
      `“${p.name}” can no longer sign in afterwards. Ideally also delete it in the device's password manager.`
    ),
    t('Entfernen', 'Remove'),
    async () => {
      try {
        await api(`/api/account/passkeys?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' })
        await pksNeu()
        ok(t('Passkey entfernt', 'Passkey removed'))
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}
const bestaetigen = useBestaetigen()
async function sitzungenWeg() {
  try {
    const r = await api('/api/account/sessions', { method: 'DELETE' })
    await kontoNeu()
    ok(t(`${r.beendet} Sitzung(en) beendet`, `${r.beendet} session(s) ended`))
  } catch (e: any) {
    fehler(e.message)
  }
}

const FARBEN = ['#1e73be', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#ef4444', '#8b5cf6', '#ec4899']
const ins = reactive({ name: 'VylarisCloud', color: '#1e73be', maxGb: 2, namensstil: 'zufall', laenge: 8, lang: 'de' })
const med = reactive({ exifEntfernen: true, umwandeln: 'aus', qualitaet: 82, vorschau: true })
const ausl = reactive({
  bilder: false,
  maxPx: 4096,
  maxVarianten: 30,
  hotlink: false,
  ohneHerkunft: true,
  erlaubtText: ''
})
const trafficGb = ref<number | null>(null)
// Standard-Kontingent (Bytes) für Konten ohne eigenes Limit und ohne Rollen-Kontingent; null = keins
const standardQuota = ref<number | null | undefined>(null)
const { data: proInfo } = await (useFetch as any)('/api/pro', { key: 'pro', immediate: istAdmin.value })
const proTraffic = computed(() => !!proInfo.value?.funktionen?.traffic)
const { data: bildcache, refresh: bildcacheNeu } = await (useFetch as any)('/api/system/bildcache', {
  key: 'bildcache',
  immediate: istAdmin.value
})
watch(
  inst,
  (i) => {
    if (i) {
      Object.assign(ins, {
        name: i.design.name,
        color: i.design.color,
        maxGb: Math.round((i.uploads.maxBytes / 1024 ** 3) * 10) / 10,
        namensstil: i.uploads.namensstil,
        laenge: i.uploads.laenge,
        lang: i.lang
      })
      if (i.medien) Object.assign(med, i.medien)
      if (i.auslieferung)
        Object.assign(ausl, { ...i.auslieferung, erlaubtText: (i.auslieferung.erlaubt || []).join('\n') })
      if (i.traffic) trafficGb.value = i.traffic.grenzeGb
      standardQuota.value = i.quota?.standardGb ? Math.round(i.quota.standardGb * 1024 ** 3) : null
    }
  },
  { immediate: true }
)
function cacheLeeren() {
  bestaetigen(
    t('Zwischenspeicher leeren?', 'Clear the cache?'),
    t(
      'Alle Bildvarianten werden gelöscht und beim nächsten Aufruf neu erzeugt.',
      'All image variants are deleted and created again on the next request.'
    ),
    t('Leeren', 'Clear'),
    async () => {
      try {
        await api('/api/system/bildcache', { method: 'DELETE' })
        await bildcacheNeu()
        ok(t('Zwischenspeicher geleert', 'Cache cleared'))
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}
async function insSpeichern() {
  if (standardQuota.value === undefined)
    return fehler(t('Bitte ein gültiges Standard-Kontingent eingeben.', 'Please enter a valid default quota.'))
  try {
    await api('/api/settings', {
      method: 'PUT',
      body: {
        design: { name: ins.name, color: ins.color },
        uploads: { maxGb: Number(ins.maxGb) || 0, namensstil: ins.namensstil, laenge: Number(ins.laenge) },
        lang: ins.lang,
        quota: { standardGb: standardQuota.value ? standardQuota.value / 1024 ** 3 : null },
        medien: { ...med, qualitaet: Number(med.qualitaet) },
        auslieferung: {
          bilder: ausl.bilder,
          maxPx: Number(ausl.maxPx) || 4096,
          maxVarianten: Number(ausl.maxVarianten) || 30,
          hotlink: ausl.hotlink,
          ohneHerkunft: ausl.ohneHerkunft,
          erlaubt: ausl.erlaubtText
            .split(/[\s,]+/)
            .map((x) => x.trim())
            .filter(Boolean)
        },
        ...(proTraffic.value ? { traffic: { grenzeGb: trafficGb.value ? Number(trafficGb.value) : null } } : {})
      }
    })
    theme.value = { ...theme.value, name: ins.name, color: ins.color }
    await instNeu()
    ok(t('Gespeichert', 'Saved'))
  } catch (e: any) {
    fehler(e.message)
  }
}
const smtp = reactive({ host: '', port: 587, sicher: false, user: '', pass: '', von: '', hatPass: false })
watch(
  inst,
  (i) => {
    if (i?.mail) Object.assign(smtp, { ...i.mail, pass: '' })
  },
  { immediate: true }
)
const smtpLaeuft = ref(false)
async function smtpSpeichern(testen = false) {
  smtpLaeuft.value = true
  try {
    await api('/api/settings', {
      method: 'PUT',
      body: {
        mail: {
          host: smtp.host.trim(),
          port: Number(smtp.port) || 587,
          sicher: smtp.sicher,
          user: smtp.user.trim(),
          pass: smtp.pass || undefined,
          von: smtp.von.trim()
        }
      }
    })
    smtp.pass = ''
    await instNeu()
    if (testen) {
      const r = await api('/api/settings/mail-test', { method: 'POST' })
      ok(t(`Test-E-Mail an ${r.an} gesendet`, `Test e-mail sent to ${r.an}`))
    } else ok(t('Gespeichert', 'Saved'))
  } catch (e: any) {
    fehler(e.message)
  } finally {
    smtpLaeuft.value = false
  }
}
const { data: vs, refresh: vsNeu } = await (useFetch as any)('/api/system/virenscan', {
  key: 'virenscan',
  immediate: istAdmin.value
})
const vsLaeuft = ref(false)
let vsUhr: any = null
async function vsUm() {
  vsLaeuft.value = true
  try {
    const r = await api('/api/system/virenscan', { method: 'POST', body: { an: !vs.value?.an } })
    await vsNeu()
    if (r.dienst === 'angefragt') {
      ok(
        r.an
          ? t(
              'ClamAV wird gestartet — das dauert beim ersten Mal ein paar Minuten',
              'ClamAV is starting — the first time takes a few minutes'
            )
          : t('ClamAV wird gestoppt', 'ClamAV is being stopped')
      )
      vsBeobachten()
    } else if (r.dienst === 'manuell')
      fehler(
        r.an
          ? t(
              'Bitte auf dem Server starten: docker compose --profile virenscan up -d',
              'Please start it on the server: docker compose --profile virenscan up -d'
            )
          : t(
              'Bitte auf dem Server stoppen: docker compose stop clamav',
              'Please stop it on the server: docker compose stop clamav'
            )
      )
    else ok(r.an ? t('Virenscan an', 'Virus scan on') : t('Virenscan aus', 'Virus scan off'))
  } catch (e: any) {
    fehler(e.message)
  } finally {
    vsLaeuft.value = false
  }
}
function vsBeobachten() {
  clearInterval(vsUhr)
  const bis = Date.now() + 10 * 60_000
  vsUhr = setInterval(async () => {
    await vsNeu()
    if (Date.now() > bis || vs.value?.an === vs.value?.clamav?.erreichbar) clearInterval(vsUhr)
  }, 5000)
}
onBeforeUnmount(() => clearInterval(vsUhr))

function portWahl(p: number) {
  smtp.port = p
  smtp.sicher = p === 465
}

const STILE = computed(() => [
  { v: 'zufall', text: t('Zufall', 'Random'), bsp: 'kX9q2Rb' },
  { v: 'woerter', text: t('Wörter', 'Words'), bsp: t('ruhiger-falke-sieben', 'calm-falcon-seven') },
  { v: 'datum', text: t('Datum', 'Date'), bsp: '2026-10-22_14-30-05' },
  { v: 'original', text: t('Dateiname', 'File name'), bsp: 'urlaubsfoto-x7k' },
  { v: 'uuid', text: 'UUID', bsp: '3f2b8c1e-9a4d-4f7e-…' },
  { v: 'unsichtbar', text: t('Unsichtbar', 'Invisible'), bsp: t('(leer aussehend)', '(looks empty)') }
])
</script>

<template>
  <section class="rein">
    <div class="kopf"><div><div class="eyebrow"><Ico n="gear" /> {{ t('Verwaltung', 'Manage') }}</div><h1>{{ t('Einstellungen', 'Settings') }}</h1></div>
      <div class="seg" role="tablist">
        <button :class="{ an: reiter === 'darstellung' }" @click="reiter = 'darstellung'"><Ico n="sun" /> {{ t('Darstellung & Links', 'Appearance & links') }}</button>
        <button :class="{ an: reiter === 'konto' }" @click="reiter = 'konto'"><Ico n="user" /> {{ t('Konto', 'Account') }}</button>
        <button :class="{ an: reiter === 'benachrichtigung' }" @click="reiter = 'benachrichtigung'"><Ico n="mail" /> {{ t('Benachrichtigungen', 'Notifications') }}</button>
        <button v-if="istAdmin" :class="{ an: reiter === 'installation' }" @click="reiter = 'installation'"><Ico n="server" /> {{ t('Installation', 'Instance') }}</button>
      </div>
    </div>

    <Transition name="wechsel" mode="out-in">
      <div v-if="reiter === 'darstellung'" key="d" class="raster2">
        <div class="block">
          <h3>{{ t('Darstellung', 'Appearance') }}</h3>
          <p class="leise klein">{{ t('Gilt für dein Konto auf allen Geräten.', 'Applies to your account on all devices.') }}</p>
          <div class="themen">
            <button v-for="th in [{ v: 'dark', ic: 'moon', text: t('Dunkel', 'Dark') }, { v: 'light', ic: 'sun', text: t('Hell', 'Light') }, { v: 'system', ic: 'monitor', text: 'System' }]" :key="th.v" :class="['thema-' + th.v, { an: prefs.theme === th.v }]" @click="(e) => { prefs.theme = th.v; prefsSpeichern({ theme: th.v }, e) }">
              <span class="mini"><i></i><i></i><i></i></span><span><Ico :n="th.ic" /> {{ th.text }}</span>
            </button>
          </div>
          <label class="feld" style="margin-top:16px"><span>{{ t('Sprache', 'Language') }}</span>
            <VdAuswahl v-model="prefs.lang" class="eingabe" @change="prefsSpeichern({ lang: prefs.lang })"><option value="de">Deutsch</option><option value="en">English</option></VdAuswahl></label>
        </div>
        <div class="block">
          <h3>{{ t('Neue Links', 'New links') }}</h3>
          <p class="leise klein">{{ t('Vorgaben für deine Uploads — einzelne Werkzeuge können sie überschreiben.', 'Defaults for your uploads — individual tools can override them.') }}</p>
          <div class="stile">
            <button :class="{ an: !prefs.stil }" @click="prefs.stil = ''; prefsSpeichern({ stil: '' })"><b>{{ t('Standard der Installation', 'Instance default') }}</b></button>
            <button v-for="s in STILE" :key="s.v" :class="{ an: prefs.stil === s.v }" @click="prefs.stil = s.v; prefsSpeichern({ stil: s.v })"><b>{{ s.text }}</b><code>/v/{{ s.bsp }}</code></button>
          </div>
          <label class="feld" style="margin-top:14px"><span>{{ t('Standard-Ablauf', 'Default expiry') }}</span>
            <VdAuswahl v-model="prefs.ablauf" class="eingabe" @change="prefsSpeichern({ ablauf: prefs.ablauf })"><option value="">{{ t('Nie', 'Never') }}</option><option value="1d">{{ t('1 Tag', '1 day') }}</option><option value="7d">{{ t('7 Tage', '7 days') }}</option><option value="30d">{{ t('30 Tage', '30 days') }}</option><option value="365d">{{ t('1 Jahr', '1 year') }}</option></VdAuswahl></label>
          <label class="frage-opt"><button type="button" :class="['schalter', { an: fragen }]" role="switch" :aria-checked="fragen" @click="fragenUm"></button><span><b>{{ t('Vor dem Hochladen fragen', 'Ask before uploading') }}</b><small>{{ t('Link-Stil, Ablauf, Passwort und Ordner für jede Datei wählen (dieser Browser).', 'Choose link style, expiry, password and folder for each upload (this browser).') }}</small></span></label>
        </div>
      </div>

      <div v-else-if="reiter === 'konto'" key="k" class="raster2">
        <form class="block" @submit.prevent="pwAendern">
          <h3>{{ t('Passwort ändern', 'Change password') }}</h3>
          <p class="leise klein">{{ konto?.username }} · {{ konto?.email }}</p>
          <label class="feld"><span>{{ t('Aktuelles Passwort', 'Current password') }}</span><input v-model="pw.current" class="eingabe" type="password" autocomplete="current-password" required></label>
          <label class="feld"><span>{{ t('Neues Passwort', 'New password') }}</span><input v-model="pw.password" class="eingabe" type="password" autocomplete="new-password" minlength="10" required></label>
          <label class="feld"><span>{{ t('Wiederholen', 'Repeat') }}</span><input v-model="pw.password2" class="eingabe" type="password" autocomplete="new-password" minlength="10" required></label>
          <button class="knopf rot">{{ t('Ändern', 'Change') }}</button>
        </form>
        <div>
          <div class="block">
            <div class="reihe zw"><h3>{{ t('Zwei-Faktor-Anmeldung', 'Two-factor sign-in') }}</h3><span :class="['chip', konto?.totp_enabled ? 'ok' : 'neutral']">{{ konto?.totp_enabled ? t('Aktiv', 'Active') : t('Aus', 'Off') }}</span></div>
            <p class="leise klein">{{ t('Zusätzlich zum Passwort ein Code aus einer App wie Aegis, 1Password oder Google Authenticator.', 'A code from an app such as Aegis, 1Password or Google Authenticator in addition to your password.') }}</p>
            <template v-if="!konto?.totp_enabled">
              <button v-if="!zf.qr" class="knopf" @click="zfStart"><Ico n="shield" /> {{ t('Einrichten', 'Set up') }}</button>
              <form v-else class="zf" @submit.prevent="zfAn">
                <div class="qr" v-html="zf.qr"></div>
                <div><p class="klein leise">{{ t('QR-Code mit der App scannen oder den Schlüssel eingeben:', 'Scan the QR code with your app or enter the key:') }}</p><code class="mono schl">{{ zf.secret }}</code>
                  <input v-model="zf.code" class="eingabe mono" inputmode="numeric" maxlength="6" :placeholder="t('6-stelliger Code', '6-digit code')" required><button class="knopf rot" style="margin-top:8px">{{ t('Bestätigen', 'Confirm') }}</button></div>
              </form>
            </template>
            <template v-else>
              <p class="klein leise">{{ t(`${konto.backup_codes} Notfall-Codes übrig.`, `${konto.backup_codes} backup codes left.`) }}</p>
              <button v-if="!zf.aus" class="knopf gefahr" @click="zf.aus = true">{{ t('Abschalten', 'Disable') }}</button>
              <form v-else class="reihe" @submit.prevent="zfAus"><input v-model="zf.pw" class="eingabe" style="flex:1" type="password" :placeholder="t('Passwort zur Bestätigung', 'Password to confirm')" required><button class="knopf gefahr">{{ t('Abschalten', 'Disable') }}</button></form>
            </template>
            <div v-if="zf.codes.length" class="codes"><b>{{ t('Notfall-Codes — jetzt sichern, sie erscheinen nur einmal:', 'Backup codes — save them now, they are shown only once:') }}</b><div><code v-for="c in zf.codes" :key="c" class="mono">{{ c }}</code></div></div>
          </div>
          <div class="block">
            <div class="reihe zw"><h3>Passkeys</h3><span :class="['chip', pks?.passkeys?.length ? 'ok' : 'neutral']">{{ pks?.passkeys?.length || 0 }}</span></div>
            <p class="leise klein">{{ t('Anmelden mit Fingerabdruck, Gesichtserkennung oder Geräte-PIN — ohne Passwort und ohne Code.', 'Sign in with your fingerprint, face or device PIN — no password, no code.') }}</p>
            <div v-for="p in pks?.passkeys || []" :key="p.id" class="reihe zw id-zeile">
              <span><Ico n="key" class="pk-ic" /> <b>{{ p.name }}</b> <span class="sehrleise">{{ p.zuletzt_at ? t(`zuletzt ${datum(p.zuletzt_at)}`, `last used ${datum(p.zuletzt_at)}`) : t(`angelegt ${datum(p.created_at)}`, `added ${datum(p.created_at)}`) }}</span></span>
              <button class="knopf klein" :aria-label="t('Entfernen', 'Remove')" @click="pkWeg(p)"><Ico n="trash" /></button>
            </div>
            <button v-if="kannPasskey" class="knopf" :disabled="pkLaeuft" @click="pkAnlegen"><Ico :n="pkLaeuft ? 'loader' : 'plus'" :spin="pkLaeuft" /> {{ t('Passkey hinzufügen', 'Add passkey') }}</button>
            <p v-else class="meldung meldung-warn klein">{{ t('Passkeys gehen nur über HTTPS. Richte unter „Netzwerk“ eine Domain mit Zertifikat ein.', 'Passkeys only work over HTTPS. Set up a domain with a certificate first.') }}</p>
          </div>
          <div class="block">
            <div class="reihe zw"><div><h3>{{ t('Sitzungen', 'Sessions') }}</h3><p class="leise klein" style="margin:0">{{ t(`${konto?.sessions || 1} Gerät(e) angemeldet`, `${konto?.sessions || 1} device(s) signed in`) }}</p></div>
              <button class="knopf" :disabled="(konto?.sessions || 1) <= 1" @click="sitzungenWeg">{{ t('Andere abmelden', 'Sign out others') }}</button></div>
          </div>
          <div v-if="ids?.verfuegbar?.length || ids?.verknuepft?.length" class="block">
            <h3>{{ t('Verknüpfte Anmeldungen', 'Linked sign-ins') }}</h3>
            <p class="leise klein">{{ t('Damit meldest du dich ohne Passwort an.', 'Use these to sign in without a password.') }}</p>
            <div v-for="v in ids.verknuepft" :key="v.anbieter" class="reihe zw id-zeile"><span><b>{{ v.name }}</b> <span class="sehrleise">{{ v.email }}</span></span><button class="knopf klein" @click="idLoesen(v.anbieter)">{{ t('Lösen', 'Unlink') }}</button></div>
            <div v-if="nichtVerknuepft.length" class="reihe"><a v-for="a in nichtVerknuepft" :key="a.id" :href="`/api/sso/${a.id}/start?verknuepfen=1`" class="knopf klein"><Ico n="link" /> {{ t(`Mit ${a.name} verknüpfen`, `Link ${a.name}`) }}</a></div>
          </div>
        </div>
      </div>

      <div v-else-if="reiter === 'benachrichtigung'" key="b" class="raster2">
        <form class="block" @submit.prevent="benSpeichern">
          <h3>{{ t('Wohin?', 'Where to?') }}</h3>
          <p class="leise klein">{{ t('Du kannst beides gleichzeitig nutzen.', 'You can use both at the same time.') }}</p>
          <label class="feld"><span>Discord-Webhook</span><input v-model="ben.discord" class="eingabe mono" inputmode="url" spellcheck="false" placeholder="https://discord.com/api/webhooks/…" maxlength="200">
            <small>{{ t('In Discord: Kanal bearbeiten → Integrationen → Webhooks → Neuer Webhook → URL kopieren.', 'In Discord: Edit channel → Integrations → Webhooks → New webhook → Copy URL.') }}</small></label>
          <label class="frage-opt"><button type="button" :class="['schalter', { an: ben.email }]" role="switch" :aria-checked="ben.email" @click="ben.email = !ben.email"></button>
            <span><b>{{ t('Per E-Mail', 'By e-mail') }}</b><small>{{ konto?.email ? t(`An ${konto.email}`, `To ${konto.email}`) : t('Dein Konto hat keine E-Mail-Adresse.', 'Your account has no e-mail address.') }}</small></span></label>
          <div class="reihe" style="margin-top:18px">
            <button class="knopf rot" :disabled="benLaeuft">{{ t('Speichern', 'Save') }}</button>
            <button type="button" class="knopf" :disabled="benLaeuft || (!ben.discord.trim() && !ben.email)" @click="benTesten"><Ico n="sparkle" /> {{ t('Test senden', 'Send test') }}</button>
          </div>
        </form>
        <div class="block">
          <h3>{{ t('Worüber?', 'About what?') }}</h3>
          <p class="leise klein">{{ t('Änderungen hier gelten nach dem Speichern.', 'Changes here apply after saving.') }}</p>
          <div class="arten">
            <label v-for="a in ARTEN" :key="a.k"><span class="art-ic"><Ico :n="a.ic" /></span><span><b>{{ a.text }}</b><small>{{ a.info }}</small></span>
              <button type="button" :class="['schalter', { an: ben.arten[a.k] }]" role="switch" :aria-checked="ben.arten[a.k]" @click="ben.arten[a.k] = !ben.arten[a.k]"></button></label>
          </div>
        </div>
      </div>

      <form v-else-if="reiter === 'installation' && istAdmin" key="i" class="raster2" @submit.prevent="insSpeichern">
        <div class="block">
          <h3>{{ t('Name & Farbe', 'Name & colour') }}</h3>
          <label class="feld"><span>{{ t('Name', 'Name') }}</span><input v-model="ins.name" class="eingabe" maxlength="40" :disabled="!istInhaber"></label>
          <div class="feld"><span>{{ t('Akzentfarbe', 'Accent colour') }}</span><div class="farben"><button v-for="c in FARBEN" :key="c" type="button" :class="{ an: ins.color === c }" :style="{ '--c': c }" :aria-label="c" :disabled="!istInhaber" @click="ins.color = c"></button><input v-model="ins.color" type="color" :disabled="!istInhaber" :aria-label="t('Eigene Farbe', 'Custom colour')"></div></div>
          <label class="feld"><span>{{ t('Sprache der Installation', 'Instance language') }}</span><VdAuswahl v-model="ins.lang" class="eingabe" :disabled="!istInhaber"><option value="de">Deutsch</option><option value="en">English</option></VdAuswahl><small>{{ t('Standard für neue Konten und Meldungen des Servers.', 'Default for new accounts and server messages.') }}</small></label>
        </div>
        <div class="block">
          <h3>{{ t('Uploads', 'Uploads') }}</h3>
          <label class="feld"><span>{{ t('Größte Datei (GB)', 'Largest file (GB)') }}</span><input v-model="ins.maxGb" class="eingabe" type="number" min="0" step="0.1" :disabled="!istInhaber"><small>{{ t('0 = ohne Grenze. Gilt je Datei, unabhängig vom Kontingent.', '0 = no limit. Applies per file, independent of the quota.') }}</small></label>
          <div class="feld"><span>{{ t('Standard-Kontingent pro Konto', 'Default quota per account') }}</span>
            <VdQuotaEingabe v-model="standardQuota" art="einfach" id-prefix="std" />
            <small>{{ t('Gilt für normale Konten ohne eigenes Limit und ohne Rollen-Kontingent. Admins und Inhaber bleiben unbegrenzt. Einzelne Konten stellst du unter „Nutzer“ ein.', 'Applies to regular accounts without their own limit or role quota. Admins and the owner stay unlimited. Set individual accounts under “Users”.') }}</small></div>
          <label class="feld"><span>{{ t('Standard-Link-Stil', 'Default link style') }}</span><VdAuswahl v-model="ins.namensstil" class="eingabe" :disabled="!istInhaber"><option v-for="s in STILE" :key="s.v" :value="s.v">{{ s.text }} — {{ s.bsp }}</option></VdAuswahl></label>
          <label class="feld"><span>{{ t('Länge zufälliger Links', 'Random link length') }}</span><input v-model="ins.laenge" class="eingabe" type="number" min="4" max="32" :disabled="!istInhaber"></label>
        </div>
        <div class="block voll">
          <div class="reihe zw"><h3>{{ t('Medien', 'Media') }}</h3><span :class="['chip', inst?.ffmpeg ? 'ok' : 'warn']">{{ inst?.ffmpeg ? t('ffmpeg gefunden', 'ffmpeg found') : t('ffmpeg fehlt', 'ffmpeg missing') }}</span></div>
          <p class="leise klein">{{ t('Wird nach jedem Upload im Hintergrund erledigt.', 'Done in the background after every upload.') }}</p>
          <div class="schalter-liste">
            <label><button type="button" class="schalter" :class="{ an: med.exifEntfernen }" role="switch" :aria-checked="med.exifEntfernen" :disabled="!istInhaber" @click="med.exifEntfernen = !med.exifEntfernen"></button>
              <span><b>{{ t('Standort- und Kamera-Daten entfernen', 'Remove location and camera data') }}</b><small>{{ t('GPS, Gerät, Aufnahmezeit aus JPEG, PNG und WebP — verlustfrei, die Ausrichtung bleibt.', 'GPS, device, capture time from JPEG, PNG and WebP — lossless, orientation is kept.') }}</small></span></label>
            <label><button type="button" class="schalter" :class="{ an: med.vorschau }" role="switch" :aria-checked="med.vorschau" :disabled="!istInhaber" @click="med.vorschau = !med.vorschau"></button>
              <span><b>{{ t('Vorschaubilder & Wellenformen', 'Thumbnails & waveforms') }}</b><small>{{ t('Kleine Vorschauen für das Raster, Video-Streifen zum Spulen, Audio-Wellenform.', 'Small previews for the grid, video strips for scrubbing, audio waveform.') }}</small></span></label>
          </div>
          <div class="zwei-feld">
            <label class="feld"><span>{{ t('Bilder umwandeln', 'Convert images') }}</span><VdAuswahl v-model="med.umwandeln" class="eingabe" :disabled="!istInhaber || !inst?.ffmpeg"><option value="aus">{{ t('Nein — Original behalten', 'No — keep original') }}</option><option value="webp">{{ t('In WebP (kleiner, überall lesbar)', 'To WebP (smaller, widely supported)') }}</option><option value="avif">{{ t('In AVIF (am kleinsten, langsamer)', 'To AVIF (smallest, slower)') }}</option></VdAuswahl><small>{{ t('Nur, wenn das Ergebnis wirklich kleiner ist. GIFs bleiben unverändert.', 'Only if the result is actually smaller. GIFs stay unchanged.') }}</small></label>
            <label class="feld"><span>{{ t('Qualität', 'Quality') }} · {{ med.qualitaet }}</span><input v-model.number="med.qualitaet" type="range" min="40" max="100" :disabled="!istInhaber || med.umwandeln === 'aus'" style="width:100%;accent-color:var(--a)"></label>
          </div>
          <button v-if="istInhaber" class="knopf rot">{{ t('Speichern', 'Save') }}</button>
          <p v-else class="sehrleise klein">{{ t('Ändern darf nur der Inhaber.', 'Only the owner can change this.') }}</p>
        </div>
        <div class="block voll">
          <h3>{{ t('Auslieferung', 'Delivery') }}</h3>
          <p class="leise klein">{{ t('Für den Einsatz als CDN: Bildgrößen per Link und Schutz vor fremdem Einbinden. Beides ist aus, bis du es einschaltest.', 'For use as a CDN: image sizes via the link and protection against foreign embedding. Both stay off until you turn them on.') }}</p>
          <div class="schalter-liste">
            <label><button type="button" class="schalter" :class="{ an: ausl.bilder }" role="switch" :aria-checked="ausl.bilder" :disabled="!istInhaber || !inst?.ffmpeg" @click="ausl.bilder = !ausl.bilder"></button>
              <span><b>{{ t('Bilder per URL anpassen', 'Resize images via URL') }}</b><small>{{ t('Größe, Zuschnitt, Format und Qualität direkt am Direktlink — jede Variante entsteht einmal und wird zwischengespeichert.', 'Size, crop, format and quality right on the direct link — each variant is created once and cached.') }}</small></span></label>
          </div>
          <template v-if="ausl.bilder">
            <code class="beispiel mono">…/r/bild.png?w=800&amp;h=600&amp;fit=cover&amp;format=webp&amp;q=80</code>
            <p class="sehrleise klein">{{ t('w/h: Pixel · fit: contain (hineinpassen) oder cover (zuschneiden) · format: webp, avif, jpeg, png oder auto (bestes, das der Browser kann) · q: 1–100', 'w/h: pixels · fit: contain (fit inside) or cover (crop) · format: webp, avif, jpeg, png or auto (best the browser supports) · q: 1–100') }}</p>
            <div class="zwei-feld">
              <label class="feld"><span>{{ t('Höchstens (Pixel)', 'Maximum (pixels)') }}</span><input v-model.number="ausl.maxPx" class="eingabe" type="number" min="64" max="8192" :disabled="!istInhaber"></label>
              <label class="feld"><span>{{ t('Varianten pro Datei', 'Variants per file') }}</span><input v-model.number="ausl.maxVarianten" class="eingabe" type="number" min="1" max="500" :disabled="!istInhaber"><small>{{ t('Schützt davor, dass jemand mit immer neuen Größen die Platte füllt.', 'Prevents someone from filling the disk with ever new sizes.') }}</small></label>
            </div>
            <div class="reihe zw cache-zeile">
              <span class="leise klein">{{ t('Zwischenspeicher', 'Cache') }}: {{ bildcache ? `${bildcache.dateien} ${t('Varianten', 'variants')} · ${groesse(bildcache.bytes)}` : '…' }}</span>
              <button v-if="istInhaber" type="button" class="knopf klein" :disabled="!bildcache?.dateien" @click="cacheLeeren"><Ico n="trash" /> {{ t('Leeren', 'Clear') }}</button>
            </div>
          </template>
          <div class="schalter-liste">
            <label><button type="button" class="schalter" :class="{ an: ausl.hotlink }" role="switch" :aria-checked="ausl.hotlink" :disabled="!istInhaber" @click="ausl.hotlink = !ausl.hotlink"></button>
              <span><b>{{ t('Hotlink-Schutz', 'Hotlink protection') }}</b><small>{{ t('Direktlinks und Vorschaubilder nur auf erlaubten Websites einbinden. Deine eigene Domain ist immer erlaubt, Downloads und die Datei-Seite bleiben offen.', 'Embed direct links and thumbnails only on allowed websites. Your own domain is always allowed; downloads and the file page stay open.') }}</small></span></label>
          </div>
          <template v-if="ausl.hotlink">
            <label class="feld"><span>{{ t('Erlaubte Websites', 'Allowed websites') }}</span><textarea v-model="ausl.erlaubtText" class="eingabe mono" rows="4" placeholder="meinefirma.de&#10;*.forum.example" spellcheck="false" :disabled="!istInhaber"></textarea><small>{{ t('Eine Domain pro Zeile. „beispiel.de“ gilt auch für alle Subdomains, „*.beispiel.de“ nur für Subdomains.', 'One domain per line. “example.com” also covers all subdomains, “*.example.com” only subdomains.') }}</small></label>
            <div class="schalter-liste">
              <label><button type="button" class="schalter" :class="{ an: ausl.ohneHerkunft }" role="switch" :aria-checked="ausl.ohneHerkunft" :disabled="!istInhaber" @click="ausl.ohneHerkunft = !ausl.ohneHerkunft"></button>
                <span><b>{{ t('Aufrufe ohne Herkunft erlauben', 'Allow requests without referrer') }}</b><small>{{ t('Link in der Adresszeile, Discord- und Telegram-Vorschau, Apps. Aus = nur noch erlaubte Websites.', 'Link in the address bar, Discord and Telegram previews, apps. Off = allowed websites only.') }}</small></span></label>
            </div>
          </template>
          <div class="traffic-feld">
            <label class="feld"><span>{{ t('Traffic pro Konto und Monat', 'Traffic per account and month') }} <span class="chip neutral">Pro</span></span>
              <div class="reihe"><input v-model.number="trafficGb" class="eingabe" type="number" min="0" step="1" :placeholder="t('ohne Grenze', 'no limit')" :disabled="!istInhaber || !proTraffic"><span class="leise">GB</span></div>
              <small>{{ proTraffic ? t('Gilt für alle Konten ohne eigene Grenze in ihrer Rolle (Teams & Rollen). Danach werden ihre Dateien bis Monatsende nicht mehr öffentlich ausgeliefert; Warnung bei 80 % und 100 %. Der Inhaber hat keine Grenze.', 'Applies to all accounts without their own limit in their role (Teams & roles). After that their files are no longer delivered publicly until the end of the month; warning at 80% and 100%. The owner has no limit.') : t('Traffic-Statistik und Grenzen gibt es mit VylarisCloud Pro.', 'Traffic statistics and limits come with VylarisCloud Pro.') }}</small></label>
          </div>
          <button v-if="istInhaber" class="knopf rot">{{ t('Speichern', 'Save') }}</button>
        </div>
        <VdTunnel v-if="istAdmin" :inhaber="istInhaber" />
        <div v-if="vs" class="block voll">
          <div class="reihe zw"><h3>{{ t('Virenscan', 'Virus scan') }}</h3>
            <span v-if="vs.an && vs.clamav.erreichbar" class="chip ok"><Ico n="shield" /> ClamAV {{ vs.clamav.version.split('/')[0] }}</span>
            <span v-else-if="vs.an" class="chip warn"><Ico n="loader" spin /> {{ t('ClamAV startet …', 'ClamAV is starting …') }}</span>
            <span v-else class="chip neutral">{{ t('Aus', 'Off') }}</span></div>
          <p class="leise klein">{{ t(`Prüft jede Datei bis ${vs.maxMb} MB mit ClamAV, auch alle schon vorhandenen. Funde kommen in Quarantäne und werden nicht mehr ausgeliefert. Braucht etwa 1,5 GB Arbeitsspeicher.`, `Checks every file up to ${vs.maxMb} MB with ClamAV, including all existing ones. Findings are quarantined and no longer delivered. Needs about 1.5 GB of RAM.`) }}</p>
          <label class="frage-opt"><button type="button" :class="['schalter', { an: vs.an }]" role="switch" :aria-checked="vs.an" :disabled="!istInhaber || vsLaeuft" @click="vsUm"></button>
            <span><b>{{ t('Dateien auf Viren prüfen', 'Scan files for viruses') }}</b><small v-if="!vs.dienst">{{ t('Der Dienst auf dem Server ist älter — Container dann von Hand starten/stoppen, oder einmal den Befehl aus „Version“ unten links auf dem Server ausführen.', 'The service on the server is older — start/stop the container by hand, or run the command from “Version” at the bottom left on the server once.') }}</small><small v-else>{{ t('Startet bzw. stoppt den ClamAV-Container auf dem Server.', 'Starts or stops the ClamAV container on the server.') }}</small></span></label>
          <div v-if="vs.an" class="vs-zahlen">
            <div><b class="mono">{{ zahl(vs.zahlen.geprueft) }}</b><small>{{ t('geprüft', 'scanned') }}</small></div>
            <div><b class="mono">{{ zahl(vs.zahlen.offen) }}</b><small>{{ t('in der Warteschlange', 'queued') }}</small></div>
            <div :class="{ rot: vs.zahlen.funde }"><b class="mono">{{ zahl(vs.zahlen.funde) }}</b><small>{{ t('in Quarantäne', 'quarantined') }}</small></div>
          </div>
          <p v-if="vs.lauf?.status === 'fehler'" class="meldung meldung-fehler klein">{{ vs.lauf.meldung }}</p>
        </div>
        <div v-if="istInhaber" class="block voll">
          <div class="reihe zw"><h3>{{ t('E-Mail-Versand', 'Sending e-mail') }}</h3><span :class="['chip', inst?.mail?.host ? 'ok' : 'neutral']">{{ inst?.mail?.host ? t('Eingerichtet', 'Set up') : t('Aus', 'Off') }}</span></div>
          <p class="leise klein">{{ t('Für Benachrichtigungen per E-Mail. Jeder SMTP-Zugang geht — vom eigenen Mailserver bis zu Brevo, Mailjet oder Gmail (App-Passwort).', 'For e-mail notifications. Any SMTP account works — from your own mail server to Brevo, Mailjet or Gmail (app password).') }}</p>
          <div class="smtp">
            <label class="feld"><span>{{ t('Server', 'Server') }}</span><input v-model="smtp.host" class="eingabe mono" placeholder="smtp.example.com" spellcheck="false"></label>
            <div class="feld"><span>Port</span><div class="ports"><button v-for="p in [587, 465, 25]" :key="p" type="button" :class="{ an: Number(smtp.port) === p }" @click="portWahl(p)">{{ p }}<small>{{ p === 587 ? 'STARTTLS' : p === 465 ? 'TLS' : t('ohne', 'plain') }}</small></button><input v-model.number="smtp.port" class="eingabe mono" type="number" min="1" max="65535" :aria-label="t('Eigener Port', 'Custom port')"></div></div>
            <label class="feld"><span>{{ t('Benutzer', 'User') }}</span><input v-model="smtp.user" class="eingabe" autocomplete="off" spellcheck="false"></label>
            <label class="feld"><span>{{ t('Passwort', 'Password') }}</span><input v-model="smtp.pass" class="eingabe" type="password" autocomplete="new-password" :placeholder="smtp.hatPass ? t('gespeichert — leer lassen zum Behalten', 'saved — leave empty to keep') : ''"></label>
            <label class="feld voll2"><span>{{ t('Absender', 'Sender') }}</span><input v-model="smtp.von" class="eingabe" placeholder="VylarisCloud <drop@example.com>"></label>
          </div>
          <div class="reihe">
            <button type="button" class="knopf rot" :disabled="smtpLaeuft" @click="smtpSpeichern(false)">{{ t('Speichern', 'Save') }}</button>
            <button type="button" class="knopf" :disabled="smtpLaeuft || !smtp.host" @click="smtpSpeichern(true)"><Ico :n="smtpLaeuft ? 'loader' : 'mail'" :spin="smtpLaeuft" /> {{ t('Speichern & Test-E-Mail', 'Save & send test') }}</button>
          </div>
        </div>
      </form>
    </Transition>
  </section>
</template>

<style scoped>
.raster2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  align-items: start;
}
.raster2 > .block {
  margin-top: 0;
}
.raster2 > .voll {
  grid-column: 1 / -1;
  margin-top: 0;
}
.beispiel {
  display: block;
  font-size: 12.5px;
  background: var(--flaeche2);
  padding: 8px 10px;
  border-radius: 8px;
  margin: 2px 0 6px;
  overflow-x: auto;
  white-space: nowrap;
}
.cache-zeile {
  margin: 0 0 12px;
}
.traffic-feld {
  margin-top: 6px;
}
.traffic-feld .reihe {
  gap: 8px;
  align-items: center;
}
.traffic-feld .reihe .eingabe {
  max-width: 180px;
}
.schalter-liste {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 14px;
}
.schalter-liste label {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  background: var(--bg);
  border: 1px solid var(--linie);
  border-radius: 12px;
  padding: 12px;
  cursor: pointer;
}
.schalter-liste span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}
.schalter-liste small {
  color: var(--text3);
  font-size: 12px;
}
.zwei-feld {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 14px;
}
.raster2 > div > .block + .block {
  margin-top: 14px;
}
.klein {
  font-size: 12.5px;
  margin: 2px 0 12px;
}
.themen {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.themen button {
  border: 1px solid var(--linie);
  background: var(--bg);
  border-radius: 12px;
  padding: 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
  transition:
    border-color 0.2s,
    box-shadow 0.2s,
    transform 0.2s;
  font-size: 12.5px;
  font-weight: 500;
}
.themen button:hover {
  transform: translateY(-2px);
}
.themen button.an {
  border-color: var(--a);
  box-shadow: 0 0 0 3px rgba(var(--a-rgb), 0.14);
}
.themen button > span:last-child {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
}
.themen svg {
  width: 13px;
  height: 13px;
}
.mini {
  height: 54px;
  border-radius: 8px;
  display: grid;
  grid-template-columns: 30% 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 4px;
  padding: 6px;
}
.mini i {
  border-radius: 4px;
}
.mini i:first-child {
  grid-row: 1 / 3;
}
.thema-dark .mini {
  background: #070708;
}
.thema-dark .mini i {
  background: #1f1f23;
}
.thema-dark .mini i:last-child {
  background: var(--a);
}
.thema-light .mini {
  background: #f6f5f3;
  border: 1px solid #e4e1dc;
}
.thema-light .mini i {
  background: #e4e1dc;
}
.thema-light .mini i:last-child {
  background: var(--a);
}
.thema-system .mini {
  background: linear-gradient(90deg, #070708 50%, #f6f5f3 50%);
}
.thema-system .mini i {
  background: rgba(128, 128, 128, 0.35);
}
.thema-system .mini i:last-child {
  background: var(--a);
}
.stile {
  display: grid;
  gap: 6px;
}
.stile button {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--linie);
  background: var(--bg);
  border-radius: 10px;
  padding: 9px 12px;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  transition: border-color 0.2s;
}
.stile button b {
  font-weight: 500;
}
.stile button code {
  font-family: var(--f-mono);
  font-size: 11.5px;
  color: var(--text3);
}
.stile button.an {
  border-color: var(--a);
}
.zf {
  display: grid;
  grid-template-columns: 150px 1fr;
  gap: 14px;
  align-items: start;
}
.qr {
  background: #fff;
  border-radius: 10px;
  padding: 6px;
}
.qr :deep(svg) {
  width: 100%;
  height: auto;
  display: block;
}
.schl {
  display: block;
  font-size: 11.5px;
  word-break: break-all;
  background: var(--bg);
  padding: 6px 8px;
  border-radius: 8px;
  margin: 6px 0 10px;
}
.codes {
  margin-top: 14px;
  padding: 12px;
  border-radius: 12px;
  background: var(--warn-bg);
  font-size: 12.5px;
}
.codes div {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  margin-top: 8px;
}
.farben {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.farben button {
  width: 28px;
  height: 28px;
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
  width: 32px;
  height: 32px;
  border: 0;
  background: none;
  cursor: pointer;
  padding: 0;
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
@media (max-width: 860px) {
  .raster2,
  .zf {
    grid-template-columns: 1fr;
  }
}
.id-zeile {
  padding: 8px 0;
  border-bottom: 1px solid var(--linie);
  margin-bottom: 8px;
}
.pk-ic {
  width: 14px;
  height: 14px;
  color: var(--text3);
  vertical-align: -2px;
}
.frage-opt {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-top: 14px;
  cursor: pointer;
}
.frage-opt small {
  display: block;
  color: var(--text3);
  font-size: 12px;
}
.arten {
  display: grid;
  gap: 8px;
}
.arten label {
  display: flex;
  gap: 12px;
  align-items: center;
  background: var(--bg);
  border: 1px solid var(--linie);
  border-radius: 12px;
  padding: 11px 12px;
  cursor: pointer;
}
.arten label > span:nth-child(2) {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}
.arten small {
  color: var(--text3);
  font-size: 12px;
}
.art-ic {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--flaeche2);
  display: grid;
  place-items: center;
  color: var(--text2);
  flex-shrink: 0;
}
.art-ic svg {
  width: 15px;
  height: 15px;
}
.vs-zahlen {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 14px;
}
.vs-zahlen div {
  background: var(--bg);
  border: 1px solid var(--linie);
  border-radius: 12px;
  padding: 10px 12px;
}
.vs-zahlen b {
  display: block;
  font-size: 20px;
  font-weight: 600;
}
.vs-zahlen small {
  color: var(--text3);
  font-size: 12px;
}
.vs-zahlen .rot b {
  color: var(--rot);
}
.smtp {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 14px;
}
.smtp .voll2 {
  grid-column: 1 / -1;
}
.ports {
  display: flex;
  gap: 6px;
}
.ports button {
  flex: 1;
  border: 1px solid var(--linie);
  background: var(--bg);
  border-radius: 10px;
  padding: 5px 4px;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.2;
}
.ports button small {
  font-size: 10px;
  font-weight: 400;
  color: var(--text3);
}
.ports button.an {
  border-color: var(--a);
  box-shadow: 0 0 0 3px rgba(var(--a-rgb), 0.12);
}
.ports input {
  width: 90px;
  flex: none;
}
@media (max-width: 860px) {
  .smtp {
    grid-template-columns: 1fr;
  }
}
</style>
