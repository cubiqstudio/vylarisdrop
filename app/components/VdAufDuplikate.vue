<script setup lang="ts">
// Gruppen gleicher Dateien (sha256 + Größe). Je Gruppe bleibt mindestens eine Kopie stehen; geteilte Kopien werden nie automatisch zum Löschen vorgeschlagen.
const props = defineProps<{ gruppen: any[]; modelValue: string[] }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string[]): void }>()
const gewaehlt = computed(() => new Set(props.modelValue))

function setzen(ids: string[], an: boolean) {
  const s = new Set(props.modelValue)
  for (const id of ids) {
    if (an) s.add(id)
    else s.delete(id)
  }
  emit('update:modelValue', [...s])
}
const ids = (g: any) => g.kopien.map((k: any) => k.id)
const anzahlGewaehlt = (g: any) => g.kopien.filter((k: any) => gewaehlt.value.has(k.id)).length
/** Mindestens eine Kopie muss bleiben: die letzte noch nicht markierte Kopie lässt sich nicht markieren (wenn alle Kopien sichtbar sind) */
const gesperrt = (g: any, k: any) =>
  !k.darfLoeschen || (!gewaehlt.value.has(k.id) && g.ausgeblendet === 0 && anzahlGewaehlt(g) >= g.kopien.length - 1)
/** Auswahl einer Gruppe in einem Schritt ersetzen (ein einziges Ereignis, sonst rechnet der zweite Aufruf mit dem alten Stand) */
function ersetzen(g: any, neu: string[]) {
  const s = new Set(props.modelValue)
  for (const id of ids(g)) s.delete(id)
  for (const id of neu) s.add(id)
  emit('update:modelValue', [...s])
}
function empfehlung(g: any) {
  ersetzen(g, g.kopien.filter((k: any) => k.empfehlung === 'loeschen').map((k: any) => k.id))
}
function aelteste(g: any) {
  const sortiert = [...g.kopien].sort((a: any, b: any) => new Date(a.erstellt).getTime() - new Date(b.erstellt).getTime() || Number(a.id) - Number(b.id))
  const behalten = sortiert[0]?.id
  ersetzen(g, g.kopien.filter((k: any) => k.id !== behalten && k.darfLoeschen && !k.geteilt.irgendwie).map((k: any) => k.id))
}
const geschuetzt = (g: any) => g.kopien.filter((k: any) => k.geteilt.irgendwie).length
const sym = (d: any) => ({ typ: 'datei', art: d.art === 'dokument' ? 'text' : d.art, mime: '', name: d.name, verschluesselt: false, hat_vorschau: !!d.vorschau, links: { vorschau: d.vorschau } })
const gespart = (g: any) => g.kopien.filter((k: any) => gewaehlt.value.has(k.id)).length * g.size
</script>

<template>
  <div class="gruppen">
    <article v-for="g in gruppen" :key="g.sha256 + g.size" class="gruppe" :aria-labelledby="'dg-' + g.sha256.slice(0, 12)">
      <header>
        <div class="titel">
          <h4 :id="'dg-' + g.sha256.slice(0, 12)">{{ g.kopien[0]?.name }}</h4>
          <p class="leise">
            {{ t(`${g.anzahl} identische Kopien à ${groesse(g.size)}`, `${g.anzahl} identical copies of ${groesse(g.size)} each`) }} ·
            <b>{{ t('Ersparnis bis', 'Saves up to') }} {{ groesse(g.ersparnis) }}</b>
          </p>
        </div>
        <div class="knoepfe" role="group" :aria-label="t('Auswahl für diese Gruppe', 'Selection for this group')">
          <button type="button" class="knopf klein" @click="aelteste(g)"><Ico n="clock" /> {{ t('Nur die älteste behalten', 'Keep only the oldest') }}</button>
          <button type="button" class="knopf klein" @click="empfehlung(g)"><Ico n="check" /> {{ t('Empfehlung', 'Recommendation') }}</button>
          <button type="button" class="knopf klein" :disabled="!anzahlGewaehlt(g)" @click="setzen(ids(g), false)">{{ t('Keine', 'None') }}</button>
        </div>
      </header>
      <p v-if="geschuetzt(g)" class="meldung meldung-warn schutz" role="note">
        <Ico n="link" />
        {{
          t(
            `${geschuetzt(g)} Kopie(n) sind geteilt (Link, Passwort oder Galerie). Sie werden nie automatisch zum Löschen markiert — ihr Link funktioniert nach dem Löschen nicht mehr.`,
            `${geschuetzt(g)} copy/copies are shared (link, password or gallery). They are never marked for deletion automatically — their link stops working once deleted.`
          )
        }}
      </p>
      <ul class="kopien">
        <li v-for="k in g.kopien" :key="k.id" :class="{ an: gewaehlt.has(k.id), behalten: k.empfehlung === 'behalten' }">
          <input
            :id="'dk-' + k.id"
            type="checkbox"
            :checked="gewaehlt.has(k.id)"
            :disabled="gesperrt(g, k)"
            :aria-label="t(`Kopie „${k.name}“ in ${k.pfad || 'oberster Ebene'} zum Löschen markieren`, `Mark copy “${k.name}” in ${k.pfad || 'top level'} for deletion`)"
            @change="setzen([k.id], ($event.target as HTMLInputElement).checked)"
          />
          <VdCloudSymbol :e="sym(k)" />
          <div class="was">
            <label :for="'dk-' + k.id" class="name">{{ k.name }}</label>
            <span class="meta">
              <NuxtLink v-if="k.ordnerId" class="pfad" :to="{ path: '/', query: { ordner: k.ordnerId } }" :title="t('Im Dateimanager zeigen', 'Show in file manager')"><Ico n="folder" /> {{ k.pfad }}</NuxtLink>
              <span v-else class="pfad"><Ico n="folder" /> {{ t('Oberste Ebene', 'Top level') }}</span>
              <span class="leise zahl">{{ t('hochgeladen', 'uploaded') }} {{ datum(k.erstellt) }}</span>
            </span>
            <span class="meta">
              <span v-if="k.empfehlung === 'behalten'" class="chip ok"><Ico n="check" /> {{ t('Wird behalten', 'Will be kept') }}</span>
              <VdAufMarken :d="k" />
            </span>
          </div>
        </li>
      </ul>
      <p v-if="g.ausgeblendet" class="sehrleise fuss">
        {{ t(`Weitere ${g.ausgeblendet} Kopien werden hier nicht angezeigt.`, `${g.ausgeblendet} more copies are not shown here.`) }}
      </p>
      <p v-if="anzahlGewaehlt(g)" class="sehrleise fuss zahl" role="status">
        {{ t(`${anzahlGewaehlt(g)} markiert — ${groesse(gespart(g))}`, `${anzahlGewaehlt(g)} marked — ${groesse(gespart(g))}`) }}
      </p>
    </article>
  </div>
</template>

<style scoped>
.gruppen {
  display: grid;
  gap: 12px;
}
.gruppe {
  border: 1px solid var(--linie);
  border-radius: 14px;
  padding: 14px;
  background: var(--flaeche);
}
header {
  display: flex;
  gap: 10px 16px;
  justify-content: space-between;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.titel {
  min-width: 0;
  flex: 1 1 260px;
}
h4 {
  font-size: 14.5px;
  font-weight: 600;
  overflow-wrap: anywhere;
  margin: 0;
}
.titel p {
  margin: 2px 0 0;
  font-size: 12.5px;
}
.knoepfe {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: flex-start;
}
.schutz {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 12.5px;
  margin: 6px 0 8px;
}
.schutz svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  margin-top: 2px;
}
.kopien {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}
.kopien li {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid transparent;
}
.kopien li.an {
  background: rgba(var(--a-rgb), 0.08);
  border-color: rgba(var(--a-rgb), 0.3);
}
.kopien li.behalten {
  background: var(--ok-bg);
}
input[type='checkbox'] {
  width: 18px;
  height: 18px;
  margin: 8px 0 0;
  accent-color: var(--a);
  cursor: pointer;
  flex-shrink: 0;
}
input[type='checkbox']:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.was {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.name {
  font-weight: 500;
  font-size: 13.5px;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: center;
  font-size: 12px;
}
.meta:empty {
  display: none;
}
.pfad {
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
.fuss {
  font-size: 12px;
  margin: 8px 0 0;
}
</style>
