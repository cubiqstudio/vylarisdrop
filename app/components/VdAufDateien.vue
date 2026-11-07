<script setup lang="ts">
// Tabelle mit Dateien zum Aufräumen (größte Dateien, lange nicht genutzt): Auswahl per Kontrollkästchen, Ordnerpfad, Datum, Freigabe-Kennzeichen
const props = defineProps<{
  dateien: any[]
  modelValue: string[]
  beschriftung: string
  /** 'zuletzt' = zuletzt genutzt, 'erstellt' = hochgeladen am */
  datumArt?: 'zuletzt' | 'erstellt'
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string[]): void }>()
const gewaehlt = computed(() => new Set(props.modelValue))
const waehlbar = computed(() => props.dateien.filter((d) => d.darfLoeschen))
const alleGewaehlt = computed(() => waehlbar.value.length > 0 && waehlbar.value.every((d) => gewaehlt.value.has(d.id)))
const einige = computed(() => !alleGewaehlt.value && waehlbar.value.some((d) => gewaehlt.value.has(d.id)))
function umschalten(id: string, an: boolean) {
  const s = new Set(props.modelValue)
  if (an) s.add(id)
  else s.delete(id)
  emit('update:modelValue', [...s])
}
function alleUmschalten(an: boolean) {
  const s = new Set(props.modelValue)
  for (const d of waehlbar.value) {
    if (an) s.add(d.id)
    else s.delete(d.id)
  }
  emit('update:modelValue', [...s])
}
const sym = (d: any) => ({
  typ: 'datei',
  art: d.art === 'dokument' ? 'text' : d.art,
  mime: '',
  name: d.name,
  verschluesselt: false,
  hat_vorschau: !!d.vorschau,
  links: { vorschau: d.vorschau }
})
const datumVon = (d: any) => (props.datumArt === 'erstellt' ? d.erstellt : d.zuletzt)
const kopf = ref<HTMLInputElement | null>(null)
watchEffect(() => {
  if (kopf.value) kopf.value.indeterminate = einige.value
})
</script>

<template>
  <div class="tab-huelle">
    <table class="auf-tab">
      <caption class="versteckt">
        {{ beschriftung }}
      </caption>
      <thead>
        <tr>
          <th scope="col" class="c-wahl">
            <input
              ref="kopf"
              type="checkbox"
              :checked="alleGewaehlt"
              :disabled="!waehlbar.length"
              :aria-label="t('Alle löschbaren Dateien in dieser Liste auswählen', 'Select all deletable files in this list')"
              @change="alleUmschalten(($event.target as HTMLInputElement).checked)"
            />
          </th>
          <th scope="col">{{ t('Datei', 'File') }}</th>
          <th scope="col" class="r">{{ t('Größe', 'Size') }}</th>
          <th scope="col">{{ datumArt === 'erstellt' ? t('Hochgeladen', 'Uploaded') : t('Zuletzt genutzt', 'Last used') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="d in dateien" :key="d.id" :class="{ an: gewaehlt.has(d.id), gesperrt: !d.darfLoeschen }">
          <td class="c-wahl" data-l="">
            <input
              :id="'auf-' + d.id"
              type="checkbox"
              :checked="gewaehlt.has(d.id)"
              :disabled="!d.darfLoeschen"
              :aria-label="t(`„${d.name}“ auswählen`, `Select “${d.name}”`)"
              @change="umschalten(d.id, ($event.target as HTMLInputElement).checked)"
            />
          </td>
          <td class="c-name">
            <div class="datei">
              <VdCloudSymbol :e="sym(d)" />
              <div class="was">
                <label :for="'auf-' + d.id" class="name" :title="d.name">{{ d.name }}</label>
                <NuxtLink v-if="d.ordnerId" class="pfad" :to="{ path: '/', query: { ordner: d.ordnerId } }" :title="t('Im Dateimanager zeigen', 'Show in file manager')">
                  <Ico n="folder" /> {{ d.pfad }}
                </NuxtLink>
                <span v-else class="pfad leise"><Ico n="folder" /> {{ t('Oberste Ebene', 'Top level') }}</span>
                <VdAufMarken :d="d" />
              </div>
            </div>
          </td>
          <td class="r zahl" :data-l="t('Größe', 'Size')">
            <b>{{ groesse(d.size) }}</b>
          </td>
          <td class="zahl leise" :data-l="datumArt === 'erstellt' ? t('Hochgeladen', 'Uploaded') : t('Zuletzt genutzt', 'Last used')">
            {{ datum(datumVon(d)) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.tab-huelle {
  overflow-x: auto;
}
.auf-tab {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
}
.auf-tab th {
  text-align: left;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 6px 10px;
  border-bottom: 1px solid var(--linie);
}
.auf-tab td {
  padding: 9px 10px;
  border-bottom: 1px solid var(--linie);
  vertical-align: top;
}
.auf-tab tbody tr:last-child td {
  border-bottom: 0;
}
.auf-tab tr.an {
  background: rgba(var(--a-rgb), 0.07);
}
.auf-tab tr.gesperrt .name {
  color: var(--text3);
}
.r {
  text-align: right;
}
.c-wahl {
  width: 34px;
}
input[type='checkbox'] {
  width: 18px;
  height: 18px;
  accent-color: var(--a);
  cursor: pointer;
  margin: 4px 0 0;
}
input[type='checkbox']:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.datei {
  display: flex;
  gap: 10px;
  min-width: 0;
}
.was {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.name {
  font-weight: 500;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.pfad {
  font-size: 12px;
  color: var(--text3);
  display: inline-flex;
  gap: 5px;
  align-items: center;
  text-decoration: none;
  overflow-wrap: anywhere;
}
a.pfad:hover {
  color: var(--a);
}
.pfad svg {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}
@media (max-width: 640px) {
  .auf-tab thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .auf-tab,
  .auf-tab tbody {
    display: block;
  }
  .auf-tab tr {
    display: grid;
    grid-template-columns: 34px 1fr 1fr;
    grid-template-areas: 'w n n' '. g d';
    border-bottom: 1px solid var(--linie);
    padding: 8px 0;
    align-items: start;
  }
  .auf-tab td {
    border: 0;
    padding: 2px 8px;
  }
  .auf-tab td.c-wahl {
    grid-area: w;
    padding-top: 6px;
  }
  .auf-tab td.c-name {
    grid-area: n;
  }
  .auf-tab td:nth-child(3) {
    grid-area: g;
    text-align: left;
  }
  .auf-tab td:nth-child(4) {
    grid-area: d;
    text-align: right;
  }
}
</style>
