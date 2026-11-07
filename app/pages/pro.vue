<script setup lang="ts">
useHead({ title: () => t('Pro & Lizenz', 'Pro & licence') })
const theme = useTheme()
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const istInhaber = computed(() => theme.value.user?.role === 'owner')
const { data, refresh } = await (useFetch as any)('/api/pro', { key: 'pro' })
const l = computed<any>(() => data.value?.lizenz || null)
const pro = computed(() => !!data.value?.pro)

const FUNKTIONEN = computed(() => [
  {
    k: 'multi-server',
    ic: 'knoten',
    zu: '/server',
    titel: t('Mehrere Server', 'Multiple servers'),
    text: t(
      'Mehrere VylarisCloud-Container teilen sich eine Datenbank und die Arbeit — für Last und Ausfallsicherheit.',
      'Several VylarisCloud containers share one database and the work — for load and redundancy.'
    )
  },
  {
    k: 's3',
    ic: 'wolke',
    zu: '/server',
    titel: t('S3-Speicher', 'S3 storage'),
    text: t(
      'Dateien bei AWS, Cloudflare R2, Backblaze, Wasabi, Hetzner oder MinIO — mit Umzug per Klick.',
      'Files on AWS, Cloudflare R2, Backblaze, Wasabi, Hetzner or MinIO — moved over in one click.'
    )
  },
  {
    k: 'teams',
    ic: 'users',
    zu: '/teams',
    titel: t('Teams & Rollen', 'Teams & roles'),
    text: t(
      'Team-Ordner für gemeinsame Dateien, eigene Rollen mit Rechten und Grenzen.',
      'Team folders for shared files, custom roles with rights and limits.'
    )
  },
  {
    k: 'sso',
    ic: 'tuer',
    zu: '/sso',
    titel: t('Anmeldung über SSO', 'Single sign-on'),
    text: t(
      'OpenID Connect (Authentik, Keycloak …), Google, Microsoft, GitHub und Discord.',
      'OpenID Connect (Authentik, Keycloak …), Google, Microsoft, GitHub and Discord.'
    )
  },
  {
    k: 'sicherung',
    ic: 'database',
    zu: '/sicherung',
    titel: t('Sicherung per Knopf', 'One-click backup'),
    text: t(
      'Alles in einer ZIP-Datei — Datenbank und Dateien, lokal wie S3. Auf jedem Server wiederherstellbar.',
      'Everything in one ZIP file — database and files, local or S3. Restorable on any server.'
    )
  },
  {
    k: 'monitoring',
    ic: 'gauge',
    zu: '/system',
    titel: 'Monitoring',
    text: t(
      'Verläufe für Last und Fehler, Prometheus-Endpunkt, Grafana-Vorlage und Warnungen.',
      'Charts for load and errors, Prometheus endpoint, Grafana template and alerts.'
    )
  },
  {
    k: 'traffic',
    ic: 'download',
    zu: '/statistik',
    titel: t('Traffic & Grenzen', 'Traffic & limits'),
    text: t(
      'Ausgelieferte Datenmenge pro Tag und Datei, monatliche Grenzen pro Konto oder Rolle mit Warnung.',
      'Delivered data per day and file, monthly limits per account or role with warnings.'
    )
  },
  {
    k: 'white-label',
    ic: 'palette',
    zu: '/marke',
    titel: t('Eigene Marke', 'Own branding'),
    text: t(
      'Eigenes Logo und Symbol, eigener Anmeldetext, ohne VylarisCloud-Hinweis.',
      'Own logo and icon, own sign-in text, no VylarisCloud notice.'
    )
  }
])

const schluessel = ref('')
const laeuft = ref('')
const frisch = ref(false)
async function aktion(body: Record<string, any>, text: string) {
  laeuft.value = body.aktion
  try {
    const r = await api('/api/pro/lizenz', { method: 'POST', body })
    data.value = r
    theme.value = { ...theme.value, ...(await api('/api/public/theme')) }
    if (body.aktion === 'aktivieren' || body.aktion === 'offline') {
      frisch.value = true
      schluessel.value = ''
      setTimeout(() => {
        frisch.value = false
      }, 2400)
    }
    ok(text)
  } catch (e: any) {
    fehler(e.message)
  } finally {
    laeuft.value = ''
  }
}
const aktivieren = () =>
  aktion({ aktion: 'aktivieren', schluessel: schluessel.value }, t('Pro ist freigeschaltet', 'Pro is unlocked'))
const pruefen = () => aktion({ aktion: 'pruefen' }, t('Lizenz geprüft', 'Licence checked'))
function entfernen() {
  bestaetigen(
    t('Lizenz lösen?', 'Release licence?'),
    t(
      'Die Pro-Funktionen werden abgeschaltet und der Geräteplatz beim Lizenzserver frei. Einstellungen, Team-Ordner und S3-Dateien bleiben erhalten.',
      'The Pro features are switched off and the device slot on the licence server is released. Settings, team folders and S3 files are kept.'
    ),
    t('Lösen', 'Release'),
    async () => {
      await aktion({ aktion: 'entfernen' }, t('Lizenz gelöst', 'Licence released'))
    }
  )
}
const dateiFeld = ref<HTMLInputElement | null>(null)
const zieht = ref(false)
async function offlineLesen(f?: File | null) {
  if (!f) return
  if (f.size > 30_000)
    return fehler(t('Das ist keine Lizenzdatei (zu groß).', 'That is not a licence file (too large).'))
  await aktion(
    { aktion: 'offline', datei: await f.text() },
    t('Offline-Lizenz eingespielt', 'Offline licence installed')
  )
}
function abgelegt(e: DragEvent) {
  zieht.value = false
  void offlineLesen(e.dataTransfer?.files?.[0])
}

const STATUS = computed(() => {
  const s = l.value
  if (!s) return { text: t('Free-Edition', 'Free edition'), art: 'neutral' }
  if (s.art === 'offline')
    return pro.value
      ? { text: t('Pro · offline', 'Pro · offline'), art: 'ok' }
      : { text: t('Offline-Lizenz abgelaufen', 'Offline licence expired'), art: 'rot' }
  return (
    (
      {
        aktiv: { text: t('Pro aktiv', 'Pro active'), art: 'ok' },
        kulanz: { text: t('Lizenzserver nicht erreichbar', 'Licence server unreachable'), art: 'warn' },
        ungueltig: { text: t('Lizenz ungültig', 'Licence invalid'), art: 'rot' },
        abgelaufen: { text: t('Kulanzzeit vorbei', 'Grace period over'), art: 'rot' }
      } as any
    )[s.status] || { text: s.status, art: 'neutral' }
  )
})
const kopiert = ref(false)
async function idKopieren() {
  if (await kopieren(data.value?.geraeteId || '')) {
    kopiert.value = true
    setTimeout(() => {
      kopiert.value = false
    }, 1600)
  }
}
</script>

<template>
  <section class="rein">
    <div class="kopf">
      <div>
        <div class="eyebrow"><Ico n="krone" /> Pro</div>
        <h1>{{ t('Pro & Lizenz', 'Pro & licence') }}</h1>
        <p>
          {{
            t(
              'VylarisCloud bleibt ohne Lizenz voll nutzbar. Pro schaltet fünf Funktionen für Teams, Firmen und größere Installationen frei.',
              'VylarisCloud stays fully usable without a licence. Pro unlocks five features for teams, companies and larger installations.'
            )
          }}
        </p>
      </div>
    </div>

    <div :class="['oben', { einzeln: pro }]">
      <div :class="['stand', { an: pro }]">
        <div class="ring" aria-hidden="true"><span></span><Ico n="krone" /></div>
        <div class="stand-text">
          <span :class="['chip', STATUS.art]">{{ STATUS.text }}</span>
          <h2>{{ pro ? l?.plan || 'Pro' : 'Free' }}</h2>
          <dl v-if="l">
            <div>
              <dt>{{ t('Schlüssel', 'Key') }}</dt>
              <dd class="mono">{{ l.schluessel || '—' }}</dd>
            </div>
            <div>
              <dt>{{ t('Gültig bis', 'Valid until') }}</dt>
              <dd>{{ l.ablauf ? datum(l.ablauf) : t('lebenslang', 'lifetime') }}</dd>
            </div>
            <div v-if="l.art === 'online'">
              <dt>{{ t('Installationen', 'Installations') }}</dt>
              <dd class="zahl">{{ l.geraete }} / {{ l.maxGeraete }}</dd>
            </div>
            <div v-if="l.art === 'offline'">
              <dt>{{ t('Datei gilt bis', 'File valid until') }}</dt>
              <dd>{{ datum(l.offlineBis) }}</dd>
            </div>
            <div v-else>
              <dt>{{ t('Zuletzt geprüft', 'Last checked') }}</dt>
              <dd>{{ l.zuletztOk ? vorher(new Date(l.zuletztOk).toISOString()) : '—' }}</dd>
            </div>
          </dl>
          <p v-if="l?.meldung" class="hinweis" :class="{ warn: l.status === 'kulanz' }">
            <Ico n="alert" /> {{ l.meldung
            }}<template v-if="l.kulanzBis">
              {{
                t(`Pro bleibt bis ${zeitpunkt(l.kulanzBis)} an.`, `Pro stays on until ${zeitpunkt(l.kulanzBis)}.`)
              }}</template
            >
          </p>
          <div v-if="l && istInhaber" class="reihe">
            <button v-if="l.art === 'online'" class="knopf klein" :disabled="!!laeuft" @click="pruefen">
              <Ico :n="laeuft === 'pruefen' ? 'loader' : 'drehenr'" :spin="laeuft === 'pruefen'" />
              {{ t('Jetzt prüfen', 'Check now') }}
            </button>
            <button class="knopf klein gefahr" :disabled="!!laeuft" @click="entfernen">
              <Ico n="x" /> {{ t('Lizenz lösen', 'Release licence') }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="istInhaber && (!l || !pro)" class="block aktiv">
        <h3>{{ t('Lizenzschlüssel eingeben', 'Enter licence key') }}</h3>
        <p class="leise klein">
          {{
            t(
              'Die Installation meldet sich beim Lizenzserver an und prüft danach alle 6 Stunden. Ist er einmal nicht erreichbar, läuft Pro 7 Tage weiter.',
              'The installation registers with the licence server and checks every 6 hours. If it is unreachable for a while, Pro keeps running for 7 days.'
            )
          }}
        </p>
        <form class="schl" @submit.prevent="aktivieren">
          <input
            v-model="schluessel"
            class="eingabe mono"
            placeholder="VD-XXXX-XXXX-XXXX"
            autocomplete="off"
            spellcheck="false"
            maxlength="80"
            required
            :aria-label="t('Lizenzschlüssel', 'Licence key')"
          />
          <button class="knopf rot" :disabled="!!laeuft">
            <Ico :n="laeuft === 'aktivieren' ? 'loader' : 'key'" :spin="laeuft === 'aktivieren'" />
            {{ t('Aktivieren', 'Activate') }}
          </button>
        </form>
        <div
          :class="['offline', { zieht }]"
          @dragover.prevent="zieht = true"
          @dragleave="zieht = false"
          @drop.prevent="abgelegt"
        >
          <Ico n="datei" />
          <div>
            <b>{{ t('Ohne Internet?', 'No internet?') }}</b>
            {{ t('Offline-Lizenzdatei hier hineinziehen oder', 'Drop an offline licence file here or') }}
            <button type="button" class="link" @click="dateiFeld?.click()">{{ t('auswählen', 'choose one') }}</button>.
            <small>{{
              t(
                'Im Lizenz-Portal deines Anbieters mit dieser Geräte-ID erstellen:',
                'Create it in your provider’s licence portal with this device ID:'
              )
            }}</small>
            <button type="button" class="geraet mono" @click="idKopieren">
              {{ data?.geraeteId }} <Ico :n="kopiert ? 'check' : 'copy'" />
            </button>
          </div>
          <input
            ref="dateiFeld"
            type="file"
            accept=".json,application/json,.lic"
            class="versteckt"
            @change="
              (e: any) => {
                offlineLesen(e.target.files?.[0]);
                e.target.value = '';
              }
            "
          />
        </div>
      </div>
      <div v-else-if="!istInhaber && !pro" class="block">
        <p class="leise">
          {{
            t(
              'Eine Lizenz aktiviert der Inhaber dieser Installation.',
              'The owner of this installation activates a licence.'
            )
          }}
        </p>
      </div>
    </div>

    <h3 class="zwischen">{{ t('Was Pro freischaltet', 'What Pro unlocks') }}</h3>
    <div :class="['raster', { frisch }]">
      <NuxtLink
        v-for="(f, i) in FUNKTIONEN"
        :key="f.k"
        :to="f.zu"
        :class="['kachel', { an: data?.funktionen?.[f.k] }]"
        :style="{ '--i': i }"
      >
        <span class="ic"><Ico :n="f.ic" /></span>
        <div>
          <b>{{ f.titel }}</b>
          <p>{{ f.text }}</p>
        </div>
        <span class="zustand"
          ><Ico :n="data?.funktionen?.[f.k] ? 'check' : 'lock'" />
          {{ data?.funktionen?.[f.k] ? t('Aktiv', 'Active') : t('Gesperrt', 'Locked') }}</span
        >
      </NuxtLink>
    </div>
  </section>
</template>

<style scoped>
.oben {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.oben.einzeln {
  grid-template-columns: minmax(0, 1fr);
}
.oben.einzeln dl {
  grid-template-columns: repeat(4, minmax(120px, max-content));
  gap: 10px 44px;
}
.stand {
  position: relative;
  overflow: hidden;
  display: flex;
  gap: 22px;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 20px;
  padding: 24px;
}
.stand.an {
  border-color: rgba(var(--a-rgb), 0.35);
  background: linear-gradient(160deg, rgba(var(--a-rgb), 0.07), var(--flaeche) 55%);
}
.ring {
  position: relative;
  flex-shrink: 0;
  width: 76px;
  height: 76px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--text3);
  background: var(--flaeche2);
}
.ring > svg {
  width: 30px;
  height: 30px;
  position: relative;
}
.ring span {
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 3px solid transparent;
}
.stand.an .ring {
  color: var(--a);
  background: rgba(var(--a-rgb), 0.1);
}
.stand.an .ring span {
  border-color: var(--a) transparent var(--a) transparent;
  animation: drehen 6s linear infinite;
  opacity: 0.55;
}
.stand-text {
  min-width: 0;
  flex: 1;
}
.stand h2 {
  font-family: var(--f-display);
  font-size: 30px;
  letter-spacing: -0.035em;
  margin: 8px 0 12px;
}
dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px 18px;
  margin: 0 0 14px;
}
dt {
  font-size: 11px;
  color: var(--text3);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
}
dd {
  margin: 2px 0 0;
  font-size: 13.5px;
  overflow-wrap: anywhere;
}
.hinweis {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 12.5px;
  color: var(--rot);
  background: var(--rot-bg);
  border-radius: 10px;
  padding: 8px 11px;
  margin: 0 0 14px;
}
.hinweis.warn {
  color: var(--warn);
  background: var(--warn-bg);
}
.hinweis svg {
  width: 14px;
  height: 14px;
  margin-top: 2px;
}
.klein {
  font-size: 12.5px;
  margin: 0 0 14px;
}
.schl {
  display: flex;
  gap: 8px;
}
.schl .eingabe {
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.offline {
  display: flex;
  gap: 12px;
  margin-top: 14px;
  padding: 14px;
  border: 1.5px dashed var(--linie2);
  border-radius: 14px;
  font-size: 13px;
  color: var(--text2);
  transition:
    border-color 0.2s,
    background 0.2s;
}
.offline.zieht {
  border-color: var(--a);
  background: rgba(var(--a-rgb), 0.05);
}
.offline > svg {
  width: 20px;
  height: 20px;
  color: var(--text3);
  flex-shrink: 0;
  margin-top: 2px;
}
.offline b {
  color: var(--text);
}
.offline small {
  display: block;
  margin: 6px 0 4px;
  color: var(--text3);
}
.link {
  border: 0;
  background: none;
  padding: 0;
  color: var(--a);
  cursor: pointer;
  font-weight: 500;
}
.geraet {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  border: 1px solid var(--linie);
  background: var(--bg);
  border-radius: 8px;
  padding: 4px 8px;
  font-size: 11.5px;
  cursor: pointer;
  color: var(--text2);
  max-width: 100%;
  overflow-wrap: anywhere;
  text-align: left;
}
.geraet svg {
  width: 12px;
  height: 12px;
}
.zwischen {
  font-size: 15px;
  margin: 28px 0 12px;
}
.raster {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 12px;
}
.kachel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 16px;
  padding: 18px;
  transition:
    border-color 0.2s,
    transform 0.2s var(--kurve);
}
.kachel:hover {
  transform: translateY(-2px);
  border-color: var(--linie2);
}
.kachel .ic {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: var(--flaeche2);
  color: var(--text3);
  transition:
    background 0.4s,
    color 0.4s;
}
.kachel .ic svg {
  width: 19px;
  height: 19px;
}
.kachel.an .ic {
  background: rgba(var(--a-rgb), 0.12);
  color: var(--a);
}
.kachel b {
  font-size: 14px;
}
.kachel p {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--text2);
}
.zustand {
  margin-top: auto;
  display: inline-flex;
  gap: 6px;
  align-items: center;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text3);
}
.zustand svg {
  width: 13px;
  height: 13px;
}
.kachel.an .zustand {
  color: var(--ok);
}
.frisch .kachel.an {
  animation: aufleuchten 1s var(--kurve) backwards;
  animation-delay: calc(var(--i) * 120ms);
}
@keyframes aufleuchten {
  0% {
    border-color: var(--linie);
    box-shadow: 0 0 0 0 rgba(var(--a-rgb), 0);
  }
  40% {
    border-color: var(--a);
    box-shadow: 0 0 0 6px rgba(var(--a-rgb), 0.12);
  }
}
@media (max-width: 960px) {
  .oben {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 560px) {
  .stand {
    flex-direction: column;
  }
  .schl {
    flex-direction: column;
  }
}
</style>
