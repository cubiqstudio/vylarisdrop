<script setup lang="ts">
const props = defineProps<{ f: any }>()
const emit = defineEmits<{ (e: 'zu'): void; (e: 'gespeichert', f?: any): void }>()
const { ok, fehler } = useToast()
const { hochladen } = useUploads()

type Werkzeug = 'stift' | 'pfeil' | 'rahmen' | 'text' | 'pixel' | 'schwarz' | 'zuschnitt'
const werkzeug = ref<Werkzeug>('pfeil')
const farbe = ref('#1e73be')
const staerke = ref(6)
const FARBEN = ['#1e73be', '#f59e0b', '#22c55e', '#ef4444', '#a855f7', '#ffffff', '#111111']

const leinwand = ref<HTMLCanvasElement | null>(null)
const ueber = ref<HTMLCanvasElement | null>(null)
const laedt = ref(true)
const verlauf: ImageData[] = []
const zukunft: ImageData[] = []
const kannZurueck = ref(false)
const kannVor = ref(false)
const speichert = ref(false)

onMounted(async () => {
  try {
    const blob = await (await fetch(props.f.links.direkt, { credentials: 'same-origin' })).blob()
    const bild = await createImageBitmap(blob)
    const c = leinwand.value!,
      o = ueber.value!
    c.width = o.width = bild.width
    c.height = o.height = bild.height
    c.getContext('2d')!.drawImage(bild, 0, 0)
    merken()
  } catch {
    fehler(t('Das Bild konnte nicht geladen werden.', 'The image could not be loaded.'))
    emit('zu')
  } finally {
    laedt.value = false
  }
})
const ctx = () => leinwand.value!.getContext('2d', { willReadFrequently: true })!
function merken() {
  const c = leinwand.value!
  verlauf.push(ctx().getImageData(0, 0, c.width, c.height))
  if (verlauf.length > 25) verlauf.shift()
  zukunft.length = 0
  kannZurueck.value = verlauf.length > 1
  kannVor.value = false
}
function setzeStand(d: ImageData) {
  const c = leinwand.value!,
    o = ueber.value!
  c.width = o.width = d.width
  c.height = o.height = d.height
  ctx().putImageData(d, 0, 0)
}
function zurueck() {
  if (verlauf.length < 2) return
  zukunft.push(verlauf.pop()!)
  setzeStand(verlauf[verlauf.length - 1]!)
  kannZurueck.value = verlauf.length > 1
  kannVor.value = true
}
function vor() {
  const d = zukunft.pop()
  if (!d) return
  verlauf.push(d)
  setzeStand(d)
  kannZurueck.value = true
  kannVor.value = zukunft.length > 0
}

function punkt(e: PointerEvent) {
  const r = leinwand.value!.getBoundingClientRect()
  return {
    x: (e.clientX - r.left) * (leinwand.value!.width / r.width),
    y: (e.clientY - r.top) * (leinwand.value!.height / r.height)
  }
}
const massstab = () => leinwand.value!.width / leinwand.value!.getBoundingClientRect().width
let start: { x: number; y: number } | null = null
let pfad: Array<{ x: number; y: number }> = []
const zuschnitt = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const textFeld = ref<{ x: number; y: number; sx: number; sy: number; wert: string } | null>(null)

function zeichneForm(
  g: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  art: Werkzeug
) {
  const s = staerke.value * massstab()
  g.strokeStyle = farbe.value
  g.fillStyle = farbe.value
  g.lineWidth = s
  g.lineCap = 'round'
  g.lineJoin = 'round'
  if (art === 'rahmen') {
    g.beginPath()
    g.roundRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y), s)
    g.stroke()
  }
  if (art === 'pfeil') {
    const w = Math.atan2(b.y - a.y, b.x - a.x),
      kopf = Math.max(14, s * 4)
    g.beginPath()
    g.moveTo(a.x, a.y)
    g.lineTo(b.x - Math.cos(w) * kopf * 0.6, b.y - Math.sin(w) * kopf * 0.6)
    g.stroke()
    g.beginPath()
    g.moveTo(b.x, b.y)
    g.lineTo(b.x - kopf * Math.cos(w - 0.45), b.y - kopf * Math.sin(w - 0.45))
    g.lineTo(b.x - kopf * Math.cos(w + 0.45), b.y - kopf * Math.sin(w + 0.45))
    g.closePath()
    g.fill()
  }
  if (art === 'pixel' || art === 'schwarz' || art === 'zuschnitt') {
    g.setLineDash([8 * massstab(), 6 * massstab()])
    g.lineWidth = 2 * massstab()
    g.strokeStyle = '#fff'
    g.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
    g.setLineDash([])
    if (art === 'zuschnitt') {
      g.fillStyle = 'rgba(0,0,0,.5)'
      const c = leinwand.value!
      g.beginPath()
      g.rect(0, 0, c.width, c.height)
      g.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
      g.fill('evenodd')
    }
  }
}
function runter(e: PointerEvent) {
  if (laedt.value) return
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  const p = punkt(e)
  if (werkzeug.value === 'text') {
    const r = leinwand.value!.getBoundingClientRect()
    textFeld.value = { x: p.x, y: p.y, sx: e.clientX - r.left, sy: e.clientY - r.top, wert: '' }
    nextTick(() => (document.querySelector('.text-eingabe') as HTMLInputElement | null)?.focus())
    return
  }
  start = p
  pfad = [p]
}
function bewegen(e: PointerEvent) {
  if (!start) return
  const p = punkt(e),
    o = ueber.value!.getContext('2d')!
  o.clearRect(0, 0, ueber.value!.width, ueber.value!.height)
  if (werkzeug.value === 'stift') {
    pfad.push(p)
    o.strokeStyle = farbe.value
    o.lineWidth = staerke.value * massstab()
    o.lineCap = 'round'
    o.lineJoin = 'round'
    o.beginPath()
    pfad.forEach((q, i) => (i ? o.lineTo(q.x, q.y) : o.moveTo(q.x, q.y)))
    o.stroke()
  } else zeichneForm(o, start, p, werkzeug.value)
}
function hoch(e: PointerEvent) {
  if (!start) return
  const p = punkt(e),
    a = start
  start = null
  ueber.value!.getContext('2d')!.clearRect(0, 0, ueber.value!.width, ueber.value!.height)
  const g = ctx()
  const x = Math.round(Math.min(a.x, p.x)),
    y = Math.round(Math.min(a.y, p.y)),
    w = Math.round(Math.abs(p.x - a.x)),
    h = Math.round(Math.abs(p.y - a.y))
  if (werkzeug.value === 'stift') {
    g.strokeStyle = farbe.value
    g.lineWidth = staerke.value * massstab()
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.beginPath()
    pfad.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)))
    g.stroke()
    merken()
    return
  }
  if (w < 4 || h < 4) return
  if (werkzeug.value === 'pfeil' || werkzeug.value === 'rahmen') {
    zeichneForm(g, a, p, werkzeug.value)
    merken()
  } else if (werkzeug.value === 'schwarz') {
    g.fillStyle = '#000'
    g.fillRect(x, y, w, h)
    merken()
  } else if (werkzeug.value === 'pixel') {
    const k = Math.max(8, Math.round(Math.min(w, h) / 12))
    const tmp = document.createElement('canvas')
    tmp.width = Math.max(1, Math.ceil(w / k))
    tmp.height = Math.max(1, Math.ceil(h / k))
    const tg = tmp.getContext('2d')!
    tg.imageSmoothingEnabled = false
    tg.drawImage(leinwand.value!, x, y, w, h, 0, 0, tmp.width, tmp.height)
    g.imageSmoothingEnabled = false
    g.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h)
    g.imageSmoothingEnabled = true
    merken()
  } else if (werkzeug.value === 'zuschnitt') {
    zuschnitt.value = { x, y, w, h }
    zeichneForm(ueber.value!.getContext('2d')!, a, p, 'zuschnitt')
  }
}
function zuschneiden() {
  const z = zuschnitt.value
  if (!z) return
  const d = ctx().getImageData(z.x, z.y, z.w, z.h)
  setzeStand(d)
  merken()
  zuschnitt.value = null
}
function textFertig() {
  const tf = textFeld.value
  textFeld.value = null
  if (!tf || !tf.wert.trim()) return
  const g = ctx(),
    gr = Math.max(14, staerke.value * 5) * massstab()
  g.font = `700 ${gr}px 'Poppins', system-ui, sans-serif`
  g.textBaseline = 'top'
  g.lineWidth = gr / 7
  g.strokeStyle = farbe.value === '#111111' ? '#fff' : '#000'
  g.lineJoin = 'round'
  g.strokeText(tf.wert, tf.x, tf.y)
  g.fillStyle = farbe.value
  g.fillText(tf.wert, tf.x, tf.y)
  merken()
}
function drehen(richtung: 1 | -1) {
  const c = leinwand.value!
  const tmp = document.createElement('canvas')
  tmp.width = c.height
  tmp.height = c.width
  const tg = tmp.getContext('2d')!
  tg.translate(tmp.width / 2, tmp.height / 2)
  tg.rotate((richtung * Math.PI) / 2)
  tg.drawImage(c, -c.width / 2, -c.height / 2)
  setzeStand(tg.getImageData(0, 0, tmp.width, tmp.height))
  merken()
}
watch(werkzeug, () => {
  zuschnitt.value = null
  ueber.value?.getContext('2d')?.clearRect(0, 0, ueber.value.width, ueber.value.height)
})

async function speichern(ersetzen: boolean) {
  speichert.value = true
  try {
    const typ = props.f.mime === 'image/jpeg' ? 'image/jpeg' : 'image/png'
    const blob: Blob = await new Promise((res, rej) =>
      leinwand.value!.toBlob((b) => (b ? res(b) : rej(new Error('leer'))), typ, 0.92)
    )
    if (ersetzen) {
      const r = await api(`/api/files/${props.f.id}/inhalt`, {
        method: 'PUT',
        body: blob,
        headers: { 'Content-Type': typ }
      })
      ok(t('Original ersetzt', 'Original replaced'))
      emit('gespeichert', r.file)
    } else {
      const basis = props.f.name.replace(/\.[a-z0-9]{2,5}$/i, '')
      hochladen([new File([blob], `${basis}-bearbeitet.${typ === 'image/jpeg' ? 'jpg' : 'png'}`, { type: typ })], {
        ordner: props.f.folder_id
      })
      emit('gespeichert')
    }
    emit('zu')
  } catch (e: any) {
    fehler(e.message)
  } finally {
    speichert.value = false
  }
}
function taste(e: KeyboardEvent) {
  if (textFeld.value) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    e.shiftKey ? vor() : zurueck()
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault()
    vor()
  }
}
onMounted(() => document.addEventListener('keydown', taste))
onBeforeUnmount(() => document.removeEventListener('keydown', taste))
const WERKZEUGE = computed(() => [
  { id: 'pfeil' as const, ic: 'right', text: t('Pfeil', 'Arrow') },
  { id: 'rahmen' as const, ic: 'rahmen', text: t('Rahmen', 'Box') },
  { id: 'stift' as const, ic: 'edit', text: t('Stift', 'Pen') },
  { id: 'text' as const, ic: 'text', text: 'Text' },
  { id: 'pixel' as const, ic: 'grid', text: t('Verpixeln', 'Pixelate') },
  { id: 'schwarz' as const, ic: 'eye', text: t('Schwärzen', 'Redact') },
  { id: 'zuschnitt' as const, ic: 'crop', text: t('Zuschneiden', 'Crop') }
])
</script>

<template>
  <Teleport to="body">
    <div class="editor" role="dialog" aria-modal="true" :aria-label="t('Bild bearbeiten', 'Edit image')">
      <header class="leiste">
        <b class="titel">{{ f.name }}</b>
        <div class="gruppe">
          <button
            v-for="w in WERKZEUGE"
            :key="w.id"
            :class="{ an: werkzeug === w.id }"
            :title="w.text"
            @click="werkzeug = w.id"
          >
            <Ico :n="w.ic" /><span>{{ w.text }}</span>
          </button>
        </div>
        <div class="gruppe">
          <button :title="t('Nach links drehen', 'Rotate left')" @click="drehen(-1)"><Ico n="drehenl" /></button>
          <button :title="t('Nach rechts drehen', 'Rotate right')" @click="drehen(1)"><Ico n="drehenr" /></button>
          <button :disabled="!kannZurueck" :title="t('Rückgängig (Strg+Z)', 'Undo (Ctrl+Z)')" @click="zurueck">
            <Ico n="undo" />
          </button>
          <button :disabled="!kannVor" :title="t('Wiederholen (Strg+Y)', 'Redo (Ctrl+Y)')" @click="vor">
            <Ico n="redo" />
          </button>
        </div>
        <div class="farben">
          <button
            v-for="c in FARBEN"
            :key="c"
            :class="{ an: farbe === c }"
            :style="{ '--c': c }"
            :aria-label="c"
            @click="farbe = c"
          ></button>
          <input v-model.number="staerke" type="range" min="2" max="24" :aria-label="t('Stärke', 'Thickness')" />
        </div>
        <div class="rechts">
          <button class="knopf" @click="emit('zu')">{{ t('Abbrechen', 'Cancel') }}</button>
          <button class="knopf" :disabled="speichert" @click="speichern(false)">
            <Ico n="copy" /> {{ t('Als Kopie', 'Save copy') }}
          </button>
          <button class="knopf rot" :disabled="speichert" @click="speichern(true)">
            <Ico :n="speichert ? 'loader' : 'check'" :spin="speichert" />
            {{ t('Original ersetzen', 'Replace original') }}
          </button>
        </div>
      </header>
      <div class="flaeche">
        <div v-if="laedt" class="laden"><Ico n="loader" spin /></div>
        <div class="buehne" :class="'wz-' + werkzeug">
          <canvas ref="leinwand"></canvas>
          <canvas ref="ueber" class="ueber" @pointerdown="runter" @pointermove="bewegen" @pointerup="hoch"></canvas>
          <input
            v-if="textFeld"
            v-model="textFeld.wert"
            class="text-eingabe"
            :style="{ left: textFeld.sx + 'px', top: textFeld.sy + 'px', color: farbe }"
            :placeholder="t('Text …', 'Text …')"
            maxlength="120"
            @keydown.enter="textFertig"
            @keydown.esc="textFeld = null"
            @blur="textFertig"
          />
        </div>
        <Transition name="hoch">
          <div v-if="zuschnitt" class="zuschnitt-leiste">
            <span class="mono">{{ zuschnitt.w }} × {{ zuschnitt.h }}</span
            ><button
              class="knopf"
              @click="
                zuschnitt = null;
                werkzeug = 'pfeil';
              "
            >
              {{ t('Verwerfen', 'Discard') }}</button
            ><button class="knopf rot" @click="zuschneiden"><Ico n="check" /> {{ t('Zuschneiden', 'Crop') }}</button>
          </div>
        </Transition>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.editor {
  position: fixed;
  inset: 0;
  z-index: 260;
  background: #0b0b0d;
  display: flex;
  flex-direction: column;
  color: #f4f3f5;
  animation: einblenden 0.25s backwards;
}
.leiste {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid #1f1f23;
  flex-wrap: wrap;
  background: #101013;
}
.titel {
  font-family: var(--f-display);
  font-size: 16px;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gruppe {
  display: flex;
  gap: 2px;
  background: #18181c;
  border-radius: 10px;
  padding: 3px;
}
.gruppe button {
  border: 0;
  background: transparent;
  color: #a3a1a8;
  height: 34px;
  padding: 0 10px;
  border-radius: 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  transition:
    background 0.15s,
    color 0.15s;
}
.gruppe button svg {
  width: 15px;
  height: 15px;
}
.gruppe button:hover:not(:disabled) {
  color: #fff;
  background: #222227;
}
.gruppe button.an {
  background: var(--a);
  color: #fff;
}
.gruppe button:disabled {
  opacity: 0.35;
  cursor: default;
}
.farben {
  display: flex;
  gap: 6px;
  align-items: center;
}
.farben button {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid #101013;
  background: var(--c);
  box-shadow: 0 0 0 1px #2a2a30;
  cursor: pointer;
  transition: transform 0.2s;
}
.farben button.an {
  box-shadow: 0 0 0 2px #fff;
  transform: scale(1.12);
}
.farben input {
  width: 90px;
  accent-color: var(--a);
  margin-left: 6px;
}
.rechts {
  margin-left: auto;
  display: flex;
  gap: 8px;
}
.rechts .knopf:not(.rot) {
  background: #18181c;
  border-color: #2a2a30;
  color: #f4f3f5;
}
.flaeche {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 24px;
  overflow: hidden;
  position: relative;
  background-image:
    linear-gradient(45deg, #121215 25%, transparent 25%), linear-gradient(-45deg, #121215 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #121215 75%), linear-gradient(-45deg, transparent 75%, #121215 75%);
  background-size: 22px 22px;
  background-position:
    0 0,
    0 11px,
    11px -11px,
    -11px 0;
}
.buehne {
  position: relative;
  max-width: 100%;
  max-height: 100%;
  line-height: 0;
  box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.8);
  animation: modalRein 0.45s var(--kurve) backwards;
}
.buehne canvas {
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 150px);
  display: block;
}
.buehne .ueber {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: crosshair;
}
.wz-text .ueber {
  cursor: text;
}
.text-eingabe {
  position: absolute;
  background: rgba(0, 0, 0, 0.55);
  border: 1px dashed #fff;
  border-radius: 6px;
  padding: 4px 8px;
  font: 700 18px var(--f-text);
  outline: 0;
  min-width: 160px;
  line-height: 1.3;
}
.laden {
  position: absolute;
  color: #a3a1a8;
}
.laden svg {
  width: 28px;
  height: 28px;
}
.zuschnitt-leiste {
  position: absolute;
  bottom: 22px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  align-items: center;
  background: #18181c;
  border: 1px solid #2a2a30;
  border-radius: 14px;
  padding: 8px 8px 8px 16px;
  box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.7);
}
.zuschnitt-leiste .knopf:not(.rot) {
  background: #222227;
  border-color: #2a2a30;
  color: #fff;
}
.hoch-enter-active,
.hoch-leave-active {
  transition:
    opacity 0.25s,
    transform 0.3s var(--kurve);
}
.hoch-enter-from,
.hoch-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}
@media (max-width: 900px) {
  .gruppe button span {
    display: none;
  }
  .rechts {
    margin-left: 0;
  }
}
</style>
