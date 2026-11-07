<script setup lang="ts">
useHead({ title: () => t('Verbundene Geräte', 'Connected devices') })
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const { data, refresh } = await (useFetch as any)('/api/app/geraete', { key: 'app-geraete' })
const { data: info } = await (useFetch as any)('/api/app/info', { key: 'app-info' })
const liste = computed<any[]>(() => data.value?.geraete || [])

// Offener Kopplungscode: Code, Link, QR-Bild, Ablaufzeitpunkt
const kopplung = ref<null | { code: string; link: string; qr: string; ablauf: number }>(null)
const laeuft = ref(false)
const jetzt = ref(Date.now())
const verbunden = ref('')
const rest = computed(() => (kopplung.value ? Math.max(0, Math.ceil((kopplung.value.ablauf - jetzt.value) / 1000)) : 0))
const abgelaufen = computed(() => !!kopplung.value && rest.value <= 0)
const restText = computed(() => `${Math.floor(rest.value / 60)}:${String(rest.value % 60).padStart(2, '0')}`)
const qrBild = computed(() => (kopplung.value ? 'data:image/svg+xml;utf8,' + encodeURIComponent(kopplung.value.qr) : ''))

async function neuerCode() {
  if (laeuft.value) return
  laeuft.value = true
  verbunden.value = ''
  try {
    const r = await api('/api/app/koppelcode', { method: 'POST' })
    jetzt.value = Date.now()
    kopplung.value = { code: r.code, link: r.link, qr: r.qr, ablauf: Date.now() + r.ablaufSek * 1000 }
  } catch (e: any) {
    fehler(e.message)
  } finally {
    laeuft.value = false
  }
}
function schliessen() {
  kopplung.value = null
}

// Solange ein Code offen ist: jede Sekunde den Rueckwaertszaehler, alle 3 Sekunden nachsehen, ob ein Geraet dazugekommen ist
let takt: ReturnType<typeof setInterval> | undefined
let zaehler = 0
onMounted(() => {
  takt = setInterval(async () => {
    jetzt.value = Date.now()
    if (!kopplung.value || abgelaufen.value || ++zaehler % 3) return
    const vorher = new Set(liste.value.map((x) => x.id))
    await refresh()
    const neu = liste.value.find((x) => !vorher.has(x.id))
    if (neu) {
      verbunden.value = neu.name
      kopplung.value = null
    }
  }, 1000)
})
onBeforeUnmount(() => clearInterval(takt))

function widerrufen(x: any) {
  bestaetigen(
    t('Gerät widerrufen?', 'Revoke device?'),
    t(
      `„${x.name}“ verliert sofort den Zugriff auf deine Cloud und wird in der App abgemeldet.`,
      `“${x.name}” loses access to your cloud immediately and is signed out in the app.`
    ),
    t('Widerrufen', 'Revoke'),
    async () => {
      try {
        await api(`/api/app/geraete/${x.id}`, { method: 'DELETE' })
        await refresh()
        ok(t('Widerrufen', 'Revoked'))
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}
</script>

<template>
  <section class="rein">
    <div class="kopf">
      <div>
        <div class="eyebrow"><Ico n="laptop" /> {{ t('Cloud', 'Cloud') }}</div>
        <h1>{{ t('Verbundene Geräte', 'Connected devices') }}</h1>
        <p>
          {{
            t(
              'Verbinde die VylarisCloud-App mit deinem Konto, ohne Passwort auf dem Handy einzutippen. Jedes Gerät lässt sich einzeln widerrufen.',
              'Connect the VylarisCloud app to your account without typing a password on your phone. Every device can be revoked on its own.'
            )
          }}
        </p>
      </div>
      <button class="knopf rot" :disabled="laeuft" @click="neuerCode">
        <Ico :n="laeuft ? 'loader' : 'plus'" :spin="laeuft" /> {{ t('Neues Gerät verbinden', 'Connect new device') }}
      </button>
    </div>

    <div v-if="verbunden" class="meldung meldung-ok ge-neu" role="status">
      <Ico n="check" /> {{ t(`„${verbunden}“ ist jetzt verbunden.`, `“${verbunden}” is now connected.`) }}
    </div>

    <Transition name="ge-auf">
      <div v-if="kopplung" class="block ge-kopplung" :class="{ aus: abgelaufen }" role="region" :aria-label="t('Kopplungscode', 'Pairing code')">
        <div class="ge-oben">
          <div class="ge-links">
            <div class="sehrleise ge-kleinlabel">{{ t('Kopplungscode', 'Pairing code') }}</div>
            <div class="ge-code mono" data-testid="code" aria-live="polite">{{ kopplung.code }}</div>
            <div class="ge-frist" :class="{ warn: rest <= 60 }">
              <Ico n="clock" />
              <span v-if="!abgelaufen" data-testid="frist"
                >{{ t('Gültig noch', 'Valid for') }} <b class="zahl">{{ restText }}</b></span
              >
              <span v-else data-testid="frist">{{ t('Abgelaufen', 'Expired') }}</span>
            </div>
            <ol class="ge-schritte">
              <li>{{ t('Öffne die VylarisCloud-App auf deinem Handy.', 'Open the VylarisCloud app on your phone.') }}</li>
              <li>{{ t('Tippe auf „Mit Code verbinden“ und gib den Code ein — oder scanne den QR-Code.', 'Tap “Connect with code” and enter the code — or scan the QR code.') }}</li>
              <li>{{ t('Fertig: Das Gerät erscheint hier in der Liste.', 'Done: the device appears in the list below.') }}</li>
            </ol>
            <div class="reihe ge-knoepfe">
              <button v-if="abgelaufen" class="knopf rot" :disabled="laeuft" @click="neuerCode">
                <Ico n="plus" /> {{ t('Neuen Code erzeugen', 'Generate new code') }}
              </button>
              <button class="knopf" @click="schliessen">{{ t('Schließen', 'Close') }}</button>
            </div>
          </div>
          <div class="ge-qr" :class="{ aus: abgelaufen }">
            <img :src="qrBild" width="220" height="220" :alt="t('QR-Code mit dem Kopplungslink', 'QR code with the pairing link')" data-testid="qr" />
          </div>
        </div>
        <VdKopierZeile :label="t('Link', 'Link')" :wert="kopplung.link" />
        <p class="sehrleise ge-fuss">
          {{
            t(
              'Der Code gilt einmal und fünf Minuten lang. Gib ihn niemandem weiter, den du nicht kennst.',
              'The code works once and for five minutes. Do not share it with anyone you do not know.'
            )
          }}
        </p>
      </div>
    </Transition>

    <div v-if="info?.apk" class="block ge-app">
      <span class="ge-ic"><Ico n="download" /></span>
      <div class="ge-text">
        <b>{{ t('App noch nicht installiert?', 'App not installed yet?') }}</b>
        <div class="sehrleise">{{ t('Die Android-App direkt von diesem Server laden', 'Download the Android app straight from this server') }} · {{ groesse(info.groesse) }}</div>
      </div>
      <a class="knopf" href="/app/download" download><Ico n="download" /> {{ t('App herunterladen', 'Download app') }}</a>
    </div>

    <h2 class="abschnitt">{{ t('Deine Geräte', 'Your devices') }}</h2>
    <div class="ge-liste" role="list">
      <div v-for="x in liste" :key="x.id" class="ge-eintrag" role="listitem">
        <span class="ge-ic"><Ico n="laptop" /></span>
        <div class="ge-text">
          <b>{{ x.name }}</b>
          <div class="sehrleise ge-meta">
            {{ t('verbunden', 'connected') }} {{ datum(x.erstellt) }} ·
            {{
              x.zuletzt_benutzt
                ? t(`zuletzt benutzt ${vorher(x.zuletzt_benutzt)}`, `last used ${vorher(x.zuletzt_benutzt)}`)
                : t('noch nie benutzt', 'never used')
            }}
          </div>
        </div>
        <button class="knopf klein gefahr" @click="widerrufen(x)">{{ t('Widerrufen', 'Revoke') }}</button>
      </div>
      <p v-if="!liste.length" class="sehrleise ge-leer">
        {{ t('Noch kein Gerät verbunden. Klicke oben auf „Neues Gerät verbinden“.', 'No device connected yet. Click “Connect new device” above.') }}
      </p>
    </div>
    <p class="sehrleise ge-hinweis">
      {{ t('Höchstens 10 Geräte: Beim elften wird das am längsten ungenutzte ersetzt.', 'At most 10 devices: the eleventh replaces the one unused the longest.') }}
    </p>
  </section>
</template>

<style scoped>
.abschnitt {
  font-family: var(--f-display);
  font-size: 22px;
  letter-spacing: -0.02em;
  margin: 30px 0 10px;
}
.ge-neu {
  display: flex;
  gap: 8px;
  align-items: center;
}
.ge-neu svg {
  width: 15px;
  height: 15px;
}
.ge-kopplung {
  border-color: rgba(var(--a-rgb), 0.45);
  background: rgba(var(--a-rgb), 0.05);
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-bottom: 14px;
}
.ge-oben {
  display: flex;
  gap: 24px;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap-reverse;
}
.ge-links {
  flex: 1 1 280px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ge-kleinlabel {
  font-size: 11.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.ge-code {
  font-size: clamp(32px, 9vw, 46px);
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1.1;
  user-select: all;
  word-break: keep-all;
}
.aus .ge-code {
  opacity: 0.35;
  text-decoration: line-through;
}
.ge-frist {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  color: var(--text2);
}
.ge-frist svg {
  width: 14px;
  height: 14px;
}
.ge-frist.warn {
  color: var(--warn);
}
.ge-schritte {
  margin: 0;
  padding-left: 20px;
  color: var(--text2);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ge-knoepfe {
  gap: 8px;
  flex-wrap: wrap;
}
.ge-qr {
  background: #fff;
  border-radius: 14px;
  padding: 8px;
  line-height: 0;
  flex-shrink: 0;
  border: 1px solid var(--linie);
  margin: 0 auto;
}
.ge-qr img {
  display: block;
  width: min(220px, 62vw);
  height: auto;
}
.ge-qr.aus {
  opacity: 0.25;
  filter: grayscale(1);
}
.ge-fuss {
  margin: 0;
  font-size: 12px;
}
.ge-app,
.ge-eintrag {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ge-app {
  margin-bottom: 4px;
}
.ge-liste {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ge-eintrag {
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 12px;
  padding: 10px 12px;
  animation: rein 0.4s var(--kurve) backwards;
}
.ge-ic {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--flaeche2);
  color: var(--text2);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.ge-ic svg {
  width: 16px;
  height: 16px;
}
.ge-text {
  flex: 1;
  min-width: 0;
}
.ge-text b {
  word-break: break-word;
}
.ge-meta {
  font-size: 12px;
  margin-top: 2px;
}
.ge-leer,
.ge-hinweis {
  margin: 6px 2px 0;
  font-size: 12.5px;
}
.ge-auf-enter-active {
  transition:
    opacity 0.35s,
    transform 0.4s var(--kurve);
}
.ge-auf-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
@media (max-width: 640px) {
  .ge-eintrag,
  .ge-app {
    flex-wrap: wrap;
  }
  .ge-text {
    flex-basis: calc(100% - 60px);
  }
  .kopf > .knopf {
    width: 100%;
    justify-content: center;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ge-eintrag,
  .ge-auf-enter-active {
    animation: none;
    transition: none;
  }
}
</style>
