<script setup lang="ts">
definePageMeta({ layout: 'leer' })
const route = useRoute()
const slug = computed(() => String(route.params.slug || ''))
const theme = useTheme()
const besucher = useBesucherThema()
const requestFetch: any = import.meta.server ? useRequestFetch() : $fetch
const { data, error, refresh } = await useAsyncData('datei-' + slug.value, () =>
  requestFetch(`/api/public/datei/${encodeURIComponent(slug.value)}`).catch((e: any) => {
    throw createError({ statusCode: e?.statusCode || 404, message: e?.data?.message })
  })
)
const d = computed<any>(() => data.value)
if (import.meta.server && error.value) {
  const ev = useRequestEvent()
  if (ev) setResponseStatus(ev, error.value.statusCode === 451 ? 451 : 404)
}

const ph = (s: string) =>
  String(s || '').replace(/\{(name|size|date|views|user|dimensions)\}/g, (_m, k) => {
    const f = d.value?.datei
    if (!f) return ''
    return (
      (
        {
          name: f.name,
          size: groesse(f.size),
          date: datum(f.created_at),
          views: String(f.views),
          user: d.value.von,
          dimensions: f.width ? `${f.width} × ${f.height}` : ''
        } as Record<string, string>
      )[k] || ''
    )
  })
const og = computed(() => {
  const f = d.value?.datei,
    e = d.value?.embed || {}
  if (!f) return null
  return {
    titel: ph(e.titel || '{name}'),
    text: ph(e.text || `${groesse(f.size)} · ${datum(f.created_at)}`),
    anbieter: ph(e.anbieter || theme.value.name),
    farbe: e.farbe || theme.value.color,
    bild: e.bild === false ? undefined : f.art === 'bild' ? d.value.medium : d.value.vorschau || undefined,
    video: f.art === 'video' ? d.value.medium : undefined
  }
})
useHead(() => ({
  title: d.value?.datei?.name || (d.value?.gesperrt ? d.value.name : t('Datei', 'File')),
  meta: [
    { name: 'robots', content: 'noindex' },
    { name: 'theme-color', content: og.value?.farbe || theme.value.color },
    ...(og.value
      ? [
          { property: 'og:title', content: og.value.titel },
          { property: 'og:description', content: og.value.text },
          { property: 'og:site_name', content: og.value.anbieter },
          ...(og.value.bild
            ? [
                { property: 'og:image', content: og.value.bild },
                { name: 'twitter:card', content: 'summary_large_image' }
              ]
            : []),
          ...(og.value.video
            ? [
                { property: 'og:type', content: 'video.other' },
                { property: 'og:video', content: og.value.video },
                { property: 'og:video:type', content: d.value.datei.mime }
              ]
            : [])
        ]
      : [])
  ]
}))

const pw = ref('')
const pwFehler = ref('')
const pwLaeuft = ref(false)
async function entsperren() {
  pwFehler.value = ''
  pwLaeuft.value = true
  try {
    await api(`/api/public/datei/${encodeURIComponent(slug.value)}/entsperren`, {
      method: 'POST',
      body: { passwort: pw.value }
    })
    await refresh()
  } catch (e: any) {
    pwFehler.value = e.message
  } finally {
    pwLaeuft.value = false
  }
}

const text = ref('')
const textGekuerzt = ref(false)
onMounted(async () => {
  if (d.value?.datei?.art !== 'text') return
  try {
    const r = await fetch(d.value.medium.replace('/r/', '/raw/'), { headers: { Range: 'bytes=0-409599' } })
    text.value = await r.text()
    textGekuerzt.value = d.value.datei.size > 409600
    codeHtml.value = (await hervorheben(text.value, spracheAusName(d.value.datei.name) || 'auto')).html
  } catch {
    text.value = ''
  }
})
const codeHtml = ref('')
const textKopiert = ref(false)
async function textKopieren() {
  if (await kopieren(text.value)) {
    textKopiert.value = true
    setTimeout(() => {
      textKopiert.value = false
    }, 1500)
  }
}
const zeilen = computed(() => text.value.split('\n'))

const kopiert = ref('')
async function kopie(k: string, url: string) {
  if (await kopieren(url)) {
    kopiert.value = k
    setTimeout(() => {
      if (kopiert.value === k) kopiert.value = ''
    }, 1500)
  }
}
const e2eInfo = ref<{ name: string; mime: string; groesse: number } | null>(null)
const ankerKey = ref('')
onMounted(() => {
  ankerKey.value = schluesselAusAnker()
})
const LINKS = computed(() =>
  d.value?.datei?.verschluesselt
    ? [
        {
          k: 'seite',
          text: t('Link', 'Link'),
          url: d.value.links.seite + (ankerKey.value ? `#k=${ankerKey.value}` : ''),
          ic: 'lock'
        }
      ]
    : d.value?.links
      ? [
          { k: 'direkt', text: t('Direkt', 'Direct'), url: d.value.links.direkt, ic: 'link' },
          { k: 'download', text: 'Download', url: d.value.links.download, ic: 'download' },
          { k: 'raw', text: 'Raw', url: d.value.links.raw, ic: 'code' }
        ]
      : []
)
const endung = computed(() => (/\.([a-z0-9]{1,6})$/i.exec(d.value?.datei?.name || '')?.[1] || 'datei').toUpperCase())
const meinThema = computed(() => theme.value.user?.theme || besucher.value || 'dark')
function themaUm(e: MouseEvent) {
  const neu = meinThema.value === 'dark' ? 'light' : 'dark'
  themaWechseln(neu, e, () => {
    besucher.value = neu
    if (theme.value.user) theme.value = { ...theme.value, user: { ...theme.value.user, theme: neu } }
  })
}
const aufrufAnteil = computed(() =>
  d.value?.datei?.max_views ? Math.min(1, d.value.datei.views / d.value.datei.max_views) : 0
)
</script>

<template>
  <div class="seite-v">
    <header class="oben">
      <NuxtLink :to="theme.user ? '/' : ''" class="marke-link"><VdMarke /></NuxtLink>
      <button class="knopf rund" :aria-label="t('Hell/Dunkel umschalten', 'Toggle light/dark')" @click="themaUm">
        <Ico :n="meinThema === 'light' ? 'moon' : 'sun'" />
      </button>
    </header>

    <div v-if="error" class="weg rein">
      <template v-if="error.statusCode === 451">
        <span class="weg-ic gesperrt"><Ico n="shield" /></span>
        <h1>{{ t('Datei gesperrt', 'File blocked') }}</h1>
        <p class="leise">
          {{
            t(
              'Der Virenscan hat in dieser Datei Schadsoftware gefunden. Sie wird zu deinem Schutz nicht ausgeliefert.',
              'The virus scan found malware in this file. It is not delivered, for your protection.'
            )
          }}
        </p>
      </template>
      <template v-else>
        <span class="weg-ic"><Ico n="file" /></span>
        <h1>{{ t('Datei nicht gefunden', 'File not found') }}</h1>
        <p class="leise">
          {{
            t(
              'Der Link ist abgelaufen, wurde gelöscht oder hatte keine Aufrufe mehr übrig.',
              'The link has expired, was deleted or had no views left.'
            )
          }}
        </p>
      </template>
    </div>

    <form v-else-if="d?.gesperrt" class="schloss rein" @submit.prevent="entsperren">
      <span class="schloss-ic"><Ico n="lock" /></span>
      <h1>{{ d.name }}</h1>
      <p class="leise">{{ t('Diese Datei ist mit einem Passwort geschützt.', 'This file is password protected.') }}</p>
      <div v-if="pwFehler" class="meldung meldung-fehler" role="alert">{{ pwFehler }}</div>
      <input
        v-model="pw"
        class="eingabe"
        type="password"
        :placeholder="t('Passwort', 'Password')"
        autocomplete="off"
        required
        autofocus
      />
      <button class="knopf rot" :disabled="pwLaeuft">
        <Ico v-if="pwLaeuft" n="loader" spin />{{ t('Öffnen', 'Open') }}
      </button>
    </form>

    <div v-else-if="d?.datei" class="teilen rein">
      <div class="buehne" :class="d.datei.verschluesselt ? 'art-e2e' : 'art-' + d.datei.art">
        <VdE2eAnsicht
          v-if="d.datei.verschluesselt"
          :src="d.medium"
          :groesse="d.datei.size"
          @info="
            (i) => {
              e2eInfo = i;
            }
          "
        />
        <VdLive v-else-if="d.datei.art === 'bild' && d.live" :src="d.live"
          ><img :src="d.medium" :alt="d.datei.name"
        /></VdLive>
        <img v-else-if="d.datei.art === 'bild'" :src="d.medium" :alt="d.datei.name" />
        <VdPlayer
          v-else-if="d.datei.art === 'video'"
          :src="d.medium"
          :poster="d.vorschau"
          :streifen="d.streifenUrl"
          :streifen-anzahl="d.datei.streifen"
          :breite="d.datei.width"
          :hoehe="d.datei.height"
        />
        <div v-else-if="d.datei.art === 'audio'" class="audio-buehne">
          <VdAudio :src="d.medium" :wellen="d.datei.wellen" :titel="d.datei.name" :dauer-ms="d.datei.duration_ms" />
        </div>
        <div v-else-if="d.datei.art === 'text'" class="textansicht">
          <div class="zeilen" aria-hidden="true">
            <span v-for="(_z, i) in zeilen" :key="i">{{ i + 1 }}</span>
          </div>
          <pre v-if="codeHtml" class="hljs" v-html="codeHtml"></pre>
          <pre v-else>{{ text }}</pre>
          <button type="button" class="knopf klein text-kopie" @click="textKopieren">
            <Ico :n="textKopiert ? 'check' : 'copy'" />
            {{ textKopiert ? t('Kopiert', 'Copied') : t('Kopieren', 'Copy') }}
          </button>
        </div>
        <div v-else class="datei-buehne">
          <div class="datei-ic">
            <span>{{ endung }}</span>
          </div>
          <a class="knopf rot" :href="d.links.download"
            ><Ico n="download" /> {{ t('Herunterladen', 'Download') }} · {{ groesse(d.datei.size) }}</a
          >
        </div>
      </div>
      <p v-if="textGekuerzt" class="leise klein-hinweis">
        {{
          t(
            'Gekürzt angezeigt — die ganze Datei gibt es über „Raw“ oder „Download“.',
            'Shown shortened — get the full file via “Raw” or “Download”.'
          )
        }}
      </p>

      <aside class="seite">
        <div class="block">
          <h2 class="dateiname">{{ d.datei.name }}</h2>
          <div v-if="d.datei.verschluesselt" class="sehrleise klein">
            {{
              e2eInfo
                ? `${e2eInfo.mime || t('unbekannter Typ', 'unknown type')} · ${groesse(e2eInfo.groesse)}`
                : t('Inhalt verschlüsselt', 'Content encrypted')
            }}
          </div>
          <div v-else class="sehrleise klein">
            {{ d.datei.mime }}<template v-if="d.datei.width"> · {{ d.datei.width }} × {{ d.datei.height }}</template> ·
            {{ groesse(d.datei.size) }}
          </div>
          <div class="chips">
            <span v-if="d.datei.verschluesselt" class="chip ok"
              ><Ico n="lock" /> {{ t('Ende-zu-Ende', 'End-to-end') }}</span
            >
            <span v-if="d.datei.expires_at" class="chip warn"
              ><Ico n="clock" /> {{ restzeit(d.datei.expires_at) }}</span
            >
            <span v-if="d.datei.passwort" class="chip info"><Ico n="lock" /> {{ t('Passwort', 'Password') }}</span>
            <span v-if="d.datei.max_views" class="chip neutral"
              ><Ico n="eye" /> {{ t(`max. ${d.datei.max_views} Aufrufe`, `max. ${d.datei.max_views} views`) }}</span
            >
          </div>
          <div v-if="d.datei.max_views" class="ring">
            <svg viewBox="0 0 44 44">
              <circle class="hinten" cx="22" cy="22" r="18" />
              <circle class="vorn" cx="22" cy="22" r="18" :style="{ '--rest': 113 - 113 * aufrufAnteil }" />
            </svg>
            <div>
              <b class="zahl">{{ zahl(d.datei.views) }}</b
              ><small>{{ t(`von ${zahl(d.datei.max_views)} Aufrufen`, `of ${zahl(d.datei.max_views)} views`) }}</small>
            </div>
          </div>
        </div>
        <div class="block">
          <div v-for="l in LINKS" :key="l.k" class="linkfeld">
            <span class="etikett"><Ico :n="l.ic" /> {{ l.text }}</span
            ><code>{{ l.url.replace(/^https?:\/\//, '') }}</code>
            <button
              class="knopf nur-icon"
              :class="{ kopiert: kopiert === l.k }"
              :aria-label="t('Kopieren', 'Copy')"
              @click="kopie(l.k, l.url)"
            >
              <Ico :n="kopiert === l.k ? 'check' : 'copy'" />
            </button>
          </div>
          <dl class="meta">
            <dt>{{ t('Hochgeladen', 'Uploaded') }}</dt>
            <dd>{{ zeitpunkt(d.datei.created_at) }}</dd>
            <dt>{{ t('Von', 'By') }}</dt>
            <dd>{{ d.von }}</dd>
            <template v-if="!d.datei.verschluesselt"
              ><dt>SHA-256</dt>
              <dd :title="d.datei.sha256">{{ d.datei.sha256.slice(0, 8) }}…{{ d.datei.sha256.slice(-6) }}</dd></template
            >
          </dl>
          <p v-if="d.datei.verschluesselt" class="sehrleise klein e2e-hinweis">
            {{
              t(
                'Entschlüsselt wird nur in deinem Browser. Der Server kennt weder Inhalt noch Schlüssel.',
                'Decryption happens only in your browser. The server knows neither the content nor the key.'
              )
            }}
          </p>
          <a v-else class="knopf rot voll" :href="d.links.download"
            ><Ico n="download" /> {{ t('Herunterladen', 'Download') }}</a
          >
        </div>
      </aside>
    </div>
    <VdFuss />
  </div>
</template>

<style scoped>
.seite-v {
  position: relative;
  max-width: 1240px;
  margin: 0 auto;
  padding: 18px 20px 60px;
}
.oben {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 26px;
}
.teilen {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 22px;
  align-items: start;
}
.buehne {
  background: #000;
  border-radius: 18px;
  overflow: hidden;
  position: relative;
  min-height: 320px;
  display: grid;
  place-items: center;
  box-shadow: 0 30px 70px -40px rgba(0, 0, 0, 0.8);
}
.buehne img,
.buehne video {
  width: 100%;
  max-height: 78vh;
  object-fit: contain;
  display: block;
}
.art-text {
  background: var(--flaeche);
  border: 1px solid var(--linie);
  place-items: stretch;
}
.art-audio {
  min-height: 0;
  place-items: stretch;
  background: #0b0b0d;
}
.art-video {
  min-height: 0;
  place-items: stretch;
}
.weg-ic.gesperrt {
  background: var(--rot-bg);
  color: var(--rot);
}
.art-e2e {
  background: var(--flaeche);
  border: 1px solid var(--linie);
  place-items: stretch;
}
.e2e-hinweis {
  margin: 12px 0 0;
  line-height: 1.5;
}
.textansicht {
  display: flex;
  max-height: 78vh;
  overflow: auto;
  font-family: var(--f-mono);
  font-size: 12.5px;
  line-height: 1.65;
}
.zeilen {
  display: flex;
  flex-direction: column;
  padding: 16px 10px 16px 16px;
  color: var(--text3);
  text-align: right;
  user-select: none;
  border-right: 1px solid var(--linie);
  position: sticky;
  left: 0;
  background: var(--flaeche);
}
.textansicht pre {
  margin: 0;
  padding: 16px;
  white-space: pre;
  tab-size: 4;
  color: var(--text);
}
.textansicht {
  position: relative;
}
.text-kopie {
  position: absolute;
  top: 10px;
  right: 10px;
  opacity: 0.85;
}
.audio-buehne {
  width: 100%;
  padding: 40px 28px;
  background: radial-gradient(circle at 20% 30%, rgba(var(--a-rgb), 0.28), transparent 60%), #0b0b0d;
}
.datei-buehne {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
  padding: 50px 20px;
  background: var(--flaeche2);
  width: 100%;
  height: 100%;
}
.datei-ic {
  width: 110px;
  height: 136px;
  border-radius: 14px;
  background: var(--flaeche);
  border: 1px solid var(--linie2);
  display: grid;
  place-items: end center;
  padding-bottom: 18px;
  font-family: var(--f-mono);
  font-weight: 700;
  color: var(--a);
  box-shadow: var(--schatten);
  animation: schweben 4s ease-in-out infinite;
}
@keyframes schweben {
  50% {
    transform: translateY(-8px) rotate(-1deg);
  }
}
.klein-hinweis {
  font-size: 12px;
  margin: 8px 0 0;
}
.seite {
  display: flex;
  flex-direction: column;
}
.dateiname {
  font-family: var(--f-display);
  font-size: 21px;
  letter-spacing: -0.02em;
  font-weight: 700;
  word-break: break-all;
  margin-bottom: 4px;
}
.klein {
  font-size: 12.5px;
}
.chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.ring {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-top: 14px;
}
.ring svg {
  width: 46px;
  height: 46px;
  transform: rotate(-90deg);
}
.ring circle {
  fill: none;
  stroke-width: 5;
}
.ring .hinten {
  stroke: var(--flaeche2);
}
.ring .vorn {
  stroke: var(--a);
  stroke-linecap: round;
  stroke-dasharray: 113;
  stroke-dashoffset: 113;
  animation: ring 1.4s 0.4s var(--kurve) forwards;
}
@keyframes ring {
  to {
    stroke-dashoffset: var(--rest);
  }
}
.ring b {
  display: block;
  font-size: 15px;
  font-family: var(--f-mono);
  font-weight: 500;
}
.ring small {
  color: var(--text3);
  font-size: 11.5px;
}
.linkfeld {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--linie);
  border-radius: 10px;
  padding: 4px 4px 4px 12px;
  background: var(--bg);
  margin-bottom: 8px;
}
.etikett {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text3);
  width: 92px;
  flex-shrink: 0;
  display: flex;
  gap: 6px;
  align-items: center;
}
.etikett svg {
  width: 12px;
  height: 12px;
}
.linkfeld code {
  flex: 1;
  min-width: 0;
  font-family: var(--f-mono);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.linkfeld .knopf.kopiert {
  background: var(--ok-bg);
  color: var(--ok);
}
.meta {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 7px 14px;
  font-size: 12.5px;
  margin: 14px 0;
}
.meta dt {
  color: var(--text3);
}
.meta dd {
  margin: 0;
  text-align: right;
  font-family: var(--f-mono);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.voll {
  width: 100%;
  padding: 11px;
}
.weg,
.schloss {
  max-width: 420px;
  margin: 12vh auto 0;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  position: relative;
}
.weg h1,
.schloss h1 {
  font-family: var(--f-display);
  font-size: 28px;
  letter-spacing: -0.03em;
  word-break: break-all;
}
.weg p,
.schloss p {
  margin: 0;
}
.weg-ic,
.schloss-ic {
  width: 72px;
  height: 72px;
  border-radius: 20px;
  display: grid;
  place-items: center;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  color: var(--text3);
}
.schloss-ic {
  background: rgba(var(--a-rgb), 0.1);
  color: var(--a);
  border-color: rgba(var(--a-rgb), 0.3);
  animation: wackeln 2.6s ease-in-out infinite;
}
.weg-ic svg,
.schloss-ic svg {
  width: 30px;
  height: 30px;
}
@keyframes wackeln {
  0%,
  80%,
  100% {
    transform: rotate(0);
  }
  85% {
    transform: rotate(-8deg);
  }
  90% {
    transform: rotate(6deg);
  }
  95% {
    transform: rotate(-3deg);
  }
}
.schloss .eingabe {
  text-align: center;
}
.schloss .knopf {
  width: 100%;
  padding: 11px;
}
@media (max-width: 960px) {
  .teilen {
    grid-template-columns: 1fr;
  }
}
</style>
