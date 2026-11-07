<script setup lang="ts">
useHead({ title: () => t('Speicher & Server', 'Storage & servers') })
const theme = useTheme()
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const istInhaber = computed(() => theme.value.user?.role === 'owner')
const { data: pro } = await (useFetch as any)('/api/pro', { key: 'pro' })
const { data, refresh } = await (useFetch as any)('/api/pro/speicher', { key: 'speicher' })
const s3An = computed(() => !!pro.value?.funktionen?.s3)
const multiAn = computed(() => !!pro.value?.funktionen?.['multi-server'])

const ANBIETER = [
  { k: 'aws', name: 'Amazon S3', endpoint: '', region: 'eu-central-1', pfadStil: false },
  {
    k: 'r2',
    name: 'Cloudflare R2',
    endpoint: 'https://<account-id>.r2.cloudflarestorage.com',
    region: 'auto',
    pfadStil: false
  },
  {
    k: 'b2',
    name: 'Backblaze B2',
    endpoint: 'https://s3.eu-central-003.backblazeb2.com',
    region: 'eu-central-003',
    pfadStil: false
  },
  {
    k: 'wasabi',
    name: 'Wasabi',
    endpoint: 'https://s3.eu-central-1.wasabisys.com',
    region: 'eu-central-1',
    pfadStil: false
  },
  { k: 'hetzner', name: 'Hetzner', endpoint: 'https://fsn1.your-objectstorage.com', region: 'fsn1', pfadStil: false },
  { k: 'minio', name: 'MinIO / Garage', endpoint: 'http://minio:9000', region: 'us-east-1', pfadStil: true },
  { k: 'andere', name: t('Anderer Anbieter', 'Other provider'), endpoint: '', region: '', pfadStil: false }
]
const f = reactive({
  art: 'lokal',
  anbieter: 'andere',
  endpoint: '',
  region: '',
  bucket: '',
  zugang: '',
  geheim: '',
  pfadStil: false,
  praefix: ''
})
let formGefuellt = false
watch(
  data,
  (d) => {
    if (!d || formGefuellt) return
    formGefuellt = true
    f.art = d.art
    if (d.s3)
      Object.assign(f, {
        endpoint: d.s3.endpoint,
        region: d.s3.region,
        bucket: d.s3.bucket,
        zugang: d.s3.zugang,
        geheim: '',
        pfadStil: d.s3.pfadStil,
        praefix: d.s3.praefix
      })
  },
  { immediate: true }
)
function vorlage(k: string) {
  const a = ANBIETER.find((x) => x.k === k)
  if (a && k !== 'andere') Object.assign(f, { endpoint: a.endpoint, region: a.region, pfadStil: a.pfadStil })
}
const s3Body = () => ({
  endpoint: f.endpoint.trim(),
  region: f.region.trim(),
  bucket: f.bucket.trim(),
  zugang: f.zugang.trim(),
  geheim: f.geheim,
  pfadStil: f.pfadStil,
  praefix: f.praefix
})
const test = ref<null | { ok: boolean; meldung: string; ms: number }>(null)
const laeuft = ref('')
async function testen() {
  laeuft.value = 'test'
  test.value = null
  try {
    test.value = await api('/api/pro/speicher', { method: 'POST', body: { aktion: 'testen', s3: s3Body() } })
  } catch (e: any) {
    fehler(e.message)
  } finally {
    laeuft.value = ''
  }
}
async function speichern() {
  laeuft.value = 'speichern'
  try {
    await api('/api/pro/speicher', {
      method: 'POST',
      body: { aktion: 'speichern', art: f.art, ...(f.art === 's3' ? { s3: s3Body() } : {}) }
    })
    formGefuellt = false
    await refresh()
    f.geheim = ''
    ok(
      f.art === 's3'
        ? t('Neue Dateien landen jetzt in S3', 'New files now go to S3')
        : t('Neue Dateien landen jetzt lokal', 'New files now stay local')
    )
  } catch (e: any) {
    fehler(e.message)
  } finally {
    laeuft.value = ''
  }
}

const lokal = computed(() => data.value?.verteilung?.lokal || { anzahl: 0, bytes: 0 })
const s3 = computed(() => data.value?.verteilung?.s3 || { anzahl: 0, bytes: 0 })
const anteilS3 = computed(() => {
  const g = lokal.value.bytes + s3.value.bytes
  return g ? (s3.value.bytes / g) * 100 : 0
})

const umzug = computed<any>(() => data.value?.umzug || null)
const umzugProzent = computed(() =>
  umzug.value?.gesamt ? Math.min(100, ((umzug.value.erledigt + umzug.value.fehler) / umzug.value.gesamt) * 100) : 0
)
function umziehen(ziel: 'lokal' | 's3') {
  const n = ziel === 's3' ? lokal.value.anzahl : s3.value.anzahl
  bestaetigen(
    ziel === 's3'
      ? t('Alle Dateien nach S3 verschieben?', 'Move all files to S3?')
      : t('Alle Dateien zurück auf den Server holen?', 'Bring all files back to the server?'),
    t(
      `${zahl(n)} Dateien werden im Hintergrund kopiert und danach am alten Ort gelöscht. Links bleiben gleich, die Dateien bleiben die ganze Zeit erreichbar.`,
      `${zahl(n)} files are copied in the background and then removed from the old location. Links stay the same and files stay reachable the whole time.`
    ),
    t('Umzug starten', 'Start move'),
    async () => {
      try {
        await api('/api/pro/speicher', { method: 'POST', body: { aktion: 'umzug', ziel } })
        await refresh()
        ok(t('Umzug läuft', 'Move running'))
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}
async function umzugSteuern(was: string) {
  try {
    await api('/api/pro/speicher', { method: 'POST', body: { aktion: 'umzug_steuern', was } })
    await refresh()
  } catch (e: any) {
    fehler(e.message)
  }
}

let uhr: any = null
onMounted(() => {
  const tick = () => {
    uhr = setTimeout(
      async () => {
        await refresh().catch(() => {})
        tick()
      },
      umzug.value?.status === 'laeuft' ? 2000 : 5000
    )
  }
  tick()
})
onBeforeUnmount(() => clearTimeout(uhr))
const knoten = computed<any[]>(() => [...(data.value?.knoten || [])].sort((a, b) => Number(b.lebt) - Number(a.lebt)))
const lebend = computed(() => knoten.value.filter((k) => k.lebt))
const laufzeit = (d: string) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000
  return s < 3600
    ? `${Math.max(1, Math.floor(s / 60))} min`
    : s < 86400
      ? `${Math.floor(s / 3600)} h`
      : `${Math.floor(s / 86400)} d`
}
const warnLokal = computed(() => lebend.value.length > 1 && data.value?.ziel === 'lokal' && !data.value?.ordnerGeteilt)
const warnFree = computed(() => lebend.value.length > 1 && !multiAn.value)
const COMPOSE = `services:
  app:
    image: ghcr.io/cubiqstudio/vylariscloud:latest
    environment:
      NUXT_DB_URL: postgres://vylariscloud:<passwort>@<datenbank-host>:5432/vylariscloud
      VD_NODE_NAME: server-2
    volumes:
      - dateien:/data   # mit lokalem Speicher: dasselbe Laufwerk wie Server 1 (NFS)
    ports:
      - "127.0.0.1:3000:3000"
volumes:
  dateien:`
const kopiert = ref(false)
async function composeKopieren() {
  if (await kopieren(COMPOSE)) {
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
        <div class="eyebrow"><Ico n="knoten" /> Pro</div>
        <h1>{{ t('Speicher & Server', 'Storage & servers') }}</h1>
        <p>
          {{
            t(
              'Wo deine Dateien liegen und welche VylarisCloud-Server gerade arbeiten.',
              'Where your files live and which VylarisCloud servers are working right now.'
            )
          }}
        </p>
      </div>
    </div>

    <div class="block verteilung">
      <div class="reihe zw">
        <h3>{{ t('Ablage', 'Storage') }}</h3>
        <span :class="['chip', data?.ziel === 's3' || data?.ziel?.startsWith('sftp') ? 'info' : 'neutral']"
          ><Ico :n="data?.ziel === 's3' ? 'wolke' : data?.ziel?.startsWith('sftp') ? 'knoten' : 'database'" />
          {{ t('Neue Dateien:', 'New files:') }}
          {{
            data?.ziel === 's3'
              ? 'S3'
              : data?.art === 'pool'
                ? t('Speicher-Pool', 'Storage pool')
              : data?.ziel?.startsWith('sftp')
                ? t('SFTP-Erweiterung', 'SFTP add-on')
                : t('dieser Server', 'this server')
          }}</span
        >
      </div>
      <div class="vt-balken">
        <i class="l" :style="{ width: 100 - anteilS3 + '%' }"></i><i class="s" :style="{ width: anteilS3 + '%' }"></i>
      </div>
      <div class="vt-zahlen">
        <div>
          <span class="punkt l"></span><b>{{ t('Lokal', 'Local') }}</b> {{ zahl(lokal.anzahl) }}
          {{ t('Dateien', 'files') }} · {{ groesse(lokal.bytes)
          }}<small v-if="data?.platte">{{ t('frei:', 'free:') }} {{ groesse(data.platte.frei) }}</small>
        </div>
        <div v-if="data?.pool?.summe?.bekannt">
          <span class="punkt l"></span><b>{{ t('Speicher-Pool', 'Storage pool') }}</b>
          {{ t('frei:', 'free:') }} {{ groesse(data.pool.summe.frei) }} {{ t('von', 'of') }} {{ groesse(data.pool.summe.gesamt) }}
          <small v-if="data.pool.unbekannt">{{ t(`+ ${data.pool.unbekannt} ohne Angabe`, `+ ${data.pool.unbekannt} unknown`) }}</small>
        </div>
        <div>
          <span class="punkt s"></span><b>S3</b> {{ zahl(s3.anzahl) }} {{ t('Dateien', 'files') }} ·
          {{ groesse(s3.bytes) }}<small v-if="data?.s3?.bucket" class="mono">{{ data.s3.bucket }}</small>
        </div>
        <div v-if="data?.verteilung?.sftp?.anzahl">
          <span class="punkt s"></span><b>SFTP</b> {{ zahl(data.verteilung.sftp.anzahl) }} {{ t('Dateien', 'files') }} ·
          {{ groesse(data.verteilung.sftp.bytes) }}
          <small><NuxtLink to="/speicher/ziele">{{ t('Speicher-Erweiterungen', 'Storage add-ons') }}</NuxtLink></small>
        </div>
      </div>
      <div v-if="umzug" class="umzug">
        <div class="reihe zw">
          <b>{{
            umzug.ziel === 's3'
              ? t('Umzug nach S3', 'Moving to S3')
              : umzug.ziel?.startsWith('sftp')
                ? t('Umzug auf eine SFTP-Erweiterung', 'Moving to an SFTP add-on')
                : t('Umzug auf den Server', 'Moving to the server')
          }}</b>
          <span
            :class="['chip', { laeuft: 'info', fertig: 'ok', pausiert: 'warn', fehler: 'rot' }[umzug.status as string]]"
          >
            <Ico v-if="umzug.status === 'laeuft'" n="loader" spin />{{
              {
                laeuft: t('läuft', 'running'),
                fertig: t('fertig', 'done'),
                pausiert: t('pausiert', 'paused'),
                fehler: t('Fehler', 'error')
              }[umzug.status as string]
            }}</span
          >
        </div>
        <div class="u-balken">
          <i :style="{ width: umzugProzent + '%' }" :class="{ laeuft: umzug.status === 'laeuft' }"></i>
        </div>
        <div class="reihe zw klein">
          <span class="zahl"
            >{{ zahl(umzug.erledigt) }} / {{ zahl(umzug.gesamt) }} · {{ groesse(umzug.bytes)
            }}<template v-if="umzug.fehler">
              · <span class="rot">{{ zahl(umzug.fehler) }} {{ t('fehlgeschlagen', 'failed') }}</span></template
            ></span
          >
          <span v-if="istInhaber" class="reihe">
            <button v-if="umzug.status === 'laeuft'" class="knopf klein" @click="umzugSteuern('pausieren')">
              <Ico n="pause" /> {{ t('Pausieren', 'Pause') }}
            </button>
            <button
              v-if="umzug.status === 'pausiert' || umzug.status === 'fehler'"
              class="knopf klein"
              @click="umzugSteuern('fortsetzen')"
            >
              <Ico n="play" /> {{ t('Fortsetzen', 'Resume') }}
            </button>
            <button v-if="umzug.status !== 'laeuft'" class="knopf klein" @click="umzugSteuern('verwerfen')">
              <Ico n="x" /> {{ t('Ausblenden', 'Dismiss') }}
            </button>
          </span>
        </div>
        <p v-if="umzug.meldung" class="rot klein">{{ umzug.meldung }}</p>
        <TransitionGroup v-if="umzug.letzte?.length" tag="ul" name="zeile" class="letzte mono">
          <li v-for="z in umzug.letzte.slice(0, 6)" :key="z.t" :class="{ f: !z.ok }">
            <Ico :n="z.ok ? 'check' : 'x'" /> {{ z.t }}
          </li>
        </TransitionGroup>
      </div>
      <div v-else-if="istInhaber && (lokal.anzahl || s3.anzahl)" class="reihe umzug-knoepfe">
        <button v-if="lokal.anzahl && data?.s3?.bucket && s3An" class="knopf klein" @click="umziehen('s3')">
          <Ico n="wolke" />
          {{ t(`${zahl(lokal.anzahl)} Dateien nach S3 verschieben`, `Move ${zahl(lokal.anzahl)} files to S3`) }}
        </button>
        <button v-if="s3.anzahl" class="knopf klein" @click="umziehen('lokal')">
          <Ico n="download" />
          {{ t(`${zahl(s3.anzahl)} Dateien auf den Server holen`, `Bring ${zahl(s3.anzahl)} files to the server`) }}
        </button>
      </div>
    </div>

    <VdProSperre
      v-if="!s3An"
      ic="wolke"
      :titel="t('S3-Speicher', 'S3 storage')"
      :text="
        t(
          'Lege Dateien bei einem S3-Dienst ab statt auf der Platte dieses Servers — unbegrenzt Platz, und mehrere Server greifen auf dieselben Dateien zu.',
          'Store files with an S3 service instead of on this server\'s disk — unlimited space, and several servers access the same files.'
        )
      "
      :punkte="[
        t(
          'AWS, Cloudflare R2, Backblaze B2, Wasabi, Hetzner, MinIO …',
          'AWS, Cloudflare R2, Backblaze B2, Wasabi, Hetzner, MinIO …'
        ),
        t('Umzug aller Dateien per Klick — Links bleiben gleich', 'Move all files in one click — links stay the same'),
        t('Videos spulen weiter direkt (Teilbereiche)', 'Videos still seek instantly (byte ranges)')
      ]"
    />
    <form v-else class="block s3" @submit.prevent="speichern">
      <div class="reihe zw">
        <h3>{{ t('Wohin mit neuen Dateien?', 'Where do new files go?') }}</h3>
        <span v-if="data?.ausUmgebung" class="chip neutral"
          ><Ico n="lock" /> {{ t('über VD_S3_* festgelegt', 'set via VD_S3_*') }}</span
        >
      </div>
      <div class="wahl">
        <label :class="{ an: f.art === 'lokal' }"
          ><input v-model="f.art" type="radio" value="lokal" :disabled="!istInhaber || data?.ausUmgebung" /><Ico
            n="database"
          /><span
            ><b>{{ t('Dieser Server', 'This server') }}</b
            ><small>{{ t('Ordner /data (Docker-Volume)', 'Folder /data (Docker volume)') }}</small></span
          ></label
        >
        <label :class="{ an: f.art === 's3' }"
          ><input v-model="f.art" type="radio" value="s3" :disabled="!istInhaber || data?.ausUmgebung" /><Ico
            n="wolke"
          /><span
            ><b>S3</b><small>{{ t('Objektspeicher eines Anbieters', "A provider's object storage") }}</small></span
          ></label
        >
      </div>
      <Transition name="aufklappen">
        <div v-if="f.art === 's3'" class="s3-felder">
          <label class="feld"
            ><span>{{ t('Anbieter', 'Provider') }}</span
            ><VdAuswahl
              v-model="f.anbieter"
              class="eingabe"
              :disabled="!istInhaber || data?.ausUmgebung"
              @change="vorlage(f.anbieter)"
              ><option v-for="a in ANBIETER" :key="a.k" :value="a.k">{{ a.name }}</option></VdAuswahl
            ></label
          >
          <div class="zwei">
            <label class="feld"
              ><span>Endpoint</span
              ><input
                v-model="f.endpoint"
                class="eingabe mono"
                :placeholder="t('leer = AWS', 'empty = AWS')"
                :disabled="!istInhaber || data?.ausUmgebung"
            /></label>
            <label class="feld"
              ><span>Region</span
              ><input
                v-model="f.region"
                class="eingabe mono"
                placeholder="auto"
                :disabled="!istInhaber || data?.ausUmgebung"
            /></label>
          </div>
          <div class="zwei">
            <label class="feld"
              ><span>Bucket</span
              ><input v-model="f.bucket" class="eingabe mono" required :disabled="!istInhaber || data?.ausUmgebung"
            /></label>
            <label class="feld"
              ><span>{{ t('Präfix (optional)', 'Prefix (optional)') }}</span
              ><input
                v-model="f.praefix"
                class="eingabe mono"
                placeholder="vylariscloud/"
                :disabled="!istInhaber || data?.ausUmgebung"
            /></label>
          </div>
          <div class="zwei">
            <label class="feld"
              ><span>Access Key</span
              ><input
                v-model="f.zugang"
                class="eingabe mono"
                required
                autocomplete="off"
                :disabled="!istInhaber || data?.ausUmgebung"
            /></label>
            <label class="feld"
              ><span>Secret Key</span
              ><input
                v-model="f.geheim"
                class="eingabe mono"
                type="password"
                autocomplete="new-password"
                :placeholder="data?.s3?.hatGeheim ? t('gespeichert — leer lassen', 'saved — leave empty') : ''"
                :disabled="!istInhaber || data?.ausUmgebung"
            /></label>
          </div>
          <label class="opt"
            ><button
              type="button"
              :class="['schalter', { an: f.pfadStil }]"
              role="switch"
              :aria-checked="f.pfadStil"
              :disabled="!istInhaber || data?.ausUmgebung"
              @click="f.pfadStil = !f.pfadStil"
            ></button
            ><span
              ><b>Path-Style</b
              ><small>{{
                t(
                  'Für MinIO, Garage und manche eigene Server (bucket im Pfad statt in der Domain).',
                  'For MinIO, Garage and some self-hosted servers (bucket in the path instead of the domain).'
                )
              }}</small></span
            ></label
          >
          <Transition name="aufklappen"
            ><div v-if="test" :class="['test', { gut: test.ok }]">
              <Ico :n="test.ok ? 'check' : 'alert'" /> {{ test.meldung }}
              <span class="sehrleise">{{ test.ms }} ms</span>
            </div></Transition
          >
        </div>
      </Transition>
      <div v-if="istInhaber && !data?.ausUmgebung" class="modal-fuss">
        <button v-if="f.art === 's3'" type="button" class="knopf" :disabled="!!laeuft" @click="testen">
          <Ico :n="laeuft === 'test' ? 'loader' : 'network'" :spin="laeuft === 'test'" />
          {{ t('Verbindung testen', 'Test connection') }}
        </button>
        <button class="knopf rot" :disabled="!!laeuft">
          <Ico :n="laeuft === 'speichern' ? 'loader' : 'check'" :spin="laeuft === 'speichern'" />
          {{ t('Speichern', 'Save') }}
        </button>
      </div>
    </form>

    <div class="block">
      <div class="reihe zw">
        <h3>{{ t('Server', 'Servers') }}</h3>
        <span class="chip neutral zahl">{{ lebend.length }} {{ t('aktiv', 'active') }}</span>
      </div>
      <p class="leise klein">
        {{
          t(
            'Jeder VylarisCloud-Container meldet sich hier. Vorschaubilder, Importe und Aufräumen verteilen sich automatisch — nichts läuft doppelt.',
            'Every VylarisCloud container reports here. Previews, imports and cleanup are shared out automatically — nothing runs twice.'
          )
        }}
      </p>
      <div v-if="warnFree" class="hinweis warn">
        <Ico n="alert" />
        {{
          t(
            'Es laufen mehrere Server, aber Multi-Server ist nicht freigeschaltet. Zusätzliche Server pausieren nach 10 Minuten.',
            'Several servers are running, but multi-server is not unlocked. Additional servers pause after 10 minutes.'
          )
        }}
      </div>
      <div v-if="warnLokal" class="hinweis warn">
        <Ico n="alert" />
        {{
          t(
            'Die Server haben verschiedene Datenordner, Dateien liegen aber lokal. Bitte einen gemeinsamen Ordner (NFS) einbinden oder S3 nutzen — sonst findet nicht jeder Server jede Datei.',
            'The servers have different data folders, but files are stored locally. Please mount a shared folder (NFS) or use S3 — otherwise not every server finds every file.'
          )
        }}
      </div>
      <TransitionGroup tag="div" name="zeile" class="knoten">
        <div v-for="k in knoten" :key="k.id" :class="['k', { weg: !k.lebt }]">
          <span
            :class="['puls', { an: k.lebt }]"
            :title="k.lebt ? t('aktiv', 'active') : t('nicht erreichbar', 'unreachable')"
          ></span>
          <div class="k-name">
            <b>{{ k.name }}</b
            ><small class="mono"
              >{{ k.id.slice(0, 8) }}<template v-if="k.ich"> · {{ t('dieser', 'this one') }}</template></small
            >
          </div>
          <span v-if="k.rolle === 'web'" class="chip neutral">{{ t('nur Auslieferung', 'delivery only') }}</span>
          <dl>
            <div>
              <dt>Version</dt>
              <dd>{{ k.version }}</dd>
            </div>
            <div v-if="k.lebt">
              <dt>{{ t('Läuft seit', 'Up for') }}</dt>
              <dd>{{ laufzeit(k.gestartet_at) }}</dd>
            </div>
            <div v-else>
              <dt>{{ t('Zuletzt da', 'Last seen') }}</dt>
              <dd>{{ vorher(k.zuletzt_at) }}</dd>
            </div>
            <div>
              <dt>{{ t('Last', 'Load') }}</dt>
              <dd class="zahl">{{ Number(k.info?.last || 0).toFixed(2) }}</dd>
            </div>
            <div>
              <dt>RAM</dt>
              <dd class="zahl">{{ groesse(k.info?.rss || 0) }}</dd>
            </div>
            <div>
              <dt>{{ t('Arbeitet', 'Working') }}</dt>
              <dd>
                {{
                  (k.info?.arbeit?.medien || 0) + (k.info?.arbeit?.importe || 0) + (k.info?.arbeit?.umzug || 0)
                    ? t('ja', 'yes')
                    : '—'
                }}
              </dd>
            </div>
          </dl>
        </div>
      </TransitionGroup>
      <VdProSperre
        v-if="!multiAn"
        class="klein-sperre"
        ic="knoten"
        :titel="t('Mehrere Server', 'Multiple servers')"
        :text="
          t(
            'Starte weitere VylarisCloud-Container mit derselben Datenbank — für mehr Last und Ausfallsicherheit hinter einem Lastverteiler.',
            'Start more VylarisCloud containers on the same database — for more load and redundancy behind a load balancer.'
          )
        "
        :punkte="[
          t('Arbeit wird automatisch verteilt', 'Work is shared out automatically'),
          t('Fällt ein Server aus, übernimmt ein anderer', 'If one server fails, another takes over'),
          t('Alle Server zählen als eine Installation', 'All servers count as one installation')
        ]"
      />
      <details v-else class="anleitung">
        <summary><Ico n="plus" /> {{ t('Weiteren Server hinzufügen', 'Add another server') }}</summary>
        <ol>
          <li>
            {{
              t(
                'Die Datenbank für den neuen Server erreichbar machen (privates Netz, Firewall nur für deine Server).',
                'Make the database reachable for the new server (private network, firewall only for your servers).'
              )
            }}
          </li>
          <li>
            {{
              t(
                'Dateien: S3 nutzen — oder /data auf allen Servern als gemeinsamen Ordner (NFS) einbinden.',
                'Files: use S3 — or mount /data on all servers as a shared folder (NFS).'
              )
            }}
          </li>
          <li>
            {{
              t(
                'Den Container mit derselben Datenbank-Adresse starten:',
                'Start the container with the same database address:'
              )
            }}
          </li>
        </ol>
        <div class="code">
          <pre class="mono">{{ COMPOSE }}</pre>
          <button type="button" class="knopf nur-icon" :aria-label="t('Kopieren', 'Copy')" @click="composeKopieren">
            <Ico :n="kopiert ? 'check' : 'copy'" />
          </button>
        </div>
        <p class="leise klein">
          {{
            t(
              'Im Lastverteiler (Caddy, nginx, Traefik) beide Server eintragen und die Sitzungsbindung einschalten — dann landen Uploads ins Import-Archiv immer beim selben Server.',
              'Add both servers in the load balancer (Caddy, nginx, Traefik) and enable sticky sessions — import archive uploads then always reach the same server.'
            )
          }}
        </p>
      </details>
    </div>
  </section>
</template>

<style scoped>
.block + .block,
.block + .sperre,
.sperre + .block {
  margin-top: 14px;
}
.klein {
  font-size: 12.5px;
}
.rot {
  color: var(--rot);
}
.vt-balken {
  display: flex;
  height: 10px;
  border-radius: 99px;
  overflow: hidden;
  background: var(--flaeche2);
  margin: 14px 0 10px;
  gap: 2px;
}
.vt-balken i {
  display: block;
  height: 100%;
  transition: width 0.8s var(--kurve);
  transform-origin: left;
  animation: wachsen 1s 0.2s var(--kurve) both;
}
.vt-balken .l {
  background: var(--text3);
}
.vt-balken .s {
  background: var(--a);
}
.vt-zahlen {
  display: flex;
  gap: 26px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--text2);
}
.vt-zahlen b {
  color: var(--text);
  margin-right: 6px;
}
.vt-zahlen small {
  display: block;
  color: var(--text3);
  font-size: 11.5px;
  margin: 2px 0 0 16px;
}
.punkt {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 3px;
  margin-right: 7px;
}
.punkt.l {
  background: var(--text3);
}
.punkt.s {
  background: var(--a);
}
.umzug {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--linie);
}
.u-balken {
  height: 8px;
  border-radius: 99px;
  background: var(--flaeche2);
  overflow: hidden;
  margin: 10px 0 8px;
}
.u-balken i {
  display: block;
  height: 100%;
  background: var(--a);
  border-radius: 99px;
  transition: width 0.6s var(--kurve);
  position: relative;
  overflow: hidden;
}
.u-balken i.laeuft::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.35), transparent);
  animation: glanz2 1.4s linear infinite;
}
.letzte {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  font-size: 11.5px;
  color: var(--text3);
  display: grid;
  gap: 3px;
}
.letzte li {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  gap: 6px;
  align-items: center;
}
.letzte li svg {
  width: 11px;
  height: 11px;
  flex-shrink: 0;
  color: var(--ok);
}
.letzte li.f svg {
  color: var(--rot);
}
.letzte li.f {
  color: var(--rot);
}
.umzug-knoepfe {
  margin-top: 14px;
}
.wahl {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 12px 0 16px;
}
.wahl label {
  display: flex;
  gap: 12px;
  align-items: center;
  border: 1.5px solid var(--linie);
  border-radius: 14px;
  padding: 14px;
  cursor: pointer;
  transition:
    border-color 0.2s,
    background 0.2s;
}
.wahl label.an {
  border-color: var(--a);
  background: rgba(var(--a-rgb), 0.05);
}
.wahl input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.wahl svg {
  width: 20px;
  height: 20px;
  color: var(--text3);
}
.wahl label.an svg {
  color: var(--a);
}
.wahl small {
  display: block;
  color: var(--text3);
  font-size: 12px;
}
.zwei {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.opt {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin: 2px 0 12px;
  cursor: pointer;
}
.opt small {
  display: block;
  color: var(--text3);
  font-size: 12px;
}
.test {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  border-radius: 10px;
  padding: 9px 12px;
  background: var(--rot-bg);
  color: var(--rot);
}
.test.gut {
  background: var(--ok-bg);
  color: var(--ok);
}
.test svg {
  width: 15px;
  height: 15px;
}
.hinweis {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 12.5px;
  border-radius: 10px;
  padding: 9px 12px;
  margin: 10px 0;
}
.hinweis.warn {
  color: var(--warn);
  background: var(--warn-bg);
}
.hinweis svg {
  width: 14px;
  height: 14px;
  margin-top: 2px;
  flex-shrink: 0;
}
.knoten {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}
.k {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  border: 1px solid var(--linie);
  border-radius: 14px;
  padding: 12px 14px;
  background: var(--bg);
}
.k.weg {
  opacity: 0.55;
}
.puls {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--text3);
  position: relative;
  flex-shrink: 0;
}
.puls.an {
  background: var(--ok);
}
.puls.an::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: var(--ok);
  animation: pulsen 2s ease-out infinite;
}
@keyframes pulsen {
  from {
    transform: scale(1);
    opacity: 0.6;
  }
  to {
    transform: scale(2.8);
    opacity: 0;
  }
}
.k-name {
  display: flex;
  flex-direction: column;
  min-width: 150px;
}
.k-name small {
  color: var(--text3);
  font-size: 11.5px;
}
.k dl {
  display: flex;
  gap: 18px;
  margin: 0 0 0 auto;
  flex-wrap: wrap;
}
.k dt {
  font-size: 10.5px;
  color: var(--text3);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
}
.k dd {
  margin: 0;
  font-size: 13px;
}
.klein-sperre {
  margin-top: 14px;
  border-style: dashed;
}
.anleitung {
  margin-top: 14px;
  border-top: 1px solid var(--linie);
  padding-top: 12px;
}
.anleitung summary {
  cursor: pointer;
  display: inline-flex;
  gap: 8px;
  align-items: center;
  font-weight: 600;
  font-size: 13px;
}
.anleitung summary svg {
  width: 14px;
  height: 14px;
}
.anleitung ol {
  margin: 10px 0;
  padding-left: 20px;
  font-size: 13px;
  color: var(--text2);
  display: grid;
  gap: 4px;
}
.code {
  position: relative;
}
.code pre {
  background: var(--bg);
  border: 1px solid var(--linie);
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 12px;
  overflow-x: auto;
  margin: 0 0 10px;
}
.code button {
  position: absolute;
  top: 8px;
  right: 8px;
}
.zeile-enter-active {
  transition:
    opacity 0.35s,
    transform 0.35s var(--kurve);
}
.zeile-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}
.zeile-leave-active {
  display: none;
}
.aufklappen-enter-active,
.aufklappen-leave-active {
  transition:
    opacity 0.25s,
    transform 0.3s var(--kurve);
}
.aufklappen-enter-from,
.aufklappen-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
@media (max-width: 640px) {
  .wahl,
  .zwei {
    grid-template-columns: 1fr;
  }
  .k dl {
    margin-left: 0;
  }
}
</style>
