<script setup lang="ts">
const theme = useTheme()
const { ok, fehler } = useToast()
const istInhaber = computed(() => theme.value.user?.role === 'owner')
const { data, refresh } = (useFetch as any)('/api/system/update', { key: 'update', server: false })
const offen = ref(false)
const laeuft = ref(false)
const phase = ref<'' | 'warten' | 'neustart'>('')
const updFehler = ref('')
const punkt = computed(() =>
  !data.value ? 'grau' : data.value.verfuegbar ? 'rot' : data.value.neueste ? 'gruen' : 'grau'
)
const hinweise = computed<string[]>(
  () => data.value?.neueste?.hinweise?.[lang()] || data.value?.neueste?.hinweise?.de || []
)

async function pruefen() {
  laeuft.value = true
  try {
    data.value = await api('/api/system/update', { method: 'POST', body: { aktion: 'pruefen' } })
  } catch (e: any) {
    fehler(e.message)
  } finally {
    laeuft.value = false
  }
}
async function aktualisieren() {
  laeuft.value = true
  updFehler.value = ''
  const von = data.value?.aktuell
  try {
    data.value = await api('/api/system/update', { method: 'POST', body: { aktion: 'starten' } })
    phase.value = 'warten'
    const t0 = Date.now()
    while (Date.now() - t0 < 10 * 60_000) {
      await new Promise((r) => setTimeout(r, 3000))
      try {
        const s = await ($fetch as any)('/api/system/update')
        data.value = s
        if (s.nichtAbgeholt)
          throw Object.assign(
            new Error(
              t(
                `Der Dienst auf dem Server hat das Update nicht abgeholt. Einmal auf dem Server ausführen: ${s.befehl}`,
                `The server service did not pick up the update. Run once on the server: ${s.befehl}`
              )
            ),
            { echt: true }
          )
        if (s.lauf?.status === 'fehler')
          throw Object.assign(new Error(s.lauf.meldung || t('Das Update ist fehlgeschlagen.', 'The update failed.')), {
            echt: true
          })
        if (s.aktuell !== von) {
          ok(t(`Aktualisiert auf ${s.aktuell}`, `Updated to ${s.aktuell}`))
          setTimeout(() => window.location.reload(), 900)
          return
        }
      } catch (e: any) {
        if (e?.echt) throw e
        phase.value = 'neustart'
      }
    }
    throw new Error(
      t(
        `Das Update dauert ungewöhnlich lange — bitte auf dem Server ausführen: ${data.value?.befehl || 'update.sh'}`,
        `The update is taking unusually long — please run on the server: ${data.value?.befehl || 'update.sh'}`
      )
    )
  } catch (e: any) {
    fehler(e.message.replace(/[:—]\s*curl .*$/, '.'))
    updFehler.value = e.message
    phase.value = ''
  } finally {
    laeuft.value = false
  }
}
</script>

<template>
  <div class="version">
    <button
      type="button"
      class="zeile"
      :aria-label="t('Version und Updates', 'Version and updates')"
      @click="
        offen = true;
        refresh();
      "
    >
      <span :class="['punkt', punkt]"></span>
      <span class="mono">VylarisCloud {{ data?.aktuell || '' }}</span>
      <span v-if="data?.verfuegbar" class="neu">{{ t('Update', 'Update') }}</span>
    </button>
    <VdModal
      v-if="offen"
      :titel="
        data?.verfuegbar
          ? t(`Version ${data.neueste.version} ist da`, `Version ${data.neueste.version} is available`)
          : t('VylarisCloud ist aktuell', 'VylarisCloud is up to date')
      "
      @zu="offen = false"
    >
      <div class="stand">
        <div>
          <small>{{ t('Läuft', 'Running') }}</small
          ><b class="mono">{{ data?.aktuell }}</b>
        </div>
        <Ico n="right" />
        <div>
          <small>{{ t('Neueste', 'Latest') }}</small
          ><b class="mono">{{ data?.neueste?.version || '—' }}</b>
        </div>
      </div>
      <ul v-if="data?.verfuegbar && hinweise.length" class="hinweise">
        <li v-for="(h, i) in hinweise" :key="i" :style="{ '--i': i }"><Ico n="check" /> {{ h }}</li>
      </ul>
      <p v-if="data?.fehler" class="leise klein">{{ data.fehler }}</p>
      <p class="sehrleise klein">
        {{ t('Zuletzt geprüft:', 'Last checked:') }} {{ data?.geprueft ? zeitpunkt(data.geprueft) : '—' }}
      </p>
      <div v-if="phase" class="lauf">
        <Ico n="loader" spin />
        {{
          phase === 'warten'
            ? t('Neue Version wird geladen …', 'Downloading the new version …')
            : t(
                'VylarisCloud startet neu — die Seite lädt gleich von selbst.',
                'VylarisCloud is restarting — the page reloads by itself.'
              )
        }}
      </div>
      <div v-if="updFehler" class="lauf rot">
        <Ico n="alert" /> <span>{{ updFehler.replace(/[:—]\s*curl .*$/, '.') }}</span>
      </div>
      <VdServerBefehl v-if="updFehler.includes('update.sh')" />
      <VdLiveLog
        v-if="phase || (updFehler && data?.protokoll)"
        :text="data?.protokoll || ''"
        :laeuft="phase === 'warten'"
        class="log"
      />
      <template v-else-if="(!data?.updater && data?.neueste) || data?.dienstAlt">
        <VdServerBefehl
          v-if="!data?.updater"
          :text="
            t(
              'Auf diesem Server ist der Update-Dienst nicht eingerichtet. Einmal auf dem Server ausführen — danach geht jedes Update hier per Knopf:',
              'The update service is not set up on this server. Run this once on the server — after that every update works here with one click:'
            )
          "
        />
        <VdServerBefehl
          v-else-if="data?.dienstAlt"
          :text="
            t(
              'Der Update-Dienst auf dem Server ist eine ältere Fassung: Er holt das neue Image, erneuert sich selbst aber nicht. Einmal auf dem Server ausführen — danach kommt bei jedem Update alles mit:',
              'The update service on the server is an older version: it pulls the new image but does not renew itself. Run this once on the server — after that every update brings everything along:'
            )
          "
        />
      </template>
      <div class="modal-fuss">
        <button type="button" class="knopf" :disabled="laeuft" @click="pruefen">
          <Ico n="drehenr" /> {{ t('Jetzt prüfen', 'Check now') }}
        </button>
        <button
          v-if="data?.verfuegbar && istInhaber && data?.updater"
          type="button"
          class="knopf rot"
          :disabled="laeuft"
          @click="aktualisieren"
        >
          <Ico :n="laeuft ? 'loader' : 'download'" :spin="laeuft" /> {{ t('Jetzt aktualisieren', 'Update now') }}
        </button>
      </div>
    </VdModal>
  </div>
</template>

<style scoped>
.zeile {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  border: 0;
  background: none;
  padding: 8px 10px;
  border-radius: 9px;
  cursor: pointer;
  color: var(--text3);
  font-size: 11.5px;
  transition:
    background 0.15s,
    color 0.15s;
}
.zeile:hover {
  background: var(--flaeche2);
  color: var(--text);
}
.punkt {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text3);
  position: relative;
  flex-shrink: 0;
}
.punkt.gruen {
  background: var(--ok);
}
.punkt.rot {
  background: var(--rot);
}
.punkt.rot::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: var(--rot);
  animation: pulsen 1.8s ease-out infinite;
}
@keyframes pulsen {
  from {
    transform: scale(1);
    opacity: 0.7;
  }
  to {
    transform: scale(2.8);
    opacity: 0;
  }
}
.neu {
  margin-left: auto;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--rot-bg);
  color: var(--rot);
}
.stand {
  display: flex;
  align-items: center;
  gap: 18px;
  background: var(--flaeche2);
  border-radius: 14px;
  padding: 14px 16px;
  margin-bottom: 14px;
}
.stand small {
  display: block;
  font-size: 11px;
  color: var(--text3);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
}
.stand b {
  font-size: 18px;
}
.stand svg {
  width: 16px;
  height: 16px;
  color: var(--text3);
}
.hinweise {
  list-style: none;
  padding: 0;
  margin: 0 0 12px;
  display: grid;
  gap: 6px;
}
.hinweise li {
  display: flex;
  gap: 8px;
  font-size: 13px;
  animation: rein 0.4s var(--kurve) backwards;
  animation-delay: calc(var(--i) * 50ms);
}
.hinweise svg {
  width: 14px;
  height: 14px;
  color: var(--ok);
  margin-top: 3px;
  flex-shrink: 0;
}
.klein {
  font-size: 12px;
  margin: 4px 0;
}
.lauf {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  background: var(--info-bg);
  color: var(--info);
  border-radius: 10px;
  padding: 10px 12px;
  margin-top: 10px;
}
.lauf svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}
.lauf.rot {
  color: var(--rot);
  background: var(--rot-bg);
}
.log {
  margin-top: 10px;
}
</style>
