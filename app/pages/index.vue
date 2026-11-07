<script setup lang="ts">
// Platzhalter: wird vom Cloud-Dateimanager ersetzt.
useHead({ title: () => t('Meine Dateien', 'My files') })
</script>

<template>
  <div class="seite">
    <h1>{{ t('Meine Dateien', 'My files') }}</h1>
    <p>{{ t('Der Cloud-Dateimanager folgt.', 'The cloud file manager is coming.') }}</p>
    <NuxtLink to="/drop" class="knopf">{{ t('Zu Uploads & Links', 'Go to uploads & links') }}</NuxtLink>
  </div>
</template>
