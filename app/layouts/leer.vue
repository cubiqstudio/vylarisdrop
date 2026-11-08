<script setup lang="ts">
const el = ref<HTMLElement | null>(null)
function bewegen(e: MouseEvent) {
  el.value?.style.setProperty('--lx', e.clientX + 'px')
  el.value?.style.setProperty('--ly', e.clientY + 'px')
}
</script>

<template>
  <div ref="el" class="buehne" @mousemove="bewegen">
    <div class="licht" aria-hidden="true"></div>
    <slot />
    <VdBestaetigen />
  </div>
</template>

<style scoped>
.buehne {
  min-height: 100vh;
  min-height: 100dvh;
  position: relative;
  overflow-x: hidden;
  background:
    linear-gradient(var(--bg), var(--bg)) padding-box,
    var(--bg);
}
.buehne::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: 0.5;
  background-image:
    linear-gradient(var(--linie) 1px, transparent 1px), linear-gradient(90deg, var(--linie) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(ellipse 70% 60% at 50% 0%, #000 30%, transparent 75%);
}
.licht {
  position: fixed;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(520px circle at var(--lx, 50%) var(--ly, 10%), rgba(var(--a-rgb), 0.1), transparent 60%);
  transition: background 0.1s;
}
</style>
