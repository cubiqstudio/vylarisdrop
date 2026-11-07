<script setup lang="ts">
definePageMeta({ layout: 'leer' })
const route = useRoute()
const theme = useTheme()
const token = computed(() => String(route.params.token || ''))
const { data, error } = await (useFetch as any)(() => `/api/public/galerie/${encodeURIComponent(token.value)}`, {
  key: `galerie-${token.value}`
})
const dateien = computed<any[]>(() => data.value?.dateien || [])
useHead({
  title: () => data.value?.titel || t('Galerie', 'Gallery'),
  meta: [
    { name: 'robots', content: 'noindex' },
    { property: 'og:title', content: () => data.value?.titel || '' },
    { property: 'og:image', content: () => dateien.value.find((d) => d.vorschau)?.vorschau || '' }
  ]
})
const bilder = computed(() => dateien.value.filter((d) => d.art === 'bild' || d.art === 'video').length)

const offen = ref<number | null>(null)
const aktuell = computed(() => (offen.value == null ? null : dateien.value[offen.value]))
const richtung = ref(1)
function zeige(i: number) {
  richtung.value = offen.value == null || i > offen.value ? 1 : -1
  offen.value = (i + dateien.value.length) % dateien.value.length
}
const weiter = () => offen.value != null && zeige(offen.value + 1)
const zurueck = () => offen.value != null && zeige(offen.value - 1)
function zu() {
  offen.value = null
  diashow.value = false
}
const diashow = ref(false)
let uhr: any = null
watch([diashow, offen], () => {
  clearTimeout(uhr)
  if (diashow.value && aktuell.value && aktuell.value.art !== 'video') uhr = setTimeout(weiter, 5000)
})
function taste(e: KeyboardEvent) {
  if (offen.value == null) return
  if (e.key === 'ArrowRight') weiter()
  else if (e.key === 'ArrowLeft') zurueck()
  else if (e.key === 'Escape') zu()
  else if (e.key === ' ') {
    e.preventDefault()
    diashow.value = !diashow.value
  }
}
let x0 = 0
const wischStart = (e: TouchEvent) => {
  x0 = e.touches[0]!.clientX
}
const wischEnde = (e: TouchEvent) => {
  const dx = e.changedTouches[0]!.clientX - x0
  if (Math.abs(dx) > 50) (dx < 0 ? weiter : zurueck)()
}
onMounted(() => document.addEventListener('keydown', taste))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', taste)
  clearTimeout(uhr)
})
const ARTIC: Record<string, string> = { audio: 'music', text: 'text', datei: 'file' }
const meinThema = computed(() => theme.value.user?.theme || 'dark')
</script>

<template>
  <div class="seite-g">
    <header class="oben">
      <NuxtLink :to="theme.user ? '/' : ''" class="marke-link"><VdMarke /></NuxtLink>
    </header>
    <div v-if="error" class="weg rein">
      <h1>{{ t('Galerie nicht gefunden', 'Gallery not found') }}</h1>
      <p class="leise">{{ t('Der Link ist nicht (mehr) gültig.', 'The link is not valid (anymore).') }}</p>
    </div>
    <template v-else-if="data">
      <div class="kopf-g rein">
        <div>
          <h1>{{ data.titel }}</h1>
          <p v-if="data.text" class="text">{{ data.text }}</p>
          <p class="leise klein">
            {{
              t(
                `${dateien.length} Dateien · ${groesse(data.groesse)} · geteilt von ${data.von}`,
                `${dateien.length} files · ${groesse(data.groesse)} · shared by ${data.von}`
              )
            }}
          </p>
        </div>
        <div class="reihe">
          <button
            v-if="bilder"
            class="knopf"
            @click="
              zeige(0);
              diashow = true;
            "
          >
            <Ico n="play" /> {{ t('Diashow', 'Slideshow') }}
          </button>
          <a v-if="data.download && dateien.length" :href="`/g/${token}/zip`" class="knopf rot"
            ><Ico n="download" /> {{ t('Alles als ZIP', 'Everything as ZIP') }}</a
          >
        </div>
      </div>
      <div v-if="!dateien.length" class="leer-hinweis">
        <h3>{{ t('Noch leer', 'Still empty') }}</h3>
      </div>
      <div class="raster">
        <button
          v-for="(d, i) in dateien"
          :key="d.slug"
          type="button"
          class="kachel"
          :style="{ '--i': Math.min(i, 30), aspectRatio: d.width && d.height ? `${d.width} / ${d.height}` : '4 / 3' }"
          @click="zeige(i)"
        >
          <VdLive v-if="d.live" :src="d.live" art="kachel"
            ><img :src="d.vorschau || d.medium" :alt="d.name" loading="lazy" decoding="async"
          /></VdLive>
          <img
            v-else-if="d.vorschau || d.art === 'bild'"
            :src="d.vorschau || d.medium"
            :alt="d.name"
            loading="lazy"
            decoding="async"
          />
          <span v-else class="sonst"
            ><Ico :n="ARTIC[d.art] || 'file'" /><small>{{ d.name }}</small></span
          >
          <span v-if="d.art === 'video'" class="spiel"><Ico n="play" /></span>
        </button>
      </div>
    </template>
    <VdFuss />

    <Teleport to="body">
      <Transition name="licht">
        <div
          v-if="aktuell"
          class="licht"
          :data-theme="meinThema"
          @click.self="zu"
          @touchstart.passive="wischStart"
          @touchend="wischEnde"
        >
          <div class="licht-oben">
            <span class="mono klein">{{ (offen ?? 0) + 1 }} / {{ dateien.length }}</span>
            <b class="licht-name">{{ aktuell.name }}</b>
            <button
              v-if="bilder"
              class="knopf nur-icon"
              :aria-label="diashow ? t('Diashow anhalten', 'Pause slideshow') : t('Diashow', 'Slideshow')"
              @click="diashow = !diashow"
            >
              <Ico :n="diashow ? 'pause' : 'play'" />
            </button>
            <a
              :href="aktuell.seite"
              target="_blank"
              rel="noopener"
              class="knopf nur-icon"
              :aria-label="t('Datei-Seite', 'File page')"
              ><Ico n="external"
            /></a>
            <button class="knopf nur-icon" :aria-label="t('Schließen', 'Close')" @click="zu"><Ico n="x" /></button>
          </div>
          <button class="pfeil links" :aria-label="t('Zurück', 'Back')" @click="zurueck"><Ico n="left" /></button>
          <Transition :name="richtung > 0 ? 'rechts' : 'links'" mode="out-in">
            <div :key="aktuell.slug" class="buehne-g">
              <VdLive v-if="aktuell.art === 'bild' && aktuell.live" :src="aktuell.live"
                ><img :src="aktuell.medium" :alt="aktuell.name"
              /></VdLive>
              <img v-else-if="aktuell.art === 'bild'" :src="aktuell.medium" :alt="aktuell.name" />
              <video
                v-else-if="aktuell.art === 'video'"
                :src="aktuell.medium"
                :poster="aktuell.vorschau || undefined"
                controls
                autoplay
                playsinline
                @ended="diashow && weiter()"
              ></video>
              <audio v-else-if="aktuell.art === 'audio'" :src="aktuell.medium" controls autoplay></audio>
              <a v-else :href="aktuell.seite" target="_blank" rel="noopener" class="knopf rot"
                ><Ico n="external" /> {{ t('Datei öffnen', 'Open file') }}</a
              >
            </div>
          </Transition>
          <button class="pfeil rechts" :aria-label="t('Weiter', 'Next')" @click="weiter"><Ico n="right" /></button>
          <div v-if="diashow" class="fortschritt"><i :key="offen ?? 0"></i></div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.seite-g {
  max-width: 1400px;
  margin: 0 auto;
  padding: 18px 20px 20px;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}
.oben {
  margin-bottom: 26px;
}
.kopf-g {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 22px;
}
.kopf-g h1 {
  font-family: var(--f-display);
  font-size: clamp(30px, 4.4vw, 52px);
  letter-spacing: -0.04em;
  line-height: 1;
}
.text {
  margin: 10px 0 4px;
  max-width: 680px;
  color: var(--text2);
  font-size: 15px;
  white-space: pre-line;
}
.klein {
  font-size: 12.5px;
  margin: 6px 0 0;
}
.weg {
  text-align: center;
  padding: 80px 20px;
}
.raster {
  columns: 4 260px;
  column-gap: 10px;
  flex: 1;
}
.kachel {
  break-inside: avoid;
  display: block;
  width: 100%;
  margin: 0 0 10px;
  padding: 0;
  border: 0;
  border-radius: 14px;
  overflow: hidden;
  position: relative;
  cursor: zoom-in;
  background: var(--flaeche2);
  animation: rein 0.5s var(--kurve) backwards;
  animation-delay: calc(var(--i) * 30ms);
}
.kachel img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition:
    transform 0.6s var(--kurve),
    filter 0.3s;
}
.kachel:hover img {
  transform: scale(1.04);
}
.kachel::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 60%, rgba(0, 0, 0, 0.35));
  opacity: 0;
  transition: opacity 0.3s;
}
.kachel:hover::after {
  opacity: 1;
}
.sonst {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  color: var(--text3);
  padding: 10px;
}
.sonst svg {
  width: 30px;
  height: 30px;
}
.sonst small {
  font-size: 11.5px;
  text-align: center;
  overflow-wrap: anywhere;
}
.spiel {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  display: grid;
  place-items: center;
  backdrop-filter: blur(6px);
  z-index: 1;
}
.spiel svg {
  width: 18px;
  height: 18px;
}
.licht {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(6, 6, 7, 0.94);
  display: grid;
  place-items: center;
}
.licht-oben {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 14px 18px;
  color: #e9e8ec;
  z-index: 2;
}
.licht-name {
  flex: 1;
  text-align: center;
  font-size: 13.5px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.licht .knopf.nur-icon {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}
.buehne-g {
  max-width: 92vw;
  max-height: 84vh;
  display: grid;
  place-items: center;
}
.buehne-g img,
.buehne-g video {
  max-width: 92vw;
  max-height: 84vh;
  object-fit: contain;
  border-radius: 10px;
  box-shadow: 0 30px 80px -30px #000;
}
.pfeil {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 0;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  cursor: pointer;
  display: grid;
  place-items: center;
  z-index: 2;
  transition: background 0.2s;
}
.pfeil:hover {
  background: rgba(255, 255, 255, 0.16);
}
.pfeil svg {
  width: 22px;
  height: 22px;
}
.pfeil.links {
  left: 18px;
}
.pfeil.rechts {
  right: 18px;
}
.fortschritt {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: rgba(255, 255, 255, 0.1);
}
.fortschritt i {
  display: block;
  height: 100%;
  background: var(--a);
  transform-origin: left;
  animation: laufen 5s linear both;
}
@keyframes laufen {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}
.licht-enter-active,
.licht-leave-active {
  transition: opacity 0.25s;
}
.licht-enter-from,
.licht-leave-to {
  opacity: 0;
}
.rechts-enter-active,
.rechts-leave-active,
.links-enter-active,
.links-leave-active {
  transition:
    opacity 0.22s,
    transform 0.3s var(--kurve);
}
.rechts-enter-from {
  opacity: 0;
  transform: translateX(40px);
}
.rechts-leave-to {
  opacity: 0;
  transform: translateX(-40px);
}
.links-enter-from {
  opacity: 0;
  transform: translateX(-40px);
}
.links-leave-to {
  opacity: 0;
  transform: translateX(40px);
}
@media (max-width: 640px) {
  .pfeil {
    display: none;
  }
  .raster {
    columns: 2 140px;
  }
}
</style>
