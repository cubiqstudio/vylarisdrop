<script setup lang="ts">
definePageMeta({ layout: 'leer' })
useHead({ title: () => t('Anmelden', 'Sign in') })
const theme = useTheme()
const form = reactive({ username: '', password: '', code: '' })
const brauchtCode = ref(false)
const fehler = ref('')
const laeuft = ref(false)
const route = useRoute()
onMounted(() => {
  if (route.query.sso_fehler) {
    fehler.value = String(route.query.sso_fehler).slice(0, 300)
    navigateTo({ query: {} }, { replace: true })
  }
})
const sso = computed(() => theme.value.sso?.anbieter || [])
const pwOffen = ref(false)
const zeigePw = computed(() => !theme.value.sso?.passwortAus || pwOffen.value)
const SSO_IC: Record<string, string> = {
  oidc: 'key',
  google: 'globe',
  microsoft: 'grid',
  github: 'code',
  discord: 'users'
}

async function anmelden() {
  fehler.value = ''
  laeuft.value = true
  try {
    const r = await api('/api/auth/login', { method: 'POST', body: { ...form } })
    if (r.require2fa) {
      brauchtCode.value = true
      return
    }
    theme.value = await api('/api/public/theme')
    await navigateTo('/')
  } catch (e: any) {
    fehler.value = e.message
  } finally {
    laeuft.value = false
  }
}
const kannPasskey = ref(false)
onMounted(() => {
  kannPasskey.value = !!(window.isSecureContext && window.PublicKeyCredential)
})
async function mitPasskey() {
  fehler.value = ''
  laeuft.value = true
  try {
    const { startAuthentication } = await import('@simplewebauthn/browser')
    const optionsJSON = await api('/api/passkey/anmelden/start', { method: 'POST' })
    const antwort = await startAuthentication({ optionsJSON })
    await api('/api/passkey/anmelden/ende', { method: 'POST', body: { antwort } })
    theme.value = await api('/api/public/theme')
    await navigateTo('/')
  } catch (e: any) {
    if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') fehler.value = e.message
  } finally {
    laeuft.value = false
  }
}
</script>

<template>
  <div class="mitte">
    <form class="karte-gross rein" @submit.prevent="anmelden">
      <VdMarke />
      <div>
        <h1>{{ brauchtCode ? t('Bestätigungscode', 'Verification code') : t('Willkommen zurück', 'Welcome back') }}</h1>
        <p class="leise">
          {{
            brauchtCode
              ? t(
                  'Gib den Code aus deiner Authenticator-App ein — oder einen Notfall-Code.',
                  'Enter the code from your authenticator app — or a backup code.'
                )
              : theme.marke?.loginText ||
                t('Melde dich an, um deine Dateien zu verwalten.', 'Sign in to manage your files.')
          }}
        </p>
      </div>
      <div v-if="fehler" class="meldung meldung-fehler" role="alert">{{ fehler }}</div>
      <div v-if="sso.length && !brauchtCode" class="sso">
        <a
          v-for="(a, i) in sso"
          :key="a.id"
          :href="`/api/sso/${a.id}/start`"
          class="knopf sso-knopf"
          :style="{ animationDelay: 120 + i * 60 + 'ms' }"
          ><Ico :n="SSO_IC[a.art] || 'key'" /> {{ t(`Weiter mit ${a.name}`, `Continue with ${a.name}`) }}</a
        >
        <div v-if="zeigePw" class="oder">
          <span>{{ t('oder mit Passwort', 'or with password') }}</span>
        </div>
        <button v-else type="button" class="pw-auf" @click="pwOffen = true">
          {{ t('Anmeldung mit Passwort (Inhaber)', 'Sign in with password (owner)') }}
        </button>
      </div>
      <template v-if="!brauchtCode && zeigePw">
        <label class="feld"
          ><span>{{ t('Benutzername oder E-Mail', 'Username or e-mail') }}</span
          ><input v-model="form.username" class="eingabe" autocomplete="username" required :autofocus="!sso.length"
        /></label>
        <label class="feld"
          ><span>{{ t('Passwort', 'Password') }}</span
          ><input v-model="form.password" class="eingabe" type="password" autocomplete="current-password" required
        /></label>
      </template>
      <label v-else-if="brauchtCode" class="feld"
        ><span>Code</span
        ><input
          v-model="form.code"
          class="eingabe mono code"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="11"
          required
          autofocus
      /></label>
      <button v-if="brauchtCode || zeigePw" class="knopf rot gross" :disabled="laeuft">
        <Ico v-if="laeuft" n="loader" spin />{{ brauchtCode ? t('Bestätigen', 'Confirm') : t('Anmelden', 'Sign in') }}
      </button>
      <button
        v-if="kannPasskey && !brauchtCode"
        type="button"
        class="knopf gross passkey"
        :disabled="laeuft"
        @click="mitPasskey"
      >
        <Ico n="key" /> {{ t('Mit Passkey anmelden', 'Sign in with a passkey') }}
      </button>
    </form>
    <VdFuss class="login-fuss" anmeldung />
  </div>
</template>

<style scoped>
.mitte {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px 16px;
  position: relative;
}
.karte-gross {
  width: 100%;
  max-width: 400px;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 22px;
  padding: 30px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  box-shadow: 0 40px 90px -40px rgba(0, 0, 0, 0.55);
}
h1 {
  font-family: var(--f-display);
  font-size: 28px;
  letter-spacing: -0.03em;
  margin-bottom: 4px;
}
p {
  margin: 0;
  font-size: 13.5px;
}
.feld {
  margin: 0;
}
.code {
  font-size: 20px;
  letter-spacing: 0.3em;
  text-align: center;
}
.passkey {
  margin-top: -8px;
}
.gross {
  padding: 11px 16px;
  font-size: 14px;
}
.sso {
  display: grid;
  gap: 8px;
}
.sso-knopf {
  padding: 11px 16px;
  font-size: 13.5px;
  animation: rein 0.45s var(--kurve) backwards;
}
.oder {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text3);
  font-size: 11.5px;
  margin-top: 6px;
}
.oder::before,
.oder::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--linie);
}
.pw-auf {
  border: 0;
  background: none;
  color: var(--text3);
  font-size: 12px;
  cursor: pointer;
  padding: 4px;
}
.pw-auf:hover {
  color: var(--text);
}
.login-fuss {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
}
</style>
