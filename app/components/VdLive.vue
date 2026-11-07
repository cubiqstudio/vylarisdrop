<script setup lang="ts">
const props = withDefaults(defineProps<{ src: string; an?: boolean; art?: 'kachel' | 'ansicht' }>(), {
  an: undefined,
  art: 'ansicht'
})
const video = ref<HTMLVideoElement | null>(null)
const geladen = ref(false)
const spielt = ref(false)
const selbst = ref(false)
const aktiv = computed(() => (props.an === undefined ? selbst.value : props.an))

async function los() {
  if (ruhig()) return
  geladen.value = true
  await nextTick()
  const v = video.value
  if (!v) return
  v.muted = true
  v.currentTime = 0
  try {
    await v.play()
    spielt.value = true
  } catch {
    spielt.value = false
  }
}
function halt() {
  spielt.value = false
  video.value?.pause()
}
watch(aktiv, (a) => {
  if (a) void los()
  else halt()
})
function tippen(e: Event) {
  if (props.an !== undefined || !matchMedia('(hover: none)').matches) return
  e.preventDefault()
  e.stopPropagation()
  if (spielt.value) halt()
  else void los()
}
</script>

<template>
  <div class="live" :class="[art, { spielt }]" @mouseenter="selbst = true" @mouseleave="selbst = false" @click="tippen">
    <slot />
    <video
      v-if="geladen"
      ref="video"
      :src="src"
      muted
      playsinline
      preload="auto"
      disablepictureinpicture
      @ended="spielt = false"
      @error="spielt = false"
    ></video>
    <span class="marke" :title="t('Live Photo — drüberfahren zum Abspielen', 'Live Photo — hover to play')"
      ><i class="ringe" aria-hidden="true"></i>LIVE</span
    >
  </div>
</template>

<style scoped>
.live {
  position: relative;
}
.live.kachel {
  display: block;
  width: 100%;
  height: 100%;
}
.live.ansicht {
  display: inline-block;
  line-height: 0;
  max-width: 100%;
  max-height: 100%;
}
.live > :deep(img) {
  display: block;
}
video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 0;
  transition: opacity 0.35s ease;
  pointer-events: none;
}
.kachel video {
  object-fit: cover;
}
.live.spielt video {
  opacity: 1;
}
.live :deep(img) {
  transition:
    transform 0.8s var(--kurve),
    filter 0.35s;
}
.marke {
  position: absolute;
  left: 10px;
  top: 10px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px 3px 5px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  color: #fff;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  z-index: 2;
  pointer-events: none;
  transition: background 0.3s;
}
.kachel .marke {
  top: auto;
  bottom: 10px;
}
.ringe {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1.5px dotted currentColor;
  position: relative;
}
.ringe::after {
  content: '';
  position: absolute;
  inset: 2px;
  border-radius: 50%;
  border: 1.5px solid currentColor;
}
.live.spielt .marke {
  background: rgba(var(--a-rgb), 0.85);
}
.live.spielt .ringe {
  animation: drehen 2.4s linear infinite;
}
@keyframes drehen {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  video {
    transition: none;
  }
  .live.spielt .ringe {
    animation: none;
  }
}
</style>
