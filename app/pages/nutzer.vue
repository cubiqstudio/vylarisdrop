<script setup lang="ts">
useHead({ title: () => t('Nutzer', 'Users') })
const theme = useTheme()
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const istInhaber = computed(() => theme.value.user?.role === 'owner')
const { data, refresh } = await (useFetch as any)('/api/users', { key: 'nutzer' })
const nutzer = computed<any[]>(() => data.value?.users || [])
const neu = reactive({
  offen: false,
  username: '',
  email: '',
  password: '',
  role: 'user',
  quota_gb: '' as string | number
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
        quota_gb: neu.quota_gb === '' ? null : Number(neu.quota_gb)
      }
    })
    Object.assign(neu, { offen: false, username: '', email: '', password: '', role: 'user', quota_gb: '' })
    await refresh()
    ok(t('Konto angelegt', 'Account created'))
  } catch (e: any) {
    fehler(e.message)
  }
}
const bearb = ref<any>(null)
async function speichern() {
  try {
    const body: Record<string, any> = { quota_gb: bearb.value.quota_gb === '' ? null : Number(bearb.value.quota_gb) }
    if (istInhaber.value) body.role = bearb.value.role
    if (bearb.value.password) body.password = bearb.value.password
    await api(`/api/users/${bearb.value.id}`, { method: 'PATCH', body })
    bearb.value = null
    await refresh()
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
        await refresh()
        ok(t('Gelöscht', 'Deleted'))
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}
const ROLLE = (r: string) => (r === 'owner' ? t('Inhaber', 'Owner') : r === 'admin' ? 'Admin' : t('Nutzer', 'User'))
const anteil = (u: any) => (u.quota_bytes ? Math.min(100, (Number(u.belegt) / Number(u.quota_bytes)) * 100) : 0)
</script>

<template>
  <section class="rein">
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
    <div class="liste">
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
              >{{ groesse(u.belegt) }}<template v-if="u.quota_bytes"> / {{ groesse(u.quota_bytes) }}</template></span
            ><span class="sehrleise">{{ zahl(u.dateien) }} {{ t('Dateien', 'files') }}</span>
          </div>
          <div class="balken">
            <i :style="{ width: (u.quota_bytes ? anteil(u) : 0) + '%' }" :class="{ voll: anteil(u) > 90 }"></i>
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
          <button
            class="knopf nur-icon"
            :aria-label="t('Bearbeiten', 'Edit')"
            @click="
              bearb = {
                id: u.id,
                username: u.username,
                role: u.role,
                quota_gb: u.quota_bytes ? Math.round((u.quota_bytes / 1024 ** 3) * 10) / 10 : '',
                password: ''
              }
            "
          >
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
          <label class="feld"
            ><span>{{ t('Kontingent (GB)', 'Quota (GB)') }}</span
            ><input
              v-model="neu.quota_gb"
              class="eingabe"
              type="number"
              min="0"
              step="0.5"
              :placeholder="t('unbegrenzt', 'unlimited')"
          /></label>
        </div>
        <div class="modal-fuss">
          <button type="button" class="knopf" @click="neu.offen = false">{{ t('Abbrechen', 'Cancel') }}</button
          ><button class="knopf rot">{{ t('Anlegen', 'Create') }}</button>
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
          <label class="feld"
            ><span>{{ t('Kontingent (GB)', 'Quota (GB)') }}</span
            ><input
              v-model="bearb.quota_gb"
              class="eingabe"
              type="number"
              min="0"
              step="0.5"
              :placeholder="t('unbegrenzt', 'unlimited')"
          /></label>
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
          ><button class="knopf rot">{{ t('Speichern', 'Save') }}</button>
        </div>
      </form>
    </VdModal>
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
.balken {
  height: 5px;
  border-radius: 99px;
  background: var(--flaeche2);
  margin-top: 6px;
  overflow: hidden;
}
.balken i {
  display: block;
  height: 100%;
  background: var(--a);
  border-radius: 99px;
  transform-origin: left;
  animation: wachsen 1s 0.2s var(--kurve) both;
}
.balken i.voll {
  background: var(--warn);
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
