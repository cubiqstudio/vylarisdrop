<script setup lang="ts">
const props = defineProps<{
  src: string
  wellen?: number[] | null
  titel?: string
  klein?: boolean
  dauerMs?: number | null
}>()
const laengeAus = (d: number) => (Number.isFinite(d) && d > 0 ? d : (props.dauerMs || 0) / 1000)
const audio = ref<HTMLAudioElement | null>(null)
const spielt = ref(false)
const zeit = ref(0)
const dauer = ref(0)
const tempo = ref(1)
const balken = computed(() => {
  const w =
    props.wellen && props.wellen.length
      ? props.wellen
      : Array.from(
          { length: 120 },
          (_, i) => 30 + Math.round(Math.abs(Math.sin(i * 0.37) * 40 + Math.sin(i * 1.3) * 15))
        )
  const n = props.klein ? 60 : w.length
  return Array.from({ length: n }, (_, i) => Math.max(6, w[Math.floor((i * w.length) / n)] || 0))
})
const anteil = computed(() => (dauer.value ? zeit.value / dauer.value : 0))
const fmt = (s: number) =>
  Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00'
function umschalten() {
  const a = audio.value
  if (!a) return
  if (a.paused) void a.play()
  else a.pause()
}
const welle = ref<HTMLElement | null>(null)
const ziehen = ref(false)
function spulen(e: PointerEvent) {
  if (!welle.value || !audio.value || !dauer.value) return
  const r = welle.value.getBoundingClientRect()
  audio.value.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dauer.value
}
function tempoUm() {
  const l = [1, 1.25, 1.5, 2, 0.75]
  tempo.value = l[(l.indexOf(tempo.value) + 1) % l.length]!
  if (audio.value) audio.value.playbackRate = tempo.value
}
onMounted(() => {
  const a = audio.value!
  a.addEventListener('play', () => {
    spielt.value = true
  })
  a.addEventListener('pause', () => {
    spielt.value = false
  })
  a.addEventListener('timeupdate', () => {
    zeit.value = a.currentTime
  })
  a.addEventListener('loadedmetadata', () => {
    dauer.value = laengeAus(a.duration)
  })
  a.addEventListener('durationchange', () => {
    dauer.value = laengeAus(a.duration)
  })
  if (a.readyState >= 1) dauer.value = laengeAus(a.duration)
  zeit.value = a.currentTime
  spielt.value = !a.paused
})
</script>

<template>
  <div class="audio" :class="{ spielt, klein }">
    <audio ref="audio" :src="src" preload="metadata"></audio>
    <button class="play" :aria-label="spielt ? t('Pause', 'Pause') : t('Abspielen', 'Play')" @click="umschalten">
      <Ico :n="spielt ? 'pause' : 'play'" />
    </button>
    <div class="rechts">
      <div v-if="titel && !klein" class="titel">{{ titel }}</div>
      <div
        ref="welle"
        class="welle"
        role="slider"
        :aria-label="t('Position', 'Position')"
        :aria-valuenow="Math.round(zeit)"
        :aria-valuemax="Math.round(dauer)"
        @pointerdown="
          (e) => {
            ziehen = true;
            spulen(e);
          }
        "
        @pointermove="
          (e) => {
            if (ziehen) spulen(e);
          }
        "
        @pointerup="ziehen = false"
        @pointerleave="ziehen = false"
      >
        <i
          v-for="(h, i) in balken"
          :key="i"
          :style="{ height: h + '%', '--i': i }"
          :class="{ gespielt: i / balken.length < anteil, jetzt: spielt && Math.floor(anteil * balken.length) === i }"
        ></i>
      </div>
      <div class="unten mono">
        <span>{{ fmt(zeit) }}</span
        ><button class="tempo" @click="tempoUm">{{ tempo }}×</button><span>{{ fmt(dauer) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.audio {
  display: flex;
  align-items: center;
  gap: 18px;
  width: 100%;
  padding: 22px;
}
.play {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 0;
  background: var(--a);
  color: #fff;
  cursor: pointer;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  box-shadow: 0 14px 30px -10px rgba(var(--a-rgb), 0.8);
  transition: transform 0.25s cubic-bezier(0.2, 0.9, 0.2, 1.4);
  position: relative;
}
.play svg {
  width: 22px;
  height: 22px;
}
.play:hover {
  transform: scale(1.06);
}
.spielt .play::after {
  content: '';
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  border: 2px solid rgba(var(--a-rgb), 0.5);
  animation: wellenring 1.6s ease-out infinite;
}
@keyframes wellenring {
  from {
    transform: scale(0.95);
    opacity: 1;
  }
  to {
    transform: scale(1.35);
    opacity: 0;
  }
}
.rechts {
  flex: 1;
  min-width: 0;
}
.titel {
  color: #fff;
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.welle {
  height: 72px;
  display: flex;
  align-items: center;
  gap: 2px;
  cursor: pointer;
  touch-action: none;
}
.welle i {
  flex: 1;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.22);
  transition:
    background 0.25s,
    transform 0.3s;
  animation: auf 0.7s var(--kurve) backwards;
  animation-delay: calc(var(--i) * 6ms);
  transform-origin: center;
}
.welle i.gespielt {
  background: var(--a);
}
.welle i.jetzt {
  animation: jetzt 0.5s ease-in-out infinite alternate;
  background: #fff;
}
@keyframes auf {
  from {
    transform: scaleY(0.1);
  }
}
@keyframes jetzt {
  to {
    transform: scaleY(1.25);
  }
}
.welle:hover i:not(.gespielt) {
  background: rgba(255, 255, 255, 0.35);
}
.unten {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.7);
  margin-top: 6px;
}
.tempo {
  border: 0;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border-radius: 6px;
  padding: 2px 8px;
  cursor: pointer;
  font: inherit;
}
.klein {
  padding: 12px;
  gap: 12px;
}
.klein .play {
  width: 42px;
  height: 42px;
}
.klein .play svg {
  width: 16px;
  height: 16px;
}
.klein .welle {
  height: 44px;
}
</style>
