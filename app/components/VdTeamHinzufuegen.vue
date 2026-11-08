<script setup lang="ts">
// "Mitglied hinzufügen" für die Team-Leitung: Benutzername tippen, Vorschläge erscheinen (Debounce), Pfeile/Enter/Esc.
// Eigener Zustand je Team (getippter Text, offene Vorschläge) – ein Neuladen der Teamdaten zerstört ihn nicht.
const props = defineProps<{ teamId: number }>()
const emit = defineEmits<{ (e: 'hinzugefuegt'): void }>()
const { ok } = useToast()
const id = useId()
const text = ref('')
const vorschlaege = ref<string[]>([])
const offen = ref(false)
const aktiv = ref(-1)
const laeuft = ref(false)
const meldung = ref('')
const eingabe = ref<HTMLInputElement | null>(null)
let uhr: ReturnType<typeof setTimeout> | null = null
let lauf = 0 // nur die jüngste Antwort zählt

function schliessen() {
  offen.value = false
  aktiv.value = -1
}
async function suchen() {
  const eingabeText = text.value.trim()
  const mein = ++lauf
  if (eingabeText.length < 2) {
    vorschlaege.value = []
    return schliessen()
  }
  try {
    const r = await ($fetch as any)(`/api/team/${props.teamId}/kandidaten`, {
      query: { q: eingabeText },
      headers: { accept: 'application/json' },
      retry: 0
    })
    if (mein !== lauf) return
    vorschlaege.value = (r.kandidaten || []).map((k: any) => String(k.name))
    offen.value = vorschlaege.value.length > 0
    aktiv.value = -1
  } catch {
    if (mein !== lauf) return
    vorschlaege.value = []
    schliessen()
  }
}
function getippt() {
  meldung.value = ''
  if (uhr) clearTimeout(uhr)
  uhr = setTimeout(suchen, 250)
}
async function hinzufuegen(name: string) {
  name = name.trim()
  if (!name || laeuft.value) return
  laeuft.value = true
  meldung.value = ''
  if (uhr) clearTimeout(uhr)
  lauf++
  try {
    await api(`/api/team/${props.teamId}/mitglieder`, { method: 'POST', body: { name } })
    ok(t(`„${name}“ wurde hinzugefügt.`, `“${name}” was added.`))
    text.value = ''
    vorschlaege.value = []
    schliessen()
    emit('hinzugefuegt')
  } catch (e: any) {
    meldung.value = e.message
  } finally {
    laeuft.value = false
    eingabe.value?.focus()
  }
}
function taste(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!vorschlaege.value.length) return
    e.preventDefault()
    if (!offen.value) offen.value = true
    const n = vorschlaege.value.length
    aktiv.value = e.key === 'ArrowDown' ? (aktiv.value + 1) % n : (aktiv.value - 1 + n) % n
  } else if (e.key === 'Escape' && offen.value) {
    e.preventDefault()
    schliessen()
  } else if (e.key === 'Enter' && offen.value && aktiv.value >= 0) {
    e.preventDefault()
    void hinzufuegen(vorschlaege.value[aktiv.value]!)
  }
}
function absenden() {
  void hinzufuegen(text.value)
}
onBeforeUnmount(() => {
  if (uhr) clearTimeout(uhr)
})
</script>

<template>
  <form class="th" autocomplete="off" @submit.prevent="absenden">
    <label :for="id + '-in'" class="th-label">{{ t('Mitglied hinzufügen', 'Add member') }}</label>
    <div class="th-zeile">
      <div class="th-feld">
        <input
          :id="id + '-in'"
          ref="eingabe"
          v-model="text"
          class="eingabe"
          type="text"
          role="combobox"
          maxlength="64"
          spellcheck="false"
          autocapitalize="off"
          :placeholder="t('Benutzername', 'Username')"
          aria-autocomplete="list"
          :aria-expanded="offen"
          :aria-controls="id + '-liste'"
          :aria-activedescendant="aktiv >= 0 ? id + '-o' + aktiv : undefined"
          :aria-describedby="id + '-hilfe'"
          @input="getippt"
          @keydown="taste"
          @blur="schliessen"
          @focus="vorschlaege.length && (offen = true)"
        />
        <ul v-show="offen" :id="id + '-liste'" class="th-liste" role="listbox" :aria-label="t('Vorschläge', 'Suggestions')">
          <li
            v-for="(v, i) in vorschlaege"
            :id="id + '-o' + i"
            :key="v"
            role="option"
            :aria-selected="i === aktiv"
            :class="{ aktiv: i === aktiv }"
            @mousedown.prevent="hinzufuegen(v)"
            @mousemove="aktiv = i"
          >
            <Ico n="user" /> {{ v }}
          </li>
        </ul>
      </div>
      <button class="knopf" type="submit" :disabled="laeuft || !text.trim()">
        <Ico :n="laeuft ? 'loader' : 'plus'" :spin="laeuft" /> {{ t('Hinzufügen', 'Add') }}
      </button>
    </div>
    <p :id="id + '-hilfe'" class="th-hilfe sehrleise">
      {{ t('Ab zwei Buchstaben erscheinen Vorschläge. Neue Mitglieder starten als „Mitglied“.', 'Suggestions appear after two letters. New members start as “Member”.') }}
    </p>
    <p v-if="meldung" class="th-fehler" role="alert">{{ meldung }}</p>
    <span class="versteckt" role="status">{{ offen ? t(`${vorschlaege.length} Vorschläge`, `${vorschlaege.length} suggestions`) : '' }}</span>
  </form>
</template>

<style scoped>
.th {
  display: grid;
  gap: 6px;
}
.th-label {
  font-size: 13px;
  font-weight: 600;
}
.th-zeile {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.th-feld {
  position: relative;
  flex: 1;
  min-width: 0;
}
.th-liste {
  position: absolute;
  z-index: 20;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
}
.th-liste li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13.5px;
  overflow-wrap: anywhere;
}
.th-liste li svg {
  width: 14px;
  height: 14px;
  color: var(--text3);
  flex-shrink: 0;
}
.th-liste li.aktiv {
  background: rgba(var(--a-rgb), 0.12);
  outline: 1px solid rgba(var(--a-rgb), 0.45);
}
.th-hilfe {
  margin: 0;
  font-size: 12px;
}
.th-fehler {
  margin: 0;
  font-size: 13px;
  color: var(--rot);
  background: var(--rot-bg);
  border-radius: 10px;
  padding: 8px 12px;
}
</style>
