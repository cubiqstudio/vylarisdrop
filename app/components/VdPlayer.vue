<script setup lang="ts">
const props = defineProps<{
  src: string
  poster?: string | null
  streifen?: string | null
  streifenAnzahl?: number
  breite?: number | null
  hoehe?: number | null
}>()
const huelle = ref<HTMLElement | null>(null)
const video = ref<HTMLVideoElement | null>(null)
const spielt = ref(false)
const zeit = ref(0)
const dauer = ref(0)
const puffer = ref(0)
const lautstaerke = ref(1)
const stumm = ref(false)
const tempo = ref(1)
const vollbild = ref(false)
const sichtbar = ref(true)
const tempoMenu = ref(false)
const puls = ref<'' | 'an' | 'aus'>('')
const hover = ref<{ x: number; anteil: number } | null>(null)
const ziehen = ref(false)
let ausblenden: any = null

const fmt = (s: number) => {
  if (!Number.isFinite(s)) return '0:00'
  const m = Math.floor(s / 60),
    x = Math.floor(s % 60)
  return m >= 60
    ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(x).padStart(2, '0')}`
    : `${m}:${String(x).padStart(2, '0')}`
}
const anteil = computed(() => (dauer.value ? zeit.value / dauer.value : 0))

function umschalten() {
  const v = video.value
  if (!v) return
  if (v.paused) void v.play()
  else v.pause()
  puls.value = v.paused ? 'aus' : 'an'
  setTimeout(() => {
    puls.value = ''
  }, 600)
}
function regen() {
  sichtbar.value = true
  clearTimeout(ausblenden)
  if (spielt.value && !tempoMenu.value)
    ausblenden = setTimeout(() => {
      sichtbar.value = false
    }, 2500)
}
function springen(s: number) {
  const v = video.value
  if (v) {
    v.currentTime = Math.max(0, Math.min(dauer.value, v.currentTime + s))
    regen()
  }
}
function setzeLaut(v: number) {
  if (!video.value) return
  video.value.volume = Math.max(0, Math.min(1, v))
  video.value.muted = video.value.volume === 0
  regen()
}
function setzeTempo(t: number) {
  if (video.value) video.value.playbackRate = t
  tempo.value = t
  tempoMenu.value = false
  regen()
}
async function voll() {
  if (!huelle.value) return
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
  else await huelle.value.requestFullscreen().catch(() => {})
}
async function bild() {
  const v: any = video.value
  try {
    if ((document as any).pictureInPictureElement) await (document as any).exitPictureInPicture()
    else await v?.requestPictureInPicture()
  } catch {}
}

const leiste = ref<HTMLElement | null>(null)
const klein = ref(false)
let groesse: ResizeObserver | null = null
const vollbildWechsel = () => {
  vollbild.value = document.fullscreenElement === huelle.value
}
function posAus(e: PointerEvent) {
  const r = leiste.value!.getBoundingClientRect()
  const a = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  return { a, x: e.clientX - r.left, w: r.width }
}
function leisteBewegen(e: PointerEvent) {
  const p = posAus(e)
  hover.value = { x: Math.max(70, Math.min(p.w - 70, p.x)), anteil: p.a }
  if (ziehen.value && video.value) video.value.currentTime = p.a * dauer.value
}
function leisteDruecken(e: PointerEvent) {
  ziehen.value = true
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  leisteBewegen(e)
}
function leisteLos() {
  ziehen.value = false
}
const streifenStil = computed(() => {
  if (!props.streifen || !hover.value || !props.streifenAnzahl) return null
  const n = props.streifenAnzahl,
    i = Math.min(n - 1, Math.floor(hover.value.anteil * n))
  return {
    backgroundImage: `url("${props.streifen}")`,
    backgroundSize: `${n * 100}% 100%`,
    backgroundPosition: `${(i / (n - 1)) * 100}% 0`
  }
})

function taste(e: KeyboardEvent) {
  const z = e.target as HTMLElement
  if (z && z.closest('input, textarea, .vd-wahl')) return
  const k = e.key.toLowerCase()
  if (k === ' ' || k === 'k') {
    e.preventDefault()
    umschalten()
  } else if (k === 'arrowleft') springen(-5)
  else if (k === 'arrowright') springen(5)
  else if (k === 'j') springen(-10)
  else if (k === 'l') springen(10)
  else if (k === 'arrowup') {
    e.preventDefault()
    setzeLaut(lautstaerke.value + 0.1)
  } else if (k === 'arrowdown') {
    e.preventDefault()
    setzeLaut(lautstaerke.value - 0.1)
  } else if (k === 'm' && video.value) {
    video.value.muted = !video.value.muted
    regen()
  } else if (k === 'f') void voll()
}
onMounted(() => {
  const v = video.value!
  v.addEventListener('play', () => {
    spielt.value = true
    regen()
  })
  v.addEventListener('pause', () => {
    spielt.value = false
    sichtbar.value = true
  })
  v.addEventListener('timeupdate', () => {
    zeit.value = v.currentTime
  })
  v.addEventListener('loadedmetadata', () => {
    dauer.value = v.duration
  })
  v.addEventListener('durationchange', () => {
    dauer.value = v.duration
  })
  v.addEventListener('progress', () => {
    if (v.buffered.length && v.duration) puffer.value = v.buffered.end(v.buffered.length - 1) / v.duration
  })
  v.addEventListener('volumechange', () => {
    lautstaerke.value = v.volume
    stumm.value = v.muted
  })
  if (v.readyState >= 1) dauer.value = v.duration
  zeit.value = v.currentTime
  spielt.value = !v.paused
  document.addEventListener('fullscreenchange', vollbildWechsel)
  groesse = new ResizeObserver(([e]) => {
    if (e) klein.value = e.contentRect.width < 460
  })
  if (huelle.value) groesse.observe(huelle.value)
  huelle.value?.addEventListener('keydown', taste)
})
onBeforeUnmount(() => {
  clearTimeout(ausblenden)
  groesse?.disconnect()
  document.removeEventListener('fullscreenchange', vollbildWechsel)
})
const seitenverhaeltnis = computed(() => (props.breite && props.hoehe ? `${props.breite} / ${props.hoehe}` : '16 / 9'))
</script>

<template>
  <div ref="huelle" class="player" :class="{ spielt, ausgeblendet: !sichtbar, vollbild, klein }" tabindex="0" :style="{ aspectRatio: vollbild ? undefined : seitenverhaeltnis }"
    @mousemove="regen" @mouseleave="spielt && (sichtbar = false)" @dblclick="voll">
    <video ref="video" :src="src" :poster="poster || undefined" playsinline preload="metadata" @click="umschalten"></video>
    <button v-if="!spielt && zeit === 0" class="gross-play" :aria-label="t('Abspielen', 'Play')" @click="umschalten"><Ico n="play" /></button>
    <span v-if="puls" class="puls" :class="puls"><Ico :n="puls === 'an' ? 'play' : 'pause'" /></span>

    <div class="leiste-unten" @click.stop>
      <div ref="leiste" class="zeitleiste" role="slider" :aria-label="t('Position', 'Position')" :aria-valuenow="Math.round(zeit)" :aria-valuemax="Math.round(dauer)"
        @pointermove="leisteBewegen" @pointerleave="hover = null" @pointerdown="leisteDruecken" @pointerup="leisteLos">
        <div class="spur"><i class="puffer" :style="{ width: puffer * 100 + '%' }"></i><i class="gespielt" :style="{ width: anteil * 100 + '%' }"></i><i v-if="hover" class="hover" :style="{ width: hover.anteil * 100 + '%' }"></i></div>
        <span class="knauf" :style="{ left: anteil * 100 + '%' }"></span>
        <Transition name="tipp">
          <div v-if="hover" class="tipp" :style="{ left: hover.x + 'px' }">
            <div v-if="streifenStil" class="tipp-bild" :style="streifenStil"></div>
            <span>{{ fmt(hover.anteil * dauer) }}</span>
          </div>
        </Transition>
      </div>
      <div class="knoepfe">
        <button :aria-label="spielt ? t('Pause', 'Pause') : t('Abspielen', 'Play')" @click="umschalten"><Ico :n="spielt ? 'pause' : 'play'" /></button>
        <button class="sprung" :aria-label="t('10 s zurück', 'Back 10 s')" @click="springen(-10)"><Ico n="left" /></button>
        <button class="sprung" :aria-label="t('10 s vor', 'Forward 10 s')" @click="springen(10)"><Ico n="right" /></button>
        <div class="laut">
          <button :aria-label="t('Stumm', 'Mute')" @click="video && (video.muted = !video.muted)"><Ico n="volume" :class="{ aus: stumm || lautstaerke === 0 }" /></button>
          <input type="range" min="0" max="1" step="0.05" :value="stumm ? 0 : lautstaerke" :aria-label="t('Lautstärke', 'Volume')" @input="setzeLaut(Number(($event.target as HTMLInputElement).value))">
        </div>
        <span class="zeit mono">{{ fmt(zeit) }} <i>/</i> {{ fmt(dauer) }}</span>
        <div class="tempo">
          <button class="text" :aria-label="t('Geschwindigkeit', 'Speed')" @click="tempoMenu = !tempoMenu; regen()">{{ tempo }}×</button>
          <Transition name="tipp"><div v-if="tempoMenu" class="tempo-menu"><button v-for="x in [0.5, 0.75, 1, 1.25, 1.5, 2]" :key="x" :class="{ an: tempo === x }" @click="setzeTempo(x)">{{ x }}×</button></div></Transition>
        </div>
        <button class="pip" :aria-label="t('Bild im Bild', 'Picture in picture')" @click="bild"><Ico n="external" /></button>
        <button :aria-label="t('Vollbild', 'Fullscreen')" @click="voll"><Ico n="maximize" /></button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.player {
  position: relative;
  width: 100%;
  background: #000;
  border-radius: inherit;
  overflow: hidden;
  outline: none;
  max-height: 78vh;
  display: grid;
  place-items: center;
  user-select: none;
  justify-self: stretch;
  align-self: center;
}
.player.vollbild {
  max-height: none;
  border-radius: 0;
}
.player video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  cursor: pointer;
}
.player.ausgeblendet {
  cursor: none;
}
.gross-play {
  position: absolute;
  width: 76px;
  height: 76px;
  border-radius: 50%;
  border: 0;
  background: rgba(255, 255, 255, 0.94);
  color: #111;
  display: grid;
  place-items: center;
  cursor: pointer;
  box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.6);
  transition: transform 0.3s cubic-bezier(0.2, 0.9, 0.2, 1.4);
  animation: einschweben 0.6s var(--kurve) backwards;
}
.gross-play svg {
  width: 28px;
  height: 28px;
  margin-left: 4px;
}
.gross-play:hover {
  transform: scale(1.08);
}
.gross-play::after {
  content: '';
  position: absolute;
  inset: -8px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.5);
  animation: ring 2s ease-out infinite;
}
@keyframes ring {
  from {
    transform: scale(0.9);
    opacity: 1;
  }
  to {
    transform: scale(1.4);
    opacity: 0;
  }
}
@keyframes einschweben {
  from {
    opacity: 0;
    transform: scale(0.7);
  }
}
.puls {
  position: absolute;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  display: grid;
  place-items: center;
  pointer-events: none;
  animation: puls 0.6s ease-out forwards;
}
.puls svg {
  width: 24px;
  height: 24px;
}
@keyframes puls {
  from {
    opacity: 1;
    transform: scale(0.8);
  }
  to {
    opacity: 0;
    transform: scale(1.5);
  }
}
.leiste-unten {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 30px 16px 12px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.78));
  color: #fff;
  transition:
    opacity 0.35s,
    transform 0.35s var(--kurve);
}
.ausgeblendet .leiste-unten {
  opacity: 0;
  transform: translateY(10px);
  pointer-events: none;
}
.zeitleiste {
  position: relative;
  height: 18px;
  display: flex;
  align-items: center;
  cursor: pointer;
  touch-action: none;
}
.spur {
  position: absolute;
  left: 0;
  right: 0;
  height: 4px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.2);
  overflow: hidden;
  transition: height 0.2s;
}
.zeitleiste:hover .spur {
  height: 6px;
}
.spur i {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 4px;
}
.puffer {
  background: rgba(255, 255, 255, 0.3);
  transition: width 0.3s;
}
.hover {
  background: rgba(255, 255, 255, 0.25);
}
.gespielt {
  background: var(--a);
  z-index: 1;
}
.knauf {
  position: absolute;
  width: 14px;
  height: 14px;
  margin-left: -7px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 0 4px rgba(var(--a-rgb), 0.4);
  transform: scale(0);
  transition: transform 0.2s cubic-bezier(0.2, 0.9, 0.2, 1.4);
  z-index: 2;
}
.zeitleiste:hover .knauf,
.player:not(.spielt) .knauf {
  transform: scale(1);
}
.tipp {
  position: absolute;
  bottom: 24px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  pointer-events: none;
}
.tipp-bild {
  width: 160px;
  height: 90px;
  border-radius: 8px;
  border: 2px solid #fff;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.55);
  background-repeat: no-repeat;
  background-color: #111;
}
.tipp span {
  font-family: var(--f-mono);
  font-size: 11.5px;
  background: rgba(0, 0, 0, 0.8);
  padding: 2px 7px;
  border-radius: 5px;
}
.tipp-enter-active,
.tipp-leave-active {
  transition:
    opacity 0.15s,
    transform 0.2s var(--kurve);
}
.tipp-enter-from,
.tipp-leave-to {
  opacity: 0;
}
.knoepfe {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  flex-wrap: nowrap;
  min-width: 0;
}
.knoepfe button {
  border: 0;
  background: transparent;
  color: #fff;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition:
    background 0.15s,
    transform 0.15s;
}
.knoepfe button:hover {
  background: rgba(255, 255, 255, 0.12);
}
.knoepfe button:active {
  transform: scale(0.9);
}
.knoepfe svg {
  width: 17px;
  height: 17px;
}
.knoepfe .aus {
  opacity: 0.45;
}
.laut {
  display: flex;
  align-items: center;
}
.laut input {
  width: 0;
  opacity: 0;
  transition:
    width 0.25s var(--kurve),
    opacity 0.2s;
  accent-color: var(--a);
}
.laut:hover input,
.laut:focus-within input {
  width: 80px;
  opacity: 1;
}
.zeit {
  font-size: 12px;
  margin-left: 6px;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
}
.zeit i {
  opacity: 0.5;
  font-style: normal;
}
.tempo {
  position: relative;
  margin-left: auto;
}
.knoepfe button.text {
  width: auto;
  padding: 0 10px;
  font-size: 12.5px;
  font-weight: 600;
  font-family: var(--f-mono);
}
.tempo-menu {
  position: absolute;
  bottom: 42px;
  right: 0;
  background: rgba(20, 20, 24, 0.96);
  border-radius: 10px;
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 76px;
}
.tempo-menu button {
  width: 100% !important;
  font-size: 12.5px;
  font-family: var(--f-mono);
}
.tempo-menu button.an {
  color: var(--a);
}
.klein .knoepfe .sprung,
.klein .knoepfe .pip,
.klein .laut input {
  display: none;
}
.klein .leiste-unten {
  padding: 24px 10px 8px;
}
.klein .knoepfe button {
  width: 30px;
  height: 30px;
}
.klein .zeit {
  font-size: 11px;
}
.klein .gross-play {
  width: 58px;
  height: 58px;
}
.klein .gross-play svg {
  width: 22px;
  height: 22px;
}
@media (prefers-reduced-motion: reduce) {
  .gross-play::after {
    display: none;
  }
}
</style>
