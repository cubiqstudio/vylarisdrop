<script setup lang="ts">
useHead({ title: () => t('Papierkorb', 'Trash') })
const theme = useTheme()
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const istAdmin = computed(() => theme.value.user?.role !== 'user')
const alle = ref(false)
const { data, refresh } = await (useFetch as any)('/api/papierkorb', {
  key: 'papierkorb',
  query: computed(() => (alle.value ? { alle: '1' } : {}))
})
const liste = computed<any[]>(() => data.value?.dateien || [])
const ARTIC: Record<string, string> = { bild: 'image', video: 'film', audio: 'music', text: 'text', datei: 'file' }
const weg = ref<string[]>([])
async function aktion(body: Record<string, any>, text: string) {
  try {
    if (body.id) weg.value = [...weg.value, body.id]
    await api('/api/papierkorb', { method: 'POST', body })
    ok(text)
    // Der Papierkorb zählt zum Speicher: Seitenleiste und Karte neu laden
    void refreshNuxtData(['stats', 'quota-me'])
    setTimeout(() => {
      void refresh().then(() => {
        weg.value = []
      })
    }, 350)
  } catch (e: any) {
    weg.value = weg.value.filter((x) => x !== body.id)
    fehler(e.message)
  }
}
const zurueck = (d: any) => aktion({ aktion: 'wiederherstellen', id: d.id }, t('Wiederhergestellt', 'Restored'))
function endgueltig(d: any) {
  bestaetigen(
    t('Endgültig löschen?', 'Delete permanently?'),
    t(
      `„${d.name}“ wird sofort und unwiderruflich gelöscht.`,
      `“${d.name}” will be deleted immediately and irreversibly.`
    ),
    t('Endgültig löschen', 'Delete permanently'),
    () => aktion({ aktion: 'loeschen', id: d.id }, t('Endgültig gelöscht', 'Deleted permanently'))
  )
}
function leeren() {
  bestaetigen(
    t('Papierkorb leeren?', 'Empty trash?'),
    t(
      'Alle Dateien im Papierkorb werden sofort und unwiderruflich gelöscht.',
      'All files in the trash will be deleted immediately and irreversibly.'
    ),
    t('Leeren', 'Empty'),
    () => aktion({ aktion: 'leeren' }, t('Papierkorb geleert', 'Trash emptied'))
  )
}
const tageBis = (d: string) => Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 86400000))
</script>

<template>
  <section class="rein">
    <div class="kopf">
      <div>
        <div class="eyebrow"><Ico n="trash" /> {{ t('Bibliothek', 'Library') }}</div>
        <h1>{{ t('Papierkorb', 'Trash') }}</h1>
        <p>
          {{
            t(
              `Gelöschte Dateien bleiben ${data?.tage || 30} Tage hier — danach sind sie endgültig weg.`,
              `Deleted files stay here for ${data?.tage || 30} days — after that they are gone for good.`
            )
          }}
        </p>
      </div>
      <div class="reihe">
        <label v-if="istAdmin" class="alle"
          ><button
            type="button"
            :class="['schalter', { an: alle }]"
            role="switch"
            :aria-checked="alle"
            @click="alle = !alle"
          ></button>
          {{ t('Alle Konten', 'All accounts') }}</label
        >
        <button v-if="liste.some((d) => d.eigen)" class="knopf gefahr" @click="leeren">
          <Ico n="trash" /> {{ t('Leeren', 'Empty') }}
        </button>
      </div>
    </div>
    <VdQuotaKarte />
    <div v-if="!liste.length" class="leer-hinweis block">
      <span class="leer-ic"><Ico n="trash" /></span>
      <h3>{{ t('Der Papierkorb ist leer', 'The trash is empty') }}</h3>
      <p>
        {{
          t(
            'Gelöschte Dateien landen hier und lassen sich wiederherstellen.',
            'Deleted files land here and can be restored.'
          )
        }}
      </p>
    </div>
    <TransitionGroup tag="div" name="weg" class="liste">
      <div
        v-for="(d, i) in liste.filter((x) => !weg.includes(x.id))"
        :key="d.id"
        class="zeile"
        :style="{ animationDelay: Math.min(i, 12) * 35 + 'ms' }"
      >
        <span class="ic"><Ico :n="ARTIC[d.art] || 'file'" /></span>
        <div class="was">
          <b>{{ d.name }}</b
          ><small
            >{{ groesse(d.size) }} · {{ t('gelöscht', 'deleted') }} {{ vorher(d.geloescht_at)
            }}<template v-if="d.von && d.von !== d.besitzer"> {{ t('von', 'by') }} {{ d.von }}</template
            ><template v-if="alle"> · {{ d.besitzer }}</template></small
          >
        </div>
        <span :class="['chip', tageBis(d.weg_am) <= 3 ? 'warn' : 'neutral']"
          ><Ico n="clock" /> {{ t(`noch ${tageBis(d.weg_am)} Tage`, `${tageBis(d.weg_am)} days left`) }}</span
        >
        <button class="knopf klein" @click="zurueck(d)"><Ico n="undo" /> {{ t('Wiederherstellen', 'Restore') }}</button>
        <button
          class="knopf nur-icon"
          :aria-label="t('Endgültig löschen', 'Delete permanently')"
          @click="endgueltig(d)"
        >
          <Ico n="x" />
        </button>
      </div>
    </TransitionGroup>
  </section>
</template>

<style scoped>
.alle {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  color: var(--text2);
  cursor: pointer;
}
.liste {
  display: grid;
  gap: 8px;
}
.zeile {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 14px;
  padding: 10px 12px;
  animation: rein 0.4s var(--kurve) backwards;
  flex-wrap: wrap;
}
.ic {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--flaeche2);
  color: var(--text3);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.ic svg {
  width: 16px;
  height: 16px;
}
.was {
  flex: 1;
  min-width: 180px;
  display: flex;
  flex-direction: column;
}
.was b {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.was small {
  color: var(--text3);
  font-size: 12px;
}
.leer-ic {
  display: inline-grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: var(--flaeche2);
  color: var(--text3);
  margin-bottom: 10px;
}
.leer-ic svg {
  width: 24px;
  height: 24px;
}
.weg-leave-active {
  transition:
    opacity 0.3s,
    transform 0.35s var(--kurve);
}
.weg-leave-to {
  opacity: 0;
  transform: translateX(30px);
}
.weg-move {
  transition: transform 0.35s var(--kurve);
}
</style>
