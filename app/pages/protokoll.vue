<script setup lang="ts">
useHead({ title: () => t('Protokoll', 'Activity log') })
const theme = useTheme()
const istAdmin = computed(() => theme.value.user?.role !== 'user')
const filter = reactive({ art: '', konto: '', suche: '', seite: 1 })
const suche = ref('')
let uhr: any = null
watch(suche, (v) => {
  clearTimeout(uhr)
  uhr = setTimeout(() => {
    filter.suche = v
    filter.seite = 1
  }, 300)
})
const query = computed(() =>
  Object.fromEntries(
    Object.entries(filter)
      .filter(([, v]) => (v !== '' && v !== 1) || false)
      .map(([k, v]) => [k, String(v)])
  )
)
const { data, pending } = await (useFetch as any)('/api/protokoll', { key: 'protokoll', query })
const { data: konten } = await (useFetch as any)('/api/users', { key: 'nutzer', immediate: istAdmin.value })
const seiten = computed(() => Math.max(1, Math.ceil((data.value?.gesamt || 0) / (data.value?.pro || 60))))

const ARTEN: Record<string, { ic: string; de: string; en: string; ton?: 'rot' | 'ok' | 'warn' }> = {
  login: { ic: 'key', de: 'Angemeldet', en: 'Signed in', ton: 'ok' },
  login_failed: { ic: 'alert', de: 'Anmeldung fehlgeschlagen', en: 'Sign-in failed', ton: 'rot' },
  password_changed: { ic: 'lock', de: 'Passwort geändert', en: 'Password changed' },
  '2fa_enabled': { ic: 'shield', de: 'Zwei-Faktor eingeschaltet', en: 'Two-factor enabled', ton: 'ok' },
  '2fa_disabled': { ic: 'shield', de: 'Zwei-Faktor abgeschaltet', en: 'Two-factor disabled', ton: 'warn' },
  backup_code_used: { ic: 'key', de: 'Notfall-Code benutzt', en: 'Backup code used', ton: 'warn' },
  passkey_angelegt: { ic: 'key', de: 'Passkey hinzugefügt', en: 'Passkey added', ton: 'ok' },
  passkey_geloescht: { ic: 'key', de: 'Passkey entfernt', en: 'Passkey removed' },
  upload: { ic: 'upload', de: 'Hochgeladen', en: 'Uploaded' },
  file_edited: { ic: 'edit', de: 'Datei bearbeitet', en: 'File edited' },
  file_deleted: { ic: 'trash', de: 'In den Papierkorb', en: 'Moved to trash' },
  files_deleted: { ic: 'trash', de: 'Dateien in den Papierkorb', en: 'Files moved to trash' },
  datei_wiederhergestellt: { ic: 'undo', de: 'Wiederhergestellt', en: 'Restored', ton: 'ok' },
  datei_endgueltig: { ic: 'trash', de: 'Endgültig gelöscht', en: 'Deleted permanently', ton: 'rot' },
  papierkorb_geleert: { ic: 'trash', de: 'Papierkorb geleert', en: 'Trash emptied', ton: 'rot' },
  anfrage_created: { ic: 'mail', de: 'Datei-Anfrage erstellt', en: 'File request created' },
  anfrage_upload: { ic: 'mail', de: 'Upload über Datei-Anfrage', en: 'Upload via file request' },
  token_created: { ic: 'key', de: 'Upload-Token erstellt', en: 'Upload token created' },
  token_deleted: { ic: 'key', de: 'Upload-Token gelöscht', en: 'Upload token deleted' },
  user_created: { ic: 'user', de: 'Konto angelegt', en: 'Account created' },
  user_updated: { ic: 'user', de: 'Konto geändert', en: 'Account changed' },
  user_deleted: { ic: 'user', de: 'Konto gelöscht', en: 'Account deleted', ton: 'rot' },
  settings_changed: { ic: 'gear', de: 'Einstellungen geändert', en: 'Settings changed' },
  setup: { ic: 'gear', de: 'Eingerichtet', en: 'Set up', ton: 'ok' },
  import_start: { ic: 'umzug', de: 'Import gestartet', en: 'Import started' },
  import_fertig: { ic: 'umzug', de: 'Import fertig', en: 'Import finished', ton: 'ok' },
  import_installer: { ic: 'umzug', de: 'Umzug per Installer', en: 'Move via installer' },
  team_angelegt: { ic: 'users', de: 'Team angelegt', en: 'Team created' },
  team_geloescht: { ic: 'users', de: 'Team gelöscht', en: 'Team deleted' },
  rolle_angelegt: { ic: 'shield', de: 'Rolle angelegt', en: 'Role created' },
  rolle_geloescht: { ic: 'shield', de: 'Rolle gelöscht', en: 'Role deleted' },
  sso_geaendert: { ic: 'tuer', de: 'SSO geändert', en: 'SSO changed' },
  sso_verknuepft: { ic: 'tuer', de: 'SSO verknüpft', en: 'SSO linked' },
  sso_geloest: { ic: 'tuer', de: 'SSO gelöst', en: 'SSO unlinked' },
  speicher_geaendert: { ic: 'wolke', de: 'Speicher geändert', en: 'Storage changed' },
  speicher_umzug: { ic: 'wolke', de: 'Speicher-Umzug', en: 'Storage move' },
  marke_geaendert: { ic: 'palette', de: 'Marke geändert', en: 'Branding changed' },
  update_angefragt: { ic: 'download', de: 'Update angestoßen', en: 'Update requested' },
  lizenz_aktivieren: { ic: 'krone', de: 'Lizenz aktiviert', en: 'Licence activated', ton: 'ok' },
  lizenz_entfernt: { ic: 'krone', de: 'Lizenz gelöst', en: 'Licence released' },
  lizenz_pruefen: { ic: 'krone', de: 'Lizenz geprüft', en: 'Licence checked' },
  lizenz_offline: { ic: 'krone', de: 'Offline-Lizenz', en: 'Offline licence' },
  virus_fund: { ic: 'alert', de: 'Virus gefunden', en: 'Virus found', ton: 'rot' },
  virus_freigegeben: { ic: 'shield', de: 'Fehlalarm freigegeben', en: 'False alarm released', ton: 'warn' },
  tunnel_an: { ic: 'wolke', de: 'Cloudflare Tunnel eingeschaltet', en: 'Cloudflare Tunnel turned on', ton: 'ok' },
  tunnel_aus: { ic: 'wolke', de: 'Cloudflare Tunnel ausgeschaltet', en: 'Cloudflare Tunnel turned off' },
  tunnel_abgebaut: { ic: 'wolke', de: 'Tunnel bei Cloudflare entfernt', en: 'Tunnel removed at Cloudflare' },
  webhook_angelegt: { ic: 'network', de: 'Webhook angelegt', en: 'Webhook added' },
  webhook_geloescht: { ic: 'network', de: 'Webhook gelöscht', en: 'Webhook deleted' },
  webhook_aus: {
    ic: 'network',
    de: 'Webhook abgeschaltet (zu viele Fehler)',
    en: 'Webhook disabled (too many errors)',
    ton: 'warn'
  },
  regel_angelegt: { ic: 'clock', de: 'Speicher-Regel angelegt', en: 'Storage rule added' },
  regel_lauf: { ic: 'clock', de: 'Speicher-Regel lief', en: 'Storage rule ran' },
  speicher_an: { ic: 'box', de: 'Speicherdienst eingeschaltet', en: 'Storage service turned on', ton: 'ok' },
  speicher_aus: { ic: 'box', de: 'Speicherdienst ausgeschaltet', en: 'Storage service turned off' },
  box_angelegt: { ic: 'box', de: 'Storage-Box angelegt', en: 'Storage box created', ton: 'ok' },
  box_geaendert: { ic: 'box', de: 'Storage-Box geändert', en: 'Storage box changed' },
  box_geloescht: { ic: 'box', de: 'Storage-Box gelöscht', en: 'Storage box deleted', ton: 'rot' },
  box_passwort: { ic: 'key', de: 'Box-Passwort neu gesetzt', en: 'Box password reset', ton: 'warn' },
  unterkonto_angelegt: { ic: 'users', de: 'Unterkonto angelegt', en: 'Sub-account created' },
  unterkonto_geaendert: { ic: 'users', de: 'Unterkonto geändert', en: 'Sub-account changed' },
  unterkonto_passwort: { ic: 'key', de: 'Unterkonto-Passwort neu', en: 'Sub-account password reset', ton: 'warn' },
  unterkonto_geloescht: { ic: 'users', de: 'Unterkonto gelöscht', en: 'Sub-account deleted' },
  bucket_angelegt: { ic: 'database', de: 'Bucket angelegt', en: 'Bucket created', ton: 'ok' },
  bucket_geaendert: { ic: 'database', de: 'Bucket geändert', en: 'Bucket changed' },
  bucket_geloescht: { ic: 'database', de: 'Bucket gelöscht', en: 'Bucket deleted', ton: 'rot' },
  schluessel_angelegt: { ic: 'key', de: 'Zugangsschlüssel angelegt', en: 'Access key created' },
  schluessel_geloescht: { ic: 'key', de: 'Zugangsschlüssel gelöscht', en: 'Access key deleted' },
  system_warnung: { ic: 'alert', de: 'System-Warnung', en: 'System alert', ton: 'warn' },
  sicherung: { ic: 'database', de: 'Sicherung erstellt', en: 'Backup created' },
  wiederherstellung: { ic: 'database', de: 'Sicherung eingespielt', en: 'Backup restored', ton: 'warn' }
}
const info = (a: string) => ARTEN[a] || { ic: 'circle', de: a, en: a }
function details(d: any): string {
  if (!d || typeof d !== 'object') return ''
  const teile: string[] = []
  for (const k of [
    'name',
    'username',
    'kennung',
    'box',
    'login',
    'bucket',
    'quelle',
    'anbieter',
    'ziel',
    'art',
    'grund',
    'sso',
    'von',
    'zu'
  ])
    if (d[k]) teile.push(String(d[k]))
  for (const k of ['anzahl', 'dateien', 'erledigt'])
    if (d[k] != null) teile.push(`${d[k]} ${k === 'erledigt' ? t('übernommen', 'imported') : t('Dateien', 'files')}`)
  return teile.join(' · ').slice(0, 160)
}
const tagVon = (z: string) =>
  new Date(z).toLocaleDateString(lang() === 'en' ? 'en-GB' : 'de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long'
  })
const gruppen = computed(() => {
  const aus: Array<{ tag: string; eintraege: any[] }> = []
  for (const e of data.value?.eintraege || []) {
    const tag = tagVon(e.zeit)
    if (aus.at(-1)?.tag !== tag) aus.push({ tag, eintraege: [] })
    aus.at(-1)!.eintraege.push(e)
  }
  return aus
})
</script>

<template>
  <section class="rein">
    <div class="kopf">
      <div>
        <div class="eyebrow"><Ico n="list" /> {{ t('Verwaltung', 'Manage') }}</div>
        <h1>{{ t('Protokoll', 'Activity log') }}</h1>
        <p>
          {{
            istAdmin
              ? t(
                  'Wer hat wann was gemacht — alle Konten. Einträge bleiben 180 Tage.',
                  'Who did what and when — all accounts. Entries are kept for 180 days.'
                )
              : t(
                  'Was in deinem Konto passiert ist. Einträge bleiben 180 Tage.',
                  'What happened in your account. Entries are kept for 180 days.'
                )
          }}
        </p>
      </div>
    </div>
    <div class="block filter">
      <label class="suche"
        ><Ico n="search" /><input
          v-model="suche"
          :placeholder="t('Suchen (Name, IP, Ereignis) …', 'Search (name, IP, event) …')"
      /></label>
      <VdAuswahl v-model="filter.art" class="eingabe" @change="filter.seite = 1"
        ><option value="">{{ t('Alle Ereignisse', 'All events') }}</option>
        <option v-for="a in data?.arten || []" :key="a" :value="a">
          {{ lang() === 'en' ? info(a).en : info(a).de }}
        </option></VdAuswahl
      >
      <VdAuswahl v-if="istAdmin" v-model="filter.konto" class="eingabe" @change="filter.seite = 1"
        ><option value="">{{ t('Alle Konten', 'All accounts') }}</option>
        <option v-for="k in konten?.users || []" :key="k.id" :value="String(k.id)">{{ k.username }}</option></VdAuswahl
      >
    </div>
    <div v-if="!pending && !gruppen.length" class="leer-hinweis block">
      <h3>{{ t('Keine Einträge', 'No entries') }}</h3>
      <p>{{ t('Hier erscheint, was in VylarisCloud passiert.', 'What happens in VylarisCloud shows up here.') }}</p>
    </div>
    <div v-for="g in gruppen" :key="g.tag" class="tag">
      <h3>{{ g.tag }}</h3>
      <div class="zeitstrahl">
        <div
          v-for="(e, i) in g.eintraege"
          :key="e.id"
          :class="['eintrag', info(e.art).ton]"
          :style="{ animationDelay: Math.min(i, 15) * 25 + 'ms' }"
        >
          <span class="ic"><Ico :n="info(e.art).ic" /></span>
          <div class="was">
            <b>{{ lang() === 'en' ? info(e.art).en : info(e.art).de }}</b>
            <small>{{
              [istAdmin ? e.konto || t('unbekannt', 'unknown') : '', details(e.detail)].filter(Boolean).join(' · ')
            }}</small>
          </div>
          <span v-if="e.ip" class="ip mono">{{ e.ip }}</span>
          <time class="zeit mono">{{
            new Date(e.zeit).toLocaleTimeString(lang() === 'en' ? 'en-GB' : 'de-DE', {
              hour: '2-digit',
              minute: '2-digit'
            })
          }}</time>
        </div>
      </div>
    </div>
    <div v-if="seiten > 1" class="reihe seiten">
      <button class="knopf klein" :disabled="filter.seite <= 1" @click="filter.seite--"><Ico n="left" /></button>
      <span class="zahl leise">{{ filter.seite }} / {{ seiten }}</span>
      <button class="knopf klein" :disabled="filter.seite >= seiten" @click="filter.seite++"><Ico n="right" /></button>
    </div>
  </section>
</template>

<style scoped>
.filter {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.filter .eingabe {
  width: auto;
  min-width: 180px;
}
.suche {
  flex: 1;
  min-width: 220px;
  display: flex;
  gap: 8px;
  align-items: center;
  border: 1px solid var(--linie);
  background: var(--bg);
  border-radius: 10px;
  padding: 0 12px;
  color: var(--text3);
}
.suche svg {
  width: 15px;
  height: 15px;
}
.suche input {
  border: 0;
  outline: 0;
  background: transparent;
  flex: 1;
  padding: 9px 0;
  color: var(--text);
}
.tag {
  margin-bottom: 18px;
}
.tag h3 {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text3);
  font-weight: 600;
  margin: 0 0 8px 4px;
}
.zeitstrahl {
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 16px;
  overflow: hidden;
}
.eintrag {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-top: 1px solid var(--linie);
  animation: rein 0.35s var(--kurve) backwards;
}
.eintrag:first-child {
  border-top: 0;
}
.ic {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--flaeche2);
  color: var(--text2);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.ic svg {
  width: 14px;
  height: 14px;
}
.eintrag.ok .ic {
  background: var(--ok-bg);
  color: var(--ok);
}
.eintrag.rot .ic {
  background: var(--rot-bg);
  color: var(--rot);
}
.eintrag.warn .ic {
  background: var(--warn-bg);
  color: var(--warn);
}
.was {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.was b {
  font-size: 13.5px;
  font-weight: 500;
}
.was small {
  color: var(--text3);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ip {
  font-size: 11.5px;
  color: var(--text3);
}
.zeit {
  font-size: 12px;
  color: var(--text2);
}
.seiten {
  justify-content: center;
}
@media (max-width: 640px) {
  .ip {
    display: none;
  }
}
</style>
