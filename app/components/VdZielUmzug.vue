<script setup lang="ts">
// Verteilung der Dateien auf die Speicherorte und „Dateien umziehen“ mit Fortschritt (Pausieren, Fortsetzen, Abbrechen)
const props = defineProps<{ ziele: any[]; verteilung: Record<string, { anzahl: number; bytes: number }>; umzug: any; ort: any }>()
const emit = defineEmits<{ (e: 'refresh'): void }>()
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()

const dateien = (n: number) => (n === 1 ? t('1 Datei', '1 file') : t(`${zahl(n)} Dateien`, `${zahl(n)} files`))
const FARBEN = ['var(--a)', 'var(--ok)', 'var(--warn)', 'var(--info)', '#a855f7', '#14b8a6', '#ec4899', '#f97316']
const name = (k: string) =>
  k === 'lokal'
    ? t('Dieser Server', 'This server')
    : k === 's3'
      ? 'S3'
      : props.ziele.find((z) => `sftp${z.id}` === k)?.name || t('Entfernte Erweiterung', 'Removed add-on')
const eintraege = computed(() => {
  const keys = new Set<string>(['lokal', ...Object.keys(props.verteilung)])
  const liste = [...keys].map((k) => ({
    k,
    name: name(k),
    anzahl: props.verteilung[k]?.anzahl || 0,
    bytes: props.verteilung[k]?.bytes || 0
  }))
  return liste.map((e, i) => ({ ...e, farbe: FARBEN[i % FARBEN.length]! }))
})
const gesamtBytes = computed(() => eintraege.value.reduce((a, e) => a + e.bytes, 0))
const gesamtAnzahl = computed(() => eintraege.value.reduce((a, e) => a + e.anzahl, 0))
const anteil = (e: { bytes: number; anzahl: number }) =>
  gesamtBytes.value ? (e.bytes / gesamtBytes.value) * 100 : gesamtAnzahl.value ? (e.anzahl / gesamtAnzahl.value) * 100 : 0

// Ziele für den Umzug: Server, S3 (falls eingerichtet und Pro), jede aktive schreibbare Erweiterung
const optionen = computed(() => {
  const l: Array<{ k: string; text: string; n: number; b: number }> = []
  const zu = (k: string, text: string) => {
    const n = eintraege.value.filter((e) => e.k !== k).reduce((a, e) => a + e.anzahl, 0)
    const b = eintraege.value.filter((e) => e.k !== k).reduce((a, e) => a + e.bytes, 0)
    l.push({ k, text, n, b })
  }
  zu('lokal', t('Dieser Server', 'This server'))
  if (props.ort?.s3Bereit && props.ort?.s3Pro) zu('s3', 'S3')
  for (const z of props.ziele) if (z.aktiv && z.schreibbar) zu(`sftp${z.id}`, z.name)
  return l
})
const wahl = ref('')
watch(
  optionen,
  (o) => {
    if (!o.find((x) => x.k === wahl.value)) wahl.value = (o.find((x) => x.k.startsWith('sftp')) || o[0])?.k || ''
  },
  { immediate: true }
)
const gewaehlt = computed(() => optionen.value.find((o) => o.k === wahl.value))
const laeuft = computed(() => props.umzug?.status === 'laeuft')
const prozent = computed(() =>
  props.umzug?.gesamt ? Math.min(100, ((props.umzug.erledigt + props.umzug.fehler) / props.umzug.gesamt) * 100) : 0
)

function starten(zielKey?: string) {
  const o = optionen.value.find((x) => x.k === (zielKey || wahl.value))
  if (!o) return
  if (!o.n) {
    ok(t('Alle Dateien liegen schon dort.', 'All files are already there.'))
    return
  }
  bestaetigen(
    t(`Alle Dateien nach „${o.text}“ umziehen?`, `Move all files to “${o.text}”?`),
    t(
      `${zahl(o.n)} Dateien (${groesse(o.b)}) werden im Hintergrund kopiert. Jede Kopie wird per Prüfsumme (SHA-256) gegen das Original geprüft, erst dann wird das Original gelöscht. Links bleiben gleich und die Dateien bleiben die ganze Zeit erreichbar. Du kannst pausieren oder abbrechen.`,
      `${zahl(o.n)} files (${groesse(o.b)}) are copied in the background. Every copy is checked against the original by SHA-256 checksum before the original is deleted. Links stay the same and the files remain reachable the whole time. You can pause or cancel.`
    ),
    t('Umzug starten', 'Start move'),
    async () => {
      try {
        await api('/api/speicher/ziele/umzug', { method: 'POST', body: { aktion: 'starten', ziel: o.k } })
        emit('refresh')
        ok(t('Umzug läuft', 'Move running'))
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}
async function steuern(was: string) {
  try {
    await api('/api/speicher/ziele/umzug', { method: 'POST', body: { aktion: 'steuern', was } })
    emit('refresh')
  } catch (e: any) {
    fehler(e.message)
  }
}
function abbrechen() {
  bestaetigen(
    t('Umzug abbrechen?', 'Cancel the move?'),
    t(
      'Die gerade kopierte Datei wird noch sauber fertiggestellt, dann hört der Umzug auf. Bereits umgezogene Dateien bleiben am neuen Ort, alle Dateien bleiben erreichbar.',
      'The file currently being copied is finished cleanly, then the move stops. Files already moved stay at the new location; all files remain reachable.'
    ),
    t('Umzug abbrechen', 'Cancel move'),
    () => steuern('abbrechen')
  )
}
defineExpose({ starten })
const STATUS: Record<string, [string, string, string]> = {
  laeuft: ['info', 'läuft', 'running'],
  fertig: ['ok', 'fertig', 'done'],
  pausiert: ['warn', 'pausiert', 'paused'],
  fehler: ['rot', 'angehalten', 'stopped']
}
</script>

<template>
  <section class="zu block" aria-labelledby="zu-titel">
    <div class="reihe zw">
      <h3 id="zu-titel">{{ t('Wo deine Dateien liegen', 'Where your files live') }}</h3>
      <span class="leise zu-summe">{{ dateien(gesamtAnzahl) }} · {{ groesse(gesamtBytes) }}</span>
    </div>
    <div class="zu-balken" role="img" :aria-label="eintraege.map((e) => `${e.name} ${Math.round(anteil(e))} %`).join(', ')">
      <i v-for="e in eintraege" :key="e.k" :style="{ width: anteil(e) + '%', background: e.farbe }" :title="`${e.name}: ${zahl(e.anzahl)}`"></i>
    </div>
    <ul class="zu-legende">
      <li v-for="e in eintraege" :key="e.k">
        <span class="zu-punkt" :style="{ background: e.farbe }"></span>
        <b>{{ e.name }}</b> {{ dateien(e.anzahl) }} · {{ groesse(e.bytes) }}
      </li>
    </ul>

    <div v-if="!umzug || umzug.status === 'fertig'" class="zu-start">
      <label class="zu-wahl">
        <span>{{ t('Alle Dateien umziehen nach', 'Move all files to') }}</span>
        <VdAuswahl v-model="wahl" class="eingabe" :disabled="!optionen.length">
          <option v-for="o in optionen" :key="o.k" :value="o.k">{{ o.text }} ({{ t(`${zahl(o.n)} zu verschieben`, `${zahl(o.n)} to move`) }})</option>
        </VdAuswahl>
      </label>
      <button type="button" class="knopf rot" :disabled="!gewaehlt || !gewaehlt.n || laeuft" @click="starten()">
        <Ico n="umzug" /> {{ t('Umzug starten', 'Start move') }}
      </button>
    </div>

    <div v-if="umzug" class="zu-lauf" :class="umzug.status">
      <div class="reihe zw">
        <b>{{ t('Umzug nach', 'Moving to') }} {{ name(umzug.ziel) }}</b>
        <span class="chip" :class="STATUS[umzug.status]?.[0]">
          <Ico v-if="umzug.status === 'laeuft'" n="loader" spin /><Ico v-else-if="umzug.status === 'fertig'" n="check" /><Ico v-else-if="umzug.status === 'pausiert'" n="pause" /><Ico v-else n="alert" />
          {{ t(STATUS[umzug.status]?.[1] || umzug.status, STATUS[umzug.status]?.[2] || umzug.status) }}
        </span>
      </div>
      <div class="zu-fortschritt" role="progressbar" :aria-valuenow="Math.round(prozent)" aria-valuemin="0" aria-valuemax="100">
        <i :style="{ width: prozent + '%' }" :class="{ laeuft }"></i>
      </div>
      <div class="reihe zw zu-klein">
        <span class="zu-zahl"
          >{{ zahl(umzug.erledigt) }} / {{ zahl(umzug.gesamt) }} · {{ groesse(umzug.bytes)
          }}<template v-if="umzug.fehler"> · <span class="zu-rot">{{ zahl(umzug.fehler) }} {{ t('fehlgeschlagen', 'failed') }}</span></template></span
        >
        <span class="reihe">
          <button v-if="laeuft" type="button" class="knopf klein" @click="steuern('pausieren')"><Ico n="pause" /> {{ t('Pausieren', 'Pause') }}</button>
          <button v-if="umzug.status === 'pausiert' || umzug.status === 'fehler'" type="button" class="knopf klein" @click="steuern('fortsetzen')">
            <Ico n="play" /> {{ t('Fortsetzen', 'Resume') }}
          </button>
          <button v-if="umzug.status !== 'fertig'" type="button" class="knopf klein gefahr" @click="abbrechen"><Ico n="x" /> {{ t('Abbrechen', 'Cancel') }}</button>
          <button v-else type="button" class="knopf klein" @click="steuern('verwerfen')"><Ico n="x" /> {{ t('Ausblenden', 'Dismiss') }}</button>
        </span>
      </div>
      <p v-if="umzug.meldung" class="meldung meldung-fehler zu-meld" role="alert">{{ umzug.meldung }}</p>
      <ul v-if="umzug.letzte?.length" class="zu-letzte mono">
        <li v-for="(z, i) in umzug.letzte.slice(0, 6)" :key="i + z.t" :class="{ f: !z.ok }"><Ico :n="z.ok ? 'check' : 'x'" /> {{ z.t }}</li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.zu h3 {
  margin: 0;
}
.zu-summe {
  font-size: 12.5px;
}
.zu-balken {
  display: flex;
  height: 10px;
  border-radius: 99px;
  overflow: hidden;
  background: var(--flaeche2);
  margin: 14px 0 10px;
  gap: 2px;
}
.zu-balken i {
  display: block;
  height: 100%;
  min-width: 3px;
  transition: width 0.8s var(--kurve);
}
.zu-legende {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 22px;
  font-size: 13px;
  color: var(--text2);
}
.zu-legende b {
  color: var(--text);
  margin-right: 4px;
}
.zu-punkt {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 3px;
  margin-right: 7px;
}
.zu-start {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--linie);
}
.zu-wahl {
  flex: 1 1 260px;
  display: block;
}
.zu-wahl > span {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text2);
  margin-bottom: 6px;
}
.zu-lauf {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--linie);
}
.zu-fortschritt {
  height: 8px;
  border-radius: 99px;
  background: var(--flaeche2);
  overflow: hidden;
  margin: 10px 0 8px;
}
.zu-fortschritt i {
  display: block;
  height: 100%;
  background: var(--a);
  border-radius: 99px;
  transition: width 0.6s var(--kurve);
  position: relative;
  overflow: hidden;
}
.zu-lauf.fertig .zu-fortschritt i {
  background: var(--ok);
}
.zu-lauf.fehler .zu-fortschritt i {
  background: var(--rot);
}
.zu-fortschritt i.laeuft::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.35), transparent);
  animation: zu-glanz 1.4s linear infinite;
}
@keyframes zu-glanz {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(100%);
  }
}
.zu-klein {
  font-size: 12.5px;
}
.zu-rot {
  color: var(--rot);
}
.zu-meld {
  margin: 10px 0 0;
}
.zu-letzte {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  font-size: 11.5px;
  color: var(--text3);
  display: grid;
  gap: 3px;
}
.zu-letzte li {
  display: flex;
  gap: 6px;
  align-items: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zu-letzte li svg {
  width: 11px;
  height: 11px;
  flex-shrink: 0;
  color: var(--ok);
}
.zu-letzte li.f,
.zu-letzte li.f svg {
  color: var(--rot);
}
</style>
