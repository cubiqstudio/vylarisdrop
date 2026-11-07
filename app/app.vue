<script setup lang="ts">
const theme = useTheme()
const besucher = useBesucherThema()
watch(
  () => theme.value.lang,
  (l) => {
    sprache.value = l === 'en' ? 'en' : 'de'
  },
  { immediate: true }
)
const thema = computed(() => theme.value.user?.theme || besucher.value || 'system')

useHead({
  titleTemplate: (x) => (x ? `${x} · ${theme.value.name}` : theme.value.name),
  htmlAttrs: {
    lang: () => theme.value.lang || 'de',
    'data-theme': () => thema.value,
    style: () => `--a: ${theme.value.color}; --a-rgb: ${hexRgb(theme.value.color)}`
  },
  link: () => [
    { rel: 'icon', href: theme.value.marke?.icon || '/icon.svg', key: 'icon' },
    { rel: 'apple-touch-icon', href: theme.value.marke?.icon || '/icons/apple-touch-icon.png', key: 'apple-icon' }
  ],
  // Adressleiste/Statusleiste im Ton der Kopfzeile (Hintergrund des gewählten Themas); "system" folgt dem Gerät
  meta: () => [
    { name: 'apple-mobile-web-app-title', content: theme.value.name, key: 'apple-titel' },
    ...(thema.value === 'system'
      ? [
          { name: 'theme-color', content: '#f5f9fe', media: '(prefers-color-scheme: light)', key: 'tc-hell' },
          { name: 'theme-color', content: '#0b0d11', media: '(prefers-color-scheme: dark)', key: 'tc-dunkel' }
        ]
      : [{ name: 'theme-color', content: thema.value === 'light' ? '#f5f9fe' : '#0b0d11', key: 'tc' }])
  ]
})
const { toasts } = useToast()
</script>

<template>
  <div>
    <NuxtLayout><NuxtPage :transition="{ name: 'seite', mode: 'default' }" /></NuxtLayout>
    <TransitionGroup tag="div" name="toast-raus" class="toasts" aria-live="polite">
      <div v-for="x in toasts" :key="x.id" class="toast" :class="x.art">
        <Ico :n="x.art === 'ok' ? 'check' : 'alert'" />
        {{ x.text }}
      </div>
    </TransitionGroup>
  </div>
</template>
