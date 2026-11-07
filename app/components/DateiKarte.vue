<script setup lang="ts">
const props = defineProps<{ f: any; gewaehlt: boolean; auswahlModus: boolean; i: number }>()
const tonSpielt = ref(false)
function tonUm() {
  const w = window as any
  if (tonSpielt.value) {
    w.__rdTon?.pause()
    return
  }
  w.__rdTon?.pause()
  const a = new Audio(props.f.links.direkt)
  w.__rdTon = a
  a.onpause = () => {
    tonSpielt.value = false
  }
  a.onended = () => {
    tonSpielt.value = false
  }
  tonSpielt.value = true
  void a.play().catch(() => {
    tonSpielt.value = false
  })
}
onBeforeUnmount(() => {
  if (tonSpielt.value) (window as any).__rdTon?.pause()
})
const emit = defineEmits<{ (e: 'oeffnen'): void; (e: 'waehlen'): void }>()
const el = ref<HTMLElement | null>(null)
const video = ref<HTMLVideoElement | null>(null)
const fortschritt = ref(0)
const textVorschau = ref('')
const sichtbar = ref(false)
const kaputt = ref(false)
const drueber = ref(false)

const wellen = computed(() => {
  if (Array.isArray(props.f.wellen) && props.f.wellen.length) {
    const w = props.f.wellen
    return Array.from({ length: 34 }, (_, j) => Math.max(8, w[Math.floor((j * w.length) / 34)] || 0))
  }
  let s = 0
  for (const c of String(props.f.id)) s = (s * 31 + c.charCodeAt(0)) % 9973
  return Array.from(
    { length: 34 },
    (_, j) => 18 + Math.round(Math.abs(Math.sin(j * 1.7 + s) * 52 + Math.cos(j * 0.6 + s / 7) * 18))
  )
})
const endung = computed(() =>
  (/\.([a-z0-9]{1,6})$/i.exec(props.f.name)?.[1] || props.f.mime.split('/')[1] || 'datei').toUpperCase().slice(0, 5)
)
const ART = computed(
  () =>
    (
      ({ bild: t('Bild', 'Image'), video: 'Video', audio: 'Audio', text: 'Text', datei: t('Datei', 'File') }) as Record<
        string,
        string
      >
    )[props.f.art]
)

let beobachter: IntersectionObserver | null = null
onMounted(() => {
  beobachter = new IntersectionObserver(
    ([e]) => {
      if (e?.isIntersecting) {
        sichtbar.value = true
        beobachter?.disconnect()
        if (props.f.art === 'text') void textLaden()
      }
    },
    { rootMargin: '200px' }
  )
  if (el.value) beobachter.observe(el.value)
})
onBeforeUnmount(() => beobachter?.disconnect())
async function textLaden() {
  try {
    const r = await fetch(props.f.links.raw, { headers: { Range: 'bytes=0-1500' } })
    textVorschau.value = (await r.text()).split('\n').slice(0, 14).join('\n')
  } catch {}
}

function bewegen(e: MouseEvent) {
  if (ruhig() || !el.value) return
  const r = el.value.getBoundingClientRect(),
    x = (e.clientX - r.left) / r.width,
    y = (e.clientY - r.top) / r.height
  el.value.style.transform = `translateY(-4px) rotateX(${(0.5 - y) * 9}deg) rotateY(${(x - 0.5) * 11}deg)`
  el.value.style.setProperty('--mx', x * 100 + '%')
  el.value.style.setProperty('--my', y * 100 + '%')
  fortschritt.value = x
  if (!props.f.streifen && video.value && video.value.duration) video.value.currentTime = video.value.duration * x
}
function verlassen() {
  drueber.value = false
  if (el.value) el.value.style.transform = ''
  fortschritt.value = 0
  video.value?.pause()
}
function betreten() {
  drueber.value = true
  if (!props.f.streifen && video.value) {
    video.value.muted = true
    void video.value.play().catch(() => {})
  }
}
const streifenStil = computed(() => {
  const n = props.f.streifen
  if (!n || !fortschritt.value) return null
  const i = Math.min(n - 1, Math.floor(fortschritt.value * n))
  return {
    backgroundImage: `url("${props.f.links.streifen}")`,
    backgroundSize: `${n * 100}% 100%`,
    backgroundPosition: `${(i / (n - 1)) * 100}% 50%`
  }
})
function klick() {
  if (props.auswahlModus) emit('waehlen')
  else emit('oeffnen')
}
</script>

<template>
  <article
    ref="el"
    class="karte"
    :class="{ gewaehlt }"
    :style="{ '--i': Math.min(i, 20) }"
    tabindex="0"
    @mousemove="bewegen"
    @mouseleave="verlassen"
    @mouseenter="betreten"
    @click="klick"
    @keydown.enter="emit('oeffnen')"
    @keydown.space.prevent="emit('waehlen')"
  >
    <div class="vorschau">
      <template v-if="f.art === 'bild' && !kaputt">
        <VdLive v-if="sichtbar && f.live && f.links.live" :src="f.links.live" :an="drueber" art="kachel"
          ><img
            :src="f.hat_vorschau ? f.links.vorschau : f.links.direkt"
            :alt="f.name"
            loading="lazy"
            decoding="async"
            @error="kaputt = true"
        /></VdLive>
        <img
          v-else-if="sichtbar"
          :src="f.hat_vorschau ? f.links.vorschau : f.links.direkt"
          :alt="f.name"
          loading="lazy"
          decoding="async"
          @error="kaputt = true"
        />
      </template>
      <template v-else-if="f.art === 'video' && !kaputt">
        <img v-if="sichtbar && f.hat_vorschau" :src="f.links.vorschau" :alt="f.name" loading="lazy" decoding="async" />
        <video
          v-else-if="sichtbar"
          ref="video"
          :src="f.links.direkt + '#t=0.5'"
          preload="metadata"
          muted
          playsinline
          loop
          @error="kaputt = true"
        ></video>
        <div v-if="streifenStil" class="streifen" :style="streifenStil"></div>
        <div class="spielen">
          <span><Ico n="play" /></span>
        </div>
        <span v-if="f.duration_ms" class="dauer">{{ dauer(f.duration_ms) }}</span>
        <div class="scrub" :style="{ width: fortschritt * 100 + '%' }"></div>
      </template>
      <div v-else-if="f.art === 'audio'" class="wellenform" :class="{ spielt: tonSpielt }">
        <i v-for="(h, j) in wellen" :key="j" :style="{ height: h + '%', '--j': j }"></i>
        <button
          type="button"
          class="ton"
          :aria-label="tonSpielt ? t('Anhalten', 'Pause') : t('Anhören', 'Listen')"
          @click.stop="tonUm"
        >
          <Ico :n="tonSpielt ? 'pause' : 'play'" />
        </button>
        <span v-if="f.duration_ms" class="dauer">{{ dauer(f.duration_ms) }}</span>
      </div>
      <pre v-else-if="f.art === 'text'" class="code">{{ textVorschau }}</pre>
      <div v-else-if="f.verschluesselt" class="datei-ic e2e-ic">
        <Ico n="lock" /><small>{{ endung }}</small>
      </div>
      <div v-else class="datei-ic">
        <div>{{ endung }}</div>
      </div>
      <span class="art">{{ ART }}</span>
      <span
        v-if="f.verarbeitung === 'offen' || f.verarbeitung === 'laeuft'"
        class="verarbeitet"
        :title="t('Vorschau wird erstellt', 'Preview is being created')"
        ><Ico n="loader" spin
      /></span>
      <button
        class="auswahl"
        :aria-label="t('Auswählen', 'Select')"
        :aria-pressed="gewaehlt"
        @click.stop="emit('waehlen')"
      >
        <Ico n="check" />
      </button>
    </div>
    <span class="schein"></span>
    <div class="info">
      <div class="n" :title="f.name">{{ f.name }}</div>
      <div class="m">
        <span>{{ groesse(f.size) }}</span
        >·<span>{{ vorher(f.created_at) }}</span
        ><template v-if="f.von"
          >·<span class="von" :title="t('Hochgeladen von', 'Uploaded by')">{{ f.von }}</span></template
        >
        <span class="schutz">
          <Ico v-if="f.favorite" n="star" class="stern" />
          <Ico
            v-if="f.scan === 'fund'"
            n="shield"
            class="fund"
            :title="t(`Quarantäne: ${f.scan_info}`, `Quarantined: ${f.scan_info}`)"
          />
          <Ico v-if="f.passwort" n="lock" :title="t('Passwort', 'Password')" />
          <Ico v-if="f.expires_at" n="clock" :title="restzeit(f.expires_at)" />
          <Ico v-if="f.max_views" n="eye" :title="`${f.views}/${f.max_views}`" />
        </span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.karte {
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: var(--r);
  overflow: hidden;
  cursor: pointer;
  position: relative;
  transition:
    transform 0.35s var(--kurve),
    box-shadow 0.35s,
    border-color 0.25s;
  animation: rein 0.55s var(--kurve) backwards;
  animation-delay: calc(var(--i) * 40ms);
  transform-style: preserve-3d;
  will-change: transform;
}
.karte:hover {
  box-shadow:
    var(--schatten),
    0 18px 40px -22px rgba(0, 0, 0, 0.45);
  border-color: var(--linie2);
}
.karte.gewaehlt {
  border-color: var(--a);
  box-shadow: 0 0 0 3px rgba(var(--a-rgb), 0.18);
}
.schein {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s;
  background: radial-gradient(
    420px circle at var(--mx, 50%) var(--my, 50%),
    rgba(255, 255, 255, 0.14),
    transparent 42%
  );
  z-index: 2;
}
.karte:hover .schein {
  opacity: 1;
}
.vorschau {
  aspect-ratio: 4 / 3;
  position: relative;
  overflow: hidden;
  background: var(--flaeche2);
}
.vorschau img,
.vorschau video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.8s var(--kurve);
}
.karte:hover .vorschau img {
  transform: scale(1.05);
}
.art {
  position: absolute;
  left: 10px;
  top: 10px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  backdrop-filter: blur(8px);
  padding: 3px 7px;
  border-radius: 6px;
}
.dauer {
  position: absolute;
  right: 10px;
  bottom: 10px;
  font-size: 11px;
  font-family: var(--f-mono);
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  padding: 2px 6px;
  border-radius: 5px;
}
.spielen {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  transition: opacity 0.3s;
  background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.3));
  pointer-events: none;
}
.spielen span {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  color: #111;
  display: grid;
  place-items: center;
  transition:
    transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1.4),
    opacity 0.3s;
}
.spielen svg {
  width: 18px;
  height: 18px;
  margin-left: 3px;
}
.karte:hover .spielen {
  opacity: 0;
}
.scrub {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 3px;
  background: var(--a);
  z-index: 1;
}
.streifen {
  position: absolute;
  inset: 0;
  background-repeat: no-repeat;
  background-color: #000;
}
.verarbeitet {
  position: absolute;
  left: 10px;
  bottom: 10px;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  display: grid;
  place-items: center;
}
.verarbeitet svg {
  width: 13px;
  height: 13px;
}
.wellenform {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 16px;
  background: linear-gradient(160deg, rgba(var(--a-rgb), 0.1), transparent 60%);
}
.ton {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 50%;
  background: var(--a);
  color: var(--a-text, #fff);
  display: grid;
  place-items: center;
  cursor: pointer;
  box-shadow: 0 8px 22px -8px rgba(0, 0, 0, 0.6);
  transition:
    transform 0.15s var(--kurve),
    filter 0.2s;
  z-index: 2;
}
.ton:hover {
  filter: brightness(1.08);
  transform: translate(-50%, -50%) scale(1.06);
}
.ton :deep(svg) {
  width: 17px;
  height: 17px;
}
.ton:focus-visible {
  outline: 2px solid var(--text);
  outline-offset: 2px;
}
.wellenform i {
  flex: 1;
  border-radius: 2px;
  background: var(--text3);
  opacity: 0.55;
}
.karte:hover .wellenform i {
  animation: wogen 1s ease-in-out infinite alternate;
  animation-delay: calc(var(--j) * -60ms);
  background: var(--a);
  opacity: 0.9;
}
@keyframes wogen {
  to {
    transform: scaleY(0.45);
  }
}
.code {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 40px 14px 14px;
  font-family: var(--f-mono);
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--text2);
  white-space: pre;
  overflow: hidden;
  background: var(--flaeche2);
}
.datei-ic {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}
.datei-ic div {
  width: 56px;
  height: 70px;
  border-radius: 8px;
  background: var(--flaeche);
  border: 1px solid var(--linie2);
  display: grid;
  place-items: end center;
  padding-bottom: 10px;
  font-family: var(--f-mono);
  font-size: 10px;
  font-weight: 600;
  color: var(--a);
  position: relative;
  box-shadow: var(--schatten);
}
.datei-ic div::before {
  content: '';
  position: absolute;
  right: -1px;
  top: -1px;
  width: 16px;
  height: 16px;
  background: linear-gradient(225deg, var(--flaeche2) 50%, var(--linie2) 50%);
  border-bottom-left-radius: 4px;
}
.info {
  padding: 11px 12px 12px;
}
.n {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.m {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 11.5px;
  color: var(--text3);
  margin-top: 3px;
}
.schutz {
  margin-left: auto;
  display: flex;
  gap: 6px;
}
.schutz svg {
  width: 12px;
  height: 12px;
}
.schutz .stern {
  color: #f59e0b;
  fill: currentColor;
}
.auswahl {
  position: absolute;
  right: 10px;
  top: 10px;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  border: 1.5px solid rgba(255, 255, 255, 0.85);
  background: rgba(0, 0, 0, 0.25);
  opacity: 0;
  transition:
    opacity 0.2s,
    background 0.2s;
  display: grid;
  place-items: center;
  color: #fff;
  cursor: pointer;
  padding: 0;
  z-index: 3;
}
.auswahl svg {
  width: 13px;
  height: 13px;
  opacity: 0;
}
.karte:hover .auswahl,
.karte.gewaehlt .auswahl,
.auswahl:focus-visible {
  opacity: 1;
}
.karte.gewaehlt .auswahl {
  background: var(--a);
  border-color: var(--a);
}
.karte.gewaehlt .auswahl svg {
  opacity: 1;
}
.von {
  color: var(--a);
  font-weight: 500;
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.e2e-ic {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--a);
}
.e2e-ic svg {
  width: 26px;
  height: 26px;
}
.e2e-ic small {
  font-family: var(--f-mono);
  font-size: 10.5px;
  color: var(--text3);
}
.fund {
  color: var(--rot);
}
</style>
