<script setup lang="ts">
const props = defineProps<{ src: string; groesse: number }>()
const emit = defineEmits<{ (e: 'info', i: { name: string; mime: string; groesse: number }): void }>()
const schluessel = ref('')
const eingabe = ref('')
const status = ref<'ohne' | 'bereit' | 'laeuft' | 'fertig' | 'fehler'>('ohne')
const anteil = ref(0)
const fehlerText = ref('')
const info = ref<{ name: string; mime: string; groesse: number } | null>(null)
const url = ref('')
const text = ref('')
const html = ref('')
const AUTO = 200 * 1024 ** 2,
  SPEICHER_MAX = 1536 * 1024 ** 2

onMounted(() => {
  schluessel.value = schluesselAusAnker()
  if (schluessel.value) {
    status.value = 'bereit'
    if (props.groesse <= AUTO) void anzeigen()
  }
})
onBeforeUnmount(() => {
  if (url.value) URL.revokeObjectURL(url.value)
})

function schluesselNehmen() {
  const m = /k=([A-Za-z0-9_-]{43})/.exec(eingabe.value) || /^([A-Za-z0-9_-]{43})$/.exec(eingabe.value.trim())
  if (!m) {
    fehlerText.value = t('Das ist kein gültiger Schlüssel.', 'That is not a valid key.')
    return
  }
  fehlerText.value = ''
  schluessel.value = m[1]!
  history.replaceState(null, '', `#k=${schluessel.value}`)
  status.value = 'bereit'
  if (props.groesse <= AUTO) void anzeigen()
}

const art = computed(() => {
  const m = info.value?.mime || ''
  return m.startsWith('image/')
    ? 'bild'
    : m.startsWith('video/')
      ? 'video'
      : m.startsWith('audio/')
        ? 'audio'
        : m.startsWith('text/') || /json|xml|javascript|yaml|toml|x-sh/.test(m)
          ? 'text'
          : 'datei'
})

async function anzeigen() {
  status.value = 'laeuft'
  anteil.value = 0
  fehlerText.value = ''
  const teile: Uint8Array[] = []
  try {
    const i = await entschluesseln(
      props.src,
      schluessel.value,
      (b) => {
        teile.push(b)
      },
      (k) => {
        info.value = k
        emit('info', k)
        if (k.groesse > SPEICHER_MAX)
          throw new Error(
            t(
              'Die Datei ist zu groß, um sie hier anzuzeigen — bitte „Entschlüsseln & speichern“ nutzen.',
              'The file is too large to show here — please use “Decrypt & save”.'
            )
          )
      },
      (p) => {
        anteil.value = p
      }
    )
    const blob = new Blob(teile as BlobPart[], { type: i.mime })
    url.value = URL.createObjectURL(blob)
    if (art.value === 'text' && blob.size <= 2 * 1024 ** 2) {
      text.value = await blob.text()
      html.value = (await hervorheben(text.value, spracheAusName(i.name) || 'auto')).html
    }
    status.value = 'fertig'
  } catch (e: any) {
    status.value = 'fehler'
    fehlerText.value = e.message
  }
}

async function speichern() {
  if (url.value && info.value) return herunterladen()
  const w = window as any
  if (typeof w.showSaveFilePicker === 'function') {
    let datei: any = null
    status.value = 'laeuft'
    anteil.value = 0
    fehlerText.value = ''
    try {
      await entschluesseln(
        props.src,
        schluessel.value,
        async (b) => {
          await datei.write(b)
        },
        async (k) => {
          info.value = k
          emit('info', k)
          const h = await w.showSaveFilePicker({ suggestedName: k.name })
          datei = await h.createWritable()
        },
        (p) => {
          anteil.value = p
        }
      )
      await datei.close()
      status.value = 'bereit'
    } catch (e: any) {
      await datei?.abort?.().catch(() => {})
      if (e?.name === 'AbortError') {
        status.value = 'bereit'
        return
      }
      status.value = 'fehler'
      fehlerText.value = e.message
    }
    return
  }
  await anzeigen()
  if (status.value === 'fertig') herunterladen()
}
function herunterladen() {
  const a = document.createElement('a')
  a.href = url.value
  a.download = info.value?.name || 'datei'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
</script>

<template>
  <div class="e2e-buehne">
    <template v-if="status === 'fertig' && info">
      <img v-if="art === 'bild'" :src="url" :alt="info.name">
      <video v-else-if="art === 'video'" :src="url" controls playsinline></video>
      <div v-else-if="art === 'audio'" class="mitte"><span class="gross-ic"><Ico n="music" /></span><audio :src="url" controls></audio></div>
      <pre v-else-if="art === 'text' && html" class="hljs code" v-html="html"></pre>
      <div v-else class="mitte"><span class="gross-ic"><Ico n="file" /></span><b>{{ info.name }}</b></div>
      <div class="leiste"><span class="chip ok"><Ico n="lock" /> {{ t('Entschlüsselt', 'Decrypted') }}</span><button class="knopf rot klein" @click="herunterladen"><Ico n="download" /> {{ t('Speichern', 'Save') }}</button></div>
    </template>
    <div v-else class="mitte">
      <span class="gross-ic schloss"><Ico n="lock" /></span>
      <h3>{{ t('Ende-zu-Ende verschlüsselt', 'End-to-end encrypted') }}</h3>
      <template v-if="status === 'ohne'">
        <p class="leise">{{ t('Zum Öffnen brauchst du den vollständigen Link mit Schlüssel. Füge ihn hier ein:', 'You need the full link including the key to open it. Paste it here:') }}</p>
        <form class="schl-form" @submit.prevent="schluesselNehmen"><input v-model="eingabe" class="eingabe mono" :placeholder="t('Link oder Schlüssel', 'Link or key')" spellcheck="false" autocomplete="off"><button class="knopf rot">{{ t('Öffnen', 'Open') }}</button></form>
      </template>
      <template v-else-if="status === 'laeuft'">
        <p class="leise">{{ t('Wird hier im Browser entschlüsselt …', 'Decrypting here in your browser …') }}</p>
        <div class="balken" role="progressbar" :aria-valuenow="Math.round(anteil * 100)" aria-valuemin="0" aria-valuemax="100"><i :style="{ transform: `scaleX(${anteil})` }"></i></div>
        <small class="mono sehrleise">{{ Math.round(anteil * 100) }} %</small>
      </template>
      <template v-else>
        <p class="leise">{{ t('Der Schlüssel ist da. Die Datei verlässt den Server nur verschlüsselt.', 'The key is here. The file only ever leaves the server encrypted.') }}</p>
        <div class="reihe" style="justify-content:center">
          <button v-if="groesse <= SPEICHER_MAX" class="knopf" @click="anzeigen"><Ico n="eye" /> {{ t('Entschlüsseln & anzeigen', 'Decrypt & view') }}</button>
          <button class="knopf rot" @click="speichern"><Ico n="download" /> {{ t('Entschlüsseln & speichern', 'Decrypt & save') }}</button>
        </div>
      </template>
      <p v-if="fehlerText" class="meldung meldung-fehler" role="alert">{{ fehlerText }}</p>
    </div>
  </div>
</template>

<style scoped>
.e2e-buehne {
  width: 100%;
  min-height: 320px;
  display: grid;
  place-items: center;
  position: relative;
  background: var(--flaeche);
}
.e2e-buehne img,
.e2e-buehne video {
  width: 100%;
  max-height: 78vh;
  object-fit: contain;
  display: block;
  background: #000;
}
.mitte {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px 24px;
  text-align: center;
  max-width: 480px;
}
.mitte h3 {
  font-size: 18px;
  margin: 4px 0 0;
}
.mitte p {
  margin: 0;
  font-size: 13.5px;
}
.gross-ic {
  width: 64px;
  height: 64px;
  border-radius: 20px;
  background: var(--flaeche2);
  display: grid;
  place-items: center;
  color: var(--text2);
}
.gross-ic svg {
  width: 28px;
  height: 28px;
}
.gross-ic.schloss {
  background: rgba(var(--a-rgb), 0.12);
  color: var(--a);
  animation: modalRein 0.5s var(--kurve) backwards;
}
.schl-form {
  display: flex;
  gap: 8px;
  width: 100%;
  margin-top: 6px;
}
.schl-form input {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
}
.balken {
  width: 260px;
  height: 6px;
  border-radius: 99px;
  background: var(--flaeche2);
  overflow: hidden;
  margin-top: 6px;
}
.balken i {
  display: block;
  height: 100%;
  background: var(--a);
  transform-origin: left;
  transition: transform 0.2s;
}
.code {
  margin: 0;
  padding: 16px;
  width: 100%;
  max-height: 78vh;
  overflow: auto;
  font-family: var(--f-mono);
  font-size: 12.5px;
  line-height: 1.65;
  white-space: pre;
  text-align: left;
  align-self: stretch;
}
.leiste {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  gap: 8px;
  align-items: center;
}
.meldung {
  margin: 8px 0 0;
}
</style>
