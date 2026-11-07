<script setup lang="ts">
useHead({ title: () => t('Nutzer', 'Users') })
const theme = useTheme()
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const istInhaber = computed(() => theme.value.user?.role === 'owner')
const istAdmin = computed(() => ['owner', 'admin'].includes(theme.value.user?.role || ''))
// Nicht-Admins rufen die Verwaltungs-APIs gar nicht erst ab (sie würden 403 liefern)
const { data, refresh } = await (useFetch as any)('/api/users', { key: 'nutzer', immediate: istAdmin.value })
const { data: ueb, refresh: uebNeu } = await (useFetch as any)('/api/quota', {
  key: 'quota-uebersicht',
  immediate: istAdmin.value
})
const alleNutzer = computed<any[]>(() => data.value?.users || [])
const neu = reactive({
  offen: false,
  username: '',
  email: '',
  password: '',
  role: 'user',
  quota: null as number | null | undefined
})
async function anlegen() {
  try {
    await api('/api/users', {
      method: 'POST',
      body: {
        username: neu.username,
        email: neu.email,
        password: neu.password,
        role: neu.role,
        quota_bytes: neu.quota ?? null
      }
    })
    Object.assign(neu, { offen: false, username: '', email: '', password: '', role: 'user', quota: null })
    await Promise.all([refresh(), uebNeu()])
    ok(t('Konto angelegt', 'Account created'))
  } catch (e: any) {
    fehler(e.message)
  }
}
const bearb = ref<any>(null)
async function speichern() {
  try {
    const body: Record<string, any> = { quota_bytes: bearb.value.quota ?? null }
    if (istInhaber.value) body.role = bearb.value.role
    if (bearb.value.password) body.password = bearb.value.password
    await api(`/api/users/${bearb.value.id}`, { method: 'PATCH', body })
    bearb.value = null
    await Promise.all([refresh(), uebNeu()])
    await refreshNuxtData('stats')
    ok(t('Gespeichert', 'Saved'))
  } catch (e: any) {
    fehler(e.message)
  }
}
function loeschen(u: any) {
  bestaetigen(
    t('Konto löschen?', 'Delete account?'),
    t(
      `„${u.username}“ und ALLE ${u.dateien} Dateien dieses Kontos werden endgültig gelöscht.`,
      `“${u.username}” and ALL ${u.dateien} files of this account will be deleted permanently.`
    ),
    t('Endgültig löschen', 'Delete permanently'),
    async () => {
      try {
        await api(`/api/users/${u.id}`, { method: 'DELETE' })
        await Promise.all([refresh(), uebNeu()])
        ok(t('Gelöscht', 'Deleted'))
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}
const ROLLE = (r: string) => (r === 'owner' ? t('Inhaber', 'Owner') : r === 'admin' ? 'Admin' : t('Nutzer', 'User'))
// Sortierung und Filter nach Belegung
const sortierung = ref<'name' | 'belegt' | 'anteil'>('name')
const filter = ref<'alle' | 'ueber80' | 'voll' | 'ohne'>('alle')
const nutzer = computed<any[]>(() => {
  let l = [...alleNutzer.value]
  if (filter.value === 'ueber80') l = l.filter((u) => u.quota_stufe && u.quota_stufe !== 'ok')
  else if (filter.value === 'voll') l = l.filter((u) => u.quota_stufe === 'voll')
  else if (filter.value === 'ohne') l = l.filter((u) => u.quota_wirksam == null)
  if (sortierung.value === 'belegt') l.sort((a, b) => Number(b.belegt) - Number(a.belegt))
  else if (sortierung.value === 'anteil')
    l.sort((a, b) => (b.quota_prozent ?? -1) - (a.quota_prozent ?? -1) || Number(b.belegt) - Number(a.belegt))
  else l.sort((a, b) => a.username.localeCompare(b.username, lang()))
  return l
})
const QUELLE = (u: any) =>
  u.quota_unbegrenzt
    ? t('Unbegrenzt', 'Unlimited')
    : u.quota_quelle === 'konto'
      ? t('Konto', 'Account')
      : u.quota_quelle === 'rolle'
        ? t('Rolle', 'Role')
        : u.quota_quelle === 'standard'
          ? t('Standard', 'Default')
          : t('Kein Limit', 'No limit')
const erbtText = (u: any) => {
  const e = u?.quota_erbt
  if (!e || e.limit == null) return t('Erbt derzeit: kein Limit.', 'Currently inherits: no limit.')
  return t(
    `Erbt derzeit: ${groesse(e.limit)} (${e.source === 'rolle' ? 'Rolle' : 'Standard'}).`,
    `Currently inherits: ${groesse(e.limit)} (${e.source === 'rolle' ? 'role' : 'default'}).`
  )
}
const standardErbt = computed(() => ({
  quota_erbt: ueb.value?.standardGb ? { limit: Math.round(ueb.value.standardGb * 1024 ** 3), source: 'standard' } : null
}))
const plattenWarnung = computed(
  () => !!ueb.value?.platte && ueb.value.vergeben > ueb.value.platte.gesamt
)
function bearbeiten(u: any) {
  bearb.value = {
    id: u.id,
    username: u.username,
    role: u.role,
    // null = erbt, -1 = unbegrenzt, sonst Bytes (Rohwert am Konto)
    quota: u.quota_bytes == null || Number(u.quota_bytes) === 0 ? null : Number(u.quota_bytes),
    erbt: u.quota_erbt,
    password: ''
  }
}
</script>

<template>
  <section class="rein">
    <div v-if="!istAdmin" class="block leer-hinweis">
      <h3>{{ t('Nur für Administratoren', 'Administrators only') }}</h3>
      <p>{{ t('Dafür fehlt dir die Berechtigung.', 'You do not have permission for this.') }}</p>
    </div>
    <template v-else>
    <div class="kopf">
      <div>
        <div class="eyebrow"><Ico n="users" /> {{ t('Verwaltung', 'Manage') }}</div>
        <h1>{{ t('Nutzer', 'Users') }}</h1>
        <p>
          {{
            t(
              'Konten für deine Familie, Freunde oder dein Team — jedes mit eigenen Dateien und auf Wunsch eigenem Kontingent.',
              'Accounts for family, friends or your team — each with its own files and optional quota.'
            )
          }}
        </p>
      </div>
      <button class="knopf rot" @click="neu.offen = true">
        <Ico n="plus" /> {{ t('Konto anlegen', 'Add account') }}
      </button>
    </div>
    <div v-if="ueb" class="uebersicht">
      <div class="kachel">
        <small>{{ t('Gesamt belegt', 'Total used') }}</small>
        <b class="zahl">{{ groesse(ueb.belegt) }}</b>
        <span class="sehrleise">{{ t('davon Papierkorb', 'of which trash') }} {{ groesse(ueb.papierkorb) }}</span>
      </div>
      <div class="kachel">
        <small>{{ t('Insgesamt vergeben', 'Allocated in total') }}</small>
        <b class="zahl">{{ groesse(ueb.vergeben) }}</b>
        <span class="sehrleise"
          >{{ ueb.begrenzt }} {{ t('mit Limit', 'with limit') }} · {{ ueb.unbegrenzt }} {{ t('ohne', 'without') }}</span
        >
      </div>
      <div class="kachel" :class="{ warnung: plattenWarnung }">
        <small>{{ t('Platte frei', 'Disk free') }}</small>
        <b class="zahl">{{ ueb.platte ? groesse(ueb.platte.frei) : '—' }}</b>
        <span class="sehrleise">{{
          plattenWarnung
            ? t('Vergeben ist mehr als die Platte fasst', 'Allocated is more than the disk holds')
            : ueb.platte
              ? t('von', 'of') + ' ' + groesse(ueb.platte.gesamt)
              : t('nicht messbar', 'not measurable')
        }}</span>
      </div>
      <div class="kachel" :class="{ warnung: ueb.ueber80 > 0 }">
        <small>{{ t('Konten über 80 %', 'Accounts over 80%') }}</small>
        <b class="zahl">{{ ueb.ueber80 }}</b>
        <span class="sehrleise">{{ t('davon voll:', 'of which full:') }} {{ ueb.voll }}</span>
      </div>
    </div>
    <div class="werkzeuge">
      <div class="seg" role="group" :aria-label="t('Sortieren', 'Sort')">
        <button :class="{ an: sortierung === 'name' }" @click="sortierung = 'name'">{{ t('Name', 'Name') }}</button>
        <button :class="{ an: sortierung === 'belegt' }" @click="sortierung = 'belegt'">
          {{ t('Belegung', 'Usage') }}
        </button>
        <button :class="{ an: sortierung === 'anteil' }" @click="sortierung = 'anteil'">
          {{ t('Anteil', 'Share') }}
        </button>
      </div>
      <div class="seg" role="group" :aria-label="t('Filtern', 'Filter')">
        <button :class="{ an: filter === 'alle' }" @click="filter = 'alle'">{{ t('Alle', 'All') }}</button>
        <button :class="{ an: filter === 'ueber80' }" @click="filter = 'ueber80'">{{ t('Über 80 %', 'Over 80%') }}</button>
        <button :class="{ an: filter === 'voll' }" @click="filter = 'voll'">{{ t('Voll', 'Full') }}</button>
        <button :class="{ an: filter === 'ohne' }" @click="filter = 'ohne'">{{ t('Ohne Limit', 'No limit') }}</button>
      </div>
    </div>
    <div class="liste">
      <p v-if="!nutzer.length" class="leise leer">{{ t('Keine Konten in dieser Ansicht.', 'No accounts in this view.') }}</p>
      <div v-for="(u, i) in nutzer" :key="u.id" class="zeile" :style="{ animationDelay: Math.min(i, 12) * 40 + 'ms' }">
        <span class="av">{{ u.username.slice(0, 1).toUpperCase() }}</span>
        <div class="wer">
          <b>{{ u.username }}</b
          ><small>{{ u.email || '—' }}</small>
        </div>
        <span :class="['chip', u.role === 'owner' ? 'rot' : u.role === 'admin' ? 'info' : 'neutral']">{{
          ROLLE(u.role)
        }}</span>
        <div class="platz">
          <div class="reihe zw klein">
            <span
              ><b class="zahl" :class="u.quota_stufe">{{ groesse(u.belegt) }}</b
              ><template v-if="u.quota_wirksam"> / {{ groesse(u.quota_wirksam) }}</template>
              <span v-if="u.quota_prozent != null" :class="['prozent', u.quota_stufe]">&nbsp;· {{ zahl(u.quota_prozent, 1) }} %</span></span
            ><span class="chip neutral quelle" :title="t('Woher das Limit kommt', 'Where the limit comes from')">{{ QUELLE(u) }}</span>
          </div>
          <VdQuotaBalken :used="Number(u.belegt)" :limit="u.quota_wirksam" klein :beschriftung="u.username" />
          <div class="reihe zw klein sub">
            <span class="sehrleise"
              >{{ zahl(u.dateien) }} {{ u.dateien === 1 ? t('Datei', 'file') : t('Dateien', 'files') }}<template v-if="Number(u.papierkorb) > 0">
                · {{ t('Papierkorb', 'trash') }} {{ groesse(u.papierkorb) }}</template
              ></span
            >
          </div>
          <div
            v-if="u.traffic != null"
            class="traffic klein"
            :class="{ voll: u.traffic_grenze && u.traffic >= u.traffic_grenze }"
            :title="t('Traffic diesen Monat', 'Traffic this month')"
          >
            <Ico n="download" /> {{ groesse(u.traffic)
            }}<template v-if="u.traffic_grenze"> / {{ groesse(u.traffic_grenze) }}</template>
            {{ t('diesen Monat', 'this month') }}
          </div>
        </div>
        <span v-if="u.totp_enabled" class="chip ok" :title="t('Zwei-Faktor aktiv', 'Two-factor active')"
          ><Ico n="shield"
        /></span>
        <template v-if="u.role !== 'owner' && u.id !== theme.user?.id && (istInhaber || u.role === 'user')">
          <button class="knopf nur-icon" :aria-label="t('Bearbeiten', 'Edit')" @click="bearbeiten(u)">
            <Ico n="edit" />
          </button>
          <button class="knopf nur-icon" :aria-label="t('Löschen', 'Delete')" @click="loeschen(u)">
            <Ico n="trash" />
          </button>
        </template>
      </div>
    </div>

    <VdModal v-if="neu.offen" :titel="t('Konto anlegen', 'Add account')" @zu="neu.offen = false">
      <form @submit.prevent="anlegen">
        <label class="feld"
          ><span>{{ t('Benutzername', 'Username') }}</span
          ><input v-model="neu.username" class="eingabe" required minlength="3" maxlength="40" autocomplete="off"
        /></label>
        <label class="feld"
          ><span>{{ t('E-Mail (optional)', 'E-mail (optional)') }}</span
          ><input v-model="neu.email" class="eingabe" type="email" autocomplete="off"
        /></label>
        <label class="feld"
          ><span>{{ t('Start-Passwort', 'Initial password') }}</span
          ><input
            v-model="neu.password"
            class="eingabe"
            type="password"
            minlength="10"
            required
            autocomplete="new-password"
          /><small>{{
            t('Mindestens 10 Zeichen. Gib es der Person sicher weiter.', 'At least 10 characters. Pass it on securely.')
          }}</small></label
        >
        <div class="zwei">
          <label class="feld"
            ><span>{{ t('Rolle', 'Role') }}</span
            ><VdAuswahl v-model="neu.role" class="eingabe"
              ><option value="user">{{ t('Nutzer', 'User') }}</option>
              <option v-if="istInhaber" value="admin">Admin</option></VdAuswahl
            ></label
          >
        </div>
        <div class="feld">
          <span>{{ t('Kontingent', 'Quota') }}</span>
          <VdQuotaEingabe v-model="neu.quota" id-prefix="neu" :erbt-text="erbtText(neu.role === 'user' ? standardErbt : {})" />
        </div>
        <div class="modal-fuss">
          <button type="button" class="knopf" @click="neu.offen = false">{{ t('Abbrechen', 'Cancel') }}</button
          ><button class="knopf rot" :disabled="neu.quota === undefined">{{ t('Anlegen', 'Create') }}</button>
        </div>
      </form>
    </VdModal>
    <VdModal v-if="bearb" :titel="bearb.username" @zu="bearb = null">
      <form @submit.prevent="speichern">
        <div class="zwei">
          <label class="feld"
            ><span>{{ t('Rolle', 'Role') }}</span
            ><VdAuswahl v-model="bearb.role" class="eingabe" :disabled="!istInhaber"
              ><option value="user">{{ t('Nutzer', 'User') }}</option>
              <option value="admin">Admin</option></VdAuswahl
            ></label
          >
        </div>
        <div class="feld">
          <span>{{ t('Kontingent', 'Quota') }}</span>
          <VdQuotaEingabe v-model="bearb.quota" id-prefix="bearb" :erbt-text="erbtText({ quota_erbt: bearb.erbt })" />
          <small>{{
            t(
              'Reihenfolge: Limit am Konto → Rolle → Standard der Installation → unbegrenzt. Admins sind ohne eigenes Limit nie eingeschränkt.',
              'Order: limit on the account → role → instance default → unlimited. Admins without their own limit are never restricted.'
            )
          }}</small>
        </div>
        <label class="feld"
          ><span>{{ t('Neues Passwort (optional)', 'New password (optional)') }}</span
          ><input
            v-model="bearb.password"
            class="eingabe"
            type="password"
            minlength="10"
            autocomplete="new-password"
          /><small>{{
            t('Meldet das Konto auf allen Geräten ab.', 'Signs the account out on all devices.')
          }}</small></label
        >
        <div class="modal-fuss">
          <button type="button" class="knopf" @click="bearb = null">{{ t('Abbrechen', 'Cancel') }}</button
          ><button class="knopf rot" :disabled="bearb.quota === undefined">{{ t('Speichern', 'Save') }}</button>
        </div>
      </form>
    </VdModal>
    </template>
  </section>
</template>

<style scoped>
.liste {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.zeile {
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 14px;
  padding: 12px 14px;
  animation: rein 0.45s var(--kurve) backwards;
  flex-wrap: wrap;
}
.av {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--a), color-mix(in srgb, var(--a) 55%, #000));
  color: #fff;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-family: var(--f-display);
}
.wer {
  display: flex;
  flex-direction: column;
  min-width: 140px;
}
.wer small {
  color: var(--text3);
  font-size: 12px;
}
.platz {
  flex: 1;
  min-width: 180px;
}
.klein {
  font-size: 12px;
}
.platz .zahl.warn,
.platz .prozent.warn {
  color: var(--warn);
}
.platz .zahl.kritisch,
.platz .zahl.voll,
.platz .prozent.kritisch,
.platz .prozent.voll {
  color: var(--rot);
}
.platz .prozent {
  font-weight: 600;
}
.platz .qb {
  margin: 6px 0 4px;
}
.sub {
  font-size: 11.5px;
}
.quelle {
  font-size: 11px;
  padding: 1px 8px;
}
.uebersicht {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}
.kachel {
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 14px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.kachel small {
  color: var(--text3);
  font-size: 11.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.kachel b {
  font-family: var(--f-display);
  font-size: 22px;
  letter-spacing: -0.02em;
  font-weight: 600;
}
.kachel span {
  font-size: 12px;
}
.kachel.warnung {
  border-color: color-mix(in srgb, var(--warn) 45%, var(--linie));
}
.kachel.warnung b {
  color: var(--warn);
}
.werkzeuge {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.leer {
  padding: 16px 4px;
}
@media (max-width: 760px) {
  .uebersicht {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.zwei {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.traffic {
  display: flex;
  gap: 5px;
  align-items: center;
  color: var(--text3);
  margin-top: 5px;
  font-size: 11.5px;
}
.traffic svg {
  width: 12px;
  height: 12px;
}
.traffic.voll {
  color: var(--warn);
}
</style>
