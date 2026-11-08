<script setup lang="ts">
// Kontextmenü (Rechtsklick, langes Drücken, "…"-Knopf) — Pfeiltasten, Enter, Esc
import type { MenuePunkt } from '~/composables/useCloud'
const props = defineProps<{ x: number; y: number; punkte: MenuePunkt[]; titel?: string }>()
const emit = defineEmits<{ (e: 'waehle', k: string): void; (e: 'zu'): void }>()
const el = ref<HTMLElement | null>(null)
const pos = reactive({ x: props.x, y: props.y })
const aktiv = ref(0)
const sichtbar = computed(() => props.punkte.filter((p) => !p.trenner))

function platzieren() {
  const m = el.value
  if (!m) return
  const r = m.getBoundingClientRect()
  pos.x = Math.max(8, Math.min(props.x, innerWidth - r.width - 8))
  pos.y = Math.max(8, Math.min(props.y, innerHeight - r.height - 8))
}
function taste(e: KeyboardEvent) {
  const n = sichtbar.value.length
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('zu')
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    e.stopPropagation()
    for (let i = 1; i <= n; i++) {
      const j = (aktiv.value + (e.key === 'ArrowDown' ? i : -i) + n * 2) % n
      if (!sichtbar.value[j]!.aus) {
        aktiv.value = j
        break
      }
    }
    el.value?.querySelectorAll<HTMLElement>('[role=menuitem]')[aktiv.value]?.focus({ preventScroll: true })
  } else if (e.key === 'Enter' || e.key === ' ') {
    const p = sichtbar.value[aktiv.value]
    if (p && !p.aus) {
      e.preventDefault()
      e.stopPropagation()
      emit('waehle', p.k)
    }
  } else if (e.key === 'Tab') {
    e.preventDefault()
    emit('zu')
  }
}
function aussen(e: Event) {
  if (el.value && !el.value.contains(e.target as Node)) emit('zu')
}
onMounted(() => {
  void nextTick(() => {
    platzieren()
    el.value?.querySelector<HTMLElement>('[role=menuitem]:not([aria-disabled=true])')?.focus({ preventScroll: true })
    aktiv.value = Math.max(0, sichtbar.value.findIndex((p) => !p.aus))
  })
  document.addEventListener('keydown', taste, true)
  document.addEventListener('pointerdown', aussen, true)
  window.addEventListener('scroll', zumachen, true)
  window.addEventListener('resize', zumachen)
})
const geoeffnet = Date.now()
const zumachen = () => {
  if (Date.now() - geoeffnet > 300) emit('zu')
}
onBeforeUnmount(() => {
  document.removeEventListener('keydown', taste, true)
  document.removeEventListener('pointerdown', aussen, true)
  window.removeEventListener('scroll', zumachen, true)
  window.removeEventListener('resize', zumachen)
})
</script>

<template>
  <Teleport to="body">
    <div ref="el" class="menue" role="menu" :aria-label="titel" :style="{ left: pos.x + 'px', top: pos.y + 'px' }" @contextmenu.prevent>
      <template v-for="p in punkte" :key="p.k">
        <hr v-if="p.trenner" />
        <button
          v-else
          type="button"
          role="menuitem"
          class="punkt"
          :class="{ gefahr: p.gefahr, an: sichtbar[aktiv]?.k === p.k }"
          :aria-disabled="p.aus || undefined"
          :tabindex="-1"
          @mouseenter="aktiv = sichtbar.findIndex((x) => x.k === p.k)"
          @click="!p.aus && emit('waehle', p.k)"
        >
          <Ico v-if="p.ic" :n="p.ic" />
          <span>{{ p.text }}</span>
          <kbd v-if="p.kurz">{{ p.kurz }}</kbd>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.menue {
  position: fixed;
  z-index: 260;
  min-width: 220px;
  max-width: calc(100vw - 16px);
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 12px;
  padding: 6px;
  box-shadow: 0 18px 50px -12px rgba(0, 0, 0, 0.5);
  animation: menueRein 0.14s var(--kurve) backwards;
}
@keyframes menueRein {
  from {
    opacity: 0;
    transform: scale(0.97) translateY(-4px);
  }
}
.punkt {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: 0;
  background: transparent;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  color: var(--text);
}
.punkt svg {
  width: 15px;
  height: 15px;
  color: var(--text2);
}
.punkt.an {
  background: var(--flaeche2);
}
.punkt.gefahr,
.punkt.gefahr svg {
  color: var(--rot);
}
.punkt[aria-disabled='true'] {
  opacity: 0.45;
  cursor: default;
}
.punkt span {
  white-space: nowrap;
}
.punkt kbd {
  margin-left: auto;
  padding-left: 16px;
  font-family: var(--f-mono);
  font-size: 11px;
  color: var(--text3);
  white-space: nowrap;
}
@media (pointer: coarse), (max-width: 720px) {
  .punkt kbd {
    display: none;
  }
  .punkt {
    padding: 11px 12px;
    min-height: 44px;
    font-size: 15px;
  }
}
/* Kleine Bildschirme: Kontextmenü als Bottom-Sheet am unteren Rand (Position aus dem Skript wird überstimmt) */
@media (max-width: 720px) {
  .menue {
    left: 0 !important;
    right: 0 !important;
    top: auto !important;
    bottom: 0;
    width: 100%;
    max-width: none;
    max-height: 72dvh;
    overflow-y: auto;
    border-width: 1px 0 0;
    border-radius: 18px 18px 0 0;
    padding: 14px max(10px, env(safe-area-inset-right, 0px)) calc(10px + env(safe-area-inset-bottom, 0px)) max(10px, env(safe-area-inset-left, 0px));
    /* abdunkelnder Hintergrund ohne eigenes Element */
    box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.4);
    animation-name: sheetRein;
  }
  .menue::before {
    content: '';
    display: block;
    width: 38px;
    height: 4px;
    border-radius: 4px;
    background: var(--linie2);
    margin: -6px auto 8px;
  }
  @keyframes sheetRein {
    from {
      transform: translateY(40px);
      opacity: 0.4;
    }
  }
}
hr {
  border: 0;
  border-top: 1px solid var(--linie);
  margin: 5px 4px;
}
@media (prefers-reduced-motion: reduce) {
  .menue {
    animation: none;
  }
}
</style>
