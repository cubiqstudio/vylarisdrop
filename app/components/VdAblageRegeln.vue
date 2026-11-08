<script setup lang="ts">
// Ablage-Regeln („Wohin kommt was?“): Reiter auf /regeln, nur für Admins und den Inhaber (die API ist serverseitig gesperrt)
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
// ohne await: der Reiter darf die Seite nicht erneut anhalten
const { data, refresh, status } = (useFetch as any)('/api/regeln/ablage', { key: 'ablage-regeln' })
const regeln = computed<any[]>(() => data.value?.regeln || [])
const auswahl = computed<any>(() => data.value?.auswahl || { ziele: [], konten: [], rollen: [], teams: [], ordner: [] })
const standard = computed<any>(() => data.value?.standard || {})

const ARTEN = computed(() => [
  { v: 'bild', t: t('Bilder', 'Images') },
  { v: 'video', t: t('Videos', 'Videos') },
  { v: 'audio', t: t('Audio', 'Audio') },
  { v: 'text', t: t('Text & Code', 'Text & code') },
  { v: 'datei', t: t('Andere Dateien', 'Other files') }
])
const ROLLEN = computed(() => [
  { v: 'user', t: t('Nutzer', 'User') },
  { v: 'admin', t: t('Admin', 'Admin') },
  { v: 'owner', t: t('Inhaber', 'Owner') }
])
const ZUSTAND: Record<string, { k: string; ic: string; de: string; en: string }> = {
  online: { k: 'ok', ic: 'check', de: 'online', en: 'online' },
  offline: { k: 'rot', ic: 'alert', de: 'offline', en: 'offline' },
  voll: { k: 'warn', ic: 'alert', de: 'voll', en: 'full' },
  teilweise: { k: 'warn', ic: 'alert', de: 'teilweise erreichbar', en: 'partly reachable' },
  inaktiv: { k: 'neutral', ic: 'pause', de: 'ausgeschaltet', en: 'switched off' },
  schreibgeschuetzt: { k: 'warn', ic: 'lock', de: 'schreibgeschützt', en: 'read-only' },
  entfernt: { k: 'rot', ic: 'x', de: 'entfernt', en: 'removed' },
  nicht_eingerichtet: { k: 'neutral', ic: 'pause', de: 'nicht eingerichtet', en: 'not set up' }
}
const zustandText = (z: string) => (ZUSTAND[z] ? t(ZUSTAND[z]!.de, ZUSTAND[z]!.en) : z)
const orteOptionen = computed(() =>
  (auswahl.value.ziele as any[]).map((z) => ({ v: z.ort, t: `${z.name} — ${zustandText(z.zustand)}` }))
)
const ortName = (o: string) => (auswahl.value.ziele as any[]).find((z) => z.ort === o)?.name || o
const kontoName = (id: number) => (auswahl.value.konten as any[]).find((k) => k.id === id)?.username || `#${id}`
const rolleText = (r: string) => ROLLEN.value.find((x) => x.v === r)?.t || r
const artText = (a: string) => ARTEN.value.find((x) => x.v === a)?.t || a
/** MIME-Angabe wie im Dialog: „image/“ (Anfang) wird als „image/*“ gezeigt, damit Vorschau und Liste gleich aussehen */
const mimeText = (m: string) => (m.replace(/\*$/, '').endsWith('/') ? m.replace(/\*$/, '') + '*' : m)

const mbText = (n: number) => `${n} MB`
function kommaListe(s: string): string[] {
  return [...new Set(String(s || '').split(/[\s,;]+/).map((x) => x.trim().replace(/^\.+/, '')).filter(Boolean))]
}

/** Klartext einer Regel: „Bilder über 5 MB von Konto lucas → Storage Box A, sonst größter freier Platz; fällt aus → lokal“ */
function satz(r: any): string {
  const b = r.bedingung || {}
  const teile: string[] = []
  const arten = (b.art || []).map((a: string) => ARTEN.value.find((x) => x.v === a)?.t || a)
  teile.push(arten.length ? arten.join(', ') : t('Dateien', 'Files'))
  if (b.endungen?.length) teile.push(t(`mit Endung ${b.endungen.map((e: string) => '.' + e).join(', ')}`, `with extension ${b.endungen.map((e: string) => '.' + e).join(', ')}`))
  if (b.mime?.length) teile.push(t(`vom Typ ${b.mime.map(mimeText).join(', ')}`, `of type ${b.mime.map(mimeText).join(', ')}`))
  if (b.groesse_von_mb && b.groesse_bis_mb) teile.push(t(`von ${mbText(b.groesse_von_mb)} bis ${mbText(b.groesse_bis_mb)}`, `from ${mbText(b.groesse_von_mb)} to ${mbText(b.groesse_bis_mb)}`))
  else if (b.groesse_von_mb) teile.push(t(`ab ${mbText(b.groesse_von_mb)}`, `from ${mbText(b.groesse_von_mb)} up`))
  else if (b.groesse_bis_mb) teile.push(t(`bis ${mbText(b.groesse_bis_mb)}`, `up to ${mbText(b.groesse_bis_mb)}`))
  if (b.konten?.length) teile.push(t(`von Konto ${b.konten.map(kontoName).join(', ')}`, `from account ${b.konten.map(kontoName).join(', ')}`))
  const rollen = [
    ...(b.rollen || []).map(rolleText),
    ...(b.rollen_ids || []).map((id: number) => (auswahl.value.rollen as any[]).find((x) => x.id === id)?.name || `#${id}`)
  ]
  if (rollen.length) teile.push(t(`mit Rolle ${rollen.join(' / ')}`, `with role ${rollen.join(' / ')}`))
  if (b.ordner?.length)
    teile.push(t(`in Ordner ${b.ordner.map((id: number) => (auswahl.value.ordner as any[]).find((o) => o.id === id)?.pfad || `#${id}`).join(', ')}`, `in folder ${b.ordner.map((id: number) => (auswahl.value.ordner as any[]).find((o) => o.id === id)?.pfad || `#${id}`).join(', ')}`))
  if (b.teams?.length) teile.push(t(`im Team ${b.teams.map((id: number) => (auswahl.value.teams as any[]).find((x) => x.id === id)?.name || `#${id}`).join(', ')}`, `in team ${b.teams.map((id: number) => (auswahl.value.teams as any[]).find((x) => x.id === id)?.name || `#${id}`).join(', ')}`))
  return teile.join(' ')
}
function folge(r: any): string {
  if (r.aktion === 'verbieten') return t('nicht speichern', 'do not store') + (r.meldung ? ` („${r.meldung}“)` : '')
  const ziele = (r.ziele || []).map(ortName).join(' / ') || '–'
  const strat = (r.ziele || []).length > 1 || (r.ziele || []).includes('pool')
    ? r.strategie === 'frei' ? t(', größter freier Platz', ', most free space') : r.strategie === 'abwechselnd' ? t(', abwechselnd', ', alternating') : t(', erste verfügbare', ', first available')
    : ''
  const fb = r.fallback === 'lokal' ? t('lokal', 'local') : r.fallback === 'ablehnen' ? t('ablehnen', 'reject') : t('nächste Regel', 'next rule')
  return `${ziele}${strat}; ${t('fällt aus →', 'if unavailable →')} ${fb}`
}

// ----- Liste: Reihenfolge, Schalter, Löschen -----
async function verschieben(i: number, d: number) {
  const ids = regeln.value.map((r) => r.id)
  const j = i + d
  if (j < 0 || j >= ids.length) return
  ;[ids[i], ids[j]] = [ids[j], ids[i]]
  try {
    await api('/api/regeln/ablage/reihenfolge', { method: 'POST', body: { ids } })
    await refresh()
  } catch (e: any) {
    fehler(e.message)
    await refresh()
  }
}
async function umschalten(r: any) {
  try {
    await api(`/api/regeln/ablage/${r.id}`, { method: 'PATCH', body: { aktiv: !r.aktiv } })
    await refresh()
  } catch (e: any) {
    fehler(e.message)
  }
}
function entfernen(r: any) {
  bestaetigen(
    t('Ablage-Regel löschen?', 'Delete placement rule?'),
    t(`„${r.name || satz(r)}“ gilt danach nicht mehr. Bereits abgelegte Dateien bleiben, wo sie sind.`, `“${r.name || satz(r)}” no longer applies afterwards. Files already stored stay where they are.`),
    t('Löschen', 'Delete'),
    async () => {
      try {
        await api(`/api/regeln/ablage/${r.id}`, { method: 'DELETE' })
        await refresh()
        ok(t('Gelöscht', 'Deleted'))
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}

// ----- Dialog -----
const form = ref<any>(null)
const laeuft = ref(false)
function neu() {
  form.value = { id: null, name: '', aktiv: true, aktion: 'speichern', arten: [], mime: '', endungen: '', von: null, bis: null, konten: [], rollen: [], rollen_ids: [], ordner: [], teams: [], ziele: [], strategie: 'erste', fallback: 'naechstes', meldung: '' }
}
function bearbeiten(r: any) {
  const b = r.bedingung || {}
  form.value = {
    id: r.id, name: r.name, aktiv: r.aktiv, aktion: r.aktion, arten: [...(b.art || [])], mime: (b.mime || []).join(', '),
    endungen: (b.endungen || []).join(', '), von: b.groesse_von_mb || null, bis: b.groesse_bis_mb || null, konten: [...(b.konten || [])],
    rollen: [...(b.rollen || [])], rollen_ids: [...(b.rollen_ids || [])], ordner: [...(b.ordner || [])], teams: [...(b.teams || [])],
    ziele: [...(r.ziele || [])], strategie: r.strategie, fallback: r.fallback, meldung: r.meldung || ''
  }
}
const leer = (v: any) => v === null || v === '' || v === undefined
const ganz = (v: any) => (leer(v) || !Number.isInteger(Number(v)) || Number(v) < 1 ? null : Number(v))
/** Größen nur als ganze MB ab 1 (0,5 würde sonst still zu „keine Bedingung“ werden — bei einem Verbot sperrte das alles) */
const zahlOk = (v: any) => leer(v) || (Number.isInteger(Number(v)) && Number(v) >= 1)
const koerper = (f: any) => ({
  name: f.name,
  aktiv: f.aktiv,
  aktion: f.aktion,
  bedingung: {
    art: f.arten,
    mime: kommaListe(f.mime).map((m) => m.toLowerCase()),
    endungen: kommaListe(f.endungen).map((m) => m.toLowerCase()),
    groesse_von_mb: ganz(f.von),
    groesse_bis_mb: ganz(f.bis),
    konten: f.konten,
    rollen: f.rollen,
    rollen_ids: f.rollen_ids,
    ordner: f.ordner,
    teams: f.teams
  },
  ziele: f.aktion === 'speichern' ? f.ziele : [],
  strategie: f.strategie,
  fallback: f.fallback,
  meldung: f.meldung
})
const vorschauSatz = computed(() => {
  const f = form.value
  if (!f) return ''
  const k = koerper(f)
  const r = { bedingung: k.bedingung, aktion: k.aktion, ziele: k.ziele, strategie: k.strategie, fallback: k.fallback, meldung: k.meldung }
  return `${satz(r)} → ${folge(r)}`
})
const groesseOk = computed(() => !form.value || (zahlOk(form.value.von) && zahlOk(form.value.bis)))
const hatBedingung = computed(() => {
  const b = form.value ? koerper(form.value).bedingung : null
  return !!b && Object.values(b).some((v: any) => (Array.isArray(v) ? v.length > 0 : v != null))
})
/** Eine eingeschaltete Verbotsregel ohne jede Bedingung würde alles sperren — die API lehnt sie ab, hier schon vorher */
const verbotOhneBedingung = computed(() => !!form.value && form.value.aktion === 'verbieten' && form.value.aktiv && !hatBedingung.value)
const gueltig = computed(
  () => !!form.value && groesseOk.value && !verbotOhneBedingung.value && (form.value.aktion === 'verbieten' || form.value.ziele.length > 0)
)
function toggle(liste: string[], v: string) {
  const i = liste.indexOf(v)
  if (i >= 0) liste.splice(i, 1)
  else liste.push(v)
}
async function speichern() {
  const f = form.value
  laeuft.value = true
  try {
    if (f.id) await api(`/api/regeln/ablage/${f.id}`, { method: 'PATCH', body: koerper(f) })
    else await api('/api/regeln/ablage', { method: 'POST', body: koerper(f) })
    form.value = null
    await refresh()
    ok(t('Gespeichert — gilt ab dem nächsten Upload', 'Saved — applies from the next upload'))
  } catch (e: any) {
    fehler(e.message)
  } finally {
    laeuft.value = false
  }
}

// ----- „Datei testen“ -----
const test = ref<any>({ name: '', groesse: '', konto: '', ordner: '' })
const ergebnis = ref<any>(null)
const testLaeuft = ref(false)
async function pruefen() {
  testLaeuft.value = true
  try {
    const g = String(test.value.groesse).replace(',', '.').trim()
    ergebnis.value = await api('/api/regeln/ablage/test', {
      method: 'POST',
      body: {
        name: test.value.name,
        ...(g !== '' && Number.isFinite(Number(g)) && Number(g) >= 0 ? { groesse_mb: Number(g) } : {}),
        ...(test.value.konto ? { konto: Number(test.value.konto) } : {}),
        ...(test.value.ordner ? { ordner: Number(test.value.ordner) } : {})
      }
    })
  } catch (e: any) {
    ergebnis.value = null
    fehler(e.message)
  } finally {
    testLaeuft.value = false
  }
}
const ergebnisKopf = computed(() => {
  const e = ergebnis.value
  if (!e) return null
  if (e.ergebnis === 'verboten') return { k: 'rot', ic: 'x', text: t('Wird nicht gespeichert', 'Will not be stored') }
  if (e.ergebnis === 'abgelehnt') return { k: 'warn', ic: 'alert', text: t('Wird abgelehnt (Ziel nicht verfügbar)', 'Will be rejected (destination unavailable)') }
  return { k: 'ok', ic: 'check', text: t(`Wird gespeichert in: ${e.ortName}`, `Will be stored in: ${e.ortName}`) }
})
const kontoOptionen = computed(() => (auswahl.value.konten as any[]).map((k) => ({ v: k.id, t: `${k.username} · ${rolleText(k.role)}` })))
const ordnerOptionen = computed(() => (auswahl.value.ordner as any[]).map((o) => ({ v: o.id, t: `${o.pfad} · ${o.konto}` })))
const teamOptionen = computed(() => (auswahl.value.teams as any[]).map((x) => ({ v: x.id, t: x.name })))
const rolleIdOptionen = computed(() => (auswahl.value.rollen as any[]).map((x) => ({ v: x.id, t: x.name })))
const standardText = computed(() => {
  const s = standard.value
  if (s.art === 'pool') return t(`Pool (${(s.mitglieder || []).map(ortName).join(', ')}) → aktuell ${s.name}`, `Pool (${(s.mitglieder || []).map(ortName).join(', ')}) → currently ${s.name}`)
  return s.name || ''
})
</script>

<template>
  <div class="ab">
    <div class="block hinweis" role="note">
      <Ico n="database" />
      <div>
        <b>{{ t('Regeln gelten nur für NEUE Dateien.', 'Rules only apply to NEW files.') }}</b>
        <p class="leise">
          {{ t('Bereits gespeicherte Dateien werden nicht verschoben, auch wenn eine Regel sie später treffen würde. Zum Verschieben gibt es den Umzug in den Speicher-Erweiterungen.', 'Files that are already stored are not moved, even if a rule would match them later. Moving them is done by the move in the storage add-ons.') }}
          <NuxtLink to="/speicher/ziele" class="link">{{ t('Dateien umziehen →', 'Move files →') }}</NuxtLink>
        </p>
        <p class="leise klein">{{ t('Die erste zutreffende, eingeschaltete Regel von oben entscheidet. Ohne Treffer gilt die Speicher-Einstellung.', 'The first matching, switched-on rule from the top decides. Without a match the storage setting applies.') }}</p>
      </div>
    </div>

    <div class="reihe zw kopfzeile">
      <h2 class="ueber">{{ t('Ablage: Wohin kommt was?', 'Placement: where does what go?') }}</h2>
      <button class="knopf rot" @click="neu"><Ico n="plus" /> {{ t('Ablage-Regel anlegen', 'Add placement rule') }}</button>
    </div>

    <ol class="liste" :aria-label="t('Ablage-Regeln in Reihenfolge', 'Placement rules in order')">
      <li v-for="(r, i) in regeln" :key="r.id" class="block regel" :class="{ aus: !r.aktiv }">
        <div class="r-kopf">
          <span class="nr mono" aria-hidden="true">{{ i + 1 }}</span>
          <button type="button" :class="['schalter', { an: r.aktiv }]" role="switch" :aria-checked="r.aktiv" :aria-label="t('Aktiv', 'Active') + ': ' + (r.name || satz(r))" @click="umschalten(r)"></button>
          <div class="was">
            <b>{{ r.name || t('Regel', 'Rule') }} <span v-if="!r.aktiv" class="chip neutral">{{ t('ausgeschaltet', 'switched off') }}</span></b>
            <p class="satz">{{ satz(r) }} <span class="pfeil">→</span> <span :class="['folge', r.aktion]">{{ folge(r) }}</span></p>
            <p v-if="r.aktion === 'speichern'" class="ziele">
              <span v-for="z in r.ziele_status" :key="z.ort" :class="['chip', ZUSTAND[z.zustand]?.k || 'neutral']">
                <Ico :n="ZUSTAND[z.zustand]?.ic || 'server'" /> {{ z.name }} · {{ zustandText(z.zustand) }}
              </span>
            </p>
          </div>
        </div>
        <div class="r-fuss">
          <span class="sehrleise klein">{{ r.aktion === 'verbieten' ? t('Verbot', 'Forbidden') : t('Speichern', 'Store') }} · {{ t('Position', 'Position') }} {{ i + 1 }}</span>
          <div class="reihe">
            <button class="knopf klein nur-icon" :disabled="i === 0" :aria-label="t('Nach oben', 'Move up') + ': ' + (r.name || satz(r))" @click="verschieben(i, -1)"><Ico n="up" /></button>
            <button class="knopf klein nur-icon" :disabled="i === regeln.length - 1" :aria-label="t('Nach unten', 'Move down') + ': ' + (r.name || satz(r))" @click="verschieben(i, 1)"><Ico n="down" /></button>
            <button class="knopf klein" @click="bearbeiten(r)"><Ico n="edit" /> {{ t('Bearbeiten', 'Edit') }}</button>
            <button class="knopf klein gefahr" :aria-label="t('Löschen', 'Delete') + ': ' + (r.name || satz(r))" @click="entfernen(r)"><Ico n="trash" /></button>
          </div>
        </div>
      </li>
      <li class="block regel standard">
        <div class="r-kopf">
          <span class="nr mono" aria-hidden="true">∞</span>
          <div class="was">
            <b>{{ t('Standardregel', 'Default rule') }}</b>
            <p class="satz">{{ t('Alles andere', 'Everything else') }} <span class="pfeil">→</span> <b class="folge">{{ standardText }}</b></p>
            <p class="leise klein">{{ t('Das ist die aktuelle Speicher-Einstellung.', 'This is the current storage setting.') }} <NuxtLink to="/speicher/ziele" class="link">{{ t('Speicher-Erweiterungen', 'Storage add-ons') }}</NuxtLink></p>
          </div>
        </div>
      </li>
    </ol>
    <div v-if="!regeln.length && status !== 'pending' && status !== 'idle'" class="block leer">
      <h3>{{ t('Noch keine Ablage-Regeln', 'No placement rules yet') }}</h3>
      <p class="leise">{{ t('Zum Beispiel: „Videos über 500 MB → Storage Box A“ oder „Ausführbare Dateien nicht speichern“.', 'For example: “Videos over 500 MB → storage box A” or “Do not store executable files”.') }}</p>
    </div>

    <section class="block testfeld" :aria-label="t('Datei testen', 'Test a file')">
      <h3>{{ t('Datei testen', 'Test a file') }}</h3>
      <p class="leise klein">{{ t('Zeigt, welche Regel greift und wohin eine Datei käme — ohne etwas zu speichern.', 'Shows which rule applies and where a file would go — without storing anything.') }}</p>
      <form class="test-form" @submit.prevent="pruefen">
        <label class="feld"><span>{{ t('Dateiname', 'File name') }}</span><input v-model="test.name" class="eingabe" maxlength="200" required :placeholder="t('z. B. urlaub.mp4', 'e.g. holiday.mp4')"></label>
        <label class="feld"><span>{{ t('Größe in MB (leer = unbekannt)', 'Size in MB (empty = unknown)') }}</span><input v-model="test.groesse" class="eingabe" inputmode="decimal" placeholder="0"></label>
        <label class="feld"><span>{{ t('Konto (leer = du)', 'Account (empty = you)') }}</span>
          <select v-model="test.konto" class="eingabe"><option value="">{{ t('ich selbst', 'myself') }}</option><option v-for="k in kontoOptionen" :key="k.v" :value="k.v">{{ k.t }}</option></select></label>
        <label class="feld"><span>{{ t('Ordner (optional)', 'Folder (optional)') }}</span>
          <select v-model="test.ordner" class="eingabe"><option value="">{{ t('kein Ordner', 'no folder') }}</option><option v-for="o in ordnerOptionen" :key="o.v" :value="o.v">{{ o.t }}</option></select></label>
        <button class="knopf rot" :disabled="testLaeuft || !test.name.trim()"><Ico :n="testLaeuft ? 'loader' : 'play'" :spin="testLaeuft" /> {{ t('Testen', 'Test') }}</button>
      </form>
      <div v-if="ergebnis && ergebnisKopf" class="ergebnis" aria-live="polite">
        <p><span :class="['chip', ergebnisKopf.k]"><Ico :n="ergebnisKopf.ic" /> {{ ergebnisKopf.text }}</span></p>
        <p v-if="ergebnis.meldung" class="meldung-text">„{{ ergebnis.meldung }}“ ({{ ergebnis.status }})</p>
        <p class="leise">{{ ergebnis.grund }}</p>
        <p class="leise klein">{{ t('Erkannt als', 'Detected as') }}: {{ ergebnis.kontext.mime }} · {{ artText(ergebnis.kontext.art) }} · {{ ergebnis.kontext.groesse == null ? t('Größe unbekannt', 'size unknown') : groesse(ergebnis.kontext.groesse) }} · {{ ergebnis.kontext.konto.name }} ({{ rolleText(ergebnis.kontext.konto.rolle) }})</p>
        <ul v-if="ergebnis.pruefung.length" class="pruef">
          <li v-for="p in ergebnis.pruefung" :key="p.id"><b>{{ p.name || '#' + p.id }}</b>: {{ p.warum }}</li>
        </ul>
      </div>
    </section>

    <VdModal v-if="form" breit :titel="form.id ? t('Ablage-Regel bearbeiten', 'Edit placement rule') : t('Ablage-Regel anlegen', 'Add placement rule')" @zu="form = null">
      <form @submit.prevent="speichern">
        <p class="live" aria-live="polite"><Ico n="eye" /><span>{{ vorschauSatz }}</span></p>
        <label class="feld"><span>{{ t('Name (optional)', 'Name (optional)') }}</span><input v-model="form.name" class="eingabe" maxlength="80" :placeholder="t('z. B. Große Videos', 'e.g. large videos')"></label>

        <fieldset class="gruppe">
          <legend>{{ t('Wenn die Datei …', 'If the file …') }}</legend>
          <div class="feld"><span id="ab-arten">{{ t('Dateiarten (leer = alle)', 'File types (empty = all)') }}</span>
            <div class="chips" role="group" aria-labelledby="ab-arten">
              <button v-for="a in ARTEN" :key="a.v" type="button" :class="['wahl', { an: form.arten.includes(a.v) }]" :aria-pressed="form.arten.includes(a.v)" @click="toggle(form.arten, a.v)"><Ico v-if="form.arten.includes(a.v)" n="check" /> {{ a.t }}</button>
            </div></div>
          <label class="feld"><span>{{ t('Endungen (z. B. exe, bat, tar.gz)', 'Extensions (e.g. exe, bat, tar.gz)') }}</span><input v-model="form.endungen" class="eingabe" maxlength="600" placeholder="exe, bat, msi"></label>
          <label class="feld"><span>{{ t('Dateityp (MIME, Anfang oder exakt)', 'File type (MIME, prefix or exact)') }}</span><input v-model="form.mime" class="eingabe" maxlength="1200" placeholder="image/, application/pdf"></label>
          <div class="zwei">
            <label class="feld"><span>{{ t('Größe mindestens (MB)', 'Size at least (MB)') }}</span><input v-model.number="form.von" class="eingabe" type="number" min="1" step="1" :placeholder="t('keine Untergrenze', 'no lower limit')"></label>
            <label class="feld"><span>{{ t('Größe höchstens (MB)', 'Size at most (MB)') }}</span><input v-model.number="form.bis" class="eingabe" type="number" min="1" step="1" :placeholder="t('keine Obergrenze', 'no upper limit')"></label>
          </div>
          <p v-if="!groesseOk" class="meldung meldung-warn klein">{{ t('Größen bitte als ganze Megabyte ab 1 angeben (oder leer lassen).', 'Please give sizes as whole megabytes from 1 (or leave empty).') }}</p>
          <p class="leise klein">{{ t('Ist die Größe beim Hochladen unbekannt (z. B. WebDAV ohne Längenangabe), gilt eine Größenbedingung als nicht erfüllt; Verbote werden nach dem Speichern mit der echten Größe noch einmal geprüft.', 'If the size is unknown while uploading (e.g. WebDAV without a length), a size condition counts as not met; bans are checked again after storing with the real size.') }}</p>
          <VdAblageListe v-model="form.konten" :optionen="kontoOptionen" :label="t('Konten (leer = alle)', 'Accounts (empty = all)')" :platzhalter="t('Konto hinzufügen …', 'Add account …')" />
          <div class="feld"><span id="ab-rollen">{{ t('Rollen (leer = alle)', 'Roles (empty = all)') }}</span>
            <div class="chips" role="group" aria-labelledby="ab-rollen">
              <button v-for="r in ROLLEN" :key="r.v" type="button" :class="['wahl', { an: form.rollen.includes(r.v) }]" :aria-pressed="form.rollen.includes(r.v)" @click="toggle(form.rollen, r.v)"><Ico v-if="form.rollen.includes(r.v)" n="check" /> {{ r.t }}</button>
            </div></div>
          <VdAblageListe v-if="rolleIdOptionen.length" v-model="form.rollen_ids" :optionen="rolleIdOptionen" :label="t('Eigene Rollen', 'Custom roles')" :platzhalter="t('Rolle hinzufügen …', 'Add role …')" />
          <VdAblageListe v-model="form.ordner" :optionen="ordnerOptionen" :label="t('Ordner inkl. Unterordner (leer = überall)', 'Folders incl. subfolders (empty = anywhere)')" :platzhalter="t('Ordner hinzufügen …', 'Add folder …')" />
          <VdAblageListe v-if="teamOptionen.length" v-model="form.teams" :optionen="teamOptionen" :label="t('Team-Ordner (leer = alle)', 'Team folders (empty = all)')" :platzhalter="t('Team hinzufügen …', 'Add team …')" />
        </fieldset>

        <fieldset class="gruppe">
          <legend>{{ t('… dann', '… then') }}</legend>
          <div class="seg" role="group" :aria-label="t('Aktion', 'Action')">
            <button type="button" :class="{ an: form.aktion === 'speichern' }" :aria-pressed="form.aktion === 'speichern'" @click="form.aktion = 'speichern'"><Ico n="database" /> {{ t('Speichern in …', 'Store in …') }}</button>
            <button type="button" :class="{ an: form.aktion === 'verbieten' }" :aria-pressed="form.aktion === 'verbieten'" @click="form.aktion = 'verbieten'"><Ico n="x" /> {{ t('Nicht speichern', 'Do not store') }}</button>
          </div>
          <template v-if="form.aktion === 'speichern'">
            <VdAblageListe v-model="form.ziele" :optionen="orteOptionen" ordnung :label="t('Ziele (Reihenfolge zählt bei „erste verfügbare“)', 'Destinations (order matters for “first available”)')" :platzhalter="t('Ziel hinzufügen …', 'Add destination …')" />
            <p v-if="!form.ziele.length" class="meldung meldung-warn klein">{{ t('Bitte mindestens ein Ziel wählen.', 'Please choose at least one destination.') }}</p>
            <div class="feld"><span id="ab-strat">{{ t('Bei mehreren Zielen (oder Pool)', 'With several destinations (or pool)') }}</span>
              <div class="seg" role="group" aria-labelledby="ab-strat">
                <button type="button" :class="{ an: form.strategie === 'erste' }" :aria-pressed="form.strategie === 'erste'" @click="form.strategie = 'erste'">{{ t('Erste verfügbare', 'First available') }}</button>
                <button type="button" :class="{ an: form.strategie === 'frei' }" :aria-pressed="form.strategie === 'frei'" @click="form.strategie = 'frei'">{{ t('Größter freier Platz', 'Most free space') }}</button>
                <button type="button" :class="{ an: form.strategie === 'abwechselnd' }" :aria-pressed="form.strategie === 'abwechselnd'" @click="form.strategie = 'abwechselnd'">{{ t('Abwechselnd', 'Alternating') }}</button>
              </div>
              <p v-if="form.strategie === 'frei'" class="leise klein">{{ t('Ziele mit bekanntem freiem Platz kommen zuerst (das mit dem meisten Platz vorn); Ziele ohne Angabe (z. B. S3) folgen in der Reihenfolge der Liste.', 'Destinations with known free space come first (most space first); destinations without a figure (e.g. S3) follow in list order.') }}</p></div>
            <div class="feld"><span id="ab-fb">{{ t('Wenn kein Ziel verfügbar ist', 'If no destination is available') }}</span>
              <div class="seg" role="group" aria-labelledby="ab-fb">
                <button type="button" :class="{ an: form.fallback === 'naechstes' }" :aria-pressed="form.fallback === 'naechstes'" @click="form.fallback = 'naechstes'">{{ t('Nächste Regel', 'Next rule') }}</button>
                <button type="button" :class="{ an: form.fallback === 'lokal' }" :aria-pressed="form.fallback === 'lokal'" @click="form.fallback = 'lokal'">{{ t('Auf den Server (lokal)', 'On the server (local)') }}</button>
                <button type="button" :class="{ an: form.fallback === 'ablehnen' }" :aria-pressed="form.fallback === 'ablehnen'" @click="form.fallback = 'ablehnen'">{{ t('Ablehnen (503)', 'Reject (503)') }}</button>
              </div></div>
          </template>
          <p v-if="verbotOhneBedingung" class="meldung meldung-warn klein">{{ t('Ein Verbot braucht mindestens eine Bedingung oben — sonst würde jeder Upload gesperrt.', 'A ban needs at least one condition above — otherwise every upload would be blocked.') }}</p>
          <p v-if="form.aktion === 'verbieten'" class="leise klein">{{ t('Typ- und Endungsverbote sind keine Sicherheitsgrenze: Name und Typ bestimmt der Absender. Programme (Windows, Linux, macOS) werden zusätzlich am Inhalt erkannt und fallen unter „Andere Dateien“; Skripte und Archive nicht.', 'Type and extension bans are not a security boundary: the sender chooses name and type. Programs (Windows, Linux, macOS) are also recognised by content and count as “Other files”; scripts and archives are not.') }}</p>
          <label v-if="form.aktion === 'verbieten' || form.fallback === 'ablehnen'" class="feld"><span>{{ form.aktion === 'verbieten' ? t('Meldung beim Verbot', 'Message when forbidden') : t('Meldung beim Ablehnen', 'Message when rejecting') }}</span>
            <input v-model="form.meldung" class="eingabe" maxlength="300" :placeholder="form.aktion === 'verbieten' ? t('z. B. Ausführbare Dateien sind hier nicht erlaubt', 'e.g. Executable files are not allowed here') : t('z. B. Speicher gerade nicht erreichbar', 'e.g. Storage currently unreachable')"></label>
        </fieldset>

        <label class="frage-opt"><button type="button" :class="['schalter', { an: form.aktiv }]" role="switch" :aria-checked="form.aktiv" @click="form.aktiv = !form.aktiv"></button><span><b>{{ t('Regel eingeschaltet', 'Rule switched on') }}</b></span></label>
        <div class="modal-fuss"><button type="button" class="knopf" @click="form = null">{{ t('Abbrechen', 'Cancel') }}</button><button class="knopf rot" :disabled="laeuft || !gueltig"><Ico v-if="laeuft" n="loader" spin />{{ t('Speichern', 'Save') }}</button></div>
      </form>
    </VdModal>
  </div>
</template>

<style scoped>
.ab {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.hinweis {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.hinweis > svg {
  width: 20px;
  height: 20px;
  color: var(--a);
  flex-shrink: 0;
  margin-top: 2px;
}
.hinweis p {
  margin: 4px 0 0;
}
.link {
  color: var(--a);
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}
.link:hover,
.link:focus-visible {
  text-decoration: underline;
}
.kopfzeile {
  align-items: center;
}
.ueber {
  font-size: 17px;
  margin: 0;
}
.liste {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.regel.aus {
  opacity: 0.72;
}
.regel.standard {
  border-style: dashed;
  background: transparent;
}
.r-kopf {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.r-kopf .schalter {
  margin-top: 2px;
}
.nr {
  flex: 0 0 26px;
  height: 26px;
  border-radius: 8px;
  background: var(--flaeche2);
  color: var(--text2);
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 600;
}
.was {
  flex: 1;
  min-width: 0;
}
.was b,
.pruef b {
  overflow-wrap: anywhere;
}
.satz {
  margin: 4px 0 0;
  font-size: 14px;
  color: var(--text2);
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.pfeil {
  color: var(--text3);
  margin: 0 2px;
}
.folge {
  font-weight: 600;
  color: var(--text);
}
.folge.verbieten {
  color: var(--rot);
}
.ziele {
  margin: 8px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.r-fuss {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--linie);
}
.klein {
  font-size: 12px;
}
.leer {
  text-align: center;
  padding: 26px 20px;
}
.testfeld h3 {
  margin: 0 0 4px;
}
.test-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 10px;
  align-items: end;
  margin-top: 10px;
}
.ergebnis {
  margin-top: 14px;
  padding: 12px;
  border-radius: 12px;
  background: var(--bg);
  border: 1px solid var(--linie);
}
.ergebnis p {
  margin: 0 0 6px;
}
.meldung-text {
  font-weight: 600;
}
.pruef {
  margin: 8px 0 0;
  padding-left: 18px;
  font-size: 12.5px;
  color: var(--text2);
}
.live {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  background: var(--info-bg);
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 13px;
  margin: 0 0 12px;
  overflow-wrap: anywhere;
}
.live svg {
  width: 15px;
  height: 15px;
  color: var(--info);
  flex-shrink: 0;
  margin-top: 2px;
}
.gruppe {
  border: 1px solid var(--linie);
  background: var(--bg);
  border-radius: 14px;
  padding: 12px 14px 14px;
  margin: 0 0 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.gruppe legend {
  font-weight: 600;
  font-size: 13px;
  padding: 0 6px;
}
.gruppe .feld {
  margin: 0;
}
.zwei {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.wahl {
  border: 1.5px solid var(--linie);
  background: var(--flaeche);
  color: var(--text2);
  border-radius: 99px;
  padding: 5px 12px;
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  display: inline-flex;
  gap: 5px;
  align-items: center;
}
.wahl svg {
  width: 12px;
  height: 12px;
}
.wahl.an {
  border-color: var(--a);
  background: rgba(var(--a-rgb), 0.08);
  color: var(--text);
  font-weight: 600;
}
.wahl:focus-visible,
.seg button:focus-visible {
  outline: 2px solid var(--a);
  outline-offset: 1px;
}
.frage-opt {
  display: flex;
  gap: 12px;
  align-items: center;
  cursor: pointer;
  margin-bottom: 12px;
}
@media (pointer: coarse) {
  .wahl {
    min-height: 44px;
    padding-inline: 16px;
  }
  .link {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
}
@media (max-width: 560px) {
  .zwei {
    grid-template-columns: 1fr;
  }
  .reihe.zw {
    align-items: stretch;
  }
}
</style>
