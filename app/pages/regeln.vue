<script setup lang="ts">
useHead({ title: () => t('Speicher-Regeln', 'Storage rules') })
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const { data, refresh } = await (useFetch as any)('/api/regeln', { key: 'regeln' })
// Reiter: Lebenszyklus-Regeln (jeder) und Ablage-Regeln „Wohin kommt was?“ (nur Admin/Inhaber; die API ist serverseitig gesperrt)
const route = useRoute()
const istAdmin = computed(() => !!data.value?.admin)
const tab = ref<'lebenszyklus' | 'ablage'>(route.query.tab === 'ablage' ? 'ablage' : 'lebenszyklus')
watchEffect(() => {
  if (tab.value === 'ablage' && !istAdmin.value) tab.value = 'lebenszyklus'
})
function reiterTaste(e: KeyboardEvent) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  tab.value = tab.value === 'ablage' ? 'lebenszyklus' : 'ablage'
  nextTick(() => (document.getElementById('reiter-' + tab.value) as HTMLElement | null)?.focus())
}
const { data: ord } = await (useFetch as any)('/api/folders', { key: 'ordner' })
const regeln = computed<any[]>(() => data.value?.regeln || [])
const ordner = computed<any[]>(() => {
  const alle = ord.value?.ordner || [],
    aus: any[] = []
  const kinder = (p: number | null, tiefe: number) => {
    for (const o of alle.filter((x: any) => x.parent_id === p)) {
      aus.push({ ...o, tiefe })
      kinder(o.id, tiefe + 1)
    }
  }
  kinder(null, 0)
  return aus
})
const ARTEN = computed(() => [
  { v: '', t: t('jeder Typ', 'any type') },
  { v: 'bild', t: t('Bilder', 'images') },
  { v: 'video', t: t('Videos', 'videos') },
  { v: 'audio', t: t('Audio', 'audio') },
  { v: 'text', t: t('Text & Code', 'text & code') },
  { v: 'datei', t: t('andere Dateien', 'other files') }
])
const AKTIONEN = computed(() => [
  {
    v: 'papierkorb',
    ic: 'trash',
    t: t('In den Papierkorb', 'Move to trash'),
    info: t('30 Tage zurückholbar', 'restorable for 30 days')
  },
  {
    v: 'loeschen',
    ic: 'x',
    t: t('Endgültig löschen', 'Delete permanently'),
    info: t('nicht rückgängig zu machen', 'cannot be undone')
  },
  {
    v: 'archiv',
    ic: 'wolke',
    t: t('Nach S3 auslagern', 'Move to S3'),
    info: t('Links bleiben gleich', 'links stay the same')
  }
])

function satz(r: any) {
  const b = r.bedingung || {},
    teile: string[] = []
  const o = b.ordner_id ? ordner.value.find((x) => x.id === b.ordner_id) : null
  const art = ARTEN.value.find((a) => a.v === (b.art || ''))!.t
  teile.push(b.art ? t(`${art}`, `${art}`) : t('Dateien', 'Files'))
  if (b.ordner_id) teile.push(t(`in „${o?.name || '?'}“`, `in “${o?.name || '?'}”`))
  const zeit: string[] = []
  if (b.aelter_als_tage) zeit.push(t(`älter als ${b.aelter_als_tage} Tage`, `older than ${b.aelter_als_tage} days`))
  if (b.ohne_aufruf_tage)
    zeit.push(t(`seit ${b.ohne_aufruf_tage} Tagen nicht aufgerufen`, `not viewed for ${b.ohne_aufruf_tage} days`))
  if (b.groesser_als_mb) zeit.push(t(`größer als ${b.groesser_als_mb} MB`, `larger than ${b.groesser_als_mb} MB`))
  return `${teile.join(' ')}, ${zeit.join(t(' und ', ' and '))}`
}
const aktionText = (v: string) => AKTIONEN.value.find((a) => a.v === v)?.t || v

const form = ref<any>(null)
function neu() {
  form.value = {
    id: null,
    name: '',
    aktiv: true,
    geltung: 'eigen',
    aktion: 'papierkorb',
    favoriten_schonen: true,
    ordner_id: null,
    art: '',
    alter: true,
    aelter_als_tage: 90,
    aufruf: false,
    ohne_aufruf_tage: 30,
    gross: false,
    groesser_als_mb: 100
  }
}
function bearbeiten(r: any) {
  const b = r.bedingung || {}
  form.value = {
    id: r.id,
    name: r.name,
    aktiv: r.aktiv,
    geltung: r.geltung,
    aktion: r.aktion,
    favoriten_schonen: r.favoriten_schonen,
    ordner_id: b.ordner_id || null,
    art: b.art || '',
    alter: !!b.aelter_als_tage,
    aelter_als_tage: b.aelter_als_tage || 90,
    aufruf: !!b.ohne_aufruf_tage,
    ohne_aufruf_tage: b.ohne_aufruf_tage || 30,
    gross: !!b.groesser_als_mb,
    groesser_als_mb: b.groesser_als_mb || 100
  }
}
const koerper = (f: any) => ({
  name: f.name,
  aktiv: f.aktiv,
  geltung: f.geltung,
  aktion: f.aktion,
  favoriten_schonen: f.favoriten_schonen,
  bedingung: {
    ordner_id: f.ordner_id,
    art: f.art || null,
    aelter_als_tage: f.alter ? Number(f.aelter_als_tage) : null,
    ohne_aufruf_tage: f.aufruf ? Number(f.ohne_aufruf_tage) : null,
    groesser_als_mb: f.gross ? Number(f.groesser_als_mb) : null
  }
})
const gueltig = computed(() => !!form.value && (form.value.alter || form.value.aufruf))
const live = ref<any>(null)
let uhr: any = null
watch(
  form,
  (f) => {
    clearTimeout(uhr)
    live.value = null
    if (!f || !(f.alter || f.aufruf)) return
    uhr = setTimeout(async () => {
      try {
        live.value = await api('/api/regeln/vorschau', { method: 'POST', body: koerper(f) })
      } catch {
        live.value = null
      }
    }, 350)
  },
  { deep: true }
)
const laeuft = ref(false)
async function speichern() {
  const f = form.value
  laeuft.value = true
  try {
    const b = koerper(f)
    if (f.id) await api(`/api/regeln/${f.id}`, { method: 'PATCH', body: b })
    else await api('/api/regeln', { method: 'POST', body: b })
    form.value = null
    await refresh()
    ok(t('Gespeichert — läuft ab jetzt täglich', 'Saved — runs daily from now on'))
  } catch (e: any) {
    fehler(e.message)
  } finally {
    laeuft.value = false
  }
}
async function umschalten(r: any) {
  try {
    await api(`/api/regeln/${r.id}`, { method: 'PATCH', body: { aktiv: !r.aktiv } })
    await refresh()
  } catch (e: any) {
    fehler(e.message)
  }
}
function entfernen(r: any) {
  bestaetigen(
    t('Regel löschen?', 'Delete rule?'),
    t(
      `„${r.name || satz(r)}“ läuft danach nicht mehr. Dateien bleiben, wie sie sind.`,
      `“${r.name || satz(r)}” will no longer run. Files stay as they are.`
    ),
    t('Löschen', 'Delete'),
    async () => {
      try {
        await api(`/api/regeln/${r.id}`, { method: 'DELETE' })
        await refresh()
        ok(t('Gelöscht', 'Deleted'))
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}
const vor = ref<{ r: any; d: any } | null>(null)
async function vorschauZeigen(r: any) {
  try {
    vor.value = {
      r,
      d: await api('/api/regeln/vorschau', {
        method: 'POST',
        body: {
          name: r.name,
          geltung: r.geltung,
          aktion: r.aktion,
          favoriten_schonen: r.favoriten_schonen,
          bedingung: r.bedingung
        }
      })
    }
  } catch (e: any) {
    fehler(e.message)
  }
}
function jetzt(r: any, anzahl: number) {
  bestaetigen(
    t('Jetzt ausführen?', 'Run now?'),
    t(`${anzahl} Datei(en): ${aktionText(r.aktion)}.`, `${anzahl} file(s): ${aktionText(r.aktion)}.`),
    t('Ausführen', 'Run'),
    async () => {
      try {
        const x = await api(`/api/regeln/${r.id}/ausfuehren`, { method: 'POST' })
        vor.value = null
        await refresh()
        ok(
          t(
            `${x.anzahl} Datei(en) bearbeitet · ${groesse(x.bytes)}`,
            `${x.anzahl} file(s) processed · ${groesse(x.bytes)}`
          )
        )
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}
</script>

<template>
  <section class="rein">
    <div class="kopf"><div><div class="eyebrow"><Ico n="clock" /> {{ t('Verwaltung', 'Manage') }}</div><h1>{{ t('Speicher-Regeln', 'Storage rules') }}</h1>
      <p v-if="tab === 'lebenszyklus'">{{ t('Alte und vergessene Dateien räumen sich von selbst auf — einmal am Tag.', 'Old and forgotten files clean themselves up — once a day.') }}</p>
      <p v-else>{{ t('Lege fest, in welchem Speicher neue Dateien landen — nach Art, Größe, Konto, Rolle und Ordner.', 'Decide which storage new files end up in — by type, size, account, role and folder.') }}</p></div>
      <button v-if="tab === 'lebenszyklus'" class="knopf rot" @click="neu"><Ico n="plus" /> {{ t('Regel anlegen', 'Add rule') }}</button>
    </div>

    <div v-if="istAdmin" class="seg reiter-leiste" role="tablist" :aria-label="t('Art der Regeln', 'Kind of rules')" @keydown="reiterTaste">
      <button id="reiter-lebenszyklus" type="button" role="tab" :aria-selected="tab === 'lebenszyklus'" :tabindex="tab === 'lebenszyklus' ? 0 : -1" :class="{ an: tab === 'lebenszyklus' }" @click="tab = 'lebenszyklus'"><Ico n="clock" /> {{ t('Aufräumen nach Zeit', 'Clean-up by age') }}</button>
      <button id="reiter-ablage" type="button" role="tab" :aria-selected="tab === 'ablage'" :tabindex="tab === 'ablage' ? 0 : -1" :class="{ an: tab === 'ablage' }" @click="tab = 'ablage'"><Ico n="database" /> {{ t('Ablage: Wohin kommt was?', 'Placement: where does what go?') }}</button>
    </div>

    <VdAblageRegeln v-if="tab === 'ablage' && istAdmin" role="tabpanel" aria-labelledby="reiter-ablage" />
    <template v-else>

    <div v-if="!regeln.length" class="block leer">
      <span class="gross-ic"><Ico n="clock" /></span>
      <h3>{{ t('Noch keine Regeln', 'No rules yet') }}</h3>
      <p class="leise">{{ t('Zum Beispiel: „Screenshots, die seit 90 Tagen niemand angesehen hat, in den Papierkorb.“', 'For example: “Screenshots nobody has looked at for 90 days go to the trash.”') }}</p>
      <button class="knopf rot" @click="neu"><Ico n="plus" /> {{ t('Erste Regel anlegen', 'Add your first rule') }}</button>
    </div>

    <div class="liste">
      <article v-for="(r, i) in regeln" :key="r.id" class="block regel" :class="{ aus: !r.aktiv }" :style="{ '--i': i }">
        <div class="r-kopf">
          <button type="button" :class="['schalter', { an: r.aktiv }]" role="switch" :aria-checked="r.aktiv" :aria-label="t('Aktiv', 'Active')" @click="umschalten(r)"></button>
          <div class="was">
            <b>{{ r.name || t('Regel', 'Rule') }}</b>
            <p class="satz">{{ satz(r) }} <span class="pfeil">→</span> <span :class="['aktion', r.aktion]"><Ico :n="AKTIONEN.find(a => a.v === r.aktion)?.ic || 'trash'" /> {{ aktionText(r.aktion) }}</span></p>
          </div>
          <span v-if="r.geltung === 'alle'" class="chip warn"><Ico n="users" /> {{ t('Alle Konten', 'All accounts') }}</span>
        </div>
        <div class="r-fuss">
          <span class="sehrleise klein">
            <template v-if="r.zuletzt_at">{{ t(`Zuletzt ${zeitpunkt(r.zuletzt_at)} · ${r.zuletzt_anzahl} Datei(en) · ${groesse(r.zuletzt_bytes || 0)}`, `Last ${zeitpunkt(r.zuletzt_at)} · ${r.zuletzt_anzahl} file(s) · ${groesse(r.zuletzt_bytes || 0)}`) }}</template>
            <template v-else>{{ t('Noch nicht gelaufen', 'Has not run yet') }}</template>
            <template v-if="r.favoriten_schonen"> · {{ t('Favoriten geschont', 'favourites kept') }}</template>
            <template v-if="r.geltung === 'alle'"> · {{ t(`von ${r.von_name}`, `by ${r.von_name}`) }}</template>
          </span>
          <div class="reihe">
            <button class="knopf klein" @click="vorschauZeigen(r)"><Ico n="eye" /> {{ t('Vorschau', 'Preview') }}</button>
            <button class="knopf klein" @click="bearbeiten(r)"><Ico n="edit" /> {{ t('Bearbeiten', 'Edit') }}</button>
            <button class="knopf klein gefahr" :aria-label="t('Löschen', 'Delete')" @click="entfernen(r)"><Ico n="trash" /></button>
          </div>
        </div>
      </article>
    </div>

    <VdModal v-if="form" breit :titel="form.id ? t('Regel bearbeiten', 'Edit rule') : t('Regel anlegen', 'Add rule')" @zu="form = null">
      <form @submit.prevent="speichern">
        <label class="feld"><span>{{ t('Name (optional)', 'Name (optional)') }}</span><input v-model="form.name" class="eingabe" maxlength="80" :placeholder="t('z. B. Alte Screenshots', 'e.g. old screenshots')"></label>
        <div class="baukasten">
          <div class="zeile-b"><span class="wort">{{ t('Wenn', 'If') }}</span>
            <VdAuswahl v-model="form.art" class="eingabe klein-e"><option v-for="a in ARTEN" :key="a.v" :value="a.v">{{ a.v ? a.t : t('eine Datei', 'a file') }}</option></VdAuswahl>
            <VdAuswahl v-model="form.ordner_id" class="eingabe klein-e"><option :value="null">{{ t('irgendwo', 'anywhere') }}</option><option v-for="o in ordner" :key="o.id" :value="o.id">{{ t('in', 'in') }} {{ '— '.repeat(o.tiefe) }}{{ o.name }}</option></VdAuswahl>
          </div>
          <label :class="['zeile-b', 'bed', { an: form.alter }]"><input v-model="form.alter" type="checkbox"><span class="wort">{{ t('älter als', 'older than') }}</span><input v-model.number="form.aelter_als_tage" class="eingabe zahl-e" type="number" min="1" max="36500" :disabled="!form.alter"><span>{{ t('Tage', 'days') }}</span></label>
          <label :class="['zeile-b', 'bed', { an: form.aufruf }]"><input v-model="form.aufruf" type="checkbox"><span class="wort">{{ t('seit', 'not viewed for') }}</span><input v-model.number="form.ohne_aufruf_tage" class="eingabe zahl-e" type="number" min="1" max="36500" :disabled="!form.aufruf"><span>{{ t('Tagen nicht aufgerufen', 'days') }}</span></label>
          <label :class="['zeile-b', 'bed', { an: form.gross }]"><input v-model="form.gross" type="checkbox"><span class="wort">{{ t('größer als', 'larger than') }}</span><input v-model.number="form.groesser_als_mb" class="eingabe zahl-e" type="number" min="0.01" step="any" :disabled="!form.gross"><span>MB</span></label>
          <p v-if="!gueltig" class="meldung meldung-warn klein">{{ t('Mindestens „älter als“ oder „nicht aufgerufen“ ankreuzen.', 'Tick at least “older than” or “not viewed”.') }}</p>
          <div class="zeile-b"><span class="wort">{{ t('dann', 'then') }}</span></div>
          <div class="aktionen">
            <button v-for="a in AKTIONEN" :key="a.v" type="button" :class="['akt', a.v, { an: form.aktion === a.v }]" :disabled="a.v === 'archiv' && !data?.archiv" :aria-pressed="form.aktion === a.v" @click="form.aktion = a.v">
              <Ico :n="a.ic" /><span><b>{{ a.t }}</b><small>{{ a.v === 'archiv' && !data?.archiv ? t('braucht S3 (Pro)', 'needs S3 (Pro)') : a.info }}</small></span></button>
          </div>
        </div>
        <label class="frage-opt"><button type="button" :class="['schalter', { an: form.favoriten_schonen }]" role="switch" :aria-checked="form.favoriten_schonen" @click="form.favoriten_schonen = !form.favoriten_schonen"></button><span><b>{{ t('Favoriten nie anfassen', 'Never touch favourites') }}</b></span></label>
        <div v-if="data?.admin && !form.id" class="geltung" role="group">
          <button type="button" :class="{ an: form.geltung === 'eigen' }" @click="form.geltung = 'eigen'"><Ico n="user" /> {{ t('Nur meine Dateien', 'Only my files') }}</button>
          <button type="button" :class="{ an: form.geltung === 'alle' }" @click="form.geltung = 'alle'; form.ordner_id = null"><Ico n="users" /> {{ t('Alle Konten', 'All accounts') }}</button>
        </div>
        <div :class="['live', { warn: live && live.anzahl && form.aktion === 'loeschen' }]">
          <Ico :n="live ? 'eye' : 'loader'" :spin="!live && gueltig" />
          <span v-if="!gueltig">{{ t('Vorschau erscheint, sobald die Regel vollständig ist.', 'The preview appears once the rule is complete.') }}</span>
          <span v-else-if="!live">{{ t('Zähle …', 'Counting …') }}</span>
          <span v-else>{{ t(`Träfe jetzt ${live.anzahl} Datei(en) · ${groesse(live.bytes)}`, `Would match ${live.anzahl} file(s) now · ${groesse(live.bytes)}`) }}<template v-if="live.beispiele.length">: {{ live.beispiele.slice(0, 3).map((b: any) => b.name).join(', ') }}{{ live.anzahl > 3 ? ' …' : '' }}</template></span>
        </div>
        <div class="modal-fuss"><button type="button" class="knopf" @click="form = null">{{ t('Abbrechen', 'Cancel') }}</button><button class="knopf rot" :disabled="laeuft || !gueltig"><Ico v-if="laeuft" n="loader" spin />{{ t('Speichern', 'Save') }}</button></div>
      </form>
    </VdModal>

    <VdModal v-if="vor" breit :titel="t('Vorschau', 'Preview')" @zu="vor = null">
      <p class="satz gross-satz">{{ satz(vor.r) }} <span class="pfeil">→</span> {{ aktionText(vor.r.aktion) }}</p>
      <div class="kennzahlen"><div><b class="mono">{{ zahl(vor.d.anzahl) }}</b><small>{{ t('Dateien', 'files') }}</small></div><div><b class="mono">{{ groesse(vor.d.bytes) }}</b><small>{{ t('zusammen', 'total') }}</small></div></div>
      <table v-if="vor.d.beispiele.length" class="tab">
        <thead><tr><th>{{ t('Datei', 'File') }}</th><th v-if="vor.r.geltung === 'alle'">{{ t('Konto', 'Account') }}</th><th>{{ t('Größe', 'Size') }}</th><th>{{ t('Hochgeladen', 'Uploaded') }}</th><th>{{ t('Zuletzt angesehen', 'Last viewed') }}</th></tr></thead>
        <tbody><tr v-for="b in vor.d.beispiele" :key="b.id"><td class="name">{{ b.name }}</td><td v-if="vor.r.geltung === 'alle'">{{ b.von }}</td><td class="mono">{{ groesse(b.size) }}</td><td>{{ datum(b.created_at) }}</td><td>{{ b.last_view_at ? datum(b.last_view_at) : t('nie', 'never') }}</td></tr></tbody>
      </table>
      <p v-if="vor.d.anzahl > vor.d.beispiele.length" class="sehrleise klein">{{ t(`… und ${vor.d.anzahl - vor.d.beispiele.length} weitere`, `… and ${vor.d.anzahl - vor.d.beispiele.length} more`) }}</p>
      <p v-if="!vor.d.anzahl" class="sehrleise">{{ t('Gerade trifft die Regel keine Datei.', 'The rule matches no file right now.') }}</p>
      <div class="modal-fuss"><button class="knopf" @click="vor = null">{{ t('Schließen', 'Close') }}</button><button class="knopf rot" :disabled="!vor.d.anzahl" @click="jetzt(vor.r, vor.d.anzahl)"><Ico n="play" /> {{ t('Jetzt ausführen', 'Run now') }}</button></div>
    </VdModal>
    </template>
  </section>
</template>

<style scoped>
.reiter-leiste {
  margin-bottom: 16px;
}
.liste {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.liste .block + .block {
  margin-top: 0;
}
.regel {
  animation: rein 0.45s var(--kurve) backwards;
  animation-delay: calc(var(--i) * 50ms);
  transition: opacity 0.2s;
}
.regel.aus {
  opacity: 0.7;
}
.r-kopf {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.r-kopf .schalter {
  margin-top: 2px;
}
.was {
  flex: 1;
  min-width: 0;
}
.satz {
  margin: 4px 0 0;
  font-size: 14px;
  color: var(--text2);
  line-height: 1.55;
}
.gross-satz {
  font-size: 15px;
  margin-bottom: 14px;
}
.pfeil {
  color: var(--text3);
  margin: 0 2px;
}
.aktion {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  font-weight: 600;
  color: var(--text);
}
.aktion svg {
  width: 13px;
  height: 13px;
}
.aktion.loeschen {
  color: var(--rot);
}
.r-fuss {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--linie);
}
.klein {
  font-size: 12px;
}
.leer {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 20px;
}
.leer p {
  margin: 0 0 6px;
  max-width: 460px;
}
.gross-ic {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: rgba(var(--a-rgb), 0.1);
  color: var(--a);
  display: grid;
  place-items: center;
}
.gross-ic svg {
  width: 24px;
  height: 24px;
}
.baukasten {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg);
  border: 1px solid var(--linie);
  border-radius: 14px;
  padding: 14px;
  margin-bottom: 14px;
}
.zeile-b {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 14px;
}
.wort {
  font-weight: 600;
  min-width: 64px;
}
.klein-e {
  width: auto;
  min-width: 150px;
  padding: 7px 10px;
  font-size: 13px;
}
.zahl-e {
  width: 90px;
  padding: 7px 10px;
  font-size: 13px;
}
.bed {
  cursor: pointer;
  border-radius: 10px;
  padding: 4px 8px;
  margin: 0 -8px;
  transition: background 0.2s;
  color: var(--text3);
}
.bed.an {
  color: var(--text);
  background: rgba(var(--a-rgb), 0.05);
}
.bed input[type='checkbox'] {
  accent-color: var(--a);
  width: 16px;
  height: 16px;
}
.aktionen {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.akt {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  text-align: left;
  border: 1.5px solid var(--linie);
  background: var(--flaeche);
  border-radius: 11px;
  padding: 10px;
  cursor: pointer;
  font: inherit;
  color: var(--text);
  transition:
    border-color 0.2s,
    background 0.2s;
}
.akt svg {
  width: 15px;
  height: 15px;
  margin-top: 2px;
  flex-shrink: 0;
  color: var(--text3);
}
.akt span {
  display: flex;
  flex-direction: column;
  font-size: 13px;
}
.akt small {
  color: var(--text3);
  font-size: 11.5px;
}
.akt.an {
  border-color: var(--a);
  background: rgba(var(--a-rgb), 0.06);
}
.akt.an svg {
  color: var(--a);
}
.akt.loeschen.an {
  border-color: var(--rot);
  background: var(--rot-bg);
}
.akt.loeschen.an svg {
  color: var(--rot);
}
.akt:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.frage-opt {
  display: flex;
  gap: 12px;
  align-items: center;
  cursor: pointer;
  margin-bottom: 12px;
}
.geltung {
  display: inline-flex;
  background: var(--bg);
  border: 1px solid var(--linie);
  border-radius: 11px;
  padding: 3px;
  gap: 2px;
  margin-bottom: 12px;
}
.geltung button {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 12.5px;
  color: var(--text2);
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
}
.geltung button svg {
  width: 13px;
  height: 13px;
}
.geltung button.an {
  background: var(--flaeche2);
  color: var(--text);
  font-weight: 600;
}
.live {
  display: flex;
  gap: 10px;
  align-items: center;
  background: var(--info-bg);
  color: var(--text);
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 13px;
}
.live svg {
  width: 15px;
  height: 15px;
  color: var(--info);
  flex-shrink: 0;
}
.live.warn {
  background: var(--rot-bg);
}
.live.warn svg {
  color: var(--rot);
}
.kennzahlen {
  display: flex;
  gap: 26px;
  margin-bottom: 14px;
}
.kennzahlen b {
  display: block;
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.kennzahlen small {
  color: var(--text3);
  font-size: 12px;
}
.tab {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  display: block;
  overflow-x: auto;
  max-height: 50vh;
}
.tab th,
.tab td {
  text-align: left;
  padding: 7px 10px;
  border-bottom: 1px solid var(--linie);
  white-space: nowrap;
}
.tab th {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text3);
  font-weight: 600;
}
.tab .name {
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
}
@media (max-width: 720px) {
  .aktionen {
    grid-template-columns: 1fr;
  }
}
</style>
