<script setup lang="ts">
const props = defineProps<{ titel: string; breit?: boolean }>()
const emit = defineEmits<{ (e: 'zu'): void }>()
function taste(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('zu')
}
onMounted(() => document.addEventListener('keydown', taste))
onBeforeUnmount(() => document.removeEventListener('keydown', taste))
</script>

<template>
  <Teleport to="body">
    <div class="modal-hg" @click.self="emit('zu')">
      <div class="modal" :class="{ breit: props.breit }" role="dialog" aria-modal="true" :aria-label="props.titel">
        <div class="modal-kopf">
          <h2>{{ props.titel }}</h2>
          <button type="button" class="knopf nur-icon" :aria-label="t('Schließen', 'Close')" @click="emit('zu')">
            <Ico n="x" />
          </button>
        </div>
        <slot />
      </div>
    </div>
  </Teleport>
</template>
