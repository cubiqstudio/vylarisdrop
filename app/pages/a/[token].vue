<script setup lang="ts">
definePageMeta({ layout: 'leer' })
const route = useRoute()
const token = computed(() => String(route.params.token || ''))
const requestFetch: any = import.meta.server ? useRequestFetch() : $fetch
const { data, error, refresh } = await useAsyncData('anfrage-' + token.value, () =>
  requestFetch(`/api/public/anfrage/${encodeURIComponent(token.value)}`).catch((e: any) => {
    throw createError({ statusCode: e?.statusCode || 404 })
  })
)
const a = computed<any>(() => data.value)
if (import.meta.server && error.value) {
  const ev = useRequestEvent()
  if (ev) setResponseStatus(ev, 404)
}
useHead(() => ({
  title: a.value?.titel || t('Datei-Anfrage', 'File request'),
  meta: [{ name: 'robots', content: 'noindex' }]
}))

const name = ref('')
const notiz = ref('')
const pw = ref('')
const pwFehler = ref('')
async function entsperren() {
  pwFehler.value = ''
  try {
    await api(`/api/public/anfrage/${encodeURIComponent(token.value)}/entsperren`, {
      method: 'POST',
      body: { passwort: pw.value }
    })
    await refresh()
  } catch (e: any) {
    pwFehler.value = e.message
  }
}

interface Zeile {
  id: number
  name: string
  size: number
  prozent: number
  status: 'laeuft' | 'fertig' | 'fehler'
  fehler?: string
}
const zeilen = ref<Zeile[]>([])
const zieht = ref(false)
let n = 0
function hoch(dateien: FileList | File[], extra: Record<string, string> = {}, zurueck?: (ok: boolean) => void) {
  for (const d of Array.from(dateien)) {
    if (a.value?.max_bytes && d.size > a.value.max_bytes) {
      zeilen.value = [
        {
          id: ++n,
          name: d.name,
          size: d.size,
          prozent: 0,
          status: 'fehler',
          fehler: t(`Größer als ${groesse(a.value.max_bytes)}`, `Larger than ${groesse(a.value.max_bytes)}`)
        },
        ...zeilen.value
      ]
      zurueck?.(false)
      continue
    }
    const z: Zeile = { id: ++n, name: d.name, size: d.size, prozent: 0, status: 'laeuft' }
    zeilen.value = [z, ...zeilen.value]
    const fd = new FormData()
    fd.append('name', name.value)
    fd.append('notiz', notiz.value)
    for (const [k, v] of Object.entries(extra)) fd.append(k, v)
    fd.append('file', d, d.name)
    const x = new XMLHttpRequest()
    x.open('POST', `/api/public/anfrage/${encodeURIComponent(token.value)}/upload`)
    x.upload.onprogress = (e) => {
      if (e.lengthComputable) aendern(z.id, { prozent: Math.round((e.loaded / e.total) * 100) })
    }
    x.onload = () => {
      let r: any = {}
      try {
        r = JSON.parse(x.responseText)
      } catch {}
      if (x.status < 300) {
        aendern(z.id, { status: 'fertig', prozent: 100 })
        nextTick(() => feiern(document.querySelector(`[data-z="${z.id}"] .st`), r.name || d.name))
        void refresh()
        zurueck?.(true)
      } else {
        aendern(z.id, { status: 'fehler', fehler: r.message || t('Hochladen fehlgeschlagen', 'Upload failed') })
        zurueck?.(false)
      }
    }
    x.onerror = () => {
      aendern(z.id, { status: 'fehler', fehler: t('Verbindung unterbrochen', 'Connection lost') })
      zurueck?.(false)
    }
    x.send(fd)
  }
}
function aendern(id: number, p: Partial<Zeile>) {
  zeilen.value = zeilen.value.map((z) => (z.id === id ? { ...z, ...p } : z))
}
const aufnahmeSenden = (d: File, dauerMs: number, art: 'audio' | 'video') =>
  new Promise<boolean>((ok) => hoch([d], { aufnahme: art, dauer_ms: String(dauerMs) }, ok))
const feld = ref<HTMLInputElement | null>(null)
function ab(e: DragEvent) {
  zieht.value = false
  if (e.dataTransfer?.files.length) hoch(e.dataTransfer.files)
}
const fertigAnzahl = computed(() => zeilen.value.filter((z) => z.status === 'fertig').length)
const GRUND = computed(
  () =>
    ({
      voll: t('Hier können keine weiteren Dateien mehr hochgeladen werden.', 'No more files can be uploaded here.'),
      abgelaufen: t('Die Frist für diese Anfrage ist abgelaufen.', 'The deadline for this request has passed.'),
      geschlossen: t('Diese Anfrage wurde geschlossen.', 'This request has been closed.')
    }) as Record<string, string>
)
</script>

<template>
  <div class="seite-a">
    <header class="oben"><VdMarke /></header>
    <div v-if="error" class="mitte rein">
      <span class="ic grau"><Ico n="mail" /></span>
      <h1>{{ t('Anfrage nicht gefunden', 'Request not found') }}</h1>
      <p class="leise">{{ t('Der Link ist falsch oder wurde entfernt.', 'The link is wrong or has been removed.') }}</p>
    </div>
    <form v-else-if="a?.gesperrt" class="mitte rein" @submit.prevent="entsperren">
      <span class="ic"><Ico n="lock" /></span>
      <h1>{{ a.titel }}</h1>
      <p class="leise">
        {{ t('Diese Anfrage ist mit einem Passwort geschützt.', 'This request is password protected.') }}
      </p>
      <div v-if="pwFehler" class="meldung meldung-fehler">{{ pwFehler }}</div>
      <input v-model="pw" class="eingabe" type="password" :placeholder="t('Passwort', 'Password')" required autofocus />
      <button class="knopf rot voll">{{ t('Weiter', 'Continue') }}</button>
    </form>
    <div v-else-if="a" class="karte rein">
      <div class="eyebrow"><Ico n="upload" /> {{ t(`Datei-Anfrage von ${a.von}`, `File request from ${a.von}`) }}</div>
      <h1>{{ a.titel }}</h1>
      <p v-if="a.nachricht" class="nachricht">{{ a.nachricht }}</p>
      <div class="infos">
        <span v-if="a.max_bytes" class="chip neutral"
          >{{ t('bis', 'up to') }} {{ groesse(a.max_bytes) }} {{ t('je Datei', 'per file') }}</span
        >
        <span v-if="a.rest != null" class="chip neutral">{{
          t(`noch ${a.rest} Datei(en)`, `${a.rest} file(s) left`)
        }}</span>
        <span v-if="a.laeuft_ab" class="chip warn"><Ico n="clock" /> {{ restzeit(a.laeuft_ab) }}</span>
      </div>
      <template v-if="a.offen">
        <label class="feld"
          ><span>{{ t('Dein Name (optional)', 'Your name (optional)') }}</span
          ><input
            v-model="name"
            class="eingabe"
            maxlength="60"
            :placeholder="t('damit klar ist, von wem die Dateien sind', 'so it’s clear who the files are from')"
        /></label>
        <label class="feld"
          ><span>{{ t('Mitteilung zur Datei (optional)', 'Note with the file (optional)') }}</span
          ><textarea
            v-model="notiz"
            class="eingabe"
            rows="2"
            maxlength="500"
            :placeholder="t('z. B. Fotos vom zweiten Abend', 'e.g. photos from the second evening')"
          ></textarea>
        </label>
        <div
          class="ablage"
          :class="{ zieht }"
          role="button"
          tabindex="0"
          @click="feld?.click()"
          @keydown.enter="feld?.click()"
          @dragover.prevent="zieht = true"
          @dragleave.prevent="zieht = false"
          @drop.prevent="ab"
        >
          <span class="welle"></span><span class="welle zwei"></span>
          <span class="kreis"><Ico n="upload" /></span>
          <b>{{ t('Dateien hierher ziehen', 'Drag files here') }}</b>
          <span class="leise">{{ t('oder klicken zum Auswählen', 'or click to choose') }}</span>
          <input
            ref="feld"
            type="file"
            multiple
            class="versteckt"
            @change="
              (e) => {
                const f = (e.target as HTMLInputElement).files;
                if (f) hoch(f);
                (e.target as HTMLInputElement).value = '';
              }
            "
          />
        </div>
        <template v-if="a.aufnahme">
          <div class="oder">{{ t('oder direkt aufnehmen', 'or record directly') }}</div>
          <ClientOnly
            ><VdAufnahme
              :schluessel="'a-' + token"
              :max-min="a.aufnahme_min"
              :senden="aufnahmeSenden"
              :hinweis="
                t(
                  `Deine Aufnahme geht an ${a.von} und wird auf diesem Server gespeichert.`,
                  `Your recording goes to ${a.von} and is stored on this server.`
                )
              "
          /></ClientOnly>
        </template>
      </template>
      <div v-else class="meldung meldung-fehler">{{ GRUND[a.grund] }}</div>
      <TransitionGroup tag="div" name="zeile" class="zeilen">
        <div v-for="z in zeilen" :key="z.id" class="zeile" :class="z.status" :data-z="z.id">
          <Ico :n="z.status === 'fertig' ? 'check' : z.status === 'fehler' ? 'alert' : 'upload'" />
          <div class="mitte-z">
            <div class="nm">
              {{ z.name }} <small>{{ groesse(z.size) }}</small>
            </div>
            <div class="bar"><i :style="{ width: z.prozent + '%' }"></i></div>
          </div>
          <span class="st">{{
            z.status === 'fertig' ? t('angekommen', 'received') : z.status === 'fehler' ? z.fehler : z.prozent + ' %'
          }}</span>
        </div>
      </TransitionGroup>
      <p v-if="fertigAnzahl" class="danke">
        {{
          t(
            `Danke! ${fertigAnzahl} Datei(en) sind bei ${a.von} angekommen.`,
            `Thanks! ${fertigAnzahl} file(s) reached ${a.von}.`
          )
        }}
      </p>
    </div>
    <VdFuss />
  </div>
</template>

<style scoped>
.seite-a {
  position: relative;
  max-width: 640px;
  margin: 0 auto;
  padding: 18px 16px 60px;
}
.oben {
  margin-bottom: 28px;
}
.karte {
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 22px;
  padding: 28px;
  box-shadow: 0 40px 90px -40px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
h1 {
  font-family: var(--f-display);
  font-size: 30px;
  letter-spacing: -0.035em;
  word-break: break-word;
}
.nachricht {
  margin: 0;
  color: var(--text2);
  white-space: pre-line;
  background: var(--bg);
  border-left: 3px solid var(--a);
  padding: 10px 14px;
  border-radius: 0 10px 10px 0;
}
.infos {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.feld {
  margin: 0;
}
.ablage {
  position: relative;
  border: 2px dashed var(--linie2);
  border-radius: 18px;
  padding: 34px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
  cursor: pointer;
  transition:
    border-color 0.25s,
    background 0.25s;
  overflow: hidden;
}
.ablage:hover,
.ablage.zieht {
  border-color: var(--a);
  background: rgba(var(--a-rgb), 0.04);
}
.ablage .kreis {
  width: 60px;
  height: 60px;
  border-radius: 17px;
  background: rgba(var(--a-rgb), 0.1);
  color: var(--a);
  display: grid;
  place-items: center;
  margin-bottom: 6px;
  position: relative;
}
.ablage .kreis svg {
  width: 24px;
  height: 24px;
}
.ablage.zieht .kreis svg {
  animation: hopsen 0.7s ease-in-out infinite;
}
.ablage .welle {
  position: absolute;
  width: 60px;
  height: 60px;
  top: 34px;
  border-radius: 17px;
  border: 2px solid var(--a);
  opacity: 0;
}
.ablage.zieht .welle {
  animation: welle 1.4s ease-out infinite;
}
.ablage.zieht .welle.zwei {
  animation-delay: 0.5s;
}
@keyframes welle {
  from {
    transform: scale(1);
    opacity: 0.5;
  }
  to {
    transform: scale(2.6);
    opacity: 0;
  }
}
@keyframes hopsen {
  50% {
    transform: translateY(-4px);
  }
}
.oder {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text3);
  font-size: 12px;
}
.oder::before,
.oder::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--linie);
}
.zeilen {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.zeile {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--bg);
  border: 1px solid var(--linie);
  border-radius: 12px;
  padding: 10px 12px;
}
.zeile > svg {
  width: 17px;
  height: 17px;
  color: var(--text3);
}
.zeile.fertig {
  border-color: rgba(var(--a-rgb), 0.4);
}
.zeile.fertig > svg {
  color: var(--ok);
}
.zeile.fehler > svg,
.zeile.fehler .st {
  color: var(--rot);
}
.mitte-z {
  flex: 1;
  min-width: 0;
}
.nm {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nm small {
  color: var(--text3);
  font-family: var(--f-mono);
  font-size: 11px;
}
.bar {
  height: 4px;
  border-radius: 99px;
  background: var(--flaeche2);
  margin-top: 6px;
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  background: var(--a);
  border-radius: 99px;
  transition: width 0.3s;
}
.st {
  font-family: var(--f-mono);
  font-size: 12px;
  color: var(--text2);
  white-space: nowrap;
}
.zeile.fertig .st {
  color: var(--ok);
}
.zeile-enter-active {
  transition:
    opacity 0.35s,
    transform 0.4s var(--kurve);
}
.zeile-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
.danke {
  margin: 0;
  text-align: center;
  color: var(--ok);
  font-weight: 500;
  animation: rein 0.5s var(--kurve) backwards;
}
.mitte {
  max-width: 400px;
  margin: 12vh auto 0;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.mitte h1 {
  font-size: 26px;
}
.mitte p {
  margin: 0;
}
.ic {
  width: 70px;
  height: 70px;
  border-radius: 20px;
  background: rgba(var(--a-rgb), 0.1);
  color: var(--a);
  display: grid;
  place-items: center;
}
.ic.grau {
  background: var(--flaeche);
  color: var(--text3);
  border: 1px solid var(--linie);
}
.ic svg {
  width: 28px;
  height: 28px;
}
.voll {
  width: 100%;
  padding: 11px;
}
</style>
