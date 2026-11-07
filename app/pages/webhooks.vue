<script setup lang="ts">
useHead({ title: () => 'Webhooks' })
const theme = useTheme()
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const { data, refresh } = await (useFetch as any)('/api/webhooks', { key: 'webhooks' })
const hooks = computed<any[]>(() => data.value?.webhooks || [])
const istInhaber = computed(() => theme.value.user?.role === 'owner')

const TEXT = computed<Record<string, string>>(() => ({
  'file.uploaded': t('Datei hochgeladen', 'File uploaded'),
  'file.deleted': t('In den Papierkorb', 'Moved to trash'),
  'file.restored': t('Wiederhergestellt', 'Restored'),
  'request.uploaded': t('Datei-Anfrage erhalten', 'File request received'),
  'virus.found': t('Virenfund', 'Malware found'),
  'rule.applied': t('Speicher-Regel lief', 'Storage rule ran'),
  ping: 'Test'
}))

const form = ref<any>(null)
function neu() {
  form.value = { id: null, name: '', url: '', ereignisse: ['file.uploaded'] }
}
function bearbeiten(h: any) {
  form.value = { id: h.id, name: h.name, url: h.url, ereignisse: [...h.ereignisse] }
}
function ereignisUm(e: string) {
  const f = form.value
  f.ereignisse = f.ereignisse.includes(e) ? f.ereignisse.filter((x: string) => x !== e) : [...f.ereignisse, e]
}
const laeuft = ref(false)
async function speichern() {
  const f = form.value
  laeuft.value = true
  try {
    if (f.id)
      await api(`/api/webhooks/${f.id}`, {
        method: 'PATCH',
        body: { name: f.name, url: f.url, ereignisse: f.ereignisse }
      })
    else await api('/api/webhooks', { method: 'POST', body: { name: f.name, url: f.url, ereignisse: f.ereignisse } })
    form.value = null
    await refresh()
    ok(t('Gespeichert', 'Saved'))
  } catch (e: any) {
    fehler(e.message)
  } finally {
    laeuft.value = false
  }
}
async function umschalten(h: any) {
  try {
    await api(`/api/webhooks/${h.id}`, { method: 'PATCH', body: { aktiv: !h.aktiv } })
    await refresh()
  } catch (e: any) {
    fehler(e.message)
  }
}
function entfernen(h: any) {
  bestaetigen(
    t('Webhook löschen?', 'Delete webhook?'),
    t(
      `„${h.name || h.url}“ bekommt danach keine Ereignisse mehr. Das Protokoll wird mit gelöscht.`,
      `“${h.name || h.url}” will receive no more events. Its log is deleted too.`
    ),
    t('Löschen', 'Delete'),
    async () => {
      try {
        await api(`/api/webhooks/${h.id}`, { method: 'DELETE' })
        await refresh()
        ok(t('Gelöscht', 'Deleted'))
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}
function neuesGeheimnis(h: any) {
  bestaetigen(
    t('Neues Geheimnis?', 'New secret?'),
    t(
      'Das alte gilt sofort nicht mehr — trage das neue bei deinem Empfänger ein.',
      'The old one stops working immediately — update your receiver with the new one.'
    ),
    t('Erneuern', 'Renew'),
    async () => {
      try {
        await api(`/api/webhooks/${h.id}`, { method: 'PATCH', body: { geheimnis_neu: true } })
        await refresh()
        ok(t('Erneuert', 'Renewed'))
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}
const zeigeGeheimnis = ref<number | null>(null)
const kopiert = ref('')
async function kopie(k: string, s: string) {
  if (await kopieren(s)) {
    kopiert.value = k
    setTimeout(() => {
      if (kopiert.value === k) kopiert.value = ''
    }, 1500)
  }
}

const testet = ref<number | null>(null)
async function testen(h: any) {
  testet.value = h.id
  try {
    const r = await api(`/api/webhooks/${h.id}/test`, { method: 'POST' })
    if (r.ok) ok(t(`Angekommen — ${r.code} in ${r.ms} ms`, `Delivered — ${r.code} in ${r.ms} ms`))
    else
      fehler(
        r.code
          ? t(`Antwort ${r.code}: ${r.antwort || 'ohne Text'}`, `Response ${r.code}: ${r.antwort || 'no text'}`)
          : r.antwort
      )
    await refresh()
  } catch (e: any) {
    fehler(e.message)
  } finally {
    testet.value = null
  }
}

const protokoll = ref<{ h: any; liste: any[] } | null>(null)
const offenId = ref<string | null>(null)
async function protokollZeigen(h: any) {
  try {
    const r = await api(`/api/webhooks/${h.id}/lieferungen`)
    protokoll.value = { h, liste: r.lieferungen }
    offenId.value = null
  } catch (e: any) {
    fehler(e.message)
  }
}
async function erneut(l: any) {
  try {
    await api(`/api/webhooks/${protokoll.value!.h.id}/erneut`, { method: 'POST', body: { lieferung: l.id } })
    ok(t('Wird erneut gesendet', 'Resending'))
    setTimeout(() => protokollZeigen(protokoll.value!.h), 1500)
  } catch (e: any) {
    fehler(e.message)
  }
}

async function internUm() {
  try {
    await api('/api/settings', { method: 'PUT', body: { webhooks: { intern: !data.value?.intern } } })
    await refresh()
    ok(t('Gespeichert', 'Saved'))
  } catch (e: any) {
    fehler(e.message)
  }
}
const zustand = (h: any) =>
  !h.aktiv
    ? {
        k: 'neutral',
        t:
          h.fehler_in_folge >= 20
            ? t('Abgeschaltet (zu viele Fehler)', 'Disabled (too many errors)')
            : t('Pausiert', 'Paused')
      }
    : h.zuletzt_status == null && !h.zuletzt_at
      ? { k: 'neutral', t: t('Noch nichts gesendet', 'Nothing sent yet') }
      : h.zuletzt_status && h.zuletzt_status < 300
        ? { k: 'ok', t: t(`Zuletzt ${h.zuletzt_status}`, `Last ${h.zuletzt_status}`) }
        : { k: 'rot', t: t(`Zuletzt ${h.zuletzt_status || 'Fehler'}`, `Last ${h.zuletzt_status || 'error'}`) }
</script>

<template>
  <section class="rein">
    <div class="kopf"><div><div class="eyebrow"><Ico n="network" /> {{ t('Verwaltung', 'Manage') }}</div><h1>Webhooks</h1>
      <p>{{ t('Andere Dienste sofort informieren, wenn bei dir etwas passiert — signiert, mit Wiederholung.', 'Notify other services the moment something happens — signed, with retries.') }}</p></div>
      <div class="reihe"><NuxtLink to="/api-doku#webhooks" class="knopf"><Ico n="code" /> {{ t('So prüfst du die Signatur', 'Verifying the signature') }}</NuxtLink><button class="knopf rot" :disabled="hooks.length >= 10" @click="neu"><Ico n="plus" /> {{ t('Webhook anlegen', 'Add webhook') }}</button></div>
    </div>

    <div v-if="!hooks.length" class="block leer">
      <span class="gross-ic"><Ico n="network" /></span>
      <h3>{{ t('Noch keine Webhooks', 'No webhooks yet') }}</h3>
      <p class="leise">{{ t('Zum Beispiel für n8n, Zapier, Make, einen eigenen Bot oder dein Backup-Skript.', 'For example for n8n, Zapier, Make, your own bot or your backup script.') }}</p>
      <button class="knopf rot" @click="neu"><Ico n="plus" /> {{ t('Ersten Webhook anlegen', 'Add your first webhook') }}</button>
    </div>

    <div class="liste">
      <article v-for="(h, i) in hooks" :key="h.id" class="block hook" :style="{ '--i': i }" :class="{ aus: !h.aktiv }">
        <div class="hook-kopf">
          <button type="button" :class="['schalter', { an: h.aktiv }]" role="switch" :aria-checked="h.aktiv" :aria-label="t('Aktiv', 'Active')" @click="umschalten(h)"></button>
          <div class="was"><b>{{ h.name || t('Ohne Namen', 'Unnamed') }}</b><code class="mono">{{ h.url }}</code></div>
          <span :class="['chip', zustand(h).k]">{{ zustand(h).t }}</span>
        </div>
        <div class="chips"><span v-for="e in h.ereignisse" :key="e" class="chip neutral"><span class="mono">{{ e }}</span> · {{ TEXT[e] }}</span></div>
        <div class="zahlen sehrleise klein">{{ t(`${h.ok} zugestellt · ${h.fehler} fehlgeschlagen · ${h.offen} in der Warteschlange (14 Tage)`, `${h.ok} delivered · ${h.fehler} failed · ${h.offen} queued (14 days)`) }}</div>
        <div class="geheim">
          <span class="etikett">{{ t('Geheimnis', 'Secret') }}</span>
          <code class="mono">{{ zeigeGeheimnis === h.id ? h.geheimnis : 'whsec_' + '•'.repeat(20) }}</code>
          <button class="knopf nur-icon" :aria-label="t('Zeigen', 'Show')" @click="zeigeGeheimnis = zeigeGeheimnis === h.id ? null : h.id"><Ico :n="zeigeGeheimnis === h.id ? 'lock' : 'eye'" /></button>
          <button class="knopf nur-icon" :aria-label="t('Kopieren', 'Copy')" @click="kopie('g' + h.id, h.geheimnis)"><Ico :n="kopiert === 'g' + h.id ? 'check' : 'copy'" /></button>
          <button class="knopf nur-icon" :aria-label="t('Erneuern', 'Renew')" @click="neuesGeheimnis(h)"><Ico n="undo" /></button>
        </div>
        <div class="reihe aktionen">
          <button class="knopf" :disabled="testet === h.id" @click="testen(h)"><Ico :n="testet === h.id ? 'loader' : 'sparkle'" :spin="testet === h.id" /> {{ t('Test senden', 'Send test') }}</button>
          <button class="knopf" @click="protokollZeigen(h)"><Ico n="list" /> {{ t('Protokoll', 'Log') }}</button>
          <button class="knopf" @click="bearbeiten(h)"><Ico n="edit" /> {{ t('Bearbeiten', 'Edit') }}</button>
          <button class="knopf gefahr" style="margin-left:auto" @click="entfernen(h)"><Ico n="trash" /></button>
        </div>
      </article>
    </div>

    <div v-if="istInhaber" class="block intern">
      <label class="frage-opt"><button type="button" :class="['schalter', { an: data?.intern }]" role="switch" :aria-checked="!!data?.intern" @click="internUm"></button>
        <span><b>{{ t('Ziele im eigenen Netz erlauben', 'Allow targets in the local network') }}</b><small>{{ t('Für Heimserver (z. B. n8n auf 192.168.x.x). Sonst sind interne Adressen gesperrt, damit niemand über Webhooks Dienste hinter deiner Firewall erreicht. Gilt für alle Konten.', 'For home servers (e.g. n8n on 192.168.x.x). Otherwise internal addresses are blocked so nobody can reach services behind your firewall through webhooks. Applies to all accounts.') }}</small></span></label>
    </div>

    <VdModal v-if="form" :titel="form.id ? t('Webhook bearbeiten', 'Edit webhook') : t('Webhook anlegen', 'Add webhook')" @zu="form = null">
      <form @submit.prevent="speichern">
        <label class="feld"><span>{{ t('Name', 'Name') }}</span><input v-model="form.name" class="eingabe" maxlength="60" :placeholder="t('z. B. n8n Uploads', 'e.g. n8n uploads')"></label>
        <label class="feld"><span>{{ t('Adresse', 'URL') }}</span><input v-model="form.url" class="eingabe mono" inputmode="url" spellcheck="false" placeholder="https://example.com/hooks/vylariscloud" required></label>
        <div class="feld"><span>{{ t('Ereignisse', 'Events') }}</span>
          <div class="ereignisse">
            <button v-for="e in data?.ereignisse || []" :key="e" type="button" :class="{ an: form.ereignisse.includes(e) }" :aria-pressed="form.ereignisse.includes(e)" @click="ereignisUm(e)">
              <Ico :n="form.ereignisse.includes(e) ? 'check' : 'plus'" /><span><b>{{ TEXT[e] }}</b><small class="mono">{{ e }}</small></span></button>
          </div>
        </div>
        <div class="modal-fuss"><button type="button" class="knopf" @click="form = null">{{ t('Abbrechen', 'Cancel') }}</button><button class="knopf rot" :disabled="laeuft || !form.url || !form.ereignisse.length"><Ico v-if="laeuft" n="loader" spin />{{ t('Speichern', 'Save') }}</button></div>
      </form>
    </VdModal>

    <VdModal v-if="protokoll" breit :titel="t(`Protokoll: ${protokoll.h.name || protokoll.h.url}`, `Log: ${protokoll.h.name || protokoll.h.url}`)" @zu="protokoll = null">
      <p v-if="!protokoll.liste.length" class="sehrleise">{{ t('Noch keine Zustellungen.', 'No deliveries yet.') }}</p>
      <div class="lieferungen">
        <div v-for="l in protokoll.liste" :key="l.id" class="lieferung">
          <button type="button" class="l-kopf" :aria-expanded="offenId === l.id" @click="offenId = offenId === l.id ? null : l.id">
            <span :class="['punkt', l.status]"></span>
            <span class="mono ev">{{ l.ereignis }}</span>
            <span :class="['chip', l.status === 'ok' ? 'ok' : l.status === 'offen' ? 'info' : 'rot']">{{ l.status === 'ok' ? (l.antwort_code || 'OK') : l.status === 'offen' ? t(`Versuch ${l.versuche + 1}`, `Attempt ${l.versuche + 1}`) : (l.antwort_code || t('Fehler', 'Error')) }}</span>
            <span class="sehrleise klein mono">{{ l.dauer_ms != null ? l.dauer_ms + ' ms' : '' }}</span>
            <span class="sehrleise klein zeit">{{ zeitpunkt(l.created_at) }}</span>
            <Ico :n="offenId === l.id ? 'up' : 'down'" />
          </button>
          <div v-if="offenId === l.id" class="l-inhalt">
            <p v-if="l.antwort" class="klein"><b>{{ t('Antwort', 'Response') }}:</b> <span class="mono">{{ l.antwort }}</span></p>
            <p v-if="l.status === 'offen'" class="klein sehrleise">{{ t(`Nächster Versuch: ${zeitpunkt(l.naechster_at)}`, `Next attempt: ${zeitpunkt(l.naechster_at)}`) }}</p>
            <pre class="mono">{{ JSON.stringify({ id: String(l.id), ...l.nutzlast }, null, 2) }}</pre>
            <button v-if="l.status !== 'offen'" class="knopf klein" @click="erneut(l)"><Ico n="undo" /> {{ t('Erneut senden', 'Resend') }}</button>
          </div>
        </div>
      </div>
    </VdModal>
  </section>
</template>

<style scoped>
.liste {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.liste .block + .block {
  margin-top: 0;
}
.hook {
  animation: rein 0.45s var(--kurve) backwards;
  animation-delay: calc(var(--i) * 50ms);
  transition: opacity 0.2s;
}
.hook.aus {
  opacity: 0.72;
}
.hook-kopf {
  display: flex;
  gap: 12px;
  align-items: center;
}
.was {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.was code {
  font-size: 12px;
  color: var(--text3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin: 12px 0 8px;
}
.chips .chip {
  font-size: 11.5px;
}
.chips .mono {
  font-size: 11px;
}
.zahlen {
  margin-bottom: 10px;
}
.klein {
  font-size: 12px;
}
.geheim {
  display: flex;
  gap: 6px;
  align-items: center;
  border: 1px solid var(--linie);
  background: var(--bg);
  border-radius: 10px;
  padding: 4px 4px 4px 12px;
}
.geheim code {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.etikett {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text3);
  width: 80px;
  flex-shrink: 0;
}
.aktionen {
  margin-top: 12px;
}
.leer {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 20px;
}
.leer p {
  margin: 0 0 6px;
}
.gross-ic {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: rgba(var(--a-rgb), 0.1);
  color: var(--a);
  display: grid;
  place-items: center;
}
.gross-ic svg {
  width: 24px;
  height: 24px;
}
.intern {
  margin-top: 18px;
}
.frage-opt {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  cursor: pointer;
}
.frage-opt small {
  display: block;
  color: var(--text3);
  font-size: 12px;
  margin-top: 2px;
}
.ereignisse {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.ereignisse button {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  text-align: left;
  border: 1.5px solid var(--linie);
  background: var(--bg);
  border-radius: 10px;
  padding: 8px 10px;
  cursor: pointer;
  font: inherit;
  color: var(--text);
  transition:
    border-color 0.2s,
    background 0.2s;
}
.ereignisse button.an {
  border-color: var(--a);
  background: rgba(var(--a-rgb), 0.06);
}
.ereignisse svg {
  width: 14px;
  height: 14px;
  margin-top: 2px;
  color: var(--text3);
  flex-shrink: 0;
}
.ereignisse button.an svg {
  color: var(--a);
}
.ereignisse span {
  display: flex;
  flex-direction: column;
  font-size: 13px;
}
.ereignisse small {
  font-size: 10.5px;
  color: var(--text3);
}
.lieferungen {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 60vh;
  overflow-y: auto;
}
.lieferung {
  border: 1px solid var(--linie);
  border-radius: 10px;
  overflow: hidden;
}
.l-kopf {
  display: flex;
  gap: 10px;
  align-items: center;
  width: 100%;
  border: 0;
  background: var(--bg);
  padding: 9px 12px;
  cursor: pointer;
  font: inherit;
  color: var(--text);
  text-align: left;
}
.l-kopf > svg {
  width: 14px;
  height: 14px;
  color: var(--text3);
}
.ev {
  font-size: 12px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.zeit {
  min-width: 120px;
  text-align: right;
}
.punkt {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text3);
  flex-shrink: 0;
}
.punkt.ok {
  background: var(--ok);
}
.punkt.fehler {
  background: var(--rot);
}
.punkt.offen {
  background: var(--info);
}
.l-inhalt {
  padding: 10px 12px;
  border-top: 1px solid var(--linie);
}
.l-inhalt pre {
  background: var(--flaeche2);
  border-radius: 8px;
  padding: 10px;
  font-size: 11.5px;
  overflow: auto;
  max-height: 240px;
  margin: 6px 0 10px;
}
@media (max-width: 640px) {
  .ereignisse {
    grid-template-columns: 1fr;
  }
  .zeit {
    display: none;
  }
}
</style>
