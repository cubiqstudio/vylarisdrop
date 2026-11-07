<script setup lang="ts">
useHead({ title: () => t('Sync & WebDAV', 'Sync & WebDAV') })
const { data: info } = await (useFetch as any)('/api/sync/info', { key: 'sync-info' })
useLiveDaten({
  daten: [{ schluessel: 'sync-info', url: '/api/sync/info' }],
  themen: ['dateien', 'papierkorb'],
  mind: 3000
})
const klar = ref('')
const adresse = computed<string>(() => info.value?.adresse || '')
const benutzer = computed<string>(() => info.value?.benutzer || '')
const https = computed<boolean>(() => !!info.value?.https)
const grossAdresse = computed<string>(() => info.value?.grossAdresse || '')
const belegt = computed(() => Number(info.value?.belegt || 0))
const kontingent = computed(() => Number(info.value?.kontingent || 0))
const anteil = computed(() => (kontingent.value ? Math.min(100, (belegt.value / kontingent.value) * 100) : 0))
</script>

<template>
  <section class="rein">
    <div class="kopf">
      <div>
        <div class="eyebrow"><Ico n="umzug" /> {{ t('Cloud', 'Cloud') }}</div>
        <h1>{{ t('Sync & WebDAV', 'Sync & WebDAV') }}</h1>
        <p>
          {{
            t(
              'Binde deine Cloud als Netzlaufwerk ein oder gleiche Ordner mit Sync-Programmen ab — Windows, macOS, iOS, Android und Linux.',
              'Mount your cloud as a network drive or sync folders with sync tools — Windows, macOS, iOS, Android and Linux.'
            )
          }}
        </p>
      </div>
    </div>

    <div class="block sy-adresse">
      <h3>{{ t('Deine WebDAV-Verbindung', 'Your WebDAV connection') }}</h3>
      <div class="sy-zeilen">
        <VdKopierZeile :label="grossAdresse ? t('Adresse (normal)', 'Address (normal)') : t('Adresse', 'Address')" :wert="adresse" />
        <VdKopierZeile v-if="grossAdresse" :label="t('Große Dateien', 'Large files')" :wert="grossAdresse" />
        <VdKopierZeile :label="t('Benutzername', 'Username')" :wert="benutzer" />
        <div class="sy-pw">
          <span>{{ t('Passwort', 'Password') }}</span>
          <span class="leise">{{ t('ein App-Passwort (unten) — nicht dein Konto-Passwort', 'an app password (below) — not your account password') }}</span>
        </div>
      </div>
      <div v-if="info && !info.https && !info.lokal" class="meldung meldung-warn sy-warn" role="note">
        <b>{{ t('Nur HTTP:', 'HTTP only:') }}</b>
        {{
          t(
            'Diese Adresse ist nicht verschlüsselt. Windows verlangt für die Anmeldung HTTPS, und App-Passwörter würden im Klartext durchs Netz laufen. Richte unter Einstellungen → Netzwerk eine Domain mit HTTPS ein.',
            'This address is not encrypted. Windows requires HTTPS for sign-in, and app passwords would travel in clear text. Set up a domain with HTTPS under Settings → Network.'
          )
        }}
      </div>
      <div v-if="grossAdresse" class="meldung sy-warn" role="note">
        <b>{{ t('Zwei Adressen:', 'Two addresses:') }}</b>
        {{
          t(
            'Die normale Adresse läuft in der Regel über Cloudflare, das höchstens 100 MB je Anfrage annimmt. Für größere Dateien nimm die Adresse „Große Dateien“: Sie führt direkt zum Server (nur WebDAV, nur HTTPS), ohne diese Grenze. Beide gelten mit demselben Benutzernamen und App-Passwort.',
            'The normal address usually goes through Cloudflare, which accepts at most 100 MB per request. For larger files use the “Large files” address: it leads straight to the server (WebDAV only, HTTPS only) without that limit. Both work with the same username and app password.'
          )
        }}
      </div>
      <div v-else-if="info?.ueberCloudflare" class="meldung sy-warn" role="note">
        <b>{{ t('Dateien über 100 MB:', 'Files over 100 MB:') }}</b>
        {{
          t(
            'Diese Cloud ist über Cloudflare erreichbar, das pro Anfrage höchstens 100 MB annimmt (Tarif Free/Pro). Per WebDAV scheitern größere Dateien deshalb. Über die Weboberfläche klappt es (sie lädt in kleinen Stücken hoch); für das Netzlaufwerk braucht der Betreiber eine Adresse für große Dateien.',
            'This cloud is reached through Cloudflare, which accepts at most 100 MB per request (Free/Pro plan). Larger files therefore fail over WebDAV. The web interface works (it uploads in small pieces); for the network drive the operator needs to provide an address for large files.'
          )
        }}
      </div>
      <div v-if="kontingent" class="sy-platz">
        <div class="reihe zw">
          <span class="leise">{{ t('Speicher', 'Storage') }}</span>
          <span class="zahl leise">{{ groesse(belegt) }} {{ t('von', 'of') }} {{ groesse(kontingent) }}</span>
        </div>
        <div
          class="sy-balken"
          role="progressbar"
          :aria-valuenow="Math.round(anteil)"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="t('Belegter Speicher', 'Used storage')"
        >
          <span :class="{ voll: anteil >= 90 }" :style="{ width: anteil + '%' }" />
        </div>
      </div>
    </div>

    <h2 class="abschnitt">{{ t('App-Passwörter', 'App passwords') }}</h2>
    <p class="leise sy-hinweis">
      {{
        t(
          'Jedes Gerät bekommt ein eigenes Passwort, das du jederzeit widerrufen kannst. Dein Konto-Passwort geben Sync-Programme nie zu sehen.',
          'Every device gets its own password that you can revoke at any time. Sync tools never see your account password.'
        )
      }}
    </p>
    <VdSyncZugaenge v-model:klar="klar" :benutzer="benutzer" :adresse="adresse" />

    <h2 class="abschnitt">{{ t('Anleitungen', 'Guides') }}</h2>
    <VdSyncAnleitung
      :adresse="adresse"
      :benutzer="benutzer"
      :passwort="klar"
      :https="https"
      :gross-adresse="grossAdresse"
      :skript="info?.windowsSkript || null"
    />

    <h2 class="abschnitt">{{ t('So ist die Cloud aufgebaut', 'How the cloud is laid out') }}</h2>
    <div class="block sy-baum">
      <ul>
        <li>
          <b>{{ t('Deine Ordner und Dateien', 'Your folders and files') }}</b> —
          {{ t('liegen direkt unter der Adresse, genau wie unter „Meine Dateien“.', 'sit directly under the address, just like under “My files”.') }}
        </li>
        <li>
          <b class="mono">Team-Ordner/&lt;Teamname&gt;/…</b> —
          {{ t('die Ordner deiner Teams, mit deinen Team-Rechten.', 'the folders of your teams, with your team permissions.') }}
        </li>
        <li>
          <b>{{ t('Löschen', 'Deleting') }}</b> —
          {{ t('verschiebt in den Papierkorb (30 Tage), auch bei Sync-Programmen.', 'moves to the trash (30 days), also for sync tools.') }}
        </li>
        <li>
          <b>{{ t('Doppelte Namen', 'Duplicate names') }}</b> —
          {{ t('zeigt WebDAV als „name (2).ext“ an, die Dateien selbst bleiben unverändert.', 'are shown by WebDAV as “name (2).ext”; the files themselves stay unchanged.') }}
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.abschnitt {
  font-family: var(--f-display);
  font-size: 22px;
  letter-spacing: -0.02em;
  margin: 30px 0 8px;
}
.sy-hinweis {
  margin: 0 0 12px;
}
.sy-zeilen {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}
.sy-pw {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 8px 12px;
  font-size: 12.5px;
}
.sy-pw > span:first-child {
  color: var(--text3);
  font-size: 12px;
}
.sy-warn {
  margin: 12px 0 0;
}
.sy-platz {
  margin-top: 14px;
}
.sy-balken {
  height: 8px;
  border-radius: 99px;
  background: var(--flaeche2);
  margin-top: 6px;
  overflow: hidden;
}
.sy-balken span {
  display: block;
  height: 100%;
  background: var(--a);
  border-radius: 99px;
  transition: width 0.6s var(--kurve);
}
.sy-balken span.voll {
  background: var(--warn);
}
.sy-baum ul {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sy-baum li {
  color: var(--text2);
}
.sy-baum b {
  color: var(--text);
}
@media (max-width: 520px) {
  .sy-pw {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sy-balken span {
    transition: none;
  }
}
</style>
