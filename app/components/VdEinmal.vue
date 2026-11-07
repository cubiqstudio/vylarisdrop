<script setup lang="ts">
const props = defineProps<{ titel: string; zeilen: Array<{ label: string; wert: string }>; hinweis?: string }>()
const emit = defineEmits<{ (e: 'zu'): void }>()
const allesKopiert = ref(false)
async function alle() {
  if (await kopieren(props.zeilen.map((z) => `${z.label}: ${z.wert}`).join('\n'))) {
    allesKopiert.value = true
    setTimeout(() => {
      allesKopiert.value = false
    }, 1500)
  }
}
</script>

<template>
  <VdModal :titel="titel" @zu="emit('zu')">
    <div class="warn">
      <Ico n="alert" /><span>{{
        hinweis ||
        t(
          'Das wird nur dieses eine Mal gezeigt — jetzt kopieren und sicher ablegen (z. B. im Passwort-Manager).',
          'This is shown only this once — copy it now and store it safely (e.g. in a password manager).'
        )
      }}</span>
    </div>
    <div class="zeilen"><VdKopierZeile v-for="z in zeilen" :key="z.label" :label="z.label" :wert="z.wert" /></div>
    <div class="modal-fuss">
      <button type="button" class="knopf" @click="alle">
        <Ico :n="allesKopiert ? 'check' : 'copy'" />
        {{ allesKopiert ? t('Kopiert', 'Copied') : t('Alles kopieren', 'Copy all') }}
      </button>
      <button type="button" class="knopf rot" @click="emit('zu')">
        {{ t('Gespeichert, schließen', 'Saved, close') }}
      </button>
    </div>
  </VdModal>
</template>

<style scoped>
.warn {
  background: var(--warn-bg);
  color: var(--warn);
  border-radius: 12px;
  padding: 11px 13px;
  font-size: 12.5px;
  display: flex;
  gap: 9px;
  margin-bottom: 12px;
  line-height: 1.5;
}
.warn svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  margin-top: 2px;
}
.zeilen {
  display: grid;
  gap: 8px;
}
</style>
