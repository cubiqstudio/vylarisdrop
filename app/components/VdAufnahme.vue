<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    schluessel: string
    maxMin?: number
    hinweis?: string
    video?: boolean
    senden: (datei: File, dauerMs: number, art: 'audio' | 'video') => Promise<boolean> | boolean
  }>(),
  { maxMin: 5, hinweis: '', video: true }
)

type Stand = 'bereit' | 'fragt' | 'nimmt' | 'pause' | 'fertig' | 'sendet'
const stand = ref<Stand>('bereit')
const art = ref<'audio' | 'video'>('audio')
const fehlerText = ref('')
const hinweisZeit = ref('')
const still = ref(false)
const wiederDa = ref(false)
const geht = ref(true)
const unsicher = ref(false)
const zeigerMs = ref(0)
const M = 48
const live = ref<number[]>(Array(M).fill(0.04))
const welle = ref<number[]>(Array(M).fill(0.04))
const url = ref('')
const spielt = ref(false)
const fortschritt = ref(0)
const vorschau = ref<HTMLVideoElement | null>(null)
const spieler = ref<HTMLAudioElement | null>(null)

let strom: MediaStream | null = null,
  rec: MediaRecorder | null = null,
  ctx: AudioContext | null = null,
  ana: AnalyserNode | null = null
let uhr: ReturnType<typeof setInterval> | null = null
let blob: Blob | null = null,
  startMs = 0,
  summeMs = 0,
  stillSeit = 0,
  typ = ''
let alle: number[] = []
const maxMs = computed(() => props.maxMin * 60_000)
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`
const laeuft = computed(() => stand.value === 'nimmt' || stand.value === 'pause')

const DB = 'vylariscloud-aufnahmen'
function dbAuf(): Promise<IDBDatabase | null> {
  return new Promise((ok) => {
    try {
      const r = indexedDB.open(DB, 1)
      r.onupgradeneeded = () => {
        const d = r.result
        d.createObjectStore('meta')
        d.createObjectStore('teil', { autoIncrement: true }).createIndex('kid', 'kid')
      }
      r.onsuccess = () => ok(r.result)
      r.onerror = () => ok(null)
      r.onblocked = () => ok(null)
    } catch {
      ok(null)
    }
  })
}
async function dbTun(stores: string[], fn: (t: IDBTransaction) => void): Promise<void> {
  const d = await dbAuf()
  if (!d) return
  await new Promise<void>((ok) => {
    try {
      const t = d.transaction(stores, 'readwrite')
      fn(t)
      t.oncomplete = () => ok()
      t.onerror = () => ok()
      t.onabort = () => ok()
    } catch {
      ok()
    }
  })
  d.close()
}
const metaMerken = () =>
  dbTun(['meta'], (t) =>
    t.objectStore('meta').put({ typ, art: art.value, dauer: dauerJetzt(), welle: alle.slice(-2000) }, props.schluessel)
  )
const teilMerken = (b: Blob) => dbTun(['teil'], (t) => t.objectStore('teil').add({ kid: props.schluessel, b }))
async function speicherLeeren() {
  await dbTun(['meta', 'teil'], (t) => {
    t.objectStore('meta').delete(props.schluessel)
    const c = t.objectStore('teil').index('kid').openCursor(IDBKeyRange.only(props.schluessel))
    c.onsuccess = () => {
      if (c.result) {
        c.result.delete()
        c.result.continue()
      }
    }
  })
}
async function speicherHolen(): Promise<{ m: any; teile: Blob[] } | null> {
  const d = await dbAuf()
  if (!d) return null
  const aus = await new Promise<{ m: any; teile: Blob[] } | null>((ok) => {
    try {
      const t = d.transaction(['meta', 'teil']),
        r = t.objectStore('meta').get(props.schluessel),
        q = t.objectStore('teil').index('kid').getAll(IDBKeyRange.only(props.schluessel))
      t.oncomplete = () => ok(r.result ? { m: r.result, teile: (q.result || []).map((x: any) => x.b) } : null)
      t.onerror = () => ok(null)
    } catch {
      ok(null)
    }
  })
  d.close()
  return aus
}

const dauerJetzt = () => summeMs + (stand.value === 'nimmt' ? Date.now() - startMs : 0)
function aufraeumen() {
  if (uhr) {
    clearInterval(uhr)
    uhr = null
  }
  strom?.getTracks().forEach((s) => s.stop())
  strom = null
  void ctx?.close().catch(() => {})
  ctx = null
  ana = null
}
function typWaehlen(a: 'audio' | 'video') {
  const liste =
    a === 'audio'
      ? ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']
      : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm']
  return liste.find((x) => MediaRecorder.isTypeSupported(x)) || ''
}
async function starten(a: 'audio' | 'video') {
  verwerfenUrl()
  fehlerText.value = ''
  hinweisZeit.value = ''
  still.value = false
  wiederDa.value = false
  art.value = a
  stand.value = 'fragt'
  try {
    strom = await navigator.mediaDevices.getUserMedia(
      a === 'audio'
        ? { audio: { echoCancellation: true, noiseSuppression: true } }
        : {
            audio: { echoCancellation: true, noiseSuppression: true },
            video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
          }
    )
  } catch (e: any) {
    stand.value = 'bereit'
    fehlerText.value =
      e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError'
        ? a === 'audio'
          ? t(
              'Kein Mikrofon gefunden. Schließe eines an und versuche es noch einmal.',
              'No microphone found. Connect one and try again.'
            )
          : t(
              'Keine Kamera gefunden. Schließe eine an oder nimm nur Ton auf.',
              'No camera found. Connect one or record audio only.'
            )
        : e?.name === 'NotReadableError'
          ? t(
              'Das Gerät wird gerade von einem anderen Programm benutzt.',
              'The device is being used by another program.'
            )
          : t(
              'Der Zugriff ist blockiert. Erlaube ihn in der Adresszeile deines Browsers und versuche es noch einmal.',
              'Access is blocked. Allow it in your browser’s address bar and try again.'
            )
    return
  }
  typ = typWaehlen(a)
  try {
    rec = new MediaRecorder(strom, {
      ...(typ ? { mimeType: typ } : {}),
      ...(a === 'audio'
        ? { audioBitsPerSecond: 64_000 }
        : { audioBitsPerSecond: 64_000, videoBitsPerSecond: 1_200_000 })
    })
  } catch {
    aufraeumen()
    stand.value = 'bereit'
    fehlerText.value = t('Dein Browser kann hier nicht aufnehmen.', 'Your browser cannot record here.')
    return
  }
  typ = rec.mimeType || typ
  await speicherLeeren()
  const teile: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size) {
      teile.push(e.data)
      void teilMerken(e.data)
      void metaMerken()
    }
  }
  rec.onstop = () => {
    blob = new Blob(teile, { type: typ.split(';')[0] })
    url.value = URL.createObjectURL(blob)
    welle.value = verdichten(alle)
    aufraeumen()
    stand.value = 'fertig'
    void metaMerken()
  }
  alle = []
  summeMs = 0
  zeigerMs.value = 0
  live.value = Array(M).fill(0.04)
  stillSeit = Date.now()
  try {
    ctx = new AudioContext()
    ana = ctx.createAnalyser()
    ana.fftSize = 1024
    ctx.createMediaStreamSource(strom).connect(ana)
  } catch {
    ana = null
  }
  rec.start(2000)
  startMs = Date.now()
  stand.value = 'nimmt'
  if (a === 'video')
    nextTick(() => {
      const v = vorschau.value
      if (v && strom) {
        v.srcObject = strom
        void v.play().catch(() => {})
      }
    })
  const d = new Uint8Array(1024)
  uhr = setInterval(() => {
    if (stand.value !== 'nimmt') return
    zeigerMs.value = dauerJetzt()
    if (zeigerMs.value >= maxMs.value) {
      hinweisZeit.value = t(
        'Die Zeit ist um, die Aufnahme ist beendet. Du kannst sie jetzt anhören und senden.',
        'Time is up, the recording has ended. You can now listen to it and send it.'
      )
      beenden()
      return
    }
    if (!ana) return
    ana.getByteTimeDomainData(d)
    let s = 0
    for (const x of d) s += ((x - 128) / 128) ** 2
    const rms = Math.sqrt(s / d.length),
      w = Math.min(1, rms * 4 + 0.04)
    alle.push(w)
    live.value = [...live.value.slice(1), w]
    if (rms > 0.012) {
      stillSeit = Date.now()
      still.value = false
    } else if (Date.now() - stillSeit > 5000) still.value = true
  }, 100)
}
function verdichten(w: number[]) {
  if (!w.length) return Array(M).fill(0.12)
  return Array.from({ length: M }, (_, i) => {
    const a = Math.floor((i * w.length) / M),
      b = Math.max(a + 1, Math.floor(((i + 1) * w.length) / M))
    return Math.max(0.08, Math.max(...w.slice(a, b)))
  })
}
function pause() {
  if (!rec) return
  if (stand.value === 'nimmt') {
    summeMs = dauerJetzt()
    rec.pause()
    stand.value = 'pause'
    still.value = false
  } else if (stand.value === 'pause') {
    rec.resume()
    startMs = Date.now()
    stillSeit = Date.now()
    stand.value = 'nimmt'
  }
}
function beenden() {
  if (!rec || rec.state === 'inactive') return
  summeMs = dauerJetzt()
  zeigerMs.value = summeMs
  stand.value = 'pause'
  rec.stop()
}
function verwerfenUrl() {
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = ''
  spielt.value = false
  fortschritt.value = 0
}
async function verwerfen() {
  if (rec && rec.state !== 'inactive') {
    rec.onstop = null
    rec.ondataavailable = null
    try {
      rec.stop()
    } catch {}
  }
  aufraeumen()
  verwerfenUrl()
  blob = null
  summeMs = 0
  zeigerMs.value = 0
  still.value = false
  wiederDa.value = false
  hinweisZeit.value = ''
  stand.value = 'bereit'
  await speicherLeeren()
}
function spielen() {
  const a = spieler.value
  if (!a) return
  if (a.paused) void a.play()
  else a.pause()
}
function zeitUpd() {
  const a = spieler.value
  if (a && zeigerMs.value) fortschritt.value = Math.min(1, (a.currentTime * 1000) / zeigerMs.value)
}

function dateiName() {
  const d = new Date(),
    z = (n: number) => String(n).padStart(2, '0')
  const end = typ.includes('mp4') ? (art.value === 'audio' ? 'm4a' : 'mp4') : typ.includes('ogg') ? 'ogg' : 'webm'
  const name = art.value === 'audio' ? t('Sprachnachricht', 'Voice message') : t('Videobotschaft', 'Video message')
  return `${name} ${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}-${z(d.getMinutes())}.${end}`
}
async function absenden() {
  if (!blob) return
  fehlerText.value = ''
  stand.value = 'sendet'
  let ok = false
  try {
    ok = await props.senden(new File([blob], dateiName(), { type: blob.type }), Math.round(zeigerMs.value), art.value)
  } catch {
    ok = false
  }
  if (!ok) {
    stand.value = 'fertig'
    fehlerText.value = t(
      'Das Senden hat nicht geklappt. Deine Aufnahme ist noch da, versuche es gleich noch einmal.',
      'Sending did not work. Your recording is still here, please try again shortly.'
    )
    return
  }
  await verwerfen()
}

onMounted(async () => {
  unsicher.value = !window.isSecureContext
  geht.value = typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined'
  if (!geht.value || unsicher.value) return
  const alt = await speicherHolen()
  if (alt?.teile.length && stand.value === 'bereit') {
    typ = alt.m.typ || ''
    art.value = alt.m.art === 'video' ? 'video' : 'audio'
    blob = new Blob(alt.teile, { type: typ.split(';')[0] })
    url.value = URL.createObjectURL(blob)
    zeigerMs.value = alt.m.dauer || 0
    alle = alt.m.welle || []
    welle.value = verdichten(alle)
    wiederDa.value = true
    stand.value = 'fertig'
  }
})
onBeforeUnmount(() => {
  if (rec && rec.state !== 'inactive') {
    rec.ondataavailable = null
    rec.onstop = null
    try {
      rec.stop()
    } catch {}
  }
  aufraeumen()
  verwerfenUrl()
})
</script>

<template>
  <section v-if="geht || unsicher" class="auf" :class="{ laeuft: laeuft }" aria-live="polite">
    <p v-if="unsicher" class="klein-hinweis">
      <Ico n="lock" />
      {{ t('Aufnehmen geht nur über eine HTTPS-Adresse.', 'Recording only works over an HTTPS address.') }}
    </p>

    <template v-else-if="stand === 'bereit' || stand === 'fragt'">
      <div class="start">
        <button type="button" class="wahl" :disabled="stand === 'fragt'" @click="starten('audio')">
          <span class="rund"
            ><Ico
              :n="stand === 'fragt' && art === 'audio' ? 'loader' : 'mic'"
              :spin="stand === 'fragt' && art === 'audio'"
          /></span>
          <span class="text"
            ><b>{{ t('Sprachnachricht', 'Voice message') }}</b
            ><small>{{ t(`Bis ${maxMin} Min.`, `Up to ${maxMin} min`) }}</small></span
          >
        </button>
        <button v-if="video" type="button" class="wahl" :disabled="stand === 'fragt'" @click="starten('video')">
          <span class="rund"
            ><Ico
              :n="stand === 'fragt' && art === 'video' ? 'loader' : 'kamera'"
              :spin="stand === 'fragt' && art === 'video'"
          /></span>
          <span class="text"
            ><b>{{ t('Videobotschaft', 'Video message') }}</b
            ><small>{{ t(`Bis ${maxMin} Min.`, `Up to ${maxMin} min`) }}</small></span
          >
        </button>
      </div>
      <p v-if="stand === 'fragt'" class="klein-hinweis">
        {{
          t('Bitte erlaube den Zugriff im Fenster deines Browsers.', 'Please allow access in your browser’s prompt.')
        }}
      </p>
      <p v-else-if="hinweis" class="klein-hinweis">{{ hinweis }}</p>
    </template>

    <template v-else-if="laeuft">
      <video v-if="art === 'video'" ref="vorschau" class="bild" muted playsinline autoplay></video>
      <div class="zeile">
        <button type="button" class="rund voll" :aria-label="t('Aufnahme beenden', 'Stop recording')" @click="beenden">
          <Ico n="stopp" />
        </button>
        <button
          type="button"
          class="rund grau"
          :aria-label="stand === 'pause' ? t('Weiter aufnehmen', 'Resume recording') : t('Pause', 'Pause')"
          :aria-pressed="stand === 'pause'"
          @click="pause"
        >
          <Ico :n="stand === 'pause' ? 'mic' : 'pause'" />
        </button>
        <div class="pegel" :class="{ ruhe: stand === 'pause' }" aria-hidden="true">
          <i v-for="(h, j) in live" :key="j" :style="{ height: h * 100 + '%' }"></i>
        </div>
        <span class="zeit"
          ><span v-if="stand === 'nimmt'" class="punkt"></span>{{ mmss(zeigerMs)
          }}<small> / {{ maxMin }}:00</small></span
        >
      </div>
      <p v-if="still" class="warn" role="status">
        <Ico n="alert" />
        {{ t('Wir hören nichts. Ist dein Mikrofon stumm?', 'We can’t hear anything. Is your microphone muted?') }}
      </p>
      <p v-else-if="stand === 'pause'" class="klein-hinweis">
        {{ t('Pausiert. Mit dem Mikrofon-Knopf geht es weiter.', 'Paused. Use the microphone button to continue.') }}
      </p>
      <div class="reihe">
        <button type="button" class="knopf" @click="verwerfen">{{ t('Verwerfen', 'Discard') }}</button
        ><button type="button" class="knopf" @click="beenden">{{ t('Fertig', 'Done') }}</button>
      </div>
    </template>

    <template v-else>
      <p v-if="wiederDa" class="klein-hinweis">
        <Ico n="clock" />
        {{ t('Diese Aufnahme von vorhin wurde noch nicht gesendet.', 'This earlier recording has not been sent yet.') }}
      </p>
      <p v-if="hinweisZeit" class="klein-hinweis">{{ hinweisZeit }}</p>
      <video v-if="art === 'video'" class="bild" :src="url" controls playsinline></video>
      <div v-else class="zeile">
        <audio
          ref="spieler"
          :src="url"
          preload="metadata"
          @play="spielt = true"
          @pause="spielt = false"
          @ended="
            spielt = false;
            fortschritt = 0;
          "
          @timeupdate="zeitUpd"
        ></audio>
        <button
          type="button"
          class="rund grau"
          :aria-label="spielt ? t('Anhalten', 'Pause') : t('Anhören', 'Listen')"
          @click="spielen"
        >
          <Ico :n="spielt ? 'pause' : 'play'" />
        </button>
        <div class="pegel ruhe" aria-hidden="true">
          <i
            v-for="(h, j) in welle"
            :key="j"
            :class="{ an: (j + 1) / welle.length <= fortschritt }"
            :style="{ height: h * 100 + '%' }"
          ></i>
        </div>
        <span class="zeit">{{ mmss(zeigerMs) }}</span>
      </div>
      <div class="reihe">
        <button type="button" class="knopf" :disabled="stand === 'sendet'" @click="verwerfen">
          <Ico n="trash" /> {{ t('Verwerfen', 'Discard') }}
        </button>
        <button type="button" class="knopf rot" :disabled="stand === 'sendet'" @click="absenden">
          <Ico :n="stand === 'sendet' ? 'loader' : 'upload'" :spin="stand === 'sendet'" />
          {{ stand === 'sendet' ? t('Wird gesendet …', 'Sending …') : t('Senden', 'Send') }}
        </button>
      </div>
    </template>

    <p v-if="fehlerText" class="fehler" role="alert">{{ fehlerText }}</p>
  </section>
</template>

<style scoped>
.auf {
  border: 1px solid var(--linie2);
  border-radius: 18px;
  padding: 14px;
  display: grid;
  gap: 12px;
  background: var(--bg);
  transition: border-color 0.25s;
  min-width: 0;
}
.auf.laeuft {
  border-color: rgba(var(--a-rgb), 0.55);
}
.start {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 10px;
}
.wahl {
  display: flex;
  gap: 12px;
  align-items: center;
  text-align: left;
  border: 1px solid var(--linie);
  background: var(--flaeche);
  color: var(--text);
  border-radius: 14px;
  padding: 10px;
  cursor: pointer;
  transition:
    border-color 0.2s,
    transform 0.15s var(--kurve);
  min-width: 0;
}
.wahl:hover:not(:disabled) {
  border-color: rgba(var(--a-rgb), 0.55);
}
.wahl:active:not(:disabled) {
  transform: scale(0.98);
}
.wahl:disabled {
  opacity: 0.7;
  cursor: default;
}
.wahl:focus-visible,
.rund:focus-visible {
  outline: 2px solid var(--a);
  outline-offset: 2px;
}
.text {
  min-width: 0;
}
.text b {
  display: block;
  font-size: 14px;
  font-weight: 600;
}
.text small {
  color: var(--text3);
  font-size: 12.5px;
}
.rund {
  flex: none;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 13px;
  display: grid;
  place-items: center;
  background: rgba(var(--a-rgb), 0.12);
  color: var(--a);
  cursor: pointer;
  transition:
    transform 0.15s var(--kurve),
    filter 0.2s;
}
.rund :deep(svg) {
  width: 19px;
  height: 19px;
}
button.rund:active {
  transform: scale(0.94);
}
.rund.voll {
  background: var(--a);
  color: var(--a-text, #fff);
}
.rund.voll:hover {
  filter: brightness(1.08);
}
.rund.grau {
  background: var(--flaeche2);
  color: var(--text);
}
.zeile {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.pegel {
  flex: 1;
  min-width: 0;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  overflow: hidden;
}
.pegel i {
  flex: 0 0 3px;
  min-height: 2px;
  border-radius: 99px;
  background: var(--a);
  opacity: 0.85;
  transition: height 0.1s linear;
}
.pegel.ruhe i {
  background: var(--text3);
  opacity: 0.55;
  transition: background 0.15s;
}
.pegel.ruhe i.an {
  background: var(--a);
  opacity: 1;
}
.zeit {
  flex: none;
  font-family: var(--f-mono, ui-monospace, Consolas, monospace);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.zeit small {
  color: var(--text3);
  font-size: 11px;
}
.punkt {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--a);
  margin-right: 7px;
  animation: vd-auf-puls 1.2s ease-in-out infinite;
}
@keyframes vd-auf-puls {
  50% {
    opacity: 0.3;
  }
}
.bild {
  width: 100%;
  max-height: 340px;
  border-radius: 12px;
  background: #000;
  display: block;
}
.reihe {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
p {
  margin: 0;
}
.klein-hinweis {
  font-size: 12.5px;
  color: var(--text3);
  display: flex;
  gap: 7px;
  align-items: baseline;
}
.klein-hinweis :deep(svg) {
  width: 13px;
  height: 13px;
  flex: none;
  align-self: center;
}
.warn {
  font-size: 13px;
  color: var(--warn, #f59e0b);
  display: flex;
  gap: 8px;
  align-items: center;
}
.warn :deep(svg) {
  width: 15px;
  height: 15px;
  flex: none;
}
.fehler {
  font-size: 13px;
  color: var(--rot);
  background: rgba(var(--a-rgb), 0.08);
  padding: 10px 12px;
  border-radius: 10px;
}
@media (max-width: 480px) {
  .pegel i {
    flex-basis: 2px;
  }
  .zeit small {
    display: none;
  }
  .reihe .knopf {
    flex: 1 1 auto;
  }
}
@media (prefers-reduced-motion: reduce) {
  .punkt {
    animation: none;
  }
  .pegel i,
  .auf,
  .wahl,
  .rund {
    transition: none;
  }
}
</style>
