<script setup lang="ts">
const props = defineProps<{ inhaber: boolean }>()
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const { data, refresh } = await (useFetch as any)('/api/system/tunnel', { key: 'tunnel' })
const tz = computed<any>(() => data.value)
const f = reactive({ modus: 'token' as 'token' | 'auto', domain: '', token: '', apiToken: '', ueberschreiben: false })
watch(
  tz,
  (x) => {
    if (x && !f.domain) {
      f.domain = x.domain || ''
      f.modus = x.modus || 'token'
    }
  },
  { immediate: true }
)
const laeuft = ref(false)
let uhr: any = null
function beobachten() {
  clearInterval(uhr)
  const bis = Date.now() + 3 * 60_000
  uhr = setInterval(async () => {
    await refresh()
    if (Date.now() > bis || (tz.value?.an ? tz.value?.zustand?.bereit : !tz.value?.zustand?.erreichbar))
      clearInterval(uhr)
  }, 3000)
}
onBeforeUnmount(() => clearInterval(uhr))
async function starten() {
  laeuft.value = true
  try {
    const body =
      f.modus === 'token'
        ? { aktion: 'token', token: f.token, domain: f.domain }
        : { aktion: 'auto', apiToken: f.apiToken || undefined, domain: f.domain, ueberschreiben: f.ueberschreiben }
    await api('/api/system/tunnel', { method: 'POST', body })
    f.token = ''
    f.apiToken = ''
    await refresh()
    beobachten()
    ok(t('Tunnel wird gestartet — das dauert ein paar Sekunden', 'Starting the tunnel — this takes a few seconds'))
  } catch (e: any) {
    fehler(e.message)
  } finally {
    laeuft.value = false
  }
}
function aus() {
  bestaetigen(
    t('Tunnel ausschalten?', 'Turn off the tunnel?'),
    t(
      `VylarisCloud ist danach nicht mehr über ${tz.value?.domain} erreichbar (außer über deinen bisherigen Weg).`,
      `VylarisCloud will no longer be reachable at ${tz.value?.domain} (except through your previous route).`
    ),
    t('Ausschalten', 'Turn off'),
    async () => {
      try {
        await api('/api/system/tunnel', { method: 'POST', body: { aktion: 'aus' } })
        await refresh()
        beobachten()
        ok(t('Tunnel wird gestoppt', 'Stopping the tunnel'))
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}
function abbauen() {
  bestaetigen(
    t('Bei Cloudflare abbauen?', 'Remove at Cloudflare?'),
    t(
      `Löscht den von VylarisCloud angelegten Tunnel und den DNS-Eintrag für ${tz.value?.domain} bei Cloudflare.`,
      `Deletes the tunnel created by VylarisCloud and the DNS record for ${tz.value?.domain} at Cloudflare.`
    ),
    t('Abbauen', 'Remove'),
    async () => {
      try {
        await api('/api/system/tunnel', { method: 'POST', body: { aktion: 'abbauen' } })
        await refresh()
        ok(t('Bei Cloudflare entfernt', 'Removed at Cloudflare'))
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}
const zustand = computed(() => {
  const z = tz.value?.zustand
  if (tz.value?.an && z?.bereit)
    return {
      k: 'ok',
      ic: 'check',
      text: t(`Verbunden · ${z.verbindungen} Leitungen`, `Connected · ${z.verbindungen} links`)
    }
  if (tz.value?.an) return { k: 'warn', ic: 'loader', text: t('Startet …', 'Starting …') }
  return { k: 'neutral', ic: '', text: t('Aus', 'Off') }
})
const kopiert = ref(false)
async function zielKopieren() {
  if (await kopieren('http://app:3000')) {
    kopiert.value = true
    setTimeout(() => {
      kopiert.value = false
    }, 1500)
  }
}
</script>

<template>
  <div v-if="tz" class="block voll tunnel">
    <div class="reihe zw"><h3><Ico n="wolke" /> Cloudflare Tunnel</h3><span :class="['chip', zustand.k]"><Ico v-if="zustand.ic" :n="zustand.ic" :spin="zustand.ic === 'loader'" /> {{ zustand.text }}</span></div>
    <p class="leise klein">{{ t('VylarisCloud über eine Domain bei Cloudflare erreichbar machen — ohne offene Ports, ohne eigenes Zertifikat. Ideal für Heimserver und Server hinter einer Firewall. Cloudflare liefert HTTPS aus.', 'Make VylarisCloud reachable through a domain at Cloudflare — no open ports, no certificate of your own. Ideal for home servers and servers behind a firewall. Cloudflare serves HTTPS.') }}</p>
    <VdServerBefehl v-if="!tz.dienst" :text="t('Der Dienst auf dem Server ist zu alt dafür. Einmal auf dem Server ausführen, danach geht der Tunnel hier per Klick:', 'The service on the server is too old for this. Run this once on the server, then the tunnel works here with one click:')" />

    <template v-if="tz.an">
      <div class="aktiv">
        <div><small>{{ t('Erreichbar unter', 'Reachable at') }}</small><a :href="`https://${tz.domain}`" target="_blank" rel="noopener" class="mono">https://{{ tz.domain }} <Ico n="external" /></a></div>
        <span class="chip neutral">{{ tz.modus === 'auto' ? t('Automatisch eingerichtet', 'Set up automatically') : t('Tunnel-Token', 'Tunnel token') }}</span>
      </div>
      <p v-if="tz.lauf?.status === 'fehler'" class="meldung meldung-fehler klein">{{ tz.lauf.meldung }}</p>
      <p v-else-if="!tz.zustand.bereit && tz.zustand.erreichbar" class="sehrleise klein">{{ t('cloudflared läuft, wartet aber noch auf Cloudflare. Stimmt die Domain im Tunnel und das Ziel http://app:3000?', 'cloudflared is running but still waiting for Cloudflare. Are the domain in the tunnel and the target http://app:3000 correct?') }}</p>
      <p v-else-if="!tz.zustand.erreichbar && tz.lauf?.status === 'fertig'" class="meldung meldung-warn klein">{{ t('cloudflared läuft nicht. Meist ist der Tunnel-Token ungültig oder der Tunnel wurde bei Cloudflare gelöscht — ausschalten und mit einem neuen Token wieder einschalten.', 'cloudflared is not running. Usually the tunnel token is invalid or the tunnel was deleted at Cloudflare — turn it off and back on with a new token.') }}</p>
      <button v-if="inhaber" class="knopf gefahr" @click="aus">{{ t('Ausschalten', 'Turn off') }}</button>
    </template>

    <template v-else-if="inhaber">
      <div class="wege" role="group">
        <button type="button" :class="{ an: f.modus === 'token' }" @click="f.modus = 'token'"><Ico n="key" /><span><b>{{ t('Tunnel-Token', 'Tunnel token') }}</b><small>{{ t('Tunnel im Cloudflare-Dashboard anlegen, Token einfügen', 'Create the tunnel in the Cloudflare dashboard, paste the token') }}</small></span></button>
        <button type="button" :class="{ an: f.modus === 'auto' }" @click="f.modus = 'auto'"><Ico n="sparkle" /><span><b>{{ t('Automatisch', 'Automatic') }}</b><small>{{ t('VylarisCloud legt Tunnel und DNS-Eintrag per API-Token selbst an', 'VylarisCloud creates tunnel and DNS record itself with an API token') }}</small></span></button>
      </div>
      <ol v-if="f.modus === 'token'" class="schritte">
        <li>{{ t('Cloudflare-Dashboard → Zero Trust → Networks → Tunnels → „Create a tunnel“ → Cloudflared.', 'Cloudflare dashboard → Zero Trust → Networks → Tunnels → “Create a tunnel” → Cloudflared.') }}</li>
        <li>{{ t('Unter „Public Hostname“ deine Domain eintragen, als Service', 'Under “Public Hostname” enter your domain, as service') }} <code class="mono">HTTP</code> · <code class="mono">app:3000</code> <button type="button" class="knopf nur-icon klein" :aria-label="t('Kopieren', 'Copy')" @click="zielKopieren"><Ico :n="kopiert ? 'check' : 'copy'" /></button></li>
        <li>{{ t('Bei „Install connector“ den langen Wert hinter --token kopieren und unten einfügen.', 'At “Install connector” copy the long value after --token and paste it below.') }}</li>
      </ol>
      <ol v-else class="schritte">
        <li>{{ t('dash.cloudflare.com → Profil → API-Tokens → „Create Token“ → „Custom token“.', 'dash.cloudflare.com → Profile → API Tokens → “Create Token” → “Custom token”.') }} <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener">{{ t('Öffnen', 'Open') }} <Ico n="external" /></a></li>
        <li>{{ t('Rechte: „Account → Cloudflare Tunnel → Edit“ und „Zone → DNS → Edit“ (für die Zone deiner Domain).', 'Permissions: “Account → Cloudflare Tunnel → Edit” and “Zone → DNS → Edit” (for your domain’s zone).') }}</li>
        <li>{{ t('Token und Domain unten einfügen — VylarisCloud erledigt Tunnel, Weiterleitung und DNS-Eintrag.', 'Paste the token and domain below — VylarisCloud takes care of tunnel, routing and DNS record.') }}</li>
      </ol>
      <form class="formular" @submit.prevent="starten">
        <label class="feld"><span>Domain</span><input v-model="f.domain" class="eingabe mono" placeholder="cloud.deinefirma.de" spellcheck="false" autocomplete="off" required></label>
        <label v-if="f.modus === 'token'" class="feld"><span>{{ t('Tunnel-Token', 'Tunnel token') }}</span><input v-model="f.token" class="eingabe mono" type="password" placeholder="eyJhIjoi…" autocomplete="off" spellcheck="false" required></label>
        <template v-else>
          <label class="feld"><span>{{ t('Cloudflare-API-Token', 'Cloudflare API token') }}</span><input v-model="f.apiToken" class="eingabe mono" type="password" :placeholder="tz.auto ? t('gespeichert — leer lassen zum Behalten', 'saved — leave empty to keep') : ''" autocomplete="off" spellcheck="false" :required="!tz.auto"></label>
          <label class="haken"><input v-model="f.ueberschreiben" type="checkbox"> {{ t('Vorhandenen DNS-Eintrag für die Domain ersetzen', 'Replace an existing DNS record for the domain') }}</label>
        </template>
        <div class="reihe">
          <button class="knopf rot" :disabled="laeuft || !tz.dienst"><Ico :n="laeuft ? 'loader' : 'wolke'" :spin="laeuft" /> {{ f.modus === 'auto' ? t('Einrichten & starten', 'Set up & start') : t('Tunnel starten', 'Start tunnel') }}</button>
          <button v-if="tz.auto" type="button" class="knopf" @click="abbauen"><Ico n="trash" /> {{ t('Bei Cloudflare abbauen', 'Remove at Cloudflare') }}</button>
        </div>
        <p class="sehrleise klein">{{ t('Solange der Tunnel läuft, zeigen alle Links auf https://Domain. Beim Ausschalten gilt wieder deine bisherige Einstellung.', 'While the tunnel runs, all links point to https://domain. When turned off, your previous setting applies again.') }}</p>
      </form>
    </template>
  </div>
</template>

<style scoped>
h3 {
  display: inline-flex;
  gap: 8px;
  align-items: center;
}
h3 svg {
  width: 17px;
  height: 17px;
  color: var(--a);
}
.klein {
  font-size: 12.5px;
  margin: 2px 0 12px;
}
.aktiv {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  background: var(--ok-bg);
  border-radius: 12px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.aktiv small {
  display: block;
  font-size: 11px;
  color: var(--text3);
}
.aktiv a {
  font-size: 14px;
  color: var(--text);
  text-decoration: none;
  display: inline-flex;
  gap: 6px;
  align-items: center;
}
.aktiv a svg {
  width: 13px;
  height: 13px;
}
.wege {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 12px;
}
.wege button {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  text-align: left;
  border: 1.5px solid var(--linie);
  background: var(--bg);
  border-radius: 12px;
  padding: 10px 12px;
  cursor: pointer;
  font: inherit;
  color: var(--text);
  transition:
    border-color 0.2s,
    background 0.2s;
}
.wege button.an {
  border-color: var(--a);
  background: rgba(var(--a-rgb), 0.06);
}
.wege svg {
  width: 16px;
  height: 16px;
  margin-top: 2px;
  color: var(--text3);
  flex-shrink: 0;
}
.wege button.an svg {
  color: var(--a);
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
  margin: 0 0 12px;
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
.schritte .knopf {
  vertical-align: middle;
}
.formular {
  display: flex;
  flex-direction: column;
}
.haken {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12.5px;
  color: var(--text2);
  margin: -4px 0 14px;
  cursor: pointer;
}
@media (max-width: 720px) {
  .wege {
    grid-template-columns: 1fr;
  }
}
</style>
