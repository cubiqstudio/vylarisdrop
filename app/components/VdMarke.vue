<script setup lang="ts">
const theme = useTheme()
const uid = `vdm${useId().replace(/\W/g, '')}`
const logo = computed(() => theme.value.marke?.logo || '')
const teile = computed(() => {
  const n = theme.value.name || 'VylarisCloud'
  return n === 'VylarisCloud' ? ['Vylaris', 'Cloud'] : [n, '']
})
</script>

<template>
  <span class="marke">
    <img v-if="logo" :src="logo" :alt="theme.name" :class="['marke-bild', { breit: theme.marke?.nurLogo }]" />
    <svg v-else class="marke-zeichen" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient :id="`${uid}g`" x1="14" y1="8" x2="50" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#5aa9e6" />
          <stop offset=".55" stop-color="#1e73be" />
          <stop offset="1" stop-color="#4256e0" />
        </linearGradient>
        <mask :id="`${uid}m`">
          <rect width="64" height="64" fill="#fff" />
          <path d="M21.5 29.5h7.4L32.5 40l3.6-10.5h7.4L35.5 50.5h-6.1Z" fill="#000" />
        </mask>
      </defs>
      <path
        d="M19 53a12.5 12.5 0 0 1-2.2-24.8A17 17 0 0 1 48.6 24.4 14.5 14.5 0 0 1 45 53Z"
        :fill="`url(#${uid}g)`"
        :mask="`url(#${uid}m)`"
      />
    </svg>
    <b v-if="!(logo && theme.marke?.nurLogo)"
      >{{ teile[0] }}<span v-if="teile[1]">{{ teile[1] }}</span></b
    >
  </span>
</template>

<style scoped>
.marke {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.marke-zeichen {
  width: 32px;
  height: 32px;
  flex: none;
  filter: drop-shadow(0 4px 10px rgba(var(--a-rgb), 0.28));
}
.marke-bild {
  width: 30px;
  height: 30px;
  object-fit: contain;
  border-radius: 8px;
}
.marke-bild.breit {
  width: auto;
  max-width: 180px;
  height: 32px;
  border-radius: 0;
}
b {
  font-family: var(--f-display);
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
b span {
  color: var(--a);
}
</style>
