<script setup lang="ts">
useHead({ title: () => t('Text & Code', 'Text & code') })
const { ok, fehler } = useToast()
const { neu } = useUploads()
const { data: ord } = await (useFetch as any)('/api/folders', { key: 'ordner' })
const f = reactive({
  titel: '',
  text: '',
  sprache: 'auto',
  ablauf: '',
  passwort: '',
  einmal: false,
  ordner: null as number | null
})
const html = ref('')
const erkannt = ref('')
let uhr: any = null
watch(
  () => [f.text, f.sprache],
  () => {
    clearTimeout(uhr)
    uhr = setTimeout(async () => {
      const r = await hervorheben(f.text + '\n', f.sprache)
      html.value = r.html
      erkannt.value = f.sprache === 'auto' ? r.sprache : ''
    }, 120)
  }
)
const feld = ref<HTMLTextAreaElement | null>(null),
  unter = ref<HTMLElement | null>(null),
  nummern = ref<HTMLElement | null>(null)
function scrollen() {
  if (!feld.value) return
  if (unter.value) {
    unter.value.scrollTop = feld.value.scrollTop
    unter.value.scrollLeft = feld.value.scrollLeft
  }
  if (nummern.value) nummern.value.scrollTop = feld.value.scrollTop
}
function taste(e: KeyboardEvent) {
  if (e.key === 'Tab' && !e.shiftKey && feld.value) {
    e.preventDefault()
    const el = feld.value,
      a = el.selectionStart,
      b = el.selectionEnd
    f.text = f.text.slice(0, a) + '  ' + f.text.slice(b)
    nextTick(() => {
      el.selectionStart = el.selectionEnd = a + 2
    })
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    void speichern()
  }
}
const zeilen = computed(() => Math.max(1, f.text.split('\n').length))
const ordner = computed<any[]>(() => {
  const alle = ord.value?.ordner || [],
    aus: any[] = []
  const kinder = (p: number | null, tiefe: number) => {
    for (const o of alle.filter((x: any) => x.parent_id === p)) {
      aus.push({ ...o, tiefe })
      kinder(o.id, tiefe + 1)
    }
  }
  kinder(null, 0)
  return aus
})
const laeuft = ref(false)
const fertig = ref<any>(null)
async function speichern() {
  if (!f.text.trim()) return fehler(t('Der Text ist leer.', 'The text is empty.'))
  laeuft.value = true
  try {
    const sprache = f.sprache === 'auto' ? erkannt.value || 'plaintext' : f.sprache
    const ext = SPRACHEN.find((s) => s.v === sprache)?.ext || 'txt'
    const basis = (f.titel.trim() || 'paste').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120)
    const name = /\.[a-z0-9]{1,12}$/i.test(basis) ? basis : `${basis}.${ext}`
    const fd = new FormData()
    fd.append('datei', new Blob([f.text], { type: 'text/plain' }), name)
    const kopf: Record<string, string> = {}
    if (f.ablauf) kopf['x-vd-expires'] = f.ablauf
    if (f.einmal) kopf['x-vd-max-views'] = '1'
    if (f.passwort) kopf['x-vd-password'] = f.passwort
    if (f.ordner) kopf['x-vd-folder'] = String(f.ordner)
    const r = await api('/api/upload', { method: 'POST', body: fd, headers: kopf })
    fertig.value = r.files?.[0]
    neu.value++
    const kopiert = await kopieren(fertig.value.links.seite)
    ok(kopiert ? t('Gespeichert — Link kopiert', 'Saved — link copied') : t('Gespeichert', 'Saved'))
  } catch (e: any) {
    fehler(e.message)
  } finally {
    laeuft.value = false
  }
}
function nochEiner() {
  Object.assign(f, { titel: '', text: '', passwort: '', einmal: false })
  fertig.value = null
  nextTick(() => feld.value?.focus())
}
const ABLAUF = computed(() => [
  { v: '', t: t('Nie', 'Never') },
  { v: '10m', t: t('10 Minuten', '10 minutes') },
  { v: '1h', t: t('1 Stunde', '1 hour') },
  { v: '1d', t: t('1 Tag', '1 day') },
  { v: '7d', t: t('7 Tage', '7 days') },
  { v: '30d', t: t('30 Tage', '30 days') }
])
</script>

<template>
  <section class="rein">
    <div class="kopf">
      <div>
        <div class="eyebrow"><Ico n="code" /> {{ t('Bibliothek', 'Library') }}</div>
        <h1>{{ t('Text & Code', 'Text & code') }}</h1>
        <p>
          {{
            t(
              'Einfügen, teilen, fertig — mit Syntax-Hervorhebung für über 40 Sprachen.',
              'Paste, share, done — with syntax highlighting for over 40 languages.'
            )
          }}
        </p>
      </div>
    </div>

    <Transition name="wechsel" mode="out-in">
      <div v-if="fertig" key="fertig" class="block fertig">
        <span class="haken"><Ico n="check" /></span>
        <div>
          <h3>{{ fertig.name }}</h3>
          <p class="leise">{{ t('Der Link ist in der Zwischenablage.', 'The link is in your clipboard.') }}</p>
          <code class="mono">{{ fertig.links.seite }}</code>
        </div>
        <div class="reihe">
          <a :href="fertig.links.seite" target="_blank" rel="noopener" class="knopf"
            ><Ico n="external" /> {{ t('Öffnen', 'Open') }}</a
          ><button class="knopf rot" @click="nochEiner"><Ico n="plus" /> {{ t('Noch einer', 'Another one') }}</button>
        </div>
      </div>
      <form v-else key="form" class="raster" @submit.prevent="speichern">
        <div class="editor-block">
          <div class="leiste">
            <input
              v-model="f.titel"
              class="titel"
              :placeholder="t('Titel (optional)', 'Title (optional)')"
              maxlength="120"
            />
            <VdAuswahl v-model="f.sprache" class="eingabe sprache"
              ><option value="auto">
                {{ t('Automatisch', 'Automatic')
                }}{{ erkannt ? ` · ${SPRACHEN.find((s) => s.v === erkannt)?.name || erkannt}` : '' }}
              </option>
              <option v-for="s in SPRACHEN" :key="s.v" :value="s.v">{{ s.name }}</option></VdAuswahl
            >
          </div>
          <div class="editor">
            <div ref="nummern" class="nummern mono" aria-hidden="true">
              <span v-for="i in zeilen" :key="i">{{ i }}</span>
            </div>
            <div class="flaeche">
              <pre ref="unter" class="hljs mono unter" aria-hidden="true" v-html="html"></pre>
              <textarea
                ref="feld"
                v-model="f.text"
                class="mono oben"
                spellcheck="false"
                autofocus
                :placeholder="t('Text oder Code hier einfügen …', 'Paste text or code here …')"
                @scroll="scrollen"
                @keydown="taste"
              ></textarea>
            </div>
          </div>
        </div>
        <div class="block optionen">
          <label class="feld"
            ><span>{{ t('Läuft ab', 'Expires') }}</span
            ><VdAuswahl v-model="f.ablauf" class="eingabe"
              ><option v-for="a in ABLAUF" :key="a.v" :value="a.v">{{ a.t }}</option></VdAuswahl
            ></label
          >
          <label class="feld"
            ><span>{{ t('Passwort', 'Password') }}</span
            ><input
              v-model="f.passwort"
              class="eingabe"
              type="password"
              autocomplete="new-password"
              :placeholder="t('kein Passwort', 'no password')"
          /></label>
          <label class="feld"
            ><span>{{ t('Ordner', 'Folder') }}</span
            ><VdAuswahl v-model="f.ordner" class="eingabe"
              ><option :value="null">{{ t('Ohne Ordner', 'No folder') }}</option>
              <option v-for="o in ordner" :key="o.id" :value="o.id">
                {{ '— '.repeat(o.tiefe) }}{{ o.name }}
              </option></VdAuswahl
            ></label
          >
          <label class="opt"
            ><button
              type="button"
              :class="['schalter', { an: f.einmal }]"
              role="switch"
              :aria-checked="f.einmal"
              @click="f.einmal = !f.einmal"
            ></button
            ><span
              ><b>{{ t('Nach dem Lesen löschen', 'Delete after reading') }}</b
              ><small>{{ t('Nur ein einziger Aufruf.', 'Only a single view.') }}</small></span
            ></label
          >
          <button class="knopf rot gross" :disabled="laeuft || !f.text.trim()">
            <Ico :n="laeuft ? 'loader' : 'link'" :spin="laeuft" />
            {{ t('Speichern & Link kopieren', 'Save & copy link') }}
          </button>
          <p class="sehrleise klein">{{ t('Strg + Enter speichert.', 'Ctrl + Enter saves.') }}</p>
        </div>
      </form>
    </Transition>
  </section>
</template>

<style scoped>
.raster {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 14px;
  align-items: start;
}
.editor-block {
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 16px;
  overflow: hidden;
}
.leiste {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid var(--linie);
}
.titel {
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  font-weight: 600;
  font-size: 14px;
  color: var(--text);
}
.sprache {
  width: auto;
  padding: 6px 10px;
  font-size: 12.5px;
}
.editor {
  display: flex;
  height: min(68vh, 640px);
  font-size: 13px;
  line-height: 1.6;
}
.nummern {
  display: flex;
  flex-direction: column;
  padding: 14px 10px 14px 14px;
  color: var(--text3);
  text-align: right;
  user-select: none;
  border-right: 1px solid var(--linie);
  overflow: hidden;
  font-size: 12px;
  line-height: 21px;
  min-width: 46px;
}
.flaeche {
  position: relative;
  flex: 1;
  min-width: 0;
}
.unter,
.oben {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 14px 16px;
  white-space: pre;
  overflow: auto;
  tab-size: 2;
  font-size: 13px;
  line-height: 21px;
  font-family: var(--f-mono);
}
.unter {
  pointer-events: none;
  color: var(--text);
}
.oben {
  resize: none;
  border: 0;
  outline: 0;
  background: transparent;
  color: transparent;
  caret-color: var(--a);
}
.oben::placeholder {
  color: var(--text3);
}
.oben::selection {
  background: rgba(var(--a-rgb), 0.25);
  color: transparent;
}
.optionen {
  display: flex;
  flex-direction: column;
}
.opt {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin: 4px 0 16px;
  cursor: pointer;
}
.opt small {
  display: block;
  color: var(--text3);
  font-size: 12px;
}
.gross {
  padding: 11px 14px;
}
.klein {
  font-size: 11.5px;
  margin: 8px 0 0;
  text-align: center;
}
.fertig {
  display: flex;
  gap: 18px;
  align-items: center;
  flex-wrap: wrap;
}
.fertig > div:nth-child(2) {
  flex: 1;
  min-width: 220px;
}
.fertig code {
  display: inline-block;
  margin-top: 6px;
  font-size: 12.5px;
  background: var(--bg);
  border: 1px solid var(--linie);
  border-radius: 8px;
  padding: 4px 8px;
}
.haken {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  background: var(--ok-bg);
  color: var(--ok);
  display: grid;
  place-items: center;
  animation: modalRein 0.5s var(--kurve) backwards;
}
.haken svg {
  width: 24px;
  height: 24px;
}
.wechsel-enter-active,
.wechsel-leave-active {
  transition:
    opacity 0.2s,
    transform 0.25s var(--kurve);
}
.wechsel-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.wechsel-leave-to {
  opacity: 0;
}
@media (max-width: 900px) {
  .raster {
    grid-template-columns: 1fr;
  }
}
</style>
