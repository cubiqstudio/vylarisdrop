<script setup lang="ts">
const props = defineProps<{ f: any; ordner: any[]; tags: any[] }>()
const emit = defineEmits<{ (e: 'zu'): void; (e: 'geaendert', f: any): void; (e: 'geloescht', id: string): void }>()
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()

const form = reactive({
  name: props.f.name,
  slug: props.f.slug,
  ordner: props.f.folder_id as number | null,
  ablauf: '',
  maxAufrufe: props.f.max_views ? String(props.f.max_views) : '',
  passwort: '',
  passwortWeg: false,
  tags: (props.f.tags || []).map((x: any) => x.id) as number[]
})
// Live-Aktualisierung: ändert sich die Datei woanders (umbenannt, verschoben, Tags …), übernimmt das Formular den neuen Wert
// nur dort, wo gerade nichts eingetippt ist. Was jemand schon geändert hat, bleibt unangetastet.
watch(
  () => props.f,
  (neu, alt) => {
    if (!neu || !alt || neu.id !== alt.id) return
    const nachziehen = (feld: 'name' | 'slug' | 'ordner' | 'maxAufrufe', vorher: unknown, jetzt: unknown) => {
      if (vorher !== jetzt && form[feld] === vorher) (form as any)[feld] = jetzt
    }
    nachziehen('name', alt.name, neu.name)
    nachziehen('slug', alt.slug, neu.slug)
    nachziehen('ordner', alt.folder_id, neu.folder_id)
    nachziehen('maxAufrufe', alt.max_views ? String(alt.max_views) : '', neu.max_views ? String(neu.max_views) : '')
    const ids = (f: any): number[] => (f.tags || []).map((x: any) => x.id)
    const [a, b] = [ids(alt), ids(neu)]
    if (a.join() !== b.join() && [...form.tags].sort().join() === [...a].sort().join()) form.tags = b
  }
)
const ABLAUF = computed(() => [
  {
    v: '',
    text: props.f.expires_at
      ? t(`Unverändert (${restzeit(props.f.expires_at)})`, `Unchanged (${restzeit(props.f.expires_at)})`)
      : t('Nie', 'Never')
  },
  ...(props.f.expires_at ? [{ v: 'nie', text: t('Nie ablaufen', 'Never expire') }] : []),
  { v: '1h', text: t('1 Stunde', '1 hour') },
  { v: '1d', text: t('1 Tag', '1 day') },
  { v: '7d', text: t('7 Tage', '7 days') },
  { v: '30d', text: t('30 Tage', '30 days') },
  { v: '365d', text: t('1 Jahr', '1 year') }
])
const laeuft = ref(false)
const kopiert = ref('')
const bearbeiten = ref(false)

async function speichern() {
  laeuft.value = true
  try {
    const body: Record<string, any> = { name: form.name, ordner: form.ordner, tags: form.tags }
    if (form.slug !== props.f.slug) body.slug = form.slug
    if (form.ablauf) body.ablauf = form.ablauf === 'nie' ? null : form.ablauf
    body.max_aufrufe = form.maxAufrufe ? Number(form.maxAufrufe) : null
    if (form.passwort) body.passwort = form.passwort
    else if (form.passwortWeg) body.passwort = ''
    const r = await api(`/api/files/${props.f.id}`, { method: 'PATCH', body })
    emit('geaendert', r.file)
    ok(t('Gespeichert', 'Saved'))
    emit('zu')
  } catch (e: any) {
    fehler(e.message)
  } finally {
    laeuft.value = false
  }
}
async function favorit() {
  try {
    const r = await api(`/api/files/${props.f.id}`, { method: 'PATCH', body: { favorit: !props.f.favorite } })
    emit('geaendert', r.file)
  } catch (e: any) {
    fehler(e.message)
  }
}
function loeschen() {
  bestaetigen(
    t('In den Papierkorb?', 'Move to trash?'),
    t(
      `„${props.f.name}“ liegt dann 30 Tage im Papierkorb und lässt sich wiederherstellen. So lange funktionieren die Links nicht.`,
      `“${props.f.name}” stays in the trash for 30 days and can be restored. Its links do not work during that time.`
    ),
    t('In den Papierkorb', 'Move to trash'),
    async () => {
      try {
        await api(`/api/files/${props.f.id}`, { method: 'DELETE' })
        emit('geloescht', props.f.id)
        ok(t('Im Papierkorb', 'Moved to trash'))
        emit('zu')
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}
async function kopie(art: string, url: string) {
  if (await kopieren(url)) {
    kopiert.value = art
    setTimeout(() => {
      if (kopiert.value === art) kopiert.value = ''
    }, 1500)
  }
}
const e2eKey = ref('')
onMounted(() => {
  if (props.f.verschluesselt) e2eKey.value = e2eSchluessel(props.f.slug)
})
const LINKS = computed(() =>
  props.f.verschluesselt
    ? [
        ...(e2eKey.value
          ? [{ k: 'seite', text: t('Mit Schlüssel', 'With key'), url: `${props.f.links.seite}#k=${e2eKey.value}` }]
          : []),
        { k: 'ohne', text: t('Ohne Schlüssel', 'Without key'), url: props.f.links.seite }
      ]
    : [
        { k: 'seite', text: t('Seite', 'Page'), url: props.f.links.seite },
        { k: 'direkt', text: t('Direkt', 'Direct'), url: props.f.links.direkt },
        { k: 'download', text: 'Download', url: props.f.links.download },
        { k: 'raw', text: 'Raw', url: props.f.links.raw }
      ]
)
const reiter = ref<'bearbeiten' | 'statistik'>('bearbeiten')
const stat = ref<any>(null)
const statTage = ref(30)
async function statLaden() {
  try {
    stat.value = await api(`/api/files/${props.f.id}/statistik?tage=${statTage.value}`)
  } catch (e: any) {
    fehler(e.message)
  }
}
watch([reiter, statTage], () => {
  if (reiter.value === 'statistik') void statLaden()
})
const theme = useTheme()
const istAdmin = computed(() => ['owner', 'admin'].includes(theme.value.user?.role || ''))
async function scanAktion(aktion: 'neu' | 'freigeben') {
  try {
    await api(`/api/files/${props.f.id}/scan`, { method: 'POST', body: { aktion } })
    emit('geaendert', {
      ...props.f,
      scan: aktion === 'freigeben' ? 'frei' : '',
      scan_info: aktion === 'freigeben' ? props.f.scan_info : ''
    })
    ok(aktion === 'freigeben' ? t('Freigegeben', 'Released') : t('Wird neu geprüft', 'Will be re-scanned'))
  } catch (e: any) {
    fehler(e.message)
  }
}
function tagUm(id: number) {
  form.tags = form.tags.includes(id) ? form.tags.filter((x) => x !== id) : [...form.tags, id]
}
</script>

<template>
  <VdModal :titel="f.name" breit @zu="emit('zu')">
    <div class="detail">
      <div class="buehne">
        <VdLive v-if="f.art === 'bild' && f.live && f.links.live" :src="f.links.live"><img :src="f.links.direkt" :alt="f.name"></VdLive>
        <img v-else-if="f.art === 'bild'" :src="f.links.direkt" :alt="f.name">
        <VdPlayer v-else-if="f.art === 'video'" :src="f.links.direkt" :poster="f.hat_vorschau ? f.links.vorschau : null" :streifen="f.streifen ? f.links.streifen : null" :streifen-anzahl="f.streifen" :breite="f.width" :hoehe="f.height" />
        <VdAudio v-else-if="f.art === 'audio'" :src="f.links.direkt" :wellen="f.wellen" :dauer-ms="f.duration_ms" klein />
        <div v-else-if="f.verschluesselt" class="platzhalter"><Ico n="lock" /><span>{{ t('Ende-zu-Ende verschlüsselt', 'End-to-end encrypted') }}</span></div>
        <div v-else class="platzhalter"><Ico :n="f.art === 'text' ? 'text' : 'file'" /><span>{{ f.mime }}</span></div>
      </div>
      <div>
        <div class="reihe" style="margin-bottom:12px">
          <span class="chip neutral">{{ groesse(f.size) }}</span>
          <span class="chip neutral"><Ico n="eye" /> {{ zahl(f.views) }}<template v-if="f.max_views"> / {{ zahl(f.max_views) }}</template></span>
          <span v-if="f.expires_at" class="chip warn"><Ico n="clock" /> {{ restzeit(f.expires_at) }}</span>
          <span v-if="f.passwort" class="chip info"><Ico n="lock" /> {{ t('Passwort', 'Password') }}</span>
          <span v-if="f.width" class="chip neutral">{{ f.width }} × {{ f.height }}</span>
          <span v-if="f.scan === 'ok' || f.scan === 'frei'" class="chip ok" :title="t('Von ClamAV geprüft', 'Checked by ClamAV')"><Ico n="shield" /> {{ t('Virenfrei', 'Clean') }}</span>
          <span v-if="f.exif_entfernt" class="chip ok" :title="t('GPS- und Kamera-Daten wurden entfernt', 'GPS and camera data were removed')"><Ico n="shield" /> {{ t('Ohne Standort', 'No location') }}</span>
          <span v-if="f.von_gast" class="chip neutral"><Ico n="user" /> {{ f.von_gast }}</span>
          <button class="knopf klein" style="margin-left:auto" :aria-pressed="f.favorite" @click="favorit"><Ico n="star" :style="f.favorite ? 'color:#f59e0b;fill:currentColor' : ''" /> {{ f.favorite ? t('Favorit', 'Favourite') : t('Merken', 'Favourite') }}</button>
        </div>
        <p v-if="f.notiz" class="mitteilung"><Ico n="user" /> <span>{{ f.notiz }}</span></p>
        <div v-if="f.scan === 'fund'" class="quarantaene">
          <Ico n="shield" /><div><b>{{ t('In Quarantäne', 'Quarantined') }}</b><small>{{ t(`ClamAV hat „${f.scan_info}“ gefunden. Die Datei wird nicht mehr ausgeliefert.`, `ClamAV found “${f.scan_info}”. The file is no longer delivered.`) }}</small></div>
          <button class="knopf klein" @click="scanAktion('neu')">{{ t('Neu prüfen', 'Re-scan') }}</button>
          <button v-if="istAdmin" class="knopf klein" @click="scanAktion('freigeben')">{{ t('Fehlalarm — freigeben', 'False alarm — release') }}</button>
        </div>
        <p v-if="f.verschluesselt && !e2eKey" class="meldung meldung-warn klein-m">{{ t('Der Schlüssel ist nur im Link, den du beim Hochladen bekommen hast. Ohne ihn lässt sich die Datei nicht öffnen.', 'The key is only in the link you got when uploading. Without it the file cannot be opened.') }}</p>
        <div v-for="l in LINKS" :key="l.k" class="linkfeld">
          <span class="etikett">{{ l.text }}</span><code>{{ l.url.replace(/^https?:\/\//, '') }}</code>
          <a class="knopf nur-icon" :href="l.url" target="_blank" rel="noopener" :aria-label="t('Öffnen', 'Open')"><Ico n="external" /></a>
          <button class="knopf nur-icon" :class="{ kopiert: kopiert === l.k }" :aria-label="t('Kopieren', 'Copy')" @click="kopie(l.k, l.url)"><Ico :n="kopiert === l.k ? 'check' : 'copy'" /></button>
        </div>
      </div>
    </div>

    <div class="reiter" role="tablist">
      <button type="button" role="tab" :aria-selected="reiter === 'bearbeiten'" :class="{ an: reiter === 'bearbeiten' }" @click="reiter = 'bearbeiten'"><Ico n="edit" /> {{ t('Bearbeiten', 'Edit') }}</button>
      <button type="button" role="tab" :aria-selected="reiter === 'statistik'" :class="{ an: reiter === 'statistik' }" @click="reiter = 'statistik'"><Ico n="chart" /> {{ t('Statistik', 'Statistics') }}</button>
      <span v-if="reiter === 'statistik'" class="reiter-zeit"><button v-for="z in [7, 30, 90]" :key="z" type="button" :class="{ an: statTage === z }" @click="statTage = z">{{ z }} {{ t('T.', 'd') }}</button></span>
    </div>
    <div v-if="reiter === 'statistik'" class="stat-box">
      <VdStatistik v-if="stat" :d="stat" kompakt />
      <div v-else class="sehrleise"><Ico n="loader" spin /></div>
    </div>
    <form v-else class="bearbeiten" @submit.prevent="speichern">
      <label class="feld"><span>{{ t('Name', 'Name') }}</span><input v-model="form.name" class="eingabe" maxlength="200"></label>
      <label class="feld"><span>{{ t('Link-Name', 'Link name') }}</span><input v-model="form.slug" class="eingabe mono" maxlength="80" spellcheck="false"><small>{{ t('Ändert den Link — der alte funktioniert danach nicht mehr.', 'Changes the link — the old one will stop working.') }}</small></label>
      <label class="feld"><span>{{ t('Ordner', 'Folder') }}</span>
        <VdAuswahl v-model="form.ordner" class="eingabe"><option :value="null">{{ t('Ohne Ordner', 'No folder') }}</option><option v-for="o in ordner" :key="o.id" :value="o.id">{{ o.name }}</option></VdAuswahl></label>
      <label class="feld"><span>{{ t('Läuft ab', 'Expires') }}</span>
        <VdAuswahl v-model="form.ablauf" class="eingabe"><option v-for="a in ABLAUF" :key="a.v" :value="a.v">{{ a.text }}</option></VdAuswahl></label>
      <label class="feld"><span>{{ t('Max. Aufrufe', 'Max views') }}</span><input v-model="form.maxAufrufe" class="eingabe" inputmode="numeric" :placeholder="t('unbegrenzt', 'unlimited')"><small>{{ t('Danach ist die Datei weg.', 'After that the file is gone.') }}</small></label>
      <label class="feld"><span>{{ t('Passwort', 'Password') }}</span><input v-model="form.passwort" class="eingabe" type="password" autocomplete="new-password" :placeholder="f.passwort ? t('neues Passwort setzen', 'set new password') : t('kein Passwort', 'no password')">
        <small v-if="f.passwort"><label class="reihe" style="gap:6px;cursor:pointer"><input v-model="form.passwortWeg" type="checkbox"> {{ t('Passwort entfernen', 'Remove password') }}</label></small></label>
      <div v-if="tags.length" class="feld voll"><span>Tags</span>
        <div class="reihe"><button v-for="x in tags" :key="x.id" type="button" class="tag" :class="{ an: form.tags.includes(x.id) }" :style="{ '--c': x.color }" @click="tagUm(x.id)"><i></i>{{ x.name }}</button></div></div>
      <div class="modal-fuss voll">
        <button type="button" class="knopf gefahr" @click="loeschen"><Ico n="trash" /> {{ t('Löschen', 'Delete') }}</button>
        <button v-if="f.art === 'bild'" type="button" class="knopf" style="margin-right:auto" @click="bearbeiten = true"><Ico n="edit" /> {{ t('Bild bearbeiten', 'Edit image') }}</button>
        <span v-else style="margin-right:auto"></span>
        <button type="button" class="knopf" @click="emit('zu')">{{ t('Abbrechen', 'Cancel') }}</button>
        <button type="submit" class="knopf rot" :disabled="laeuft"><Ico v-if="laeuft" n="loader" spin />{{ t('Speichern', 'Save') }}</button>
      </div>
    </form>
    <VdBildEditor v-if="bearbeiten" :f="f" @zu="bearbeiten = false" @gespeichert="(neu) => { if (neu) emit('geaendert', neu) }" />
  </VdModal>
</template>

<style scoped>
.mitteilung {
  margin: 0;
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 13.5px;
  color: var(--text2);
  border-left: 3px solid var(--a);
  padding: 6px 0 6px 10px;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.mitteilung :deep(svg) {
  width: 13px;
  height: 13px;
  flex: none;
  align-self: center;
}
.detail {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 18px;
}
.buehne {
  background: #000;
  border-radius: 14px;
  overflow: hidden;
  display: grid;
  place-items: center;
  min-height: 220px;
  max-height: 360px;
}
.buehne img {
  width: 100%;
  height: 100%;
  max-height: 360px;
  object-fit: contain;
  display: block;
}
.buehne :deep(.player) {
  max-height: 360px;
}
.buehne :deep(.audio) {
  padding: 16px;
}
.platzhalter {
  color: #a3a1a8;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  font-family: var(--f-mono);
  font-size: 12px;
}
.platzhalter svg {
  width: 40px;
  height: 40px;
}
.linkfeld {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--linie);
  border-radius: 10px;
  padding: 4px 4px 4px 12px;
  background: var(--bg);
  margin-top: 8px;
}
.etikett {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text3);
  width: 70px;
  flex-shrink: 0;
}
.linkfeld code {
  flex: 1;
  min-width: 0;
  font-family: var(--f-mono);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.linkfeld .knopf.kopiert {
  background: var(--ok-bg);
  color: var(--ok);
}
.bearbeiten {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 14px;
  padding-top: 18px;
}
.reiter {
  display: flex;
  gap: 4px;
  align-items: center;
  margin-top: 20px;
  border-bottom: 1px solid var(--linie);
}
.reiter > button {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: var(--text2);
  padding: 9px 12px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.reiter > button.an {
  color: var(--text);
  border-bottom-color: var(--a);
  font-weight: 600;
}
.reiter > button svg {
  width: 15px;
  height: 15px;
}
.reiter-zeit {
  margin-left: auto;
  display: inline-flex;
  gap: 2px;
}
.reiter-zeit button {
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 12px;
  color: var(--text3);
  padding: 4px 8px;
  border-radius: 7px;
  cursor: pointer;
}
.reiter-zeit button.an {
  background: var(--flaeche2);
  color: var(--text);
}
.stat-box {
  padding-top: 18px;
  min-height: 120px;
}
.voll {
  grid-column: 1 / -1;
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 99px;
  border: 1px solid var(--linie);
  background: var(--flaeche);
  color: var(--text2);
  cursor: pointer;
}
.tag i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--c);
}
.tag.an {
  border-color: var(--text);
  color: var(--text);
}
.klein-m {
  font-size: 12px;
  margin: 0 0 4px;
}
.quarantaene {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  background: var(--rot-bg);
  color: var(--rot);
  border-radius: 12px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.quarantaene > svg {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}
.quarantaene > div {
  flex: 1;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  font-size: 13px;
}
.quarantaene small {
  color: var(--text2);
  font-size: 12px;
}
@media (max-width: 720px) {
  .detail,
  .bearbeiten {
    grid-template-columns: minmax(0, 1fr);
  }
  .detail > *,
  .bearbeiten > * {
    min-width: 0;
  }
}
</style>
