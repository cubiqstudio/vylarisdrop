<script setup lang="ts">
// App-Passwoerter fuer WebDAV-Clients: anlegen (Klartext nur einmal), auflisten, widerrufen
const props = defineProps<{ benutzer: string; adresse: string }>()
const klar = defineModel<string>('klar', { default: '' })
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const { data, refresh } = await (useFetch as any)('/api/sync/zugaenge', { key: 'sync-zugaenge' })
const liste = computed<any[]>(() => data.value?.zugaenge || [])
const name = ref('')
const schreiben = ref(true)
const laeuft = ref(false)
const kopiert = ref(false)
const neu = ref<{ name: string; schreiben: boolean } | null>(null)

async function anlegen() {
  if (laeuft.value) return
  laeuft.value = true
  try {
    const r = await api('/api/sync/zugaenge', {
      method: 'POST',
      body: { name: name.value.trim() || t('Mein Gerät', 'My device'), schreiben: schreiben.value }
    })
    klar.value = r.klar
    neu.value = { name: r.zugang.name, schreiben: r.zugang.schreiben }
    name.value = ''
    await refresh()
  } catch (e: any) {
    fehler(e.message)
  } finally {
    laeuft.value = false
  }
}
async function kopie(s: string) {
  if (await kopieren(s)) {
    kopiert.value = true
    setTimeout(() => {
      kopiert.value = false
    }, 1500)
  }
}
function widerrufen(x: any) {
  bestaetigen(
    t('App-Passwort widerrufen?', 'Revoke app password?'),
    t(
      `Geräte mit „${x.name}“ verlieren sofort den Zugriff auf deine Cloud.`,
      `Devices using “${x.name}” lose access to your cloud immediately.`
    ),
    t('Widerrufen', 'Revoke'),
    async () => {
      try {
        await api(`/api/sync/zugaenge/${x.id}`, { method: 'DELETE' })
        await refresh()
        ok(t('Widerrufen', 'Revoked'))
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}
function ausblenden() {
  klar.value = ''
  neu.value = null
}
</script>

<template>
  <div>
    <form class="block sz-form" @submit.prevent="anlegen">
      <div class="reihe sz-zeile">
        <label class="versteckt" for="sz-name">{{ t('Name des Geräts', 'Device name') }}</label>
        <input
          id="sz-name"
          v-model="name"
          class="eingabe"
          style="flex: 1; min-width: 200px"
          maxlength="60"
          autocomplete="off"
          :placeholder="t('Name, z. B. „Laptop“ oder „Handy“', 'Name, e.g. “laptop” or “phone”')"
        />
        <button class="knopf rot" :disabled="laeuft">
          <Ico :n="laeuft ? 'loader' : 'plus'" :spin="laeuft" /> {{ t('App-Passwort erstellen', 'Create app password') }}
        </button>
      </div>
      <div class="sz-modus" role="radiogroup" :aria-label="t('Zugriff', 'Access')">
        <button
          type="button"
          role="radio"
          :aria-checked="schreiben"
          :class="{ an: schreiben }"
          @click="schreiben = true"
        >
          <Ico :n="schreiben ? 'check' : 'circle'" />
          <span
            ><b>{{ t('Lesen und schreiben', 'Read and write') }}</b
            ><small>{{ t('Dateien öffnen, ändern, löschen', 'Open, change and delete files') }}</small></span
          >
        </button>
        <button
          type="button"
          role="radio"
          :aria-checked="!schreiben"
          :class="{ an: !schreiben }"
          @click="schreiben = false"
        >
          <Ico :n="!schreiben ? 'check' : 'circle'" />
          <span
            ><b>{{ t('Nur lesen', 'Read only') }}</b
            ><small>{{ t('Für Backups und Medien-Abspieler', 'For backups and media players') }}</small></span
          >
        </button>
      </div>
    </form>

    <Transition name="sz-auf">
      <div v-if="klar" class="block sz-geheim" role="status">
        <div class="reihe zw">
          <b
            ><Ico n="key" /> {{ t('Dein neues App-Passwort — nur jetzt sichtbar', 'Your new app password — visible only now') }}</b
          >
          <button class="knopf klein" @click="ausblenden">{{ t('Ich habe es gespeichert', 'I have saved it') }}</button>
        </div>
        <div class="sz-wert">
          <code class="mono">{{ klar }}</code>
          <button class="knopf klein" @click="kopie(klar)">
            <Ico :n="kopiert ? 'check' : 'copy'" /> {{ kopiert ? t('Kopiert', 'Copied') : t('Kopieren', 'Copy') }}
          </button>
        </div>
        <dl class="sz-daten">
          <div>
            <dt>{{ t('Adresse', 'Address') }}</dt>
            <dd class="mono">{{ props.adresse }}</dd>
          </div>
          <div>
            <dt>{{ t('Benutzername', 'Username') }}</dt>
            <dd class="mono">{{ props.benutzer }}</dd>
          </div>
        </dl>
        <p class="sehrleise">
          {{
            t(
              'Das ist das Passwort für das Gerät „' + (neu?.name || '') + '“ — nicht dein Konto-Passwort. Wir speichern nur einen Hash, danach lässt es sich nicht mehr anzeigen. Verlierst du es, erstelle ein neues. Die Anleitungen unten verwenden es jetzt in den Beispielen.',
              'This is the password for the device “' + (neu?.name || '') + '” — not your account password. We only store a hash, so it cannot be shown again. If you lose it, create a new one. The guides below use it in their examples for now.'
            )
          }}
        </p>
      </div>
    </Transition>

    <div class="sz-liste" role="list">
      <div v-for="x in liste" :key="x.id" class="sz-eintrag" role="listitem">
        <span class="sz-ic"><Ico n="key" /></span>
        <div class="sz-text">
          <div class="sz-titel">
            <b>{{ x.name }}</b>
            <span class="chip" :class="x.schreiben ? 'info' : 'neutral'">{{
              x.schreiben ? t('Lesen und schreiben', 'Read and write') : t('Nur lesen', 'Read only')
            }}</span>
          </div>
          <div class="sehrleise sz-meta">
            <span class="mono">{{ x.prefix }}…</span> · {{ t('erstellt', 'created') }} {{ datum(x.created_at) }} ·
            {{
              x.last_used_at
                ? t(`zuletzt benutzt ${vorher(x.last_used_at)}`, `last used ${vorher(x.last_used_at)}`)
                : t('noch nie benutzt', 'never used')
            }}
          </div>
        </div>
        <button class="knopf klein gefahr" @click="widerrufen(x)">{{ t('Widerrufen', 'Revoke') }}</button>
      </div>
      <p v-if="!liste.length" class="sehrleise sz-leer">
        {{ t('Noch kein App-Passwort. Erstelle eins für jedes Gerät oder Programm.', 'No app password yet. Create one for each device or program.') }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.sz-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sz-modus {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.sz-modus button {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  text-align: left;
  border: 1.5px solid var(--linie);
  background: var(--bg);
  border-radius: 11px;
  padding: 9px 11px;
  cursor: pointer;
  color: var(--text);
  transition:
    border-color 0.2s,
    background 0.2s;
}
.sz-modus button.an {
  border-color: var(--a);
  background: rgba(var(--a-rgb), 0.06);
}
.sz-modus button svg {
  width: 14px;
  height: 14px;
  margin-top: 3px;
  color: var(--text3);
}
.sz-modus button.an svg {
  color: var(--a);
}
.sz-modus span {
  display: flex;
  flex-direction: column;
  font-size: 13px;
}
.sz-modus small {
  color: var(--text3);
  font-size: 11.5px;
}
.sz-geheim {
  margin-top: 12px;
  border-color: rgba(var(--a-rgb), 0.45);
  background: rgba(var(--a-rgb), 0.05);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sz-geheim b {
  display: inline-flex;
  gap: 8px;
  align-items: center;
}
.sz-geheim b svg {
  width: 15px;
  height: 15px;
  color: var(--a);
}
.sz-wert {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 11px;
  padding: 10px 12px;
}
.sz-wert code {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.01em;
  word-break: break-all;
  flex: 1;
  min-width: 0;
  user-select: all;
}
.sz-daten {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px 16px;
}
.sz-daten dt {
  font-size: 11.5px;
  color: var(--text3);
  font-weight: 600;
}
.sz-daten dd {
  margin: 2px 0 0;
  font-size: 12.5px;
  word-break: break-all;
}
.sz-geheim p {
  margin: 0;
  font-size: 12px;
}
.sz-liste {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.sz-eintrag {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 12px;
  padding: 10px 12px;
  animation: rein 0.4s var(--kurve) backwards;
}
.sz-ic {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--flaeche2);
  color: var(--text2);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.sz-ic svg {
  width: 15px;
  height: 15px;
}
.sz-text {
  flex: 1;
  min-width: 0;
}
.sz-titel {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.sz-meta {
  font-size: 12px;
  margin-top: 2px;
}
.sz-leer {
  margin: 4px 2px;
}
.sz-auf-enter-active {
  transition:
    opacity 0.35s,
    transform 0.4s var(--kurve);
}
.sz-auf-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
@media (max-width: 640px) {
  .sz-modus {
    grid-template-columns: 1fr;
  }
  .sz-eintrag {
    flex-wrap: wrap;
  }
  .sz-text {
    flex-basis: calc(100% - 60px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .sz-eintrag,
  .sz-auf-enter-active {
    animation: none;
    transition: none;
  }
}
</style>
