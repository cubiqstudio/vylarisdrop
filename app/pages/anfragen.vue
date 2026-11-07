<script setup lang="ts">
useHead({ title: () => t('Datei-Anfragen', 'File requests') })
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const { data, refresh } = await (useFetch as any)('/api/anfragen', { key: 'anfragen' })
const { data: ordnerDaten } = await (useFetch as any)('/api/folders', { key: 'ordner' })
const anfragen = computed<any[]>(() => data.value?.anfragen || [])
const ordner = computed<any[]>(() => ordnerDaten.value?.ordner || [])

const neu = reactive({
  offen: false,
  titel: '',
  nachricht: '',
  ordner: null as number | null,
  max_mb: '',
  max_dateien: '',
  ablauf: '7d',
  passwort: '',
  aufnahme: true,
  aufnahme_min: 5
})
const laeuft = ref(false)
async function anlegen() {
  laeuft.value = true
  try {
    await api('/api/anfragen', {
      method: 'POST',
      body: {
        aufnahme: neu.aufnahme,
        aufnahme_min: neu.aufnahme_min,
        titel: neu.titel,
        nachricht: neu.nachricht,
        ordner: neu.ordner,
        max_mb: neu.max_mb ? Number(neu.max_mb) : null,
        max_dateien: neu.max_dateien ? Number(neu.max_dateien) : null,
        ablauf: neu.ablauf || null,
        passwort: neu.passwort || undefined
      }
    })
    Object.assign(neu, {
      offen: false,
      titel: '',
      nachricht: '',
      ordner: null,
      max_mb: '',
      max_dateien: '',
      ablauf: '7d',
      passwort: '',
      aufnahme: true,
      aufnahme_min: 5
    })
    await refresh()
    ok(t('Anfrage erstellt — Link kopieren und verschicken', 'Request created — copy and send the link'))
  } catch (e: any) {
    fehler(e.message)
  } finally {
    laeuft.value = false
  }
}
const eingang = ref<Record<number, any[]>>({})
const eingangAuf = ref<number | null>(null)
async function eingangZeigen(a: any) {
  if (eingangAuf.value === a.id) {
    eingangAuf.value = null
    return
  }
  eingangAuf.value = a.id
  try {
    const r: any = await api(`/api/anfragen/${a.id}/eingang`)
    eingang.value = { ...eingang.value, [a.id]: r.dateien }
  } catch (e: any) {
    fehler(e.message)
  }
}
async function aufnahmeAendern(a: any, wert: Record<string, unknown>) {
  try {
    await api(`/api/anfragen/${a.id}`, { method: 'PATCH', body: wert })
    await refresh()
  } catch (e: any) {
    fehler(e.message)
  }
}
const MINUTEN = [1, 5, 15, 30]
async function umschalten(a: any) {
  try {
    await api(`/api/anfragen/${a.id}`, { method: 'PATCH', body: { aktiv: !a.aktiv } })
    await refresh()
  } catch (e: any) {
    fehler(e.message)
  }
}
function loeschen(a: any) {
  bestaetigen(
    t('Anfrage entfernen?', 'Remove request?'),
    t(
      `Der Link für „${a.titel}“ funktioniert danach nicht mehr. Bereits hochgeladene Dateien bleiben im Ordner.`,
      `The link for “${a.titel}” will stop working. Files already uploaded stay in the folder.`
    ),
    t('Entfernen', 'Remove'),
    async () => {
      try {
        await api(`/api/anfragen/${a.id}`, { method: 'DELETE' })
        await refresh()
        ok(t('Entfernt', 'Removed'))
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}
const kopiert = ref(0)
async function kopie(a: any) {
  if (await kopieren(a.link)) {
    kopiert.value = a.id
    setTimeout(() => {
      if (kopiert.value === a.id) kopiert.value = 0
    }, 1500)
  }
}
const status = (a: any) =>
  a.offen
    ? { text: t('Offen', 'Open'), k: 'ok' }
    : a.grund === 'voll'
      ? { text: t('Voll', 'Full'), k: 'warn' }
      : a.grund === 'abgelaufen'
        ? { text: t('Abgelaufen', 'Expired'), k: 'neutral' }
        : { text: t('Geschlossen', 'Closed'), k: 'neutral' }
</script>

<template>
  <section class="rein">
    <div class="kopf">
      <div><div class="eyebrow"><Ico n="mail" /> {{ t('Bibliothek', 'Library') }}</div><h1>{{ t('Datei-Anfragen', 'File requests') }}</h1><p>{{ t('Schick einen Link — andere legen Dateien ohne Konto direkt in deinen Ordner.', 'Send a link — others drop files into your folder without an account.') }}</p></div>
      <button class="knopf rot" @click="neu.offen = true"><Ico n="plus" /> {{ t('Anfrage erstellen', 'Create request') }}</button>
    </div>

    <div v-if="anfragen.length" class="liste">
      <div v-for="(a, i) in anfragen" :key="a.id" class="anfrage" :class="{ zu: !a.offen }" :style="{ animationDelay: Math.min(i, 12) * 45 + 'ms' }">
        <div class="kopfzeile">
          <span class="ic"><Ico n="mail" /></span>
          <div class="wer"><b>{{ a.titel }}</b><small>{{ t('Ordner', 'Folder') }} „{{ a.ordner || '—' }}“ · {{ t('erstellt', 'created') }} {{ datum(a.created_at) }}</small></div>
          <span :class="['chip', status(a).k]">{{ status(a).text }}</span>
        </div>
        <div class="werte">
          <div><small>{{ t('Hochgeladen', 'Uploaded') }}</small><b class="zahl">{{ zahl(a.anzahl) }}<template v-if="a.max_dateien"> / {{ zahl(a.max_dateien) }}</template></b>
            <div v-if="a.max_dateien" class="balken"><i :style="{ width: Math.min(100, a.anzahl / a.max_dateien * 100) + '%' }"></i></div></div>
          <div><small>{{ t('Je Datei', 'Per file') }}</small><b>{{ a.max_bytes ? groesse(a.max_bytes) : t('ohne Grenze', 'no limit') }}</b></div>
          <div><small>{{ t('Frist', 'Deadline') }}</small><b>{{ a.laeuft_ab ? restzeit(a.laeuft_ab) : t('keine', 'none') }}</b></div>
          <div><small>{{ t('Schutz', 'Protection') }}</small><b>{{ a.passwort ? t('Passwort', 'Password') : t('nur Link', 'link only') }}</b></div>
        </div>
        <div class="linkzeile">
          <code class="mono">{{ a.link.replace(/^https?:\/\//, '') }}</code>
          <button class="knopf klein" :class="{ kopiert: kopiert === a.id }" @click="kopie(a)"><Ico :n="kopiert === a.id ? 'check' : 'copy'" /> {{ kopiert === a.id ? t('Kopiert', 'Copied') : t('Link kopieren', 'Copy link') }}</button>
          <button v-if="a.anzahl" class="knopf klein" :aria-expanded="eingangAuf === a.id" @click="eingangZeigen(a)"><Ico n="mic" /> {{ t('Eingang', 'Inbox') }}</button>
          <NuxtLink v-if="a.folder_id" :to="{ path: '/', query: { ordner: a.folder_id } }" class="knopf klein"><Ico n="folder" /> {{ t('Dateien ansehen', 'View files') }}</NuxtLink>
          <button class="knopf klein" @click="umschalten(a)">{{ a.aktiv ? t('Schließen', 'Close') : t('Wieder öffnen', 'Reopen') }}</button>
          <button class="knopf nur-icon" :aria-label="t('Entfernen', 'Remove')" @click="loeschen(a)"><Ico n="trash" /></button>
        </div>
        <div class="aufn-zeile">
          <button type="button" class="schalter" role="switch" :class="{ an: a.aufnahme }" :aria-checked="a.aufnahme" :aria-label="t('Aufnahme erlauben', 'Allow recording')" @click="aufnahmeAendern(a, { aufnahme: !a.aufnahme })"></button>
          <span>{{ t('Gäste dürfen Sprache und Video direkt aufnehmen', 'Guests may record voice and video directly') }}</span>
          <VdAuswahl v-if="a.aufnahme" :model-value="a.aufnahme_min" class="eingabe min" :aria-label="t('Höchstlänge', 'Maximum length')" @change="aufnahmeAendern(a, { aufnahme_min: Number($event) })"><option v-for="m in MINUTEN" :key="m" :value="m">{{ t(`bis ${m} Min.`, `up to ${m} min`) }}</option></VdAuswahl>
        </div>
        <div v-if="eingangAuf === a.id" class="eingang">
          <p v-if="!eingang[a.id]" class="leise"><Ico n="loader" spin /> {{ t('Lädt …', 'Loading …') }}</p>
          <p v-else-if="!eingang[a.id]!.length" class="leise">{{ t('Noch nichts eingegangen.', 'Nothing received yet.') }}</p>
          <div v-for="d in eingang[a.id]" :key="d.id" class="ein">
            <div class="ein-kopf"><b>{{ d.name }}</b><small><template v-if="d.von_gast">{{ d.von_gast }} · </template>{{ datum(d.created_at) }} · {{ groesse(d.size) }}</small></div>
            <p v-if="d.notiz" class="ein-notiz">{{ d.notiz }}</p>
            <VdAudio v-if="d.art === 'audio'" :src="d.links.direkt" :wellen="d.wellen" :dauer-ms="d.duration_ms" klein />
            <video v-else-if="d.art === 'video'" :src="d.links.direkt" controls preload="metadata" playsinline class="ein-video"></video>
            <a v-else class="knopf klein" :href="d.links.seite" target="_blank" rel="noopener"><Ico n="link" /> {{ t('Öffnen', 'Open') }}</a>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="leer block">
      <div class="stapel" aria-hidden="true"><span class="blatt" style="--b:0;--w:-7deg"></span><span class="blatt" style="--b:1;--w:5deg"></span><span class="blatt" style="--b:2;--w:-2deg"><Ico n="upload" /></span></div>
      <div>
        <h2>{{ t('Noch keine Anfrage offen', 'No open requests yet') }}</h2>
        <p class="leise">{{ t('Ideal nach einer Feier, für Kunden-Material oder Bewerbungen: Du legst Ordner, Höchstgröße und Frist fest, die Gäste sehen nur ihr eigenes Hochladen.', 'Great after a party, for client material or applications: you set the folder, size limit and deadline; guests only see their own upload.') }}</p>
        <button class="knopf rot" style="margin-top:14px" @click="neu.offen = true"><Ico n="plus" /> {{ t('Erste Anfrage erstellen', 'Create first request') }}</button>
      </div>
    </div>

    <VdModal v-if="neu.offen" :titel="t('Neue Datei-Anfrage', 'New file request')" @zu="neu.offen = false">
      <form @submit.prevent="anlegen">
        <label class="feld"><span>{{ t('Titel', 'Title') }}</span><input v-model="neu.titel" class="eingabe" maxlength="100" required :placeholder="t('z. B. Hochzeit Anna & Ben', 'e.g. Anna & Ben’s wedding')"></label>
        <label class="feld"><span>{{ t('Nachricht an die Gäste (optional)', 'Message to guests (optional)') }}</span><textarea v-model="neu.nachricht" class="eingabe" rows="2" maxlength="1000"></textarea></label>
        <label class="feld"><span>{{ t('Zielordner', 'Target folder') }}</span><VdAuswahl v-model="neu.ordner" class="eingabe"><option :value="null">{{ t('Neuer Ordner mit dem Titel', 'New folder named after the title') }}</option><option v-for="o in ordner" :key="o.id" :value="o.id">{{ o.name }}</option></VdAuswahl></label>
        <div class="drei">
          <label class="feld"><span>{{ t('Max. MB je Datei', 'Max MB per file') }}</span><input v-model="neu.max_mb" class="eingabe" type="number" min="1" :placeholder="t('ohne', 'none')"></label>
          <label class="feld"><span>{{ t('Max. Dateien', 'Max files') }}</span><input v-model="neu.max_dateien" class="eingabe" type="number" min="1" :placeholder="t('ohne', 'none')"></label>
          <label class="feld"><span>{{ t('Offen für', 'Open for') }}</span><VdAuswahl v-model="neu.ablauf" class="eingabe"><option value="1d">{{ t('1 Tag', '1 day') }}</option><option value="7d">{{ t('7 Tage', '7 days') }}</option><option value="30d">{{ t('30 Tage', '30 days') }}</option><option value="">{{ t('unbegrenzt', 'unlimited') }}</option></VdAuswahl></label>
        </div>
        <label class="feld"><span>{{ t('Passwort (optional)', 'Password (optional)') }}</span><input v-model="neu.passwort" class="eingabe" type="password" autocomplete="new-password"></label>
        <div class="aufn-zeile im-modal">
          <button type="button" class="schalter" role="switch" :class="{ an: neu.aufnahme }" :aria-checked="neu.aufnahme" :aria-label="t('Aufnahme erlauben', 'Allow recording')" @click="neu.aufnahme = !neu.aufnahme"></button>
          <span>{{ t('Gäste dürfen Sprache und Video direkt aufnehmen', 'Guests may record voice and video directly') }}</span>
          <VdAuswahl v-if="neu.aufnahme" v-model="neu.aufnahme_min" class="eingabe min" :aria-label="t('Höchstlänge', 'Maximum length')"><option v-for="m in MINUTEN" :key="m" :value="m">{{ t(`bis ${m} Min.`, `up to ${m} min`) }}</option></VdAuswahl>
        </div>
        <div class="modal-fuss"><button type="button" class="knopf" @click="neu.offen = false">{{ t('Abbrechen', 'Cancel') }}</button><button class="knopf rot" :disabled="laeuft"><Ico v-if="laeuft" n="loader" spin />{{ t('Erstellen', 'Create') }}</button></div>
      </form>
    </VdModal>
  </section>
</template>

<style scoped>
.aufn-zeile {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 12px;
  align-items: center;
  font-size: 13px;
  color: var(--text2);
  padding-top: 10px;
  border-top: 1px solid var(--linie);
}
.aufn-zeile > span {
  flex: 1;
  min-width: 180px;
}
.aufn-zeile .schalter {
  flex: none;
}
.aufn-zeile .min {
  width: auto;
  padding: 6px 10px;
  font-size: 13px;
}
.aufn-zeile.im-modal {
  border-top: 0;
  padding-top: 0;
  margin-bottom: 14px;
}
.eingang {
  display: grid;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--linie);
}
.eingang p {
  margin: 0;
}
.ein {
  display: grid;
  gap: 8px;
  background: var(--bg);
  border: 1px solid var(--linie);
  border-radius: 12px;
  padding: 12px;
  min-width: 0;
}
.ein-kopf b {
  display: block;
  font-size: 13.5px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.ein-kopf small {
  color: var(--text3);
  font-size: 12px;
}
.ein-notiz {
  font-size: 13.5px;
  color: var(--text2);
  white-space: pre-line;
  border-left: 3px solid var(--a);
  padding-left: 10px;
  overflow-wrap: anywhere;
}
.ein-video {
  width: 100%;
  max-height: 320px;
  border-radius: 10px;
  background: #000;
}
.ein .knopf {
  justify-self: start;
}
.liste {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.anfrage {
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 16px;
  padding: 16px 18px;
  animation: rein 0.5s var(--kurve) backwards;
  transition:
    opacity 0.3s,
    border-color 0.2s;
}
.anfrage:hover {
  border-color: var(--linie2);
}
.anfrage.zu {
  opacity: 0.72;
}
.kopfzeile {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ic {
  width: 40px;
  height: 40px;
  border-radius: 11px;
  background: rgba(var(--a-rgb), 0.1);
  color: var(--a);
  display: grid;
  place-items: center;
}
.ic svg {
  width: 17px;
  height: 17px;
}
.wer {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.wer b {
  font-size: 15px;
}
.wer small {
  color: var(--text3);
  font-size: 12px;
}
.werte {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin: 14px 0;
}
.werte div {
  background: var(--bg);
  border-radius: 10px;
  padding: 9px 12px;
}
.werte small {
  display: block;
  color: var(--text3);
  font-size: 11px;
}
.werte b {
  font-size: 13.5px;
  font-weight: 600;
}
.balken {
  height: 4px;
  border-radius: 99px;
  background: var(--flaeche2);
  margin-top: 6px;
  overflow: hidden;
}
.balken i {
  display: block;
  height: 100%;
  background: var(--a);
  border-radius: 99px;
  transform-origin: left;
  animation: wachsen 1s 0.2s var(--kurve) both;
}
.linkzeile {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.linkzeile code {
  flex: 1;
  min-width: 200px;
  font-size: 12.5px;
  background: var(--bg);
  border: 1.5px dashed rgba(var(--a-rgb), 0.4);
  border-radius: 10px;
  padding: 8px 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.knopf.kopiert {
  background: var(--ok-bg);
  color: var(--ok);
  border-color: transparent;
}
.leer {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 30px;
  align-items: center;
  padding: 34px;
}
.leer h2 {
  font-family: var(--f-display);
  font-size: 24px;
  letter-spacing: -0.03em;
  margin-bottom: 6px;
}
.leer p {
  margin: 0;
  max-width: 46ch;
}
.stapel {
  position: relative;
  height: 200px;
}
.blatt {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 140px;
  height: 170px;
  margin: -85px 0 0 -70px;
  border-radius: 14px;
  background: var(--flaeche2);
  border: 1px solid var(--linie2);
  box-shadow: 0 18px 40px -18px rgba(0, 0, 0, 0.45);
  display: grid;
  place-items: center;
  color: var(--a);
  animation:
    blattFallen 0.9s cubic-bezier(0.3, 1.3, 0.4, 1) both,
    schweben 5s ease-in-out infinite;
  animation-delay: calc(0.2s + var(--b) * 0.25s), calc(1.3s + var(--b) * 0.7s);
}
.blatt:nth-child(1) {
  margin-left: -100px;
}
.blatt:nth-child(3) {
  margin-left: -45px;
  margin-top: -75px;
  background: var(--flaeche);
}
.blatt svg {
  width: 30px;
  height: 30px;
}
@keyframes blattFallen {
  from {
    transform: translateY(-110px) rotate(calc(var(--w) * 3)) scale(0.9);
    opacity: 0;
  }
  to {
    transform: rotate(var(--w));
    opacity: 1;
  }
}
@keyframes schweben {
  0%,
  100% {
    transform: translateY(0) rotate(var(--w));
  }
  50% {
    transform: translateY(-7px) rotate(calc(var(--w) * 1.25));
  }
}
.drei {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
textarea.eingabe {
  resize: vertical;
}
@media (max-width: 760px) {
  .werte,
  .drei {
    grid-template-columns: 1fr 1fr;
  }
  .leer {
    grid-template-columns: 1fr;
  }
}
</style>
