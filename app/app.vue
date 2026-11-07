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
  link: () => [{ rel: 'icon', href: theme.value.marke?.icon || '/icon.svg', key: 'icon' }]
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
