<script setup lang="ts">
useHead({ title: () => t('Embed-Designer', 'Embed designer') })
const theme = useTheme()
const { ok, fehler } = useToast()
const { data: konto } = await (useFetch as any)('/api/account', { key: 'konto' })
const { data: beispiel } = await (useFetch as any)('/api/files', { key: 'embed-bsp', query: { art: 'bild', pro: 1 } })
const datei = computed<any>(() => beispiel.value?.files?.[0] || null)

const e = reactive({ titel: '{name}', anbieter: '', text: '{size} · {date}', farbe: theme.value.color, bild: true })
watch(
  konto,
  (k) => {
    const x = k?.prefs?.embed
    if (x)
      Object.assign(e, {
        titel: x.titel ?? '{name}',
        anbieter: x.anbieter ?? '',
        text: x.text ?? '{size} · {date}',
        farbe: x.farbe || theme.value.color,
        bild: x.bild !== false
      })
  },
  { immediate: true }
)
const plattform = ref<'discord' | 'telegram' | 'whatsapp'>('discord')
const PLATZHALTER = ['{name}', '{size}', '{date}', '{views}', '{dimensions}', '{user}']
const FARBEN = ['#1e73be', '#f59e0b', '#22c55e', '#ef4444', '#a855f7', '#ec4899', '#e5e7eb']
const letztes = ref<'titel' | 'anbieter' | 'text'>('titel')
function einfuegen(p: string) {
  e[letztes.value] = (e[letztes.value] ? e[letztes.value] + ' ' : '') + p
  pulsieren()
}

const ph = (s: string) =>
  String(s || '').replace(/\{(name|size|date|views|user|dimensions)\}/g, (_m, k) => {
    const f = datei.value
    return (
      (
        {
          name: f?.name || 'urlaub.jpg',
          size: groesse(f?.size || 2_100_000),
          date: datum(f?.created_at || new Date().toISOString()),
          views: String(f?.views ?? 18),
          user: theme.value.user?.username || 'du',
          dimensions: f?.width ? `${f.width} × ${f.height}` : '4032 × 3024'
        } as Record<string, string>
      )[k] || ''
    )
  })
const v = computed(() => ({
  titel: ph(e.titel || '{name}'),
  anbieter: ph(e.anbieter || theme.value.name),
  text: ph(e.text),
  bild:
    e.bild && datei.value ? (datei.value.hat_vorschau ? datei.value.links.vorschau : datei.value.links.direkt) : null
}))
const link = computed(() => datei.value?.links?.seite || 'https://cloud.example.com/v/aT7mQ')
const puls = ref(0)
function pulsieren() {
  puls.value++
}
watch(() => [e.titel, e.anbieter, e.text, e.farbe, e.bild], pulsieren)

const speichert = ref(false)
async function speichern() {
  speichert.value = true
  try {
    await api('/api/account/prefs', { method: 'PUT', body: { embed: { ...e } } })
    ok(t('Gespeichert — gilt ab sofort für alle deine Links', 'Saved — applies to all your links from now on'))
  } catch (x: any) {
    fehler(x.message)
  } finally {
    speichert.value = false
  }
}
const jetzt = new Date().toLocaleTimeString(lang() === 'en' ? 'en-GB' : 'de-DE', { hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <section class="rein">
    <div class="kopf">
      <div><div class="eyebrow"><Ico n="sparkle" /> Embed-Designer</div><h1>{{ t('Wie dein Link in Chats aussieht', 'How your link looks in chats') }}</h1><p>{{ t('Platzhalter werden beim Teilen automatisch ersetzt. Gilt für Discord, Telegram, WhatsApp und alles mit Open Graph.', 'Placeholders are filled in when sharing. Works for Discord, Telegram, WhatsApp and anything with Open Graph.') }}</p></div>
      <button class="knopf rot" :disabled="speichert" @click="speichern"><Ico :n="speichert ? 'loader' : 'check'" :spin="speichert" /> {{ t('Speichern', 'Save') }}</button>
    </div>
    <div class="zwei">
      <div class="block">
        <label class="feld"><span>{{ t('Oben (Anbieter)', 'Top line (provider)') }}</span><input v-model="e.anbieter" class="eingabe" :placeholder="theme.name" maxlength="120" @focus="letztes = 'anbieter'"></label>
        <label class="feld"><span>{{ t('Titel', 'Title') }}</span><input v-model="e.titel" class="eingabe" maxlength="120" @focus="letztes = 'titel'"></label>
        <label class="feld"><span>{{ t('Beschreibung', 'Description') }}</span><textarea v-model="e.text" class="eingabe" rows="2" maxlength="300" @focus="letztes = 'text'"></textarea></label>
        <div class="feld"><span>{{ t('Platzhalter (fügt ins zuletzt gewählte Feld ein)', 'Placeholders (insert into the last field)') }}</span>
          <div class="platzhalter"><button v-for="p in PLATZHALTER" :key="p" @click="einfuegen(p)">{{ p }}</button></div></div>
        <div class="feld"><span>{{ t('Farbe (Discord-Leiste, Browser-Akzent)', 'Colour (Discord bar, browser accent)') }}</span>
          <div class="farben"><button v-for="c in FARBEN" :key="c" :class="{ an: e.farbe === c }" :style="{ '--c': c }" :aria-label="c" @click="e.farbe = c"></button><input v-model="e.farbe" type="color" :aria-label="t('Eigene Farbe', 'Custom colour')"></div></div>
        <label class="reihe schalt"><button type="button" class="schalter" :class="{ an: e.bild }" role="switch" :aria-checked="e.bild" @click="e.bild = !e.bild"></button> {{ t('Großes Vorschaubild zeigen', 'Show large preview image') }}</label>
      </div>
      <div>
        <div class="seg plattform" role="tablist">
          <button :class="{ an: plattform === 'discord' }" @click="plattform = 'discord'">Discord</button>
          <button :class="{ an: plattform === 'telegram' }" @click="plattform = 'telegram'">Telegram</button>
          <button :class="{ an: plattform === 'whatsapp' }" @click="plattform = 'whatsapp'">WhatsApp</button>
        </div>
        <Transition name="wechsel" mode="out-in">
          <div v-if="plattform === 'discord'" key="dc" class="dc">
            <div class="dc-msg"><div class="dc-av">{{ (theme.user?.username || 'D').slice(0, 1).toUpperCase() }}</div><div style="min-width:0">
              <div class="dc-name">{{ theme.user?.username }} <small>{{ t('Heute um', 'Today at') }} {{ jetzt }}</small></div>
              <div class="dc-link">{{ link }}</div>
              <div :key="puls" class="dc-embed puls" :style="{ borderLeftColor: e.farbe }">
                <div class="s">{{ v.anbieter }}</div><div class="tt">{{ v.titel }}</div><div v-if="v.text" class="d">{{ v.text }}</div>
                <img v-if="v.bild" :src="v.bild" alt="">
              </div>
            </div></div>
          </div>
          <div v-else-if="plattform === 'telegram'" key="tg" class="tg">
            <div :key="puls" class="tg-blase puls">
              <div class="tg-link">{{ link }}</div>
              <div class="tg-vorschau" :style="{ borderLeftColor: e.farbe }"><b :style="{ color: e.farbe }">{{ v.anbieter }}</b><strong>{{ v.titel }}</strong><span v-if="v.text">{{ v.text }}</span><img v-if="v.bild" :src="v.bild" alt=""></div>
              <small>{{ jetzt }}</small>
            </div>
          </div>
          <div v-else key="wa" class="wa">
            <div :key="puls" class="wa-blase puls">
              <div class="wa-karte"><img v-if="v.bild" :src="v.bild" alt=""><div class="wa-text"><strong>{{ v.titel }}</strong><span v-if="v.text">{{ v.text }}</span><small>{{ link.replace(/^https?:\/\//, '').split('/')[0] }}</small></div></div>
              <div class="wa-link">{{ link }}</div><small>{{ jetzt }} ✓✓</small>
            </div>
          </div>
        </Transition>
        <p v-if="!datei" class="sehrleise klein">{{ t('Lade ein Bild hoch, um die Vorschau mit deiner eigenen Datei zu sehen.', 'Upload an image to see the preview with your own file.') }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.zwei {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 22px;
  align-items: start;
}
textarea.eingabe {
  resize: vertical;
}
.platzhalter {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.platzhalter button {
  border: 1px dashed var(--linie2);
  background: transparent;
  border-radius: 6px;
  padding: 3px 8px;
  font-family: var(--f-mono);
  font-size: 11.5px;
  color: var(--text2);
  cursor: pointer;
  transition:
    border-color 0.15s,
    color 0.15s,
    transform 0.15s;
}
.platzhalter button:hover {
  border-color: var(--a);
  color: var(--a);
  transform: translateY(-1px);
}
.farben {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.farben button {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid var(--flaeche);
  background: var(--c);
  cursor: pointer;
  box-shadow: 0 0 0 1px var(--linie2);
  transition: transform 0.2s;
}
.farben button.an {
  box-shadow: 0 0 0 2px var(--text);
  transform: scale(1.1);
}
.farben input[type='color'] {
  width: 32px;
  height: 32px;
  border: 0;
  background: none;
  cursor: pointer;
  padding: 0;
}
.schalt {
  gap: 10px;
  font-size: 13px;
  cursor: pointer;
}
.plattform {
  margin-bottom: 12px;
}
.klein {
  font-size: 12.5px;
  margin-top: 10px;
}
.puls {
  animation: puls 0.45s ease;
}
@keyframes puls {
  50% {
    transform: scale(1.012);
  }
}
.dc {
  background: #313338;
  border-radius: 14px;
  padding: 18px;
  color: #dbdee1;
}
.dc-msg {
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 14px;
}
.dc-av {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--a);
  color: #fff;
  display: grid;
  place-items: center;
  font-weight: 700;
}
.dc-name {
  font-weight: 600;
  color: #f2f3f5;
  font-size: 15px;
}
.dc-name small {
  color: #949ba4;
  font-weight: 400;
  font-size: 12px;
  margin-left: 6px;
}
.dc-link {
  color: #00a8fc;
  font-size: 15px;
  word-break: break-all;
}
.dc-embed {
  margin-top: 6px;
  max-width: 420px;
  background: #2b2d31;
  border-radius: 4px;
  border-left: 4px solid;
  padding: 10px 14px 14px;
  transition: border-color 0.3s;
}
.dc-embed .s {
  font-size: 12px;
}
.dc-embed .tt {
  font-size: 15px;
  font-weight: 600;
  color: #00a8fc;
  margin-top: 6px;
  word-break: break-word;
}
.dc-embed .d {
  font-size: 14px;
  margin-top: 6px;
}
.dc-embed img {
  width: 100%;
  border-radius: 4px;
  margin-top: 12px;
  display: block;
  max-height: 260px;
  object-fit: cover;
}
.tg {
  background: #0e1621
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Ccircle cx='2' cy='2' r='1' fill='%23ffffff10'/%3E%3C/svg%3E");
  border-radius: 14px;
  padding: 20px;
  display: flex;
  justify-content: flex-end;
}
.tg-blase {
  background: #2b5278;
  color: #fff;
  border-radius: 14px 14px 4px 14px;
  padding: 9px 11px 6px;
  max-width: 360px;
  font-size: 14px;
}
.tg-link {
  color: #6ab3f3;
  word-break: break-all;
}
.tg-vorschau {
  border-left: 3px solid;
  padding-left: 9px;
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13.5px;
}
.tg-vorschau img {
  width: 100%;
  border-radius: 8px;
  margin-top: 6px;
  max-height: 220px;
  object-fit: cover;
}
.tg-blase small,
.wa-blase small {
  display: block;
  text-align: right;
  font-size: 11px;
  opacity: 0.6;
  margin-top: 3px;
}
.wa {
  background: #0b141a;
  border-radius: 14px;
  padding: 20px;
  display: flex;
  justify-content: flex-end;
}
.wa-blase {
  background: #005c4b;
  color: #e9edef;
  border-radius: 10px 0 10px 10px;
  padding: 4px 4px 6px;
  max-width: 340px;
  font-size: 14px;
}
.wa-karte {
  background: #025144;
  border-radius: 8px;
  overflow: hidden;
}
.wa-karte img {
  width: 100%;
  display: block;
  max-height: 200px;
  object-fit: cover;
}
.wa-text {
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wa-text span {
  font-size: 13px;
  opacity: 0.8;
}
.wa-text small {
  font-size: 11.5px;
  opacity: 0.6;
}
.wa-link {
  color: #53bdeb;
  padding: 6px 6px 0;
  word-break: break-all;
}
.wechsel-enter-active {
  transition:
    opacity 0.3s,
    transform 0.35s var(--kurve);
}
.wechsel-leave-active {
  transition: opacity 0.12s;
}
.wechsel-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.wechsel-leave-to {
  opacity: 0;
}
@media (max-width: 960px) {
  .zwei {
    grid-template-columns: 1fr;
  }
}
</style>
