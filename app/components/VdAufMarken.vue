<script setup lang="ts">
// Kennzeichen einer Datei beim Aufräumen: Freigabe (Link aufgerufen, Passwort, Ablauf, Galerie), Team, Favorit
defineProps<{ d: any }>()
</script>

<template>
  <span class="marken">
    <span v-if="d.geteilt?.galerie" class="chip warn" :title="t('Liegt in einem Ordner mit öffentlicher Galerie', 'Lives in a folder with a public gallery')">
      <Ico n="globe" /> {{ t('Galerie', 'Gallery') }}
    </span>
    <span v-if="d.geteilt?.passwort" class="chip warn" :title="t('Der Freigabe-Link ist mit einem Passwort geschützt', 'The share link is password-protected')">
      <Ico n="lock" /> {{ t('Passwort-Link', 'Password link') }}
    </span>
    <span v-if="d.geteilt?.schutz" class="chip warn" :title="t('Der Freigabe-Link hat Ablaufdatum oder Aufruf-Limit', 'The share link has an expiry date or a view limit')">
      <Ico n="clock" /> {{ t('Link mit Ablauf', 'Link with expiry') }}
    </span>
    <span v-if="d.geteilt?.link" class="chip warn" :title="t('Der Freigabe-Link wurde schon aufgerufen', 'The share link has been opened before')">
      <Ico n="link" /> {{ t(`Link ${d.aufrufe}× aufgerufen`, `Link opened ${d.aufrufe}×`) }}
    </span>
    <span v-if="d.team" class="chip info" :style="d.team.farbe ? { color: d.team.farbe } : undefined">
      <Ico n="users" /> {{ d.team.name }}<template v-if="!d.eigen"> · {{ t('von jemand anderem', 'by someone else') }}</template>
    </span>
    <span v-if="d.favorit" class="chip neutral"><Ico n="star" /> {{ t('Favorit', 'Favorite') }}</span>
    <span v-if="!d.darfLoeschen" class="chip rot" :title="t('Das darf nur die Team-Leitung oder wer die Datei hochgeladen hat', 'Only the team lead or the uploader may do this')">
      <Ico n="lock" /> {{ t('nicht löschbar', 'cannot delete') }}
    </span>
  </span>
</template>

<style scoped>
.marken {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px 6px;
}
.marken:empty {
  display: none;
}
</style>
