<script setup lang="ts">
// "Link teilen": nutzt den vorhandenen Datei-Link (Drop). Passwort, Ablauf und mehr stehen in den Drop-Optionen.
const props = defineProps<{ f: any }>()
const emit = defineEmits<{ (e: 'zu'): void; (e: 'optionen'): void }>()
const kopiert = ref('')
const LINKS = computed(() =>
  props.f.verschluesselt
    ? []
    : [
        { k: 'seite', text: t('Seite', 'Page'), url: props.f.links.seite, tipp: t('Vorschau mit Download-Knopf', 'Preview with download button') },
        { k: 'direkt', text: t('Direkt', 'Direct'), url: props.f.links.direkt, tipp: t('Die Datei selbst, zum Einbetten', 'The file itself, for embedding') },
        { k: 'download', text: 'Download', url: props.f.links.download, tipp: t('Startet sofort den Download', 'Starts the download right away') }
      ]
)
async function kopie(l: { k: string; url: string }) {
  if (await kopieren(l.url)) {
    kopiert.value = l.k
    setTimeout(() => {
      if (kopiert.value === l.k) kopiert.value = ''
    }, 1600)
  }
}
const schutz = computed(() => {
  const s: string[] = []
  if (props.f.passwort) s.push(t('Passwort', 'Password'))
  if (props.f.expires_at) s.push(restzeit(props.f.expires_at))
  if (props.f.max_views) s.push(t(`höchstens ${zahl(props.f.max_views)} Aufrufe`, `at most ${zahl(props.f.max_views)} views`))
  return s
})
</script>

<template>
  <VdModal :titel="t('Link teilen', 'Share link')" @zu="emit('zu')">
    <p class="leise" style="margin: 0 0 12px">
      {{ t(`Jeder mit dem Link kann „${f.name}“ öffnen.`, `Anyone with the link can open “${f.name}”.`) }}
    </p>
    <p v-if="f.verschluesselt" class="meldung meldung-warn">
      {{ t('Diese Datei ist Ende-zu-Ende verschlüsselt. Den Link mit Schlüssel findest du in den Drop-Optionen.', 'This file is end-to-end encrypted. You will find the link with the key in the drop options.') }}
    </p>
    <div v-for="l in LINKS" :key="l.k" class="link">
      <span class="et">{{ l.text }}</span>
      <code :title="l.tipp">{{ l.url.replace(/^https?:\/\//, '') }}</code>
      <button type="button" class="knopf nur-icon" :class="{ ok: kopiert === l.k }" :aria-label="t('Kopieren', 'Copy')" @click="kopie(l)">
        <Ico :n="kopiert === l.k ? 'check' : 'copy'" />
      </button>
    </div>
    <div v-if="schutz.length" class="reihe" style="margin-top: 10px">
      <span v-for="s in schutz" :key="s" class="chip info"><Ico n="lock" /> {{ s }}</span>
    </div>
    <p class="sehrleise hinweis">
      {{ t('Passwort, Ablaufdatum, maximale Aufrufe und Statistik stellst du in den Drop-Optionen ein.', 'Password, expiry date, maximum views and statistics are set in the drop options.') }}
      <NuxtLink to="/drop" @click="emit('zu')">{{ t('Zu Uploads & Links', 'Go to uploads & links') }}</NuxtLink>
    </p>
    <div class="modal-fuss">
      <button type="button" class="knopf" @click="emit('zu')">{{ t('Schließen', 'Close') }}</button>
      <button type="button" class="knopf rot" @click="emit('optionen')"><Ico n="gear" /> {{ t('Drop-Optionen', 'Drop options') }}</button>
    </div>
  </VdModal>
</template>

<style scoped>
.link {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--linie);
  border-radius: 10px;
  padding: 4px 4px 4px 12px;
  background: var(--bg);
  margin-top: 8px;
}
.et {
  width: 70px;
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text3);
}
code {
  flex: 1;
  min-width: 0;
  font-family: var(--f-mono);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.knopf.ok {
  background: var(--ok-bg);
  color: var(--ok);
}
.hinweis {
  font-size: 12.5px;
  margin: 14px 0 0;
}
.hinweis a {
  color: var(--a);
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
