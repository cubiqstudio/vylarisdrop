<script setup lang="ts">
// "Mein Team": Speicher des eigenen Teams, Mitgliederliste, für die Leitung Mitglieder verwalten (Teil von Pro "Teams").
useHead({ title: () => t('Mein Team', 'My team') })
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const { data } = await (useFetch as any)('/api/team', { key: 'team' })
// Live: Mitgliedschaft und Team-Kontingent ('teams'), Dateien und Papierkorb (Team-Speicher). Gebündelt, still bei Fehlern;
// getippte Eingaben und offene Vorschläge liegen in VdTeamHinzufuegen und bleiben beim Neuladen unberührt.
useLiveDaten({ daten: [{ schluessel: 'team', url: '/api/team' }], themen: ['teams', 'dateien', 'papierkorb'], mind: 1500 })

const pro = computed<boolean>(() => data.value?.pro !== false)
const admin = computed<boolean>(() => !!data.value?.admin)
const teams = computed<any[]>(() => data.value?.teams || [])

async function neuLaden() {
  try {
    const neu = await ($fetch as any)('/api/team', { headers: { accept: 'application/json' }, retry: 0 })
    if (JSON.stringify(neu) !== JSON.stringify(data.value)) data.value = neu
  } catch {}
}
async function aktion(url: string, opt: Record<string, any>, text: string) {
  try {
    await api(url, opt)
    ok(text)
  } catch (e: any) {
    fehler(e.message)
  }
  await neuLaden()
}

const anzahlLeitung = (tm: any) => tm.mitglieder.filter((m: any) => m.rolle === 'leitung').length
const einzigeLeitung = (tm: any, m: any) => m.rolle === 'leitung' && anzahlLeitung(tm) <= 1
const rolleText = (r: string) => (r === 'leitung' ? t('Leitung', 'Lead') : t('Mitglied', 'Member'))
const anzahlText = (n: number) => t(`${n} ${n === 1 ? 'Mitglied' : 'Mitglieder'}`, `${n} ${n === 1 ? 'member' : 'members'}`)
const initial = (n: string) => (n.slice(0, 1) || '?').toUpperCase()

function rolleAendern(tm: any, m: any, rolle: string) {
  if (rolle === m.rolle) return
  void aktion(
    `/api/team/${tm.id}/mitglieder/${m.id}`,
    { method: 'PATCH', body: { rolle } },
    t(`${m.name} ist jetzt ${rolleText(rolle)}.`, `${m.name} is now ${rolleText(rolle).toLowerCase()}.`)
  )
}
function entfernen(tm: any, m: any) {
  bestaetigen(
    t('Mitglied entfernen?', 'Remove member?'),
    t(
      `${m.name} verliert den Zugriff auf die Team-Ordner von „${tm.name}“. Dateien, die ${m.name} dort angelegt hat, bleiben im Team-Ordner.`,
      `${m.name} loses access to the team folders of “${tm.name}”. Files ${m.name} created there stay in the team folder.`
    ),
    t('Entfernen', 'Remove'),
    () => aktion(`/api/team/${tm.id}/mitglieder/${m.id}`, { method: 'DELETE' }, t(`${m.name} wurde entfernt.`, `${m.name} was removed.`))
  )
}
function verlassen(tm: any) {
  const ich = tm.mitglieder.find((m: any) => m.ich)
  if (!ich) return
  bestaetigen(
    t('Team verlassen?', 'Leave team?'),
    t(
      `Du verlierst den Zugriff auf die Team-Ordner von „${tm.name}“. Deine Dateien dort bleiben im Team-Ordner. Zurück kommst du nur, wenn dich die Leitung wieder hinzufügt.`,
      `You lose access to the team folders of “${tm.name}”. Your files there stay in the team folder. You can only return if the lead adds you again.`
    ),
    t('Team verlassen', 'Leave team'),
    () => aktion(`/api/team/${tm.id}/mitglieder/${ich.id}`, { method: 'DELETE' }, t(`Du hast „${tm.name}“ verlassen.`, `You left “${tm.name}”.`))
  )
}
const warnText = (s: any) => {
  const von = `${groesse(s.belegt)} ${t('von', 'of')} ${groesse(s.limit)}`
  const p = Math.floor(s.prozent || 0)
  if (s.stufe === 'voll')
    return t(
      `Das Team-Kontingent ist voll (${von}). Neue Uploads in Team-Ordner werden abgelehnt, bis Platz geschaffen wird.`,
      `The team quota is full (${von}). New uploads to team folders are rejected until space is freed.`
    )
  if (s.stufe === 'kritisch') return t(`Der Team-Speicher ist fast voll: ${p} % belegt (${von}).`, `The team storage is almost full: ${p}% used (${von}).`)
  return t(`Der Team-Speicher ist zu ${p} % belegt (${von}).`, `The team storage is ${p}% full (${von}).`)
}
</script>

<template>
  <section class="rein">
    <div class="kopf">
      <div>
        <div class="eyebrow"><Ico n="users" /> {{ t('Cloud', 'Cloud') }}</div>
        <h1>{{ t('Mein Team', 'My team') }}</h1>
        <p>
          {{
            t(
              'Wie viel Speicher dein Team hat, wer dabei ist und – für die Team-Leitung – wer neu hinzukommt.',
              'How much storage your team has, who is in it and – for the team lead – who joins next.'
            )
          }}
        </p>
      </div>
    </div>

    <div v-if="!pro" class="block leer-hinweis">
      <h3>{{ t('Teams gehören zu Pro', 'Teams are part of Pro') }}</h3>
      <p>
        {{
          t(
            'Gemeinsame Team-Ordner, Team-Speicher und Team-Rollen sind Teil von VylarisCloud Pro. Sobald Pro aktiv ist, erscheinen hier deine Teams.',
            'Shared team folders, team storage and team roles are part of VylarisCloud Pro. Once Pro is active, your teams appear here.'
          )
        }}
      </p>
      <NuxtLink v-if="admin" class="knopf" to="/pro">{{ t('Pro ansehen', 'View Pro') }}</NuxtLink>
    </div>

    <div v-else-if="!teams.length" class="block leer-hinweis">
      <h3>{{ t('Du bist noch in keinem Team', 'You are not in a team yet') }}</h3>
      <p>
        {{
          t(
            'Ein Admin oder die Leitung eines Teams muss dich hinzufügen. Danach siehst du hier den Team-Speicher und alle Mitglieder.',
            'An admin or the lead of a team has to add you. After that you see the team storage and all members here.'
          )
        }}
      </p>
      <NuxtLink v-if="admin" class="knopf" to="/teams">{{ t('Teams & Rollen verwalten', 'Manage teams & roles') }}</NuxtLink>
    </div>

    <template v-else>
      <article
        v-for="tm in teams"
        :key="tm.id"
        class="block team"
        :style="{ '--f': tm.farbe }"
        :aria-labelledby="`team-${tm.id}-titel`"
      >
        <header class="t-kopf">
          <span class="farbe" aria-hidden="true"></span>
          <div class="t-name">
            <h2 :id="`team-${tm.id}-titel`">{{ tm.name }}</h2>
            <p v-if="tm.beschreibung" class="leise">{{ tm.beschreibung }}</p>
          </div>
          <span class="chip" :class="tm.meineRolle === 'leitung' ? 'info' : 'neutral'">
            {{ t('Deine Rolle:', 'Your role:') }} {{ rolleText(tm.meineRolle) }}
          </span>
        </header>

        <section class="t-speicher" :aria-labelledby="`team-${tm.id}-sp`">
          <div class="reihe zw">
            <h3 :id="`team-${tm.id}-sp`">{{ t('Team-Speicher', 'Team storage') }}</h3>
            <span v-if="tm.speicher.limit" class="chip" :class="tm.speicher.stufe === 'ok' ? 'neutral' : tm.speicher.stufe === 'warn' ? 'warn' : 'rot'">
              {{ zahl(tm.speicher.prozent || 0, 1) }} %
            </span>
            <span v-else class="chip neutral">{{ t('Kein Limit', 'No limit') }}</span>
          </div>
          <div v-if="tm.speicher.limit" class="t-gross">
            <b class="zahl">{{ groesse(tm.speicher.belegt) }}</b>
            <span class="leise">&nbsp;{{ t('von', 'of') }} {{ groesse(tm.speicher.limit) }} {{ t('belegt', 'used') }} · {{ groesse(tm.speicher.frei ?? 0) }} {{ t('frei', 'free') }}</span>
          </div>
          <div v-else class="t-gross">
            <span class="leise">{{ t('ohne Limit – belegt:', 'no limit – used:') }}&nbsp;</span><b class="zahl">{{ groesse(tm.speicher.belegt) }}</b>
          </div>
          <VdQuotaBalken :used="tm.speicher.belegt" :limit="tm.speicher.limit" gross :beschriftung="t(`Speicher von ${tm.name}`, `Storage of ${tm.name}`)" />
          <div v-if="tm.speicher.limit && tm.speicher.stufe !== 'ok'" class="meldung t-warn" :class="tm.speicher.stufe === 'warn' ? 'meldung-warn' : 'meldung-fehler'" role="status">
            <Ico n="alert" /> {{ warnText(tm.speicher) }}
          </div>
          <p v-if="tm.speicher.sonstige > 0" class="sehrleise t-klein">
            {{ t(`${groesse(tm.speicher.sonstige)} davon stammen von Konten, die nicht (mehr) im Team sind.`, `${groesse(tm.speicher.sonstige)} of this come from accounts that are not (or no longer) in the team.`) }}
          </p>
          <p class="sehrleise t-klein">
            {{ t('Es zählen alle Dateien in den Team-Ordnern samt Unterordnern und Papierkorb.', 'All files in the team folders count, including subfolders and trash.') }}
          </p>
          <NuxtLink class="knopf" to="/?ansicht=team"><Ico n="folder" /> {{ t('Team-Ordner öffnen', 'Open team folders') }}</NuxtLink>
        </section>

        <section class="t-mitglieder" :aria-labelledby="`team-${tm.id}-mi`">
          <div class="reihe zw">
            <h3 :id="`team-${tm.id}-mi`">{{ t('Mitglieder', 'Members') }}</h3>
            <span class="leise">{{ anzahlText(tm.mitgliederZahl) }}</span>
          </div>
          <ul class="t-liste">
            <li v-for="m in tm.mitglieder" :key="m.name" class="t-zeile">
              <span class="av" aria-hidden="true">{{ initial(m.name) }}</span>
              <div class="t-wer">
                <b>{{ m.name }}<small v-if="m.ich" class="leise"> ({{ t('du', 'you') }})</small></b>
                <small class="sehrleise">
                  {{ t('seit', 'since') }} {{ datum(m.beigetreten) }} · {{ groesse(m.belegt) }} {{ t('belegt', 'used') }}
                </small>
              </div>
              <span class="chip" :class="m.rolle === 'leitung' ? 'info' : 'neutral'">{{ rolleText(m.rolle) }}</span>
              <div v-if="tm.darfVerwalten && !m.geschuetzt && m.id" class="t-aktionen">
                <VdAuswahl
                  class="eingabe klein-sel"
                  :model-value="m.rolle"
                  :disabled="einzigeLeitung(tm, m)"
                  :aria-label="t(`Rolle von ${m.name}`, `Role of ${m.name}`)"
                  @change="(r: any) => rolleAendern(tm, m, r)"
                >
                  <option value="mitglied">{{ t('Mitglied', 'Member') }}</option>
                  <option value="leitung">{{ t('Leitung', 'Lead') }}</option>
                </VdAuswahl>
                <button
                  class="knopf nur-icon"
                  type="button"
                  :disabled="einzigeLeitung(tm, m)"
                  :aria-label="t(`${m.name} entfernen`, `Remove ${m.name}`)"
                  :title="einzigeLeitung(tm, m) ? t('Einzige Leitung – ernenne zuerst jemand anderen.', 'Only lead – promote someone else first.') : t('Entfernen', 'Remove')"
                  @click="entfernen(tm, m)"
                >
                  <Ico n="x" />
                </button>
              </div>
              <p v-if="tm.darfVerwalten && einzigeLeitung(tm, m)" class="t-hinweis sehrleise">
                {{ t('Einzige Leitung: ernenne zuerst jemand anderen zur Leitung, bevor du die Rolle änderst oder das Team verlässt.', 'Only lead: promote someone else to lead before you change the role or leave the team.') }}
              </p>
              <p v-else-if="tm.darfVerwalten && m.geschuetzt" class="t-hinweis sehrleise">
                {{ t('Admin-Konto – nur ein Admin kann es hier ändern.', 'Admin account – only an admin can change it here.') }}
              </p>
            </li>
          </ul>
        </section>

        <VdTeamHinzufuegen v-if="tm.darfVerwalten" :team-id="tm.id" class="t-dazu" @hinzugefuegt="neuLaden" />

        <footer class="t-fuss">
          <button
            class="knopf"
            type="button"
            :disabled="tm.mitglieder.some((m: any) => m.ich && einzigeLeitung(tm, m))"
            :title="tm.mitglieder.some((m: any) => m.ich && einzigeLeitung(tm, m)) ? t('Du bist die einzige Leitung – ernenne zuerst jemand anderen.', 'You are the only lead – promote someone else first.') : undefined"
            @click="verlassen(tm)"
          >
            {{ t('Team verlassen', 'Leave team') }}
          </button>
        </footer>
      </article>
    </template>
  </section>
</template>

<style scoped>
.team {
  margin-bottom: 16px;
  display: grid;
  gap: 18px;
  border-top: 3px solid var(--f);
}
.team + .team {
  margin-top: 0;
}
.t-kopf {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.t-name {
  flex: 1;
  min-width: 160px;
}
.t-name h2 {
  font-family: var(--f-display);
  font-size: 22px;
  letter-spacing: -0.02em;
  margin: 0;
  overflow-wrap: anywhere;
}
.t-name p {
  margin: 2px 0 0;
  font-size: 13px;
}
.farbe {
  width: 14px;
  height: 14px;
  border-radius: 5px;
  background: var(--f);
  flex-shrink: 0;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--f) 18%, transparent);
}
.t-speicher {
  display: grid;
  gap: 10px;
}
.t-speicher .knopf {
  justify-self: start;
}
.t-speicher h3,
.t-mitglieder h3 {
  margin: 0;
}
.t-gross {
  font-size: 15px;
}
.t-gross b {
  font-size: 22px;
  font-family: var(--f-display);
}
.t-klein {
  margin: 0;
  font-size: 12px;
}
.t-warn {
  margin: 0;
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.t-warn svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  margin-top: 2px;
}
.t-mitglieder {
  display: grid;
  gap: 8px;
}
.t-liste {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
.t-zeile {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  background: var(--flaeche2);
  border-radius: 12px;
  padding: 10px 12px;
}
.av {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--a), color-mix(in srgb, var(--a) 55%, #000));
  color: #fff;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 13px;
  font-family: var(--f-display);
  flex-shrink: 0;
}
.t-wer {
  flex: 1;
  min-width: 120px;
  display: flex;
  flex-direction: column;
  overflow-wrap: anywhere;
}
.t-wer b {
  font-size: 14px;
  font-weight: 600;
}
.t-wer small {
  font-size: 12px;
}
.t-aktionen {
  display: flex;
  gap: 6px;
  align-items: center;
}
.klein-sel {
  width: auto;
  padding: 6px 10px;
  font-size: 12.5px;
}
.t-hinweis {
  flex-basis: 100%;
  margin: 0;
  font-size: 12px;
}
.t-dazu {
  padding-top: 14px;
  border-top: 1px solid var(--linie);
}
.t-fuss {
  display: flex;
  justify-content: flex-end;
  padding-top: 12px;
  border-top: 1px solid var(--linie);
}
@media (max-width: 520px) {
  .t-aktionen {
    flex-basis: 100%;
    justify-content: flex-end;
  }
  .t-name h2 {
    font-size: 19px;
  }
}
</style>
