<script setup lang="ts">
useHead({ title: () => t('Anmeldung (SSO)', 'Sign-in (SSO)') })
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const { data: pro } = await (useFetch as any)('/api/pro', { key: 'pro' })
const an = computed(() => !!pro.value?.funktionen?.sso)
const { data, refresh } = await (useFetch as any)('/api/pro/sso', { key: 'sso', immediate: an.value })
const { data: tr } = await (useFetch as any)('/api/pro/teams', { key: 'teams', immediate: an.value })
const liste = ref<any[]>([])
const passwortAus = ref(false)
watch(
  data,
  (d) => {
    if (d) {
      liste.value = d.anbieter.map((a: any) => ({ ...a, domainsText: a.domains.join(', ') }))
      passwortAus.value = d.passwortAus
    }
  },
  { immediate: true }
)

const ARTEN = computed(() => [
  {
    k: 'oidc',
    name: 'OpenID Connect',
    text: t(
      'Authentik, Keycloak, Authelia, Zitadel, Okta, Auth0 …',
      'Authentik, Keycloak, Authelia, Zitadel, Okta, Auth0 …'
    ),
    ic: 'key'
  },
  { k: 'google', name: 'Google', text: t('Google-Konten und Workspace', 'Google accounts and Workspace'), ic: 'globe' },
  {
    k: 'microsoft',
    name: 'Microsoft',
    text: t('Entra ID (Azure AD), Microsoft 365', 'Entra ID (Azure AD), Microsoft 365'),
    ic: 'grid'
  },
  { k: 'github', name: 'GitHub', text: t('GitHub-Konten', 'GitHub accounts'), ic: 'code' },
  { k: 'discord', name: 'Discord', text: t('Discord-Konten', 'Discord accounts'), ic: 'users' }
])
const artName = (k: string) => ARTEN.value.find((a) => a.k === k)?.name || k
const form = ref<any>(null)
const waehlen = ref(false)
function neu(art: string) {
  const name = artName(art)
  const id = art === 'oidc' ? 'sso' : art
  let n = id,
    i = 2
  while (liste.value.some((a) => a.id === n)) n = `${id}-${i++}`
  form.value = {
    neu: true,
    id: n,
    art,
    name,
    aktiv: true,
    clientId: '',
    clientSecret: '',
    issuer: art === 'microsoft' ? 'common' : '',
    scopes: '',
    autoAnlegen: false,
    domainsText: '',
    perEmail: false,
    rolleId: null,
    teamId: null,
    adminGruppe: '',
    hatGeheimnis: false
  }
  waehlen.value = false
}
const rueck = computed(() => (form.value ? `${data.value?.basis || ''}/api/sso/${form.value.id}/callback` : ''))
const kopiert = ref(false)
async function rueckKopieren() {
  if (await kopieren(rueck.value)) {
    kopiert.value = true
    setTimeout(() => {
      kopiert.value = false
    }, 1600)
  }
}

const laeuft = ref(false)
async function alleSpeichern(neueListe: any[], text: string) {
  laeuft.value = true
  try {
    await api('/api/pro/sso', {
      method: 'POST',
      body: {
        passwortAus: passwortAus.value,
        anbieter: neueListe.map((a) => ({
          id: a.id,
          art: a.art,
          name: a.name,
          aktiv: a.aktiv,
          clientId: a.clientId,
          clientSecret: a.clientSecret || '',
          issuer: a.issuer || '',
          scopes: a.scopes || '',
          autoAnlegen: a.autoAnlegen,
          domains: String(a.domainsText || '')
            .split(/[\s,;]+/)
            .map((d: string) => d.trim().toLowerCase())
            .filter(Boolean),
          perEmail: a.perEmail,
          rolleId: a.rolleId ? Number(a.rolleId) : null,
          teamId: a.teamId ? Number(a.teamId) : null,
          adminGruppe: a.adminGruppe || ''
        }))
      }
    })
    await refresh()
    ok(text)
    return true
  } catch (e: any) {
    fehler(e.message)
    return false
  } finally {
    laeuft.value = false
  }
}
async function formSpeichern() {
  const f = { ...form.value }
  const rest = liste.value.filter((a) => a.id !== f.id || f.neu)
  if (f.neu && rest.some((a) => a.id === f.id))
    return fehler(t('Diese Kennung gibt es schon.', 'This ID already exists.'))
  const neueListe = f.neu ? [...rest, f] : liste.value.map((a) => (a.id === f.id ? f : a))
  if (await alleSpeichern(neueListe, t('Anbieter gespeichert', 'Provider saved'))) form.value = null
}
const umschalten = (a: any) =>
  alleSpeichern(
    liste.value.map((x) => (x.id === a.id ? { ...x, aktiv: !x.aktiv } : x)),
    a.aktiv ? t('Abgeschaltet', 'Disabled') : t('Eingeschaltet', 'Enabled')
  )
function entfernen(a: any) {
  bestaetigen(
    t('Anbieter entfernen?', 'Remove provider?'),
    t(
      `Konten, die sich über ${a.name} angemeldet haben, bleiben bestehen — sie brauchen dann ein Passwort oder einen anderen Anbieter.`,
      `Accounts that signed in via ${a.name} remain — they then need a password or another provider.`
    ),
    t('Entfernen', 'Remove'),
    async () => {
      await alleSpeichern(
        liste.value.filter((x) => x.id !== a.id),
        t('Entfernt', 'Removed')
      )
    }
  )
}
async function pwUmschalten() {
  passwortAus.value = !passwortAus.value
  if (
    !(await alleSpeichern(
      liste.value,
      passwortAus.value
        ? t('Nur noch SSO-Anmeldung', 'SSO sign-in only')
        : t('Passwort-Anmeldung wieder an', 'Password sign-in back on')
    ))
  )
    passwortAus.value = !passwortAus.value
}
</script>

<template>
  <section class="rein">
    <div class="kopf">
      <div>
        <div class="eyebrow"><Ico n="tuer" /> Pro</div>
        <h1>{{ t('Anmeldung (SSO)', 'Sign-in (SSO)') }}</h1>
        <p>
          {{
            t(
              'Anmelden mit dem Konto, das dein Team ohnehin hat — einmal eingerichtet, kein weiteres Passwort.',
              'Sign in with the account your team already has — set up once, no extra password.'
            )
          }}
        </p>
      </div>
      <button v-if="an" class="knopf rot" @click="waehlen = true">
        <Ico n="plus" /> {{ t('Anbieter hinzufügen', 'Add provider') }}
      </button>
    </div>

    <VdProSperre
      v-if="!an"
      ic="tuer"
      :titel="t('Anmeldung über SSO', 'Single sign-on')"
      :text="
        t(
          'Verbinde VylarisCloud mit deinem Identitätsanbieter. Neue Personen bekommen beim ersten Anmelden automatisch ein Konto — mit Rolle und Team.',
          'Connect VylarisCloud to your identity provider. New people get an account automatically on first sign-in — with role and team.'
        )
      "
      :punkte="[
        t(
          'OpenID Connect: Authentik, Keycloak, Authelia, Zitadel …',
          'OpenID Connect: Authentik, Keycloak, Authelia, Zitadel …'
        ),
        'Google, Microsoft, GitHub, Discord',
        t('Nur bestimmte E-Mail-Domains zulassen', 'Allow only certain email domains'),
        t('Gruppe aus dem Anbieter → Admin-Rechte', 'Group from the provider → admin rights')
      ]"
    />

    <template v-else>
      <div v-if="!liste.length" class="leer-hinweis block">
        <h3>{{ t('Noch kein Anbieter', 'No provider yet') }}</h3>
        <p>
          {{
            t(
              'Füge einen Anbieter hinzu — die Knöpfe erscheinen dann auf der Anmeldeseite.',
              'Add a provider — the buttons then appear on the sign-in page.'
            )
          }}
        </p>
      </div>
      <div class="liste">
        <div
          v-for="(a, i) in liste"
          :key="a.id"
          :class="['anb', { aus: !a.aktiv }]"
          :style="{ animationDelay: i * 50 + 'ms' }"
        >
          <span class="ic"><Ico :n="ARTEN.find((x) => x.k === a.art)?.ic || 'key'" /></span>
          <div class="was">
            <b>{{ a.name }}</b
            ><small
              >{{ artName(a.art) }} · <span class="mono">{{ a.id }}</span
              ><template v-if="a.autoAnlegen"> · {{ t('legt Konten an', 'creates accounts') }}</template
              ><template v-if="a.domains.length"> · {{ a.domains.join(', ') }}</template></small
            >
          </div>
          <button
            :class="['schalter', { an: a.aktiv }]"
            role="switch"
            :aria-checked="a.aktiv"
            :aria-label="t('Aktiv', 'Active')"
            :disabled="laeuft"
            @click="umschalten(a)"
          ></button>
          <button
            class="knopf nur-icon"
            :aria-label="t('Bearbeiten', 'Edit')"
            @click="form = { ...a, clientSecret: '' }"
          >
            <Ico n="edit" />
          </button>
          <button class="knopf nur-icon" :aria-label="t('Entfernen', 'Remove')" @click="entfernen(a)">
            <Ico n="trash" />
          </button>
        </div>
      </div>
      <div class="block pw">
        <button
          :class="['schalter', { an: passwortAus }]"
          role="switch"
          :aria-checked="passwortAus"
          :disabled="laeuft || !liste.some((a) => a.aktiv)"
          @click="pwUmschalten"
        ></button>
        <div>
          <b>{{ t('Nur noch über SSO anmelden', 'Sign in via SSO only') }}</b>
          <p class="leise">
            {{
              t(
                'Alle außer dir als Inhaber melden sich dann nur noch über einen Anbieter an. Dein Passwort bleibt der Notausgang, falls der Anbieter einmal ausfällt.',
                'Everyone except you as the owner then signs in only via a provider. Your password stays the way in if the provider ever fails.'
              )
            }}
          </p>
        </div>
      </div>
    </template>

    <VdModal v-if="waehlen" :titel="t('Welcher Anbieter?', 'Which provider?')" @zu="waehlen = false">
      <div class="arten">
        <button
          v-for="(a, i) in ARTEN"
          :key="a.k"
          type="button"
          class="art"
          :style="{ animationDelay: i * 40 + 'ms' }"
          @click="neu(a.k)"
        >
          <span class="ic"><Ico :n="a.ic" /></span
          ><span
            ><b>{{ a.name }}</b
            ><small>{{ a.text }}</small></span
          ><Ico n="right" class="pfeil" />
        </button>
      </div>
    </VdModal>

    <VdModal v-if="form" breit :titel="form.neu ? artName(form.art) : form.name" @zu="form = null">
      <form @submit.prevent="formSpeichern">
        <div class="rueck">
          <span>{{
            t('Rücksprung-Adresse — beim Anbieter eintragen:', 'Redirect URL — enter it at the provider:')
          }}</span>
          <button type="button" class="mono" @click="rueckKopieren">
            {{ rueck }} <Ico :n="kopiert ? 'check' : 'copy'" />
          </button>
        </div>
        <div class="zwei">
          <label class="feld"
            ><span>{{ t('Name auf dem Knopf', 'Name on the button') }}</span
            ><input v-model="form.name" class="eingabe" required maxlength="40"
          /></label>
          <label class="feld"
            ><span>{{ t('Kennung (in der Adresse)', 'ID (in the URL)') }}</span
            ><input
              v-model="form.id"
              class="eingabe mono"
              required
              pattern="[a-z0-9][a-z0-9-]{1,23}"
              :disabled="!form.neu"
          /></label>
        </div>
        <label v-if="form.art === 'oidc'" class="feld"
          ><span>{{ t('Aussteller-Adresse (Issuer)', 'Issuer URL') }}</span
          ><input
            v-model="form.issuer"
            class="eingabe mono"
            required
            placeholder="https://auth.example.com/application/o/vylariscloud"
            type="url"
          /><small>{{
            t('Dort liegt /.well-known/openid-configuration.', '/.well-known/openid-configuration lives there.')
          }}</small></label
        >
        <label v-if="form.art === 'microsoft'" class="feld"
          ><span>Tenant</span><input v-model="form.issuer" class="eingabe mono" placeholder="common" /><small>{{
            t(
              'common (alle), organizations (nur Firmen) oder die Tenant-ID deiner Organisation.',
              "common (all), organizations (work only) or your organisation's tenant ID."
            )
          }}</small></label
        >
        <div class="zwei">
          <label class="feld"
            ><span>Client-ID</span><input v-model="form.clientId" class="eingabe mono" required autocomplete="off"
          /></label>
          <label class="feld"
            ><span>{{ t('Client-Geheimnis', 'Client secret') }}</span
            ><input
              v-model="form.clientSecret"
              class="eingabe mono"
              type="password"
              autocomplete="new-password"
              :required="!form.hatGeheimnis"
              :placeholder="form.hatGeheimnis ? t('gespeichert — leer lassen', 'saved — leave empty') : ''"
          /></label>
        </div>
        <h4>{{ t('Neue Personen', 'New people') }}</h4>
        <label class="opt"
          ><button
            type="button"
            :class="['schalter', { an: form.autoAnlegen }]"
            role="switch"
            :aria-checked="form.autoAnlegen"
            @click="form.autoAnlegen = !form.autoAnlegen"
          ></button
          ><span
            ><b>{{ t('Konto automatisch anlegen', 'Create account automatically') }}</b
            ><small>{{
              t(
                'Sonst kommen nur Personen herein, deren Konto ein Admin angelegt und die es verknüpft haben.',
                'Otherwise only people whose account an admin created and who linked it can get in.'
              )
            }}</small></span
          ></label
        >
        <label class="opt"
          ><button
            type="button"
            :class="['schalter', { an: form.perEmail }]"
            role="switch"
            :aria-checked="form.perEmail"
            @click="form.perEmail = !form.perEmail"
          ></button
          ><span
            ><b>{{ t('Per E-Mail verknüpfen', 'Link by email') }}</b
            ><small>{{
              t(
                'Gibt es schon ein Konto mit derselben, vom Anbieter bestätigten E-Mail, wird es verbunden (nie das Inhaber-Konto).',
                'If an account with the same email confirmed by the provider exists, it is linked (never the owner account).'
              )
            }}</small></span
          ></label
        >
        <label class="feld"
          ><span>{{ t('Nur diese E-Mail-Domains (optional)', 'Only these email domains (optional)') }}</span
          ><input v-model="form.domainsText" class="eingabe mono" placeholder="firma.de, firma.com"
        /></label>
        <div class="zwei">
          <label class="feld"
            ><span>{{ t('Rolle für neue Konten', 'Role for new accounts') }}</span
            ><VdAuswahl v-model="form.rolleId" class="eingabe"
              ><option :value="null">{{ t('ohne', 'none') }}</option>
              <option v-for="r in tr?.rollen || []" :key="r.id" :value="r.id">{{ r.name }}</option></VdAuswahl
            ></label
          >
          <label class="feld"
            ><span>{{ t('Team für neue Konten', 'Team for new accounts') }}</span
            ><VdAuswahl v-model="form.teamId" class="eingabe"
              ><option :value="null">{{ t('ohne', 'none') }}</option>
              <option v-for="tm in tr?.teams || []" :key="tm.id" :value="tm.id">{{ tm.name }}</option></VdAuswahl
            ></label
          >
        </div>
        <details class="mehr">
          <summary>{{ t('Erweitert', 'Advanced') }}</summary>
          <label class="feld"
            ><span>{{ t('Admin-Gruppe', 'Admin group') }}</span
            ><input v-model="form.adminGruppe" class="eingabe mono" placeholder="vylariscloud-admins" /><small>{{
              t(
                'Wer im Claim „groups“ diese Gruppe hat, wird Admin. Dafür den Scope „groups“ eintragen.',
                'Anyone with this group in the "groups" claim becomes admin. Add the "groups" scope for this.'
              )
            }}</small></label
          >
          <label class="feld"
            ><span>{{ t('Zusätzliche Scopes', 'Additional scopes') }}</span
            ><input v-model="form.scopes" class="eingabe mono" placeholder="groups"
          /></label>
        </details>
        <div class="modal-fuss">
          <button type="button" class="knopf" @click="form = null">{{ t('Abbrechen', 'Cancel') }}</button
          ><button class="knopf rot" :disabled="laeuft">
            <Ico v-if="laeuft" n="loader" spin /> {{ t('Speichern', 'Save') }}
          </button>
        </div>
      </form>
    </VdModal>
  </section>
</template>

<style scoped>
.liste {
  display: grid;
  gap: 8px;
  margin-bottom: 14px;
}
.anb {
  display: flex;
  gap: 14px;
  align-items: center;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 16px;
  padding: 14px 16px;
  animation: rein 0.45s var(--kurve) backwards;
  transition: opacity 0.3s;
}
.anb.aus {
  opacity: 0.6;
}
.ic {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: rgba(var(--a-rgb), 0.1);
  color: var(--a);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.ic svg {
  width: 18px;
  height: 18px;
}
.was {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.was small {
  color: var(--text3);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pw {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.pw p {
  margin: 4px 0 0;
  font-size: 12.5px;
  max-width: 620px;
}
.arten {
  display: grid;
  gap: 8px;
}
.art {
  display: flex;
  gap: 14px;
  align-items: center;
  text-align: left;
  border: 1px solid var(--linie);
  background: var(--bg);
  border-radius: 14px;
  padding: 12px 14px;
  cursor: pointer;
  color: var(--text);
  animation: rein 0.4s var(--kurve) backwards;
  transition:
    border-color 0.2s,
    transform 0.2s var(--kurve);
}
.art:hover {
  border-color: var(--a);
  transform: translateX(3px);
}
.art small {
  display: block;
  color: var(--text3);
  font-size: 12px;
}
.art span:nth-child(2) {
  flex: 1;
}
.pfeil {
  width: 15px;
  height: 15px;
  color: var(--text3);
}
.rueck {
  background: var(--flaeche2);
  border-radius: 12px;
  padding: 10px 12px;
  margin-bottom: 16px;
  font-size: 12px;
  color: var(--text2);
  display: grid;
  gap: 6px;
}
.rueck button {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  border: 1px solid var(--linie);
  background: var(--bg);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 12px;
  cursor: pointer;
  color: var(--text);
  text-align: left;
  overflow-wrap: anywhere;
}
.rueck svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.zwei {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
h4 {
  font-size: 13px;
  margin: 6px 0 10px;
}
.opt {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 12px;
  cursor: pointer;
}
.opt small {
  display: block;
  color: var(--text3);
  font-size: 12px;
}
.mehr summary {
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
}
@media (max-width: 640px) {
  .zwei {
    grid-template-columns: 1fr;
  }
}
</style>
