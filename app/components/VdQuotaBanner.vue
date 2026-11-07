<script setup lang="ts">
// Hinweis über dem Inhalt, wenn der eigene Speicher knapp wird (ab 80 % gelb, ab 95 % rot, voll mit klarer Meldung)
const props = defineProps<{
  quota: { limit: number | null; used: number; free: number | null; prozent: number | null; stufe: string; papierkorb: number } | null | undefined
}>()
const weg = ref('')
onMounted(() => {
  try {
    weg.value = sessionStorage.getItem('vd_quota_banner') || ''
  } catch {}
})
const stufe = computed(() => (props.quota?.limit ? props.quota.stufe : 'ok'))
// Fällt die Belegung (live) wieder unter 80 %, gilt ein früheres Ausblenden nicht mehr: steigt sie erneut, erscheint der Hinweis wieder
watch(
  () => props.quota?.limit && props.quota.stufe === 'ok',
  (ok) => {
    if (!ok || !weg.value) return
    weg.value = ''
    try {
      sessionStorage.removeItem('vd_quota_banner')
    } catch {}
  }
)
// Vorgelesen wird nur ein Wechsel der Stufe, nicht jede Prozentänderung beim Live-Aktualisieren
const ansage = computed(() =>
  stufe.value === 'voll'
    ? t('Speicher voll', 'Storage full')
    : stufe.value === 'kritisch'
      ? t('Speicher fast voll', 'Storage almost full')
      : stufe.value === 'warn'
        ? t('Speicher zu über 80 Prozent belegt', 'Storage over 80 percent used')
        : ''
)
const sichtbar = computed(() => stufe.value !== 'ok' && (stufe.value === 'voll' || weg.value !== stufe.value))
function schliessen() {
  weg.value = stufe.value
  try {
    sessionStorage.setItem('vd_quota_banner', stufe.value)
  } catch {}
}
const text = computed(() => {
  const q = props.quota
  if (!q?.limit) return ''
  const von = `${groesse(q.used)} ${t('von', 'of')} ${groesse(q.limit)}`
  if (stufe.value === 'voll')
    return t(
      `Dein Speicher ist voll (${von}). Neue Uploads werden abgelehnt, bis du Platz schaffst.`,
      `Your storage is full (${von}). New uploads are rejected until you free up space.`
    )
  if (stufe.value === 'kritisch')
    return t(
      `Dein Speicher ist fast voll: ${Math.floor(q.prozent || 0)} % belegt (${von}).`,
      `Your storage is almost full: ${Math.floor(q.prozent || 0)}% used (${von}).`
    )
  return t(
    `Dein Speicher ist zu ${Math.floor(q.prozent || 0)} % belegt (${von}).`,
    `Your storage is ${Math.floor(q.prozent || 0)}% full (${von}).`
  )
})
</script>

<template>
  <div>
    <span class="versteckt" role="status">{{ sichtbar ? ansage : '' }}</span>
    <Transition name="qbanner">
      <div v-if="sichtbar" class="qbn" :class="stufe">
        <Ico n="alert" />
        <div class="txt">
          <b>{{ text }}</b>
          <span v-if="props.quota && props.quota.papierkorb > 0" class="klein">
            {{
              t(
                `Der Papierkorb belegt ${groesse(props.quota.papierkorb)} und zählt mit — leere ihn, um Platz zu schaffen.`,
                `The trash holds ${groesse(props.quota.papierkorb)} and counts towards your storage — empty it to free up space.`
              )
            }}
          </span>
          <span v-else class="klein">{{ t('Lösche Dateien, die du nicht mehr brauchst, oder bitte einen Admin um mehr Platz.', 'Delete files you no longer need or ask an admin for more space.') }}</span>
        </div>
        <NuxtLink v-if="props.quota && props.quota.papierkorb > 0" to="/papierkorb" class="knopf klein">
          <Ico n="trash" /> {{ t('Papierkorb', 'Trash') }}
        </NuxtLink>
        <button
          v-if="stufe !== 'voll'"
          type="button"
          class="knopf nur-icon klein"
          :aria-label="t('Hinweis ausblenden', 'Dismiss notice')"
          @click="schliessen"
        >
          <Ico n="x" />
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.qbn {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
  padding: 11px 14px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--warn) 35%, var(--linie));
  background: var(--warn-bg);
  color: var(--warn);
  font-size: 13px;
}
.qbn.kritisch,
.qbn.voll {
  border-color: color-mix(in srgb, var(--rot) 40%, var(--linie));
  background: var(--rot-bg);
  color: var(--rot);
}
.qbn > svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.txt {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.txt b {
  font-weight: 600;
}
.txt .klein {
  color: var(--text2);
  font-size: 12px;
}
@media (max-width: 560px) {
  .qbn {
    flex-wrap: wrap;
  }
}
.qbanner-enter-active,
.qbanner-leave-active {
  transition:
    opacity 0.25s,
    transform 0.3s var(--kurve);
}
.qbanner-enter-from,
.qbanner-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
