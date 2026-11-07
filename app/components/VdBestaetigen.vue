<script setup lang="ts">
const b = useBestaetigung()
async function ja() {
  const f = b.value?.aktion
  if (!f) return
  b.value = { ...b.value!, laeuft: true }
  try {
    await f()
  } finally {
    b.value = null
  }
}
</script>

<template>
  <VdModal v-if="b" :titel="b.titel" @zu="b = null">
    <p class="leise" style="margin:0">{{ b.text }}</p>
    <div class="modal-fuss">
      <button class="knopf" :disabled="b.laeuft" @click="b = null">{{ t('Abbrechen', 'Cancel') }}</button>
      <button class="knopf rot" :disabled="b.laeuft" @click="ja"><Ico v-if="b.laeuft" n="loader" spin />{{ b.knopf }}</button>
    </div>
  </VdModal>
</template>
