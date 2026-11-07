<script setup lang="ts">
// Karte einer SFTP-Speicher-Erweiterung: Status, Messwerte und Aktionen
const props = defineProps<{ ziel: any; istOrt: boolean; testet: boolean; ergebnis?: any; umzugLaeuft: boolean }>()
const emit = defineEmits<{
  (e: 'testen'): void
  (e: 'bearbeiten'): void
  (e: 'entfernen'): void
  (e: 'umschalten'): void
  (e: 'ort'): void
  (e: 'umziehen'): void
}>()

const s = computed(() => props.ziel.status || {})
const stufe = computed<'aus' | 'hostkey' | 'online' | 'offline' | 'unbekannt'>(() =>
  !props.ziel.aktiv
    ? 'aus'
    : s.value.hostKeyGeaendert
      ? 'hostkey'
      : s.value.online === true
        ? 'online'
        : s.value.online === false
          ? 'offline'
          : 'unbekannt'
)
const CHIP: Record<string, { k: string; ic: string; de: string; en: string }> = {
  online: { k: 'ok', ic: 'check', de: 'Online', en: 'Online' },
  offline: { k: 'rot', ic: 'alert', de: 'Offline', en: 'Offline' },
  hostkey: { k: 'rot', ic: 'shield', de: 'Host-Schlüssel geändert', en: 'Host key changed' },
  aus: { k: 'neutral', ic: 'pause', de: 'Deaktiviert', en: 'Disabled' },
  unbekannt: { k: 'neutral', ic: 'clock', de: 'Noch nicht geprüft', en: 'Not checked yet' }
}
const chip = computed(() => CHIP[stufe.value]!)
const platz = computed(() => s.value.platz as null | { frei: number; gesamt: number })
const belegtAnteil = computed(() => (platz.value?.gesamt ? 100 - (platz.value.frei / platz.value.gesamt) * 100 : 0))
const SCHRITT: Record<string, [string, string]> = {
  verbindung: ['Verbindung', 'Connection'],
  hostkey: ['Host-Schlüssel', 'Host key'],
  anmeldung: ['Anmeldung', 'Login'],
  ordner: ['Zielordner', 'Target folder'],
  schreiben: ['Schreiben', 'Write'],
  lesen: ['Lesen', 'Read'],
  loeschen: ['Löschen', 'Delete']
}
const kurz = (fp: string) => (fp ? fp.slice(0, 15) + '…' + fp.slice(-5) : '')
const hatDateien = computed(() => props.ziel.dateien > 0 || props.ziel.papierkorb > 0)
</script>

<template>
  <article class="zk" :class="[stufe, { ort: istOrt }]" :aria-label="ziel.name">
    <header class="zk-kopf">
      <span class="zk-puls" :class="stufe" aria-hidden="true"></span>
      <div class="zk-titel">
        <h3>{{ ziel.name }}</h3>
        <div class="zk-adresse mono" :title="`${ziel.benutzer}@${ziel.host}:${ziel.port}${ziel.basisPfad}`">
          {{ ziel.benutzer }}@{{ ziel.host }}:{{ ziel.port }}<span class="leise">{{ ziel.basisPfad }}</span>
        </div>
      </div>
      <div class="zk-chips">
        <span v-if="istOrt" class="chip info"><Ico n="upload" /> {{ t('Neue Uploads', 'New uploads') }}</span>
        <span v-if="!ziel.schreibbar" class="chip warn"><Ico n="lock" /> {{ t('Nur lesen', 'Read-only') }}</span>
        <span class="chip" :class="chip.k"><Ico :n="chip.ic" /> {{ t(chip.de, chip.en) }}</span>
      </div>
    </header>

    <p v-if="stufe === 'hostkey'" class="meldung meldung-fehler zk-meld" role="alert">
      <Ico n="alert" />
      <span>
        <b>{{ t('Host-Schlüssel hat sich geändert.', 'Host key has changed.') }}</b>
        {{
          t(
            'Die Verbindung wird aus Sicherheitsgründen verweigert, bis du den neuen Fingerabdruck beim Anbieter geprüft und unter „Bearbeiten“ bestätigt hast.',
            'The connection is refused for security reasons until you have checked the new fingerprint with the provider and confirmed it under “Edit”.'
          )
        }}
      </span>
    </p>
    <p v-else-if="stufe === 'offline' && s.fehler" class="meldung meldung-fehler zk-meld" role="alert">
      <Ico n="alert" /> <span>{{ s.fehler }}</span>
    </p>

    <dl class="zk-werte">
      <div>
        <dt>{{ t('Letzter Test', 'Last check') }}</dt>
        <dd>{{ s.geprueft ? vorher(s.geprueft) : '—' }}</dd>
      </div>
      <div>
        <dt>{{ t('Antwortzeit', 'Latency') }}</dt>
        <dd>
          <template v-if="s.latenzMs != null && stufe !== 'offline'">{{ s.latenzMs }} ms</template
          ><template v-else>—</template>
        </dd>
      </div>
      <div>
        <dt>{{ t('Dateien hier', 'Files here') }}</dt>
        <dd>
          {{ zahl(ziel.dateien) }} · {{ groesse(ziel.bytes) }}
          <small v-if="ziel.papierkorb" class="leise">+ {{ zahl(ziel.papierkorb) }} {{ t('im Papierkorb', 'in trash') }}</small>
        </dd>
      </div>
      <div class="zk-platz">
        <dt>{{ t('Platz auf dem Server', 'Space on the server') }}</dt>
        <dd v-if="platz">
          {{ groesse(platz.frei) }} {{ t('frei von', 'free of') }} {{ groesse(platz.gesamt) }}
          <span class="zk-balken" role="img" :aria-label="`${Math.round(belegtAnteil)} %`"
            ><i :style="{ width: belegtAnteil + '%' }" :class="{ knapp: belegtAnteil > 90 }"></i
          ></span>
        </dd>
        <dd v-else class="leise" :title="t('Der Server meldet seinen freien Platz nicht (statvfs@openssh.com fehlt).', 'The server does not report free space (statvfs@openssh.com missing).')">
          {{ t('nicht verfügbar', 'not available') }}
        </dd>
      </div>
      <div v-if="s.banner" class="zk-breit">
        <dt>{{ t('Server', 'Server') }}</dt>
        <dd class="mono">{{ s.banner }}</dd>
      </div>
      <div class="zk-breit">
        <dt>{{ t('Host-Schlüssel (gepinnt)', 'Host key (pinned)') }}</dt>
        <dd class="mono" :title="ziel.hostKey">{{ kurz(ziel.hostKey) }}</dd>
      </div>
    </dl>

    <div v-if="ergebnis" class="zk-test" :class="{ gut: ergebnis.ok }" role="status">
      <div class="reihe">
        <Ico :n="ergebnis.ok ? 'check' : 'alert'" /> <b>{{ ergebnis.meldung }}</b>
      </div>
      <ul>
        <li v-for="x in ergebnis.schritte" :key="x.name" :class="{ f: !x.ok }">
          <Ico :n="x.ok ? 'check' : 'x'" /> {{ t(SCHRITT[x.name]?.[0] || x.name, SCHRITT[x.name]?.[1] || x.name) }}
          <small v-if="x.ms != null" class="mono">{{ x.ms }} ms</small>
        </li>
      </ul>
    </div>

    <footer class="zk-fuss">
      <button type="button" class="knopf klein" :disabled="testet" @click="emit('testen')">
        <Ico :n="testet ? 'loader' : 'network'" :spin="testet" /> {{ t('Verbindung testen', 'Test connection') }}
      </button>
      <button type="button" class="knopf klein" @click="emit('bearbeiten')"><Ico n="edit" /> {{ t('Bearbeiten', 'Edit') }}</button>
      <button
        v-if="!istOrt && ziel.aktiv && ziel.schreibbar"
        type="button"
        class="knopf klein"
        :disabled="stufe === 'offline' || stufe === 'hostkey'"
        @click="emit('ort')"
      >
        <Ico n="upload" /> {{ t('Für neue Uploads nutzen', 'Use for new uploads') }}
      </button>
      <button v-if="ziel.aktiv && ziel.schreibbar" type="button" class="knopf klein" :disabled="umzugLaeuft || stufe === 'offline' || stufe === 'hostkey'" @click="emit('umziehen')">
        <Ico n="umzug" /> {{ t('Dateien hierher umziehen', 'Move files here') }}
      </button>
      <span class="zk-platzhalter"></span>
      <button
        type="button"
        class="schalter"
        :class="{ an: ziel.aktiv }"
        role="switch"
        :aria-checked="ziel.aktiv"
        :aria-label="ziel.aktiv ? t('Deaktivieren', 'Disable') : t('Aktivieren', 'Enable')"
        :title="ziel.aktiv ? t('Deaktivieren', 'Disable') : t('Aktivieren', 'Enable')"
        @click="emit('umschalten')"
      ></button>
      <button
        type="button"
        class="knopf klein gefahr"
        :title="hatDateien ? t('Erst alle Dateien umziehen', 'Move all files away first') : t('Entfernen', 'Remove')"
        @click="emit('entfernen')"
      >
        <Ico n="trash" /> {{ t('Entfernen', 'Remove') }}
      </button>
    </footer>
  </article>
</template>

<style scoped>
.zk {
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 16px;
  padding: 16px 18px;
  display: grid;
  gap: 14px;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.zk.ort {
  border-color: rgba(var(--a-rgb), 0.45);
  box-shadow: 0 0 0 3px rgba(var(--a-rgb), 0.07);
}
.zk.aus {
  opacity: 0.8;
}
.zk-kopf {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
}
.zk-titel {
  flex: 1 1 220px;
  min-width: 0;
}
.zk-titel h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 3px;
}
.zk-adresse {
  font-size: 12.5px;
  color: var(--text2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zk-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.zk-puls {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  margin-top: 6px;
  background: var(--text3);
  position: relative;
  flex-shrink: 0;
}
.zk-puls.online {
  background: var(--ok);
}
.zk-puls.online::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: var(--ok);
  animation: zk-pulsen 2.2s ease-out infinite;
}
.zk-puls.offline,
.zk-puls.hostkey {
  background: var(--rot);
}
@keyframes zk-pulsen {
  from {
    transform: scale(1);
    opacity: 0.55;
  }
  to {
    transform: scale(2.6);
    opacity: 0;
  }
}
.zk-meld {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin: 0;
  line-height: 1.5;
}
.zk-meld svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  margin-top: 2px;
}
.zk-werte {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px 18px;
  margin: 0;
}
.zk-werte dt {
  font-size: 11.5px;
  color: var(--text3);
  margin-bottom: 2px;
}
.zk-werte dd {
  margin: 0;
  font-size: 13.5px;
  font-weight: 500;
  min-width: 0;
  overflow-wrap: anywhere;
}
.zk-werte dd small {
  display: block;
  font-weight: 400;
  font-size: 11.5px;
}
.zk-breit {
  grid-column: span 2;
}
.zk-platz {
  grid-column: span 2;
}
.zk-balken {
  display: block;
  height: 6px;
  border-radius: 99px;
  background: var(--flaeche2);
  overflow: hidden;
  margin-top: 6px;
}
.zk-balken i {
  display: block;
  height: 100%;
  background: var(--a);
  border-radius: 99px;
  transition: width 0.6s var(--kurve);
}
.zk-balken i.knapp {
  background: var(--warn);
}
.zk-test {
  border-radius: 12px;
  padding: 10px 12px;
  background: var(--rot-bg);
  color: var(--rot);
  font-size: 13px;
}
.zk-test.gut {
  background: var(--ok-bg);
  color: var(--ok);
}
.zk-test ul {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  color: var(--text2);
  font-size: 12.5px;
}
.zk-test li {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}
.zk-test li svg {
  width: 12px;
  height: 12px;
  color: var(--ok);
}
.zk-test li.f,
.zk-test li.f svg {
  color: var(--rot);
}
.zk-test small {
  color: var(--text3);
}
.zk-test svg {
  width: 14px;
  height: 14px;
}
.zk-fuss {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  padding-top: 12px;
  border-top: 1px solid var(--linie);
}
.zk-platzhalter {
  flex: 1;
}
@media (max-width: 560px) {
  .zk {
    padding: 14px;
  }
  .zk-breit,
  .zk-platz {
    grid-column: 1 / -1;
  }
  .zk-fuss .knopf {
    flex: 1 1 auto;
  }
}
</style>
