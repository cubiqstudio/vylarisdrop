<script setup lang="ts">
useHead({ title: () => 'System' })
const theme = useTheme()
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const istInhaber = computed(() => theme.value.user?.role === 'owner')
const stunden = ref(1)
const { data, refresh, pending } = await (useFetch as any)(() => `/api/system/monitoring?stunden=${stunden.value}`, {
  key: 'monitoring',
  watch: [stunden]
})
// Live: nur die Speicherzahlen (Dateien/Belegung) reagieren auf Datei-Meldungen, höchstens alle 10 s; sonst wie bisher alle
// 30 s (nur bei sichtbarem Tab). Fehler bleiben still, die Kacheln behalten ihre Werte und werden nicht abgedunkelt.
useLiveDaten({
  daten: [{ schluessel: 'monitoring', url: () => `/api/system/monitoring?stunden=${stunden.value}` }],
  themen: ['dateien', 'papierkorb'],
  mind: 10_000,
  intervall: 30_000
})
const z = computed<any>(() => data.value?.zustand)
const v = computed<any[]>(() => data.value?.verlauf || [])
const reihe = (k: string) => v.value.map((p) => ({ zeit: p.zeit, wert: p[k] }))
const letzte = computed(() => v.value[v.value.length - 1] || null)
const fehlerQuote = computed(() => {
  const n = v.value.reduce((a, p) => a + p.anfragen, 0),
    f = v.value.reduce((a, p) => a + p.f5, 0)
  return n ? (f / n) * 100 : 0
})
const plattePz = computed(() => (z.value?.platte?.gesamt ? (z.value.platte.frei / z.value.platte.gesamt) * 100 : null))
const ZEITEN = computed(() => [
  { v: 1, t: t('1 Std.', '1 h') },
  { v: 6, t: t('6 Std.', '6 h') },
  { v: 24, t: t('24 Std.', '24 h') },
  { v: 168, t: t('7 Tage', '7 days') }
])
const proMin = computed(() =>
  stunden.value > 24 ? t('Ø pro Minute, stündlich', 'avg per minute, hourly') : t('pro Minute', 'per minute')
)

const zeigeToken = ref(false)
const kopiert = ref('')
async function kopie(k: string, s: string) {
  if (await kopieren(s)) {
    kopiert.value = k
    setTimeout(() => {
      if (kopiert.value === k) kopiert.value = ''
    }, 1500)
  }
}
async function tokenNeu() {
  const los = async () => {
    try {
      await api('/api/system/monitoring', { method: 'POST', body: { token_neu: true } })
      await refresh()
      zeigeToken.value = true
      ok(t('Token erstellt', 'Token created'))
    } catch (e: any) {
      fehler(e.message)
    }
  }
  if (!data.value?.token) return los()
  bestaetigen(
    t('Neues Token?', 'New token?'),
    t(
      'Prometheus kommt mit dem alten Token sofort nicht mehr herein — trage das neue in die prometheus.yml ein.',
      'Prometheus will be locked out with the old token immediately — put the new one into prometheus.yml.'
    ),
    t('Erneuern', 'Renew'),
    los
  )
}
const scrape = computed(() => {
  const u = data.value?.metrikUrl ? new URL(data.value.metrikUrl) : null
  return u
    ? `scrape_configs:
  - job_name: vylariscloud
    scheme: ${u.protocol.replace(':', '')}
    metrics_path: /metrics
    authorization:
      credentials: ${zeigeToken.value && data.value.token ? data.value.token : 'vdm_…'}
    static_configs:
      - targets: ['${u.host}']`
    : ''
})
const w = reactive({ platteProzent: 10, fehlerProzent: 5, warteschlange: 200, aus: false })
watch(
  data,
  (d) => {
    if (d?.warnungen) Object.assign(w, d.warnungen, { aus: !!d.aus })
  },
  { immediate: true }
)
async function warnSpeichern() {
  try {
    await api('/api/system/monitoring', {
      method: 'POST',
      body: {
        warnungen: {
          platteProzent: Number(w.platteProzent),
          fehlerProzent: Number(w.fehlerProzent),
          warteschlange: Number(w.warteschlange)
        },
        aus: w.aus
      }
    })
    ok(t('Gespeichert', 'Saved'))
  } catch (e: any) {
    fehler(e.message)
  }
}
const ms = (n: number) => `${zahl(n)} ms`
const pz = (n: number) => `${zahl(n, 1)} %`
</script>

<template>
  <section class="rein">
    <div class="kopf"><div><div class="eyebrow"><Ico n="krone" /> Pro</div><h1>System</h1>
      <p>{{ t('Last, Fehler und Ressourcen aller Server — mit Prometheus- und Grafana-Anbindung.', 'Load, errors and resources of all servers — with Prometheus and Grafana integration.') }}</p></div>
      <div v-if="data?.pro" class="zeitraum" role="group" :aria-label="t('Zeitraum', 'Period')"><button v-for="x in ZEITEN" :key="x.v" type="button" :class="{ an: stunden === x.v }" :aria-pressed="stunden === x.v" @click="stunden = x.v">{{ x.t }}</button></div>
    </div>

    <VdProSperre v-if="data && !data.pro" ic="gauge" :titel="t('Monitoring', 'Monitoring')" :text="t('Sieh, wie es deinen Servern geht — und erfahre es, bevor es Nutzer merken.', 'See how your servers are doing — and know before your users notice.')"
      :punkte="[t('Verläufe für Anfragen, Fehler, Antwortzeit, CPU und Arbeitsspeicher', 'Charts for requests, errors, response time, CPU and memory'), t('Prometheus-Endpunkt und fertiges Grafana-Dashboard', 'Prometheus endpoint and a ready Grafana dashboard'), t('Warnungen bei voller Platte, vielen Fehlern oder Stau', 'Alerts for a full disk, many errors or a backlog')]" />

    <template v-else-if="z">
      <div class="kacheln" :class="{ laedt: pending }">
        <div class="kachel"><small>{{ t('Anfragen', 'Requests') }}</small><b class="mono">{{ letzte ? zahl(letzte.anfragen, letzte.anfragen < 10 ? 1 : 0) : '—' }}</b><span>{{ t('pro Minute, zuletzt', 'per minute, latest') }}</span></div>
        <div :class="['kachel', { rot: fehlerQuote > (data.warnungen?.fehlerProzent || 5) }]"><small>{{ t('Server-Fehler', 'Server errors') }}</small><b class="mono">{{ pz(fehlerQuote) }}</b><span>{{ t('der Anfragen im Zeitraum', 'of requests in the period') }}</span></div>
        <div class="kachel"><small>{{ t('Antwortzeit', 'Response time') }}</small><b class="mono">{{ letzte ? ms(letzte.ms) : '—' }}</b><span>{{ t('Durchschnitt, zuletzt', 'average, latest') }}</span></div>
        <div :class="['kachel', { rot: plattePz != null && plattePz < (data.warnungen?.platteProzent || 10) }]"><small>{{ t('Platte frei', 'Disk free') }}</small><b class="mono">{{ plattePz == null ? '—' : pz(plattePz) }}</b><span>{{ z.platte ? `${groesse(z.platte.frei)} / ${groesse(z.platte.gesamt)}` : t('S3 oder unbekannt', 'S3 or unknown') }}</span></div>
        <div class="kachel"><small>{{ t('Dateien', 'Files') }}</small><b class="mono">{{ zahl(z.dateien) }}</b><span>{{ groesse(z.bytes) }}{{ z.bytesS3 ? ` · ${groesse(z.bytesS3)} S3` : '' }}</span></div>
        <div class="kachel"><small>{{ t('Datenbank', 'Database') }}</small><b class="mono">{{ groesse(z.db.bytes) }}</b><span>{{ t(`${Object.values(z.db.verbindungen).reduce((a: number, b: any) => a + b, 0)} Verbindungen`, `${Object.values(z.db.verbindungen).reduce((a: number, b: any) => a + b, 0)} connections`) }}</span></div>
      </div>

      <div class="diagramme">
        <div class="block"><h4>{{ t('Anfragen', 'Requests') }} <small>{{ proMin }}</small></h4><VdLinie :punkte="reihe('anfragen')" /></div>
        <div class="block"><h4>{{ t('Server-Fehler (5xx)', 'Server errors (5xx)') }} <small>{{ t('Anzahl', 'count') }}</small></h4><VdLinie :punkte="reihe('f5')" ton="rot" /></div>
        <div class="block"><h4>{{ t('Antwortzeit', 'Response time') }} <small>{{ t('Durchschnitt', 'average') }}</small></h4><VdLinie :punkte="reihe('ms')" :format="ms" /></div>
        <div class="block"><h4>{{ t('Arbeitsspeicher', 'Memory') }} <small>{{ t('alle Server', 'all servers') }}</small></h4><VdLinie :punkte="reihe('ram')" :format="groesse" /></div>
        <div class="block"><h4>CPU <small>{{ t('Ø je Server, 100 % = ein Kern', 'avg per server, 100 % = one core') }}</small></h4><VdLinie :punkte="reihe('cpu')" :format="pz" /></div>
        <div class="block"><h4>{{ t('Event-Loop-Verzögerung', 'Event loop delay') }} <small>p99</small></h4><VdLinie :punkte="reihe('schleife')" :format="ms" /></div>
      </div>

      <div class="zwei">
        <div class="block">
          <h3>{{ t('Warteschlangen', 'Queues') }}</h3>
          <div v-for="(n, k) in z.warteschlangen" :key="k" class="schlange">
            <span>{{ ({ medien: t('Vorschaubilder', 'Previews'), virenscan: t('Virenscan', 'Virus scan'), webhooks: 'Webhooks' } as any)[k] }}</span>
            <span class="mono">{{ zahl(n as number) }}</span>
            <i class="balken"><i :style="{ width: Math.min(100, ((n as number) / Math.max(1, data.warnungen?.warteschlange || 200)) * 100) + '%' }"></i></i>
          </div>
          <p class="sehrleise klein">{{ t(`Warnung ab ${data.warnungen?.warteschlange} wartenden Aufgaben.`, `Alert from ${data.warnungen?.warteschlange} waiting jobs.`) }}</p>
        </div>
        <div class="block">
          <h3>Server</h3>
          <div v-for="k in z.knoten" :key="k.id" class="server-zeile">
            <span :class="['zustand', { an: k.lebt }]"></span><b>{{ k.name }}</b><span class="mono sehrleise">{{ k.version }}</span>
            <span class="sehrleise klein rechts">{{ k.lebt ? t('läuft', 'running') : t(`still seit ${vorher(k.zuletzt_at)}`, `silent since ${vorher(k.zuletzt_at)}`) }}</span>
          </div>
          <p class="sehrleise klein">{{ t(`Lizenz ${z.lizenz ? 'aktiv' : 'inaktiv'} · ClamAV ${z.clamav ? 'erreichbar' : 'aus'} · ${zahl(z.konten)} Konten`, `Licence ${z.lizenz ? 'active' : 'inactive'} · ClamAV ${z.clamav ? 'reachable' : 'off'} · ${zahl(z.konten)} accounts`) }}</p>
        </div>
      </div>

      <div v-if="istInhaber" class="zwei">
        <div class="block">
          <div class="reihe zw"><h3>Prometheus</h3><a href="/api/system/grafana.json" class="knopf klein"><Ico n="download" /> {{ t('Grafana-Dashboard', 'Grafana dashboard') }}</a></div>
          <p class="leise klein">{{ t('Jeder Server liefert unter /metrics seine eigenen Zähler plus die gemeinsamen Werte. Bei mehreren Servern jeden einzeln abfragen.', 'Each server serves its own counters plus the shared values at /metrics. With several servers, scrape each one.') }}</p>
          <template v-if="data.token">
            <div class="feldzeile"><span class="etikett">URL</span><code class="mono">{{ data.metrikUrl }}</code><button class="knopf nur-icon" :aria-label="t('Kopieren', 'Copy')" @click="kopie('url', data.metrikUrl)"><Ico :n="kopiert === 'url' ? 'check' : 'copy'" /></button></div>
            <div class="feldzeile"><span class="etikett">Token</span><code class="mono">{{ zeigeToken ? data.token : 'vdm_' + '•'.repeat(20) }}</code>
              <button class="knopf nur-icon" :aria-label="t('Zeigen', 'Show')" @click="zeigeToken = !zeigeToken"><Ico :n="zeigeToken ? 'lock' : 'eye'" /></button>
              <button class="knopf nur-icon" :aria-label="t('Kopieren', 'Copy')" @click="kopie('token', data.token)"><Ico :n="kopiert === 'token' ? 'check' : 'copy'" /></button>
              <button class="knopf nur-icon" :aria-label="t('Erneuern', 'Renew')" @click="tokenNeu"><Ico n="undo" /></button></div>
            <pre class="mono scrape">{{ scrape }}</pre>
            <button class="knopf klein" @click="kopie('scrape', scrape)"><Ico :n="kopiert === 'scrape' ? 'check' : 'copy'" /> {{ t('prometheus.yml kopieren', 'Copy prometheus.yml') }}</button>
          </template>
          <button v-else class="knopf rot" @click="tokenNeu"><Ico n="key" /> {{ t('Zugang einrichten', 'Set up access') }}</button>
        </div>
        <form class="block" @submit.prevent="warnSpeichern">
          <h3>{{ t('Warnungen', 'Alerts') }}</h3>
          <p class="leise klein">{{ t('Per E-Mail oder Discord an den Inhaber (Einstellungen → Benachrichtigungen), höchstens alle 6 Stunden je Art. Ein ausgefallener Server meldet sich immer.', 'By e-mail or Discord to the owner (Settings → Notifications), at most every 6 hours per kind. A server going down always alerts.') }}</p>
          <label class="feld"><span>{{ t('Platte frei unter (%)', 'Disk free below (%)') }}</span><input v-model.number="w.platteProzent" class="eingabe" type="number" min="1" max="50"></label>
          <label class="feld"><span>{{ t('Server-Fehler über (% in 15 min)', 'Server errors above (% in 15 min)') }}</span><input v-model.number="w.fehlerProzent" class="eingabe" type="number" min="0.1" max="100" step="0.1"></label>
          <label class="feld"><span>{{ t('Wartende Aufgaben über', 'Waiting jobs above') }}</span><input v-model.number="w.warteschlange" class="eingabe" type="number" min="10"></label>
          <label class="frage-opt"><button type="button" :class="['schalter', { an: !w.aus }]" role="switch" :aria-checked="!w.aus" @click="w.aus = !w.aus"></button><span><b>{{ t('Warnungen schicken', 'Send alerts') }}</b></span></label>
          <button class="knopf rot">{{ t('Speichern', 'Save') }}</button>
        </form>
      </div>
    </template>
  </section>
</template>

<style scoped>
.zeitraum {
  display: inline-flex;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 11px;
  padding: 3px;
  gap: 2px;
}
.zeitraum button {
  border: 0;
  background: transparent;
  color: var(--text2);
  font: inherit;
  font-size: 12.5px;
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
}
.zeitraum button.an {
  background: var(--flaeche2);
  color: var(--text);
  font-weight: 600;
}
.kacheln {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
  transition: opacity 0.2s;
}
.kacheln.laedt {
  opacity: 0.7;
}
.kachel {
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 14px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  animation: rein 0.45s var(--kurve) backwards;
}
.kachel small {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text3);
  font-weight: 600;
}
.kachel b {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--text);
}
.kachel span {
  font-size: 12px;
  color: var(--text3);
}
.kachel.rot {
  border-color: var(--rot);
  background: var(--rot-bg);
}
.kachel.rot b {
  color: var(--rot);
}
.diagramme {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.diagramme .block + .block,
.zwei .block + .block {
  margin-top: 0;
}
h4 {
  margin: 0 0 18px;
  font-size: 13.5px;
}
h4 small {
  font-weight: 400;
  color: var(--text3);
  font-size: 12px;
  margin-left: 6px;
}
.zwei {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 14px;
  align-items: start;
}
.schlange {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 10px;
  align-items: center;
  font-size: 13px;
  margin-bottom: 10px;
}
.balken {
  grid-column: 1 / -1;
  height: 6px;
  border-radius: 99px;
  background: var(--flaeche2);
  overflow: hidden;
  display: block;
}
.balken i {
  display: block;
  height: 100%;
  background: var(--a);
  border-radius: 99px;
  transition: width 0.5s var(--kurve);
}
.server-zeile {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--linie);
  font-size: 13px;
}
.server-zeile .rechts {
  margin-left: auto;
}
.zustand {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--rot);
  flex-shrink: 0;
}
.zustand.an {
  background: var(--ok);
  box-shadow: 0 0 0 3px var(--ok-bg);
}
.klein {
  font-size: 12px;
  margin: 8px 0 0;
}
.feldzeile {
  display: flex;
  gap: 6px;
  align-items: center;
  border: 1px solid var(--linie);
  background: var(--bg);
  border-radius: 10px;
  padding: 4px 4px 4px 12px;
  margin-top: 10px;
}
.feldzeile code {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.etikett {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text3);
  width: 50px;
  flex-shrink: 0;
}
.scrape {
  background: var(--bg);
  border: 1px solid var(--linie);
  border-radius: 10px;
  padding: 12px;
  font-size: 12px;
  margin: 10px 0;
  overflow-x: auto;
}
.frage-opt {
  display: flex;
  gap: 12px;
  align-items: center;
  cursor: pointer;
  margin: 4px 0 14px;
}
@media (max-width: 860px) {
  .zwei {
    grid-template-columns: 1fr;
  }
  .diagramme {
    grid-template-columns: 1fr;
  }
}
</style>
