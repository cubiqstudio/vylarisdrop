<script setup lang="ts">
useHead({ title: () => t('Upload-Werkzeuge', 'Upload tools') })
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const { data, refresh } = await (useFetch as any)('/api/tokens', { key: 'tokens' })
const tokens = computed<any[]>(() => data.value?.tokens || [])
const ablauf = ref('')
const stil = ref('')
const ergebnis = ref<{ tool: string; inhalt: string; dateiname?: string } | null>(null)
const laeuft = ref('')

async function erzeugen(tool: 'sharex' | 'flameshot' | 'curl') {
  laeuft.value = tool
  try {
    const r = await api(`/api/config/${tool}`, {
      method: 'POST',
      body: { ablauf: ablauf.value, stil: stil.value || undefined }
    })
    if (r.dateiname) {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([r.inhalt], { type: r.typ }))
      a.download = r.dateiname
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    }
    ergebnis.value = { tool, inhalt: r.inhalt, dateiname: r.dateiname }
    await refresh()
    ok(
      tool === 'sharex'
        ? t(
            'Konfiguration heruntergeladen — Doppelklick importiert sie in ShareX',
            'Configuration downloaded — double-click imports it into ShareX'
          )
        : t('Bereit', 'Ready')
    )
  } catch (e: any) {
    fehler(e.message)
  } finally {
    laeuft.value = ''
  }
}
const neuName = ref('')
const neuKlar = ref('')
const neuRechte = ref<string[]>(['upload'])
const RECHTE = computed(() => [
  { k: 'upload', text: t('Hochladen', 'Upload'), info: t('ShareX, Flameshot, curl', 'ShareX, Flameshot, curl') },
  {
    k: 'lesen',
    text: t('Lesen', 'Read'),
    info: t('Dateien, Ordner, Statistik abrufen', 'Fetch files, folders, statistics')
  },
  {
    k: 'verwalten',
    text: t('Verwalten', 'Manage'),
    info: t('Ändern, löschen, Ordner anlegen', 'Edit, delete, create folders')
  }
])
function rechtUm(k: string) {
  neuRechte.value = neuRechte.value.includes(k) ? neuRechte.value.filter((x) => x !== k) : [...neuRechte.value, k]
}
const rechtName = (k: string) => RECHTE.value.find((r) => r.k === k)?.text || k
async function tokenNeu() {
  try {
    const r = await api('/api/tokens', { method: 'POST', body: { name: neuName.value, rechte: neuRechte.value } })
    neuKlar.value = r.klar
    neuName.value = ''
    neuRechte.value = ['upload']
    await refresh()
  } catch (e: any) {
    fehler(e.message)
  }
}
function widerrufen(x: any) {
  bestaetigen(
    t('Token widerrufen?', 'Revoke token?'),
    t(
      `Werkzeuge mit „${x.name}“ können danach nicht mehr hochladen.`,
      `Tools using “${x.name}” will no longer be able to upload.`
    ),
    t('Widerrufen', 'Revoke'),
    async () => {
      try {
        await api(`/api/tokens/${x.id}`, { method: 'DELETE' })
        await refresh()
        ok(t('Widerrufen', 'Revoked'))
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}
const kopiert = ref(false)
async function kopie(s: string) {
  if (await kopieren(s)) {
    kopiert.value = true
    setTimeout(() => {
      kopiert.value = false
    }, 1500)
  }
}
const WERKZEUGE = computed(() => [
  {
    id: 'sharex' as const,
    ic: 'download',
    titel: 'ShareX',
    text: t(
      'Windows: Bildschirmfotos, Videos und Dateien direkt hochladen. Die .sxcu-Datei per Doppelklick importieren.',
      'Windows: upload screenshots, videos and files directly. Import the .sxcu file with a double-click.'
    )
  },
  {
    id: 'flameshot' as const,
    ic: 'camera',
    titel: 'Flameshot',
    text: t(
      'Linux: Bereich aufnehmen, hochladen, Link landet in der Zwischenablage. Skript auf eine Tastenkombination legen.',
      'Linux: capture an area, upload, link goes to the clipboard. Bind the script to a hotkey.'
    )
  },
  {
    id: 'curl' as const,
    ic: 'terminal',
    titel: 'curl',
    text: t(
      'Für Skripte, Server und Automatisierung — ein Befehl, die Antwort ist der Link.',
      'For scripts, servers and automation — one command, the response is the link.'
    )
  }
])
</script>

<template>
  <section class="rein">
    <div class="kopf"><div><div class="eyebrow"><Ico n="upload" /> {{ t('Verwaltung', 'Manage') }}</div><h1>{{ t('Upload-Werkzeuge', 'Upload tools') }}</h1><p>{{ t('Verbinde deine Screenshot-Tools — jede Konfiguration bekommt ein eigenes Token.', 'Connect your screenshot tools — each configuration gets its own token.') }}</p></div></div>
    <div class="block optionen">
      <label class="feld"><span>{{ t('Ablauf für Uploads', 'Expiry for uploads') }}</span>
        <VdAuswahl v-model="ablauf" class="eingabe"><option value="">{{ t('Nie', 'Never') }}</option><option value="1h">{{ t('1 Stunde', '1 hour') }}</option><option value="1d">{{ t('1 Tag', '1 day') }}</option><option value="7d">{{ t('7 Tage', '7 days') }}</option><option value="30d">{{ t('30 Tage', '30 days') }}</option></VdAuswahl></label>
      <label class="feld"><span>{{ t('Link-Stil', 'Link style') }}</span>
        <VdAuswahl v-model="stil" class="eingabe"><option value="">{{ t('Wie in den Einstellungen', 'As in settings') }}</option><option value="zufall">{{ t('Zufall (kX9q2Rb)', 'Random (kX9q2Rb)') }}</option><option value="woerter">{{ t('Wörter (ruhiger-falke-sieben)', 'Words (calm-falcon-seven)') }}</option><option value="datum">{{ t('Datum', 'Date') }}</option><option value="original">{{ t('Dateiname', 'File name') }}</option><option value="uuid">UUID</option><option value="unsichtbar">{{ t('Unsichtbar', 'Invisible') }}</option></VdAuswahl></label>
    </div>
    <div class="werkzeuge">
      <div v-for="(w, i) in WERKZEUGE" :key="w.id" class="werkzeug" :style="{ animationDelay: i * 70 + 'ms' }">
        <span class="w-ic"><Ico :n="w.ic" /></span>
        <h3>{{ w.titel }}</h3>
        <p class="leise">{{ w.text }}</p>
        <button class="knopf rot" :disabled="!!laeuft" @click="erzeugen(w.id)"><Ico :n="laeuft === w.id ? 'loader' : w.id === 'curl' ? 'code' : 'download'" :spin="laeuft === w.id" /> {{ w.id === 'curl' ? t('Befehl erzeugen', 'Generate command') : t('Herunterladen', 'Download') }}</button>
      </div>
    </div>
    <Transition name="aufklappen">
      <div v-if="ergebnis && !ergebnis.dateiname" class="block ergebnis">
        <div class="reihe zw"><b>{{ t('Dein Befehl', 'Your command') }}</b><button class="knopf klein" @click="kopie(ergebnis.inhalt)"><Ico :n="kopiert ? 'check' : 'copy'" /> {{ kopiert ? t('Kopiert', 'Copied') : t('Kopieren', 'Copy') }}</button></div>
        <pre class="mono">{{ ergebnis.inhalt }}</pre>
        <p class="sehrleise">{{ t('DATEI durch den Pfad ersetzen. Das Token im Befehl ist geheim — wie ein Passwort.', 'Replace DATEI with the path. The token in the command is secret — like a password.') }}</p>
      </div>
    </Transition>

    <h2 class="abschnitt">{{ t('Token', 'Tokens') }} <NuxtLink to="/api-doku" class="knopf klein doku-link"><Ico n="code" /> {{ t('API-Doku', 'API docs') }}</NuxtLink></h2>
    <form class="block token-form" @submit.prevent="tokenNeu">
      <div class="reihe">
        <input v-model="neuName" class="eingabe" style="flex:1;min-width:200px" :placeholder="t('Name, z. B. „Server-Backup“', 'Name, e.g. “server backup”')" maxlength="60">
        <button class="knopf" :disabled="!neuRechte.length"><Ico n="plus" /> {{ t('Neues Token', 'New token') }}</button>
      </div>
      <div class="rechte" role="group" :aria-label="t('Rechte', 'Permissions')">
        <button v-for="r in RECHTE" :key="r.k" type="button" :class="{ an: neuRechte.includes(r.k) }" :aria-pressed="neuRechte.includes(r.k)" @click="rechtUm(r.k)">
          <Ico :n="neuRechte.includes(r.k) ? 'check' : 'plus'" /><span><b>{{ r.text }}</b><small>{{ r.info }}</small></span>
        </button>
      </div>
    </form>
    <div v-if="neuKlar" class="block geheim">
      <b>{{ t('Dein neues Token — nur jetzt sichtbar:', 'Your new token — visible only now:') }}</b>
      <div class="reihe"><code class="mono">{{ neuKlar }}</code><button class="knopf klein" @click="kopie(neuKlar)"><Ico :n="kopiert ? 'check' : 'copy'" /></button></div>
      <p class="sehrleise">{{ t('Senden als Header „Authorization: Bearer vd_…“ — an /api/upload oder die API v1.', 'Send as header “Authorization: Bearer vd_…” — to /api/upload or the API v1.') }}</p>
    </div>
    <div class="liste">
      <div v-for="x in tokens" :key="x.id" class="zeile">
        <span class="ic"><Ico n="key" /></span>
        <div style="flex:1;min-width:0"><b>{{ x.name }}</b> <span v-for="r in (x.rechte || ['upload'])" :key="r" class="chip neutral recht">{{ rechtName(r) }}</span><div class="sehrleise klein"><span class="mono">{{ x.prefix }}…</span> · {{ t('angelegt', 'created') }} {{ datum(x.created_at) }} · {{ x.last_used_at ? t(`zuletzt ${vorher(x.last_used_at)}`, `last used ${vorher(x.last_used_at)}`) : t('noch nie benutzt', 'never used') }}</div></div>
        <button class="knopf klein gefahr" @click="widerrufen(x)">{{ t('Widerrufen', 'Revoke') }}</button>
      </div>
      <p v-if="!tokens.length" class="sehrleise">{{ t('Noch keine Token.', 'No tokens yet.') }}</p>
    </div>
  </section>
</template>

<style scoped>
.optionen {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 14px;
  margin-bottom: 14px;
}
.optionen .feld {
  margin: 0;
}
.werkzeuge {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
}
.werkzeug {
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 16px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
  animation: rein 0.55s var(--kurve) backwards;
  transition:
    transform 0.3s var(--kurve),
    border-color 0.2s;
}
.werkzeug:hover {
  transform: translateY(-3px);
  border-color: var(--linie2);
}
.werkzeug h3 {
  font-family: var(--f-display);
  font-size: 20px;
  letter-spacing: -0.02em;
}
.werkzeug p {
  margin: 0 0 6px;
  font-size: 13px;
  flex: 1;
}
.w-ic {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: rgba(var(--a-rgb), 0.1);
  color: var(--a);
  display: grid;
  place-items: center;
  transition: transform 0.4s cubic-bezier(0.2, 0.9, 0.2, 1.4);
}
.w-ic svg {
  width: 20px;
  height: 20px;
}
.werkzeug:hover .w-ic {
  transform: rotate(-8deg) scale(1.08);
}
.ergebnis {
  margin-top: 14px;
}
.ergebnis pre {
  background: var(--bg);
  border: 1px solid var(--linie);
  border-radius: 10px;
  padding: 12px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 10px 0 6px;
}
.abschnitt {
  font-family: var(--f-display);
  font-size: 22px;
  letter-spacing: -0.02em;
  margin: 30px 0 12px;
}
.geheim {
  border-color: rgba(var(--a-rgb), 0.4);
  background: rgba(var(--a-rgb), 0.04);
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.geheim code {
  font-size: 13px;
  word-break: break-all;
}
.liste {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.zeile {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 12px;
  padding: 10px 12px;
  animation: rein 0.4s var(--kurve) backwards;
}
.ic {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--flaeche2);
  color: var(--text2);
  display: grid;
  place-items: center;
}
.ic svg {
  width: 15px;
  height: 15px;
}
.klein {
  font-size: 12px;
}
.doku-link {
  margin-left: 10px;
  vertical-align: middle;
  font-family: var(--f-body, inherit);
  letter-spacing: 0;
}
.token-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.rechte {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.rechte button {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  text-align: left;
  border: 1.5px solid var(--linie);
  background: var(--bg);
  border-radius: 11px;
  padding: 9px 11px;
  cursor: pointer;
  font: inherit;
  color: var(--text);
  transition:
    border-color 0.2s,
    background 0.2s;
}
.rechte button.an {
  border-color: var(--a);
  background: rgba(var(--a-rgb), 0.06);
}
.rechte button svg {
  width: 14px;
  height: 14px;
  margin-top: 2px;
  flex-shrink: 0;
  color: var(--text3);
}
.rechte button.an svg {
  color: var(--a);
}
.rechte span {
  display: flex;
  flex-direction: column;
  font-size: 13px;
}
.rechte small {
  color: var(--text3);
  font-size: 11.5px;
}
.recht {
  font-size: 10.5px;
  padding: 2px 7px;
  margin-left: 4px;
  vertical-align: 1px;
}
@media (max-width: 640px) {
  .rechte {
    grid-template-columns: 1fr;
  }
}
.aufklappen-enter-active {
  transition:
    opacity 0.35s,
    transform 0.4s var(--kurve);
}
.aufklappen-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
@media (max-width: 640px) {
  .optionen {
    grid-template-columns: 1fr;
  }
}
</style>
