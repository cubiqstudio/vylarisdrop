<script setup lang="ts">
useHead({ title: () => t('Teams & Rollen', 'Teams & roles') })
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const { data: pro } = await (useFetch as any)('/api/pro', { key: 'pro' })
const an = computed(() => !!pro.value?.funktionen?.teams)
const { data, refresh } = await (useFetch as any)('/api/pro/teams', { key: 'teams' })
const teams = computed<any[]>(() => data.value?.teams || [])
const rollen = computed<any[]>(() => data.value?.rollen || [])
const konten = computed<any[]>(() => data.value?.konten || [])
const reiter = ref<'teams' | 'rollen'>('teams')
const FARBEN = ['#1e73be', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#ef4444', '#8b5cf6', '#ec4899']

async function senden(url: string, body: Record<string, any>, text?: string) {
  try {
    const r = await api(url, { method: 'POST', body })
    await refresh()
    if (text) ok(text)
    return r
  } catch (e: any) {
    fehler(e.message)
    return null
  }
}

const teamForm = ref<any>(null)
const offenesTeam = ref<number | null>(null)
async function teamSpeichern() {
  const f = teamForm.value
  const r = await senden(
    '/api/pro/teams',
    f.id
      ? { aktion: 'aendern', id: f.id, name: f.name, farbe: f.farbe, beschreibung: f.beschreibung }
      : { aktion: 'anlegen', name: f.name, farbe: f.farbe, beschreibung: f.beschreibung },
    t('Gespeichert', 'Saved')
  )
  if (r) {
    teamForm.value = null
    if (r.id) offenesTeam.value = r.id
  }
}
function teamLoeschen(tm: any) {
  bestaetigen(
    t('Team löschen?', 'Delete team?'),
    t(
      `Die ${tm.ordner} Team-Ordner werden wieder private Ordner ihrer Ersteller. Dateien bleiben erhalten.`,
      `The ${tm.ordner} team folders become private folders of their creators again. Files are kept.`
    ),
    t('Löschen', 'Delete'),
    () => senden('/api/pro/teams', { aktion: 'loeschen', id: tm.id }, t('Team gelöscht', 'Team deleted'))
  )
}
const neuesMitglied = reactive<Record<number, string>>({})
const mitglied = (tm: any, user_id: number, rolle: 'leitung' | 'mitglied' | null) =>
  senden('/api/pro/teams', { aktion: 'mitglied', id: tm.id, user_id, rolle })
const nichtImTeam = (tm: any) => konten.value.filter((k) => !tm.mitglieder.some((m: any) => m.id === k.id))

const LEER = {
  hochladen: true,
  anfragen: true,
  import: true,
  maxDateiMb: null,
  kontingentGb: null,
  ablaufMaxTage: null,
  trafficGb: null
}
const rolleForm = ref<any>(null)
async function rolleSpeichern() {
  const f = rolleForm.value
  const zahlOderNull = (v: any) => (v === '' || v == null ? null : Number(v))
  const rechte = {
    hochladen: f.rechte.hochladen,
    anfragen: f.rechte.anfragen,
    import: f.rechte.import,
    maxDateiMb: zahlOderNull(f.rechte.maxDateiMb),
    kontingentGb: zahlOderNull(f.rechte.kontingentGb),
    ablaufMaxTage: zahlOderNull(f.rechte.ablaufMaxTage),
    trafficGb: zahlOderNull(f.rechte.trafficGb)
  }
  const r = await senden(
    '/api/pro/rollen',
    f.id
      ? { aktion: 'aendern', id: f.id, name: f.name, farbe: f.farbe, rechte }
      : { aktion: 'anlegen', name: f.name, farbe: f.farbe, rechte },
    t('Gespeichert', 'Saved')
  )
  if (r) rolleForm.value = null
}
function rolleLoeschen(r: any) {
  bestaetigen(
    t('Rolle löschen?', 'Delete role?'),
    t(`${r.konten} Konten verlieren damit ihre Einschränkungen.`, `${r.konten} accounts lose their restrictions.`),
    t('Löschen', 'Delete'),
    () => senden('/api/pro/rollen', { aktion: 'loeschen', id: r.id }, t('Rolle gelöscht', 'Role deleted'))
  )
}
const zuweisen = (k: any, id: string) =>
  senden(
    '/api/pro/rollen',
    { aktion: 'zuweisen', id: id ? Number(id) : null, user_id: k.id },
    t('Rolle zugewiesen', 'Role assigned')
  )
function rechteText(r: any): string[] {
  const x: string[] = []
  if (!r.hochladen) x.push(t('keine Uploads', 'no uploads'))
  if (!r.anfragen) x.push(t('keine Anfragen', 'no requests'))
  if (!r.import) x.push(t('kein Import', 'no import'))
  if (r.maxDateiMb) x.push(t(`max. ${zahl(r.maxDateiMb)} MB je Datei`, `max. ${zahl(r.maxDateiMb)} MB per file`))
  if (r.kontingentGb)
    x.push(
      t(
        `${zahl(r.kontingentGb, r.kontingentGb < 10 ? 1 : 0)} GB Speicher`,
        `${zahl(r.kontingentGb, r.kontingentGb < 10 ? 1 : 0)} GB storage`
      )
    )
  if (r.trafficGb)
    x.push(
      t(
        `${zahl(r.trafficGb, r.trafficGb < 10 ? 1 : 0)} GB Traffic/Monat`,
        `${zahl(r.trafficGb, r.trafficGb < 10 ? 1 : 0)} GB traffic/month`
      )
    )
  if (r.ablaufMaxTage)
    x.push(t(`löscht nach ${zahl(r.ablaufMaxTage)} Tagen`, `deletes after ${zahl(r.ablaufMaxTage)} days`))
  return x.length ? x : [t('alles erlaubt', 'everything allowed')]
}
const normale = computed(() => konten.value.filter((k) => k.role === 'user'))
</script>

<template>
  <section class="rein">
    <div class="kopf">
      <div><div class="eyebrow"><Ico n="users" /> Pro</div><h1>{{ t('Teams & Rollen', 'Teams & roles') }}</h1>
        <p>{{ t('Teams teilen Ordner miteinander, Rollen legen fest, was normale Konten dürfen.', 'Teams share folders with each other, roles define what regular accounts may do.') }}</p></div>
      <div class="seg" role="tablist">
        <button :class="{ an: reiter === 'teams' }" @click="reiter = 'teams'"><Ico n="users" /> Teams <span class="zahl">{{ teams.length }}</span></button>
        <button :class="{ an: reiter === 'rollen' }" @click="reiter = 'rollen'"><Ico n="shield" /> {{ t('Rollen', 'Roles') }} <span class="zahl">{{ rollen.length }}</span></button>
      </div>
    </div>

    <VdProSperre v-if="!an" ic="users" :titel="t('Teams & Rollen', 'Teams & roles')" :text="t('Gemeinsame Ordner für Abteilungen, Projekte oder die Familie — und Rollen, die Uploads, Speicher und Laufzeit regeln.', 'Shared folders for departments, projects or the family — and roles that govern uploads, storage and lifetime.')"
      :punkte="[t('Team-Ordner: alle Mitglieder sehen und laden hoch', 'Team folders: all members see and upload'), t('Team-Leitung darf alle Dateien im Team verwalten', 'Team leads may manage all files in the team'), t('Rollen mit Kontingent, Dateigröße und automatischem Löschen', 'Roles with quota, file size and automatic deletion'), t('Neue SSO-Konten landen direkt im richtigen Team', 'New SSO accounts land directly in the right team')]" />

    <Transition v-else name="wechsel" mode="out-in">
      <div v-if="reiter === 'teams'" key="t">
        <div class="reihe zw leiste"><p class="leise klein">{{ t('Team-Ordner entstehen unter „Ordner“: neu anlegen oder einen eigenen Ordner fürs Team freigeben.', 'Team folders are created under "Folders": create a new one or share one of your own with the team.') }}</p>
          <button class="knopf rot" @click="teamForm = { name: '', farbe: FARBEN[teams.length % FARBEN.length], beschreibung: '' }"><Ico n="plus" /> {{ t('Team anlegen', 'Create team') }}</button></div>
        <div v-if="!teams.length" class="leer-hinweis block"><h3>{{ t('Noch keine Teams', 'No teams yet') }}</h3><p>{{ t('Lege ein Team an und füge Mitglieder hinzu.', 'Create a team and add members.') }}</p></div>
        <div class="teams">
          <div v-for="(tm, i) in teams" :key="tm.id" :class="['team', { offen: offenesTeam === tm.id }]" :style="{ '--f': tm.farbe, animationDelay: Math.min(i, 10) * 50 + 'ms' }">
            <button class="team-kopf" :aria-expanded="offenesTeam === tm.id" @click="offenesTeam = offenesTeam === tm.id ? null : tm.id">
              <span class="farbe"></span>
              <span class="tn"><b>{{ tm.name }}</b><small>{{ tm.beschreibung || t(`${tm.mitglieder.length} ${tm.mitglieder.length === 1 ? 'Mitglied' : 'Mitglieder'} · ${tm.ordner} Ordner`, `${tm.mitglieder.length} ${tm.mitglieder.length === 1 ? 'member' : 'members'} · ${tm.ordner} ${tm.ordner === 1 ? 'folder' : 'folders'}`) }}</small></span>
              <span class="stapel"><i v-for="m in tm.mitglieder.slice(0, 5)" :key="m.id" :title="m.username">{{ m.username.slice(0, 1).toUpperCase() }}</i><i v-if="tm.mitglieder.length > 5" class="mehr">+{{ tm.mitglieder.length - 5 }}</i></span>
              <Ico n="down" class="pfeil" />
            </button>
            <Transition name="aufklappen">
              <div v-if="offenesTeam === tm.id" class="team-inhalt">
                <div v-for="m in tm.mitglieder" :key="m.id" class="mitglied">
                  <span class="av">{{ m.username.slice(0, 1).toUpperCase() }}</span><b>{{ m.username }}</b>
                  <VdAuswahl class="eingabe klein-sel" :model-value="m.rolle" @change="(e: any) => mitglied(tm, m.id, e)"><option value="mitglied">{{ t('Mitglied', 'Member') }}</option><option value="leitung">{{ t('Leitung', 'Lead') }}</option></VdAuswahl>
                  <button class="knopf nur-icon" :aria-label="t('Entfernen', 'Remove')" @click="mitglied(tm, m.id, null)"><Ico n="x" /></button>
                </div>
                <form v-if="nichtImTeam(tm).length" class="reihe dazu" @submit.prevent="neuesMitglied[tm.id] && mitglied(tm, Number(neuesMitglied[tm.id]), 'mitglied').then(() => { neuesMitglied[tm.id] = '' })">
                  <VdAuswahl v-model="neuesMitglied[tm.id]" class="eingabe" style="flex:1"><option value="">{{ t('Konto hinzufügen …', 'Add account …') }}</option><option v-for="k in nichtImTeam(tm)" :key="k.id" :value="k.id">{{ k.username }}</option></VdAuswahl>
                  <button class="knopf" :disabled="!neuesMitglied[tm.id]"><Ico n="plus" /> {{ t('Hinzufügen', 'Add') }}</button>
                </form>
                <div class="reihe fuss"><button class="knopf klein" @click="teamForm = { ...tm }"><Ico n="edit" /> {{ t('Bearbeiten', 'Edit') }}</button><button class="knopf klein gefahr" @click="teamLoeschen(tm)"><Ico n="trash" /> {{ t('Löschen', 'Delete') }}</button></div>
              </div>
            </Transition>
          </div>
        </div>
      </div>

      <div v-else key="r">
        <div class="reihe zw leiste"><p class="leise klein">{{ t('Rollen gelten nur für normale Konten — Admins und der Inhaber dürfen immer alles.', 'Roles only apply to regular accounts — admins and the owner may always do everything.') }}</p>
          <button class="knopf rot" @click="rolleForm = { name: '', farbe: '#3b82f6', rechte: { ...LEER } }"><Ico n="plus" /> {{ t('Rolle anlegen', 'Create role') }}</button></div>
        <div class="rollen">
          <div v-for="(r, i) in rollen" :key="r.id" class="rolle" :style="{ '--f': r.farbe, animationDelay: Math.min(i, 10) * 50 + 'ms' }">
            <div class="reihe zw"><b class="rn"><span class="farbe"></span>{{ r.name }}</b><span class="sehrleise klein">{{ r.konten }} {{ t('Konten', 'accounts') }}</span></div>
            <div class="chips"><span v-for="x in rechteText(r.rechte)" :key="x" class="chip neutral">{{ x }}</span></div>
            <div class="reihe"><button class="knopf klein" @click="rolleForm = { id: r.id, name: r.name, farbe: r.farbe, rechte: { ...LEER, ...r.rechte } }"><Ico n="edit" /> {{ t('Bearbeiten', 'Edit') }}</button><button class="knopf klein gefahr" @click="rolleLoeschen(r)"><Ico n="trash" /></button></div>
          </div>
        </div>
        <div class="block zuordnung">
          <h3>{{ t('Konten und Rollen', 'Accounts and roles') }}</h3>
          <p v-if="!normale.length" class="leise klein">{{ t('Es gibt noch keine normalen Konten.', 'There are no regular accounts yet.') }}</p>
          <div v-for="k in normale" :key="k.id" class="z-zeile"><span class="av">{{ k.username.slice(0, 1).toUpperCase() }}</span><b>{{ k.username }}</b>
            <VdAuswahl class="eingabe klein-sel" :model-value="k.rolle_id || ''" @change="(e: any) => zuweisen(k, e)"><option value="">{{ t('ohne Rolle (alles erlaubt)', 'no role (everything allowed)') }}</option><option v-for="r in rollen" :key="r.id" :value="r.id">{{ r.name }}</option></VdAuswahl></div>
        </div>
      </div>
    </Transition>

    <VdModal v-if="teamForm" :titel="teamForm.id ? t('Team bearbeiten', 'Edit team') : t('Team anlegen', 'Create team')" @zu="teamForm = null">
      <form @submit.prevent="teamSpeichern">
        <label class="feld"><span>Name</span><input v-model="teamForm.name" class="eingabe" required maxlength="60" autofocus></label>
        <label class="feld"><span>{{ t('Beschreibung (optional)', 'Description (optional)') }}</span><input v-model="teamForm.beschreibung" class="eingabe" maxlength="300"></label>
        <div class="feld"><span>{{ t('Farbe', 'Colour') }}</span><div class="farben"><button v-for="c in FARBEN" :key="c" type="button" :class="{ an: teamForm.farbe === c }" :style="{ background: c }" :aria-label="c" @click="teamForm.farbe = c"></button></div></div>
        <div class="modal-fuss"><button type="button" class="knopf" @click="teamForm = null">{{ t('Abbrechen', 'Cancel') }}</button><button class="knopf rot">{{ t('Speichern', 'Save') }}</button></div>
      </form>
    </VdModal>
    <VdModal v-if="rolleForm" :titel="rolleForm.id ? t('Rolle bearbeiten', 'Edit role') : t('Rolle anlegen', 'Create role')" @zu="rolleForm = null">
      <form @submit.prevent="rolleSpeichern">
        <label class="feld"><span>Name</span><input v-model="rolleForm.name" class="eingabe" required maxlength="40" :placeholder="t('z. B. Gast, Praktikant, Kunde', 'e.g. Guest, Intern, Client')"></label>
        <div class="feld"><span>{{ t('Darf …', 'May …') }}</span>
          <label v-for="r in [{ k: 'hochladen', text: t('Dateien hochladen', 'upload files') }, { k: 'anfragen', text: t('Datei-Anfragen erstellen', 'create file requests') }, { k: 'import', text: t('aus anderen Diensten importieren', 'import from other services') }]" :key="r.k" class="opt">
            <button type="button" :class="['schalter', { an: rolleForm.rechte[r.k] }]" role="switch" :aria-checked="rolleForm.rechte[r.k]" @click="rolleForm.rechte[r.k] = !rolleForm.rechte[r.k]"></button>{{ r.text }}</label>
        </div>
        <div class="drei">
          <label class="feld"><span>{{ t('Max. Dateigröße (MB)', 'Max. file size (MB)') }}</span><input v-model="rolleForm.rechte.maxDateiMb" class="eingabe" type="number" min="1" step="1" :placeholder="t('Installation', 'instance')"></label>
          <label class="feld"><span>{{ t('Speicher (GB)', 'Storage (GB)') }}</span><input v-model="rolleForm.rechte.kontingentGb" class="eingabe" type="number" min="0.1" step="0.1" :placeholder="t('unbegrenzt', 'unlimited')"><small>{{ t('Ein eigenes Kontingent am Konto geht vor.', 'An account\'s own quota takes precedence.') }}</small></label>
          <label class="feld"><span>{{ t('Löschen nach (Tagen)', 'Delete after (days)') }}</span><input v-model="rolleForm.rechte.ablaufMaxTage" class="eingabe" type="number" min="1" step="1" :placeholder="t('nie', 'never')"></label>
        </div>
        <label class="feld"><span>{{ t('Traffic pro Monat (GB)', 'Traffic per month (GB)') }}</span><input v-model="rolleForm.rechte.trafficGb" class="eingabe" type="number" min="0.1" step="0.1" :placeholder="t('Vorgabe der Installation', 'instance default')" style="max-width:260px"><small>{{ t('Braucht Pro „Traffic“. Danach werden die Dateien bis Monatsende nicht mehr öffentlich ausgeliefert.', 'Needs Pro “Traffic”. After that, files are no longer delivered publicly until the end of the month.') }}</small></label>
        <div class="feld"><span>{{ t('Farbe', 'Colour') }}</span><div class="farben"><button v-for="c in FARBEN" :key="c" type="button" :class="{ an: rolleForm.farbe === c }" :style="{ background: c }" :aria-label="c" @click="rolleForm.farbe = c"></button></div></div>
        <div class="modal-fuss"><button type="button" class="knopf" @click="rolleForm = null">{{ t('Abbrechen', 'Cancel') }}</button><button class="knopf rot">{{ t('Speichern', 'Save') }}</button></div>
      </form>
    </VdModal>
  </section>
</template>

<style scoped>
.klein {
  font-size: 12.5px;
}
.leiste {
  margin-bottom: 14px;
}
.leiste p {
  margin: 0;
  max-width: 620px;
}
.teams {
  display: grid;
  gap: 10px;
}
.team {
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 16px;
  overflow: hidden;
  animation: rein 0.45s var(--kurve) backwards;
  transition: border-color 0.2s;
}
.team.offen {
  border-color: color-mix(in srgb, var(--f) 45%, var(--linie));
}
.team-kopf {
  width: 100%;
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 14px 16px;
  background: none;
  border: 0;
  cursor: pointer;
  text-align: left;
  color: var(--text);
}
.farbe {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  background: var(--f);
  flex-shrink: 0;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--f) 18%, transparent);
}
.tn {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.tn small {
  color: var(--text3);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stapel {
  display: flex;
}
.stapel i {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-style: normal;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  background: color-mix(in srgb, var(--f) 80%, #000);
  border: 2px solid var(--flaeche);
  margin-left: -8px;
  font-family: var(--f-display);
}
.stapel i.mehr {
  background: var(--flaeche2);
  color: var(--text2);
}
.pfeil {
  width: 16px;
  height: 16px;
  color: var(--text3);
  transition: transform 0.3s var(--kurve);
}
.team.offen .pfeil {
  transform: rotate(180deg);
}
.team-inhalt {
  padding: 4px 16px 16px;
  display: grid;
  gap: 8px;
}
.mitglied,
.z-zeile {
  display: flex;
  gap: 10px;
  align-items: center;
}
.mitglied b,
.z-zeile b {
  flex: 1;
  font-size: 13.5px;
  font-weight: 500;
}
.av {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--a), color-mix(in srgb, var(--a) 55%, #000));
  color: #fff;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 12.5px;
  font-family: var(--f-display);
  flex-shrink: 0;
}
.klein-sel {
  width: auto;
  padding: 6px 10px;
  font-size: 12.5px;
}
.dazu {
  margin-top: 6px;
}
.fuss {
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--linie);
}
.rollen {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}
.rolle {
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 16px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  animation: rein 0.45s var(--kurve) backwards;
}
.rn {
  display: flex;
  gap: 10px;
  align-items: center;
}
.chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.zuordnung {
  display: grid;
  gap: 10px;
}
.opt {
  display: flex;
  gap: 12px;
  align-items: center;
  margin: 8px 0;
  cursor: pointer;
  font-size: 13.5px;
}
.drei {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.farben {
  display: flex;
  gap: 8px;
}
.farben button {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.15s;
}
.farben button.an {
  border-color: var(--text);
  transform: scale(1.1);
}
.wechsel-enter-active,
.wechsel-leave-active {
  transition:
    opacity 0.2s,
    transform 0.25s var(--kurve);
}
.wechsel-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.wechsel-leave-to {
  opacity: 0;
}
.aufklappen-enter-active,
.aufklappen-leave-active {
  transition:
    opacity 0.25s,
    transform 0.3s var(--kurve);
}
.aufklappen-enter-from,
.aufklappen-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
@media (max-width: 640px) {
  .drei {
    grid-template-columns: 1fr;
  }
  .stapel {
    display: none;
  }
}
</style>
