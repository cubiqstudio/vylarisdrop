<script setup lang="ts">
useHead({ title: () => t('Eigene Marke', 'Own branding') })
const theme = useTheme()
const { ok, fehler } = useToast()
const istInhaber = computed(() => theme.value.user?.role === 'owner')
const { data: pro } = await (useFetch as any)('/api/pro', { key: 'pro' })
const an = computed(() => !!pro.value?.funktionen?.['white-label'])
const { data, refresh } = await (useFetch as any)('/api/pro/marke', { key: 'marke' })
const f = reactive({
  logo: null as string | null,
  icon: null as string | null,
  nurLogo: false,
  ohneHinweis: false,
  loginText: '',
  fusszeile: ''
})
const logoVorschau = ref(''),
  iconVorschau = ref('')
watch(
  data,
  (d) => {
    if (!d) return
    Object.assign(f, {
      logo: null,
      icon: null,
      nurLogo: d.nurLogo,
      ohneHinweis: d.ohneHinweis,
      loginText: d.loginText,
      fusszeile: d.fusszeile
    })
    logoVorschau.value = d.hatLogo ? `/api/public/marke/logo?v=${Date.now()}` : ''
    iconVorschau.value = d.hatIcon ? `/api/public/marke/icon?v=${Date.now()}` : ''
  },
  { immediate: true }
)

async function bildWaehlen(art: 'logo' | 'icon', e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!file) return
  if (file.size > 400 * 1024) return fehler(t('Das Bild ist größer als 400 KB.', 'The image is larger than 400 KB.'))
  if (!/^image\/(png|jpeg|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(file.type))
    return fehler(t('Erlaubt sind PNG, JPEG, WebP, SVG und ICO.', 'Allowed are PNG, JPEG, WebP, SVG and ICO.'))
  const url = await new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = rej
    r.readAsDataURL(file)
  })
  f[art] = url
  if (art === 'logo') logoVorschau.value = url
  else iconVorschau.value = url
}
function bildWeg(art: 'logo' | 'icon') {
  f[art] = ''
  if (art === 'logo') logoVorschau.value = ''
  else iconVorschau.value = ''
}
const logoFeld = ref<HTMLInputElement | null>(null),
  iconFeld = ref<HTMLInputElement | null>(null)

const laeuft = ref(false)
async function speichern() {
  laeuft.value = true
  try {
    const body: Record<string, any> = {
      nurLogo: f.nurLogo,
      ohneHinweis: f.ohneHinweis,
      loginText: f.loginText,
      fusszeile: f.fusszeile
    }
    if (f.logo !== null) body.logo = f.logo || null
    if (f.icon !== null) body.icon = f.icon || null
    await api('/api/pro/marke', { method: 'POST', body })
    await refresh()
    theme.value = { ...theme.value, ...(await api('/api/public/theme')) }
    ok(t('Gespeichert', 'Saved'))
  } catch (e: any) {
    fehler(e.message)
  } finally {
    laeuft.value = false
  }
}
const vorschauHell = ref(false)
</script>

<template>
  <section class="rein">
    <div class="kopf">
      <div>
        <div class="eyebrow"><Ico n="palette" /> Pro</div>
        <h1>{{ t('Eigene Marke', 'Own branding') }}</h1>
        <p>
          {{
            t(
              'Dein Logo, dein Symbol, deine Worte — VylarisCloud tritt in den Hintergrund.',
              'Your logo, your icon, your words — VylarisCloud steps into the background.'
            )
          }}
          <NuxtLink to="/einstellungen" class="link">{{
            t('Name und Farbe stellst du unter Einstellungen ein.', 'Name and colour are set under Settings.')
          }}</NuxtLink>
        </p>
      </div>
    </div>

    <VdProSperre
      v-if="!an"
      ic="palette"
      :titel="t('Eigene Marke', 'Own branding')"
      :text="
        t(
          'Für Firmen und Agenturen: VylarisCloud sieht aus wie dein eigenes Produkt — für Kunden, Kolleginnen und Kollegen.',
          'For companies and agencies: VylarisCloud looks like your own product — for clients and colleagues.'
        )
      "
      :punkte="[
        t('Eigenes Logo in Seitenleiste, Anmeldung und Datei-Seiten', 'Own logo in sidebar, sign-in and file pages'),
        t('Eigenes Browser-Symbol', 'Own browser icon'),
        t('Kein „Mit VylarisCloud geteilt“ auf öffentlichen Seiten', 'No “Shared with VylarisCloud” on public pages'),
        t('Eigener Text auf der Anmeldeseite', 'Own text on the sign-in page')
      ]"
    />

    <div v-else class="zwei-spalten">
      <form class="spalte" @submit.prevent="speichern">
        <div class="block">
          <h3>{{ t('Logo', 'Logo') }}</h3>
          <p class="leise klein">
            {{
              t(
                'PNG, WebP oder SVG mit transparentem Hintergrund, bis 400 KB. Quadratisch als Zeichen neben dem Namen — oder breit, wenn der Name schon im Logo steht.',
                'PNG, WebP or SVG with transparent background, up to 400 KB. Square as a mark next to the name — or wide if the name is already part of the logo.'
              )
            }}
          </p>
          <div class="bild-wahl">
            <div class="bild-feld"><img v-if="logoVorschau" :src="logoVorschau" alt="" /><Ico v-else n="image" /></div>
            <div class="reihe">
              <button type="button" class="knopf klein" :disabled="!istInhaber" @click="logoFeld?.click()">
                <Ico n="upload" /> {{ t('Auswählen', 'Choose') }}
              </button>
              <button
                v-if="logoVorschau"
                type="button"
                class="knopf klein gefahr"
                :disabled="!istInhaber"
                @click="bildWeg('logo')"
              >
                <Ico n="trash" />
              </button>
            </div>
            <input
              ref="logoFeld"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              class="versteckt"
              @change="bildWaehlen('logo', $event)"
            />
          </div>
          <label class="opt"
            ><button
              type="button"
              :class="['schalter', { an: f.nurLogo }]"
              role="switch"
              :aria-checked="f.nurLogo"
              :disabled="!istInhaber"
              @click="f.nurLogo = !f.nurLogo"
            ></button
            ><span
              ><b>{{ t('Nur das Logo zeigen', 'Show logo only') }}</b
              ><small>{{
                t(
                  'Ohne den Namen daneben — wenn das Logo ihn schon enthält.',
                  'Without the name next to it — if the logo already contains it.'
                )
              }}</small></span
            ></label
          >
        </div>
        <div class="block">
          <h3>{{ t('Browser-Symbol', 'Browser icon') }}</h3>
          <p class="leise klein">
            {{
              t(
                'Quadratisch, am besten 64 × 64 oder SVG. Ohne eigenes Symbol nimmt VylarisCloud das Logo.',
                'Square, ideally 64 × 64 or SVG. Without an own icon VylarisCloud uses the logo.'
              )
            }}
          </p>
          <div class="bild-wahl">
            <div class="bild-feld klein-bild">
              <img v-if="iconVorschau || logoVorschau" :src="iconVorschau || logoVorschau" alt="" /><Ico
                v-else
                n="cloud"
              />
            </div>
            <div class="reihe">
              <button type="button" class="knopf klein" :disabled="!istInhaber" @click="iconFeld?.click()">
                <Ico n="upload" /> {{ t('Auswählen', 'Choose') }}
              </button>
              <button
                v-if="iconVorschau"
                type="button"
                class="knopf klein gefahr"
                :disabled="!istInhaber"
                @click="bildWeg('icon')"
              >
                <Ico n="trash" />
              </button>
            </div>
            <input
              ref="iconFeld"
              type="file"
              accept="image/png,image/svg+xml,image/x-icon,image/webp"
              class="versteckt"
              @change="bildWaehlen('icon', $event)"
            />
          </div>
        </div>
        <div class="block">
          <h3>{{ t('Texte', 'Texts') }}</h3>
          <label class="feld"
            ><span>{{ t('Text auf der Anmeldeseite', 'Text on the sign-in page') }}</span
            ><textarea
              v-model="f.loginText"
              class="eingabe"
              rows="2"
              maxlength="300"
              :disabled="!istInhaber"
              :placeholder="t('Melde dich an, um deine Dateien zu verwalten.', 'Sign in to manage your files.')"
            ></textarea>
          </label>
          <label class="feld"
            ><span>{{ t('Fußzeile auf Datei-Seiten', 'Footer on file pages') }}</span
            ><input
              v-model="f.fusszeile"
              class="eingabe"
              maxlength="200"
              :disabled="!istInhaber"
              :placeholder="
                t('z. B. © Muster GmbH · Impressum unter muster.de', 'e.g. © Example Ltd · Imprint at example.com')
              "
          /></label>
          <label class="opt"
            ><button
              type="button"
              :class="['schalter', { an: f.ohneHinweis }]"
              role="switch"
              :aria-checked="f.ohneHinweis"
              :disabled="!istInhaber"
              @click="f.ohneHinweis = !f.ohneHinweis"
            ></button
            ><span
              ><b>{{ t('„Mit VylarisCloud geteilt“ ausblenden', 'Hide "Shared with VylarisCloud"') }}</b
              ><small>{{
                t(
                  'Auf Datei-Seiten, Datei-Anfragen und der Anmeldeseite.',
                  'On file pages, file requests and the sign-in page.'
                )
              }}</small></span
            ></label
          >
        </div>
        <div v-if="istInhaber" class="reihe ende">
          <button class="knopf rot" :disabled="laeuft">
            <Ico :n="laeuft ? 'loader' : 'check'" :spin="laeuft" /> {{ t('Speichern', 'Save') }}
          </button>
        </div>
      </form>

      <div class="spalte vorschau-spalte">
        <div class="reihe zw">
          <b class="klein">{{ t('Vorschau', 'Preview') }}</b>
          <div class="seg">
            <button :class="{ an: !vorschauHell }" @click="vorschauHell = false"><Ico n="moon" /></button
            ><button :class="{ an: vorschauHell }" @click="vorschauHell = true"><Ico n="sun" /></button>
          </div>
        </div>
        <div
          :class="['vs', vorschauHell ? 'hell' : 'dunkel']"
          :style="{ '--a': theme.color, '--a-rgb': hexRgb(theme.color) }"
        >
          <div class="vs-tab">
            <img v-if="iconVorschau || logoVorschau" :src="iconVorschau || logoVorschau" alt="" /><Ico
              v-else
              n="cloud"
            /><span>{{ t('Anmelden', 'Sign in') }} · {{ theme.name }}</span>
          </div>
          <div class="vs-karte">
            <div class="vs-marke">
              <img v-if="logoVorschau" :src="logoVorschau" alt="" :class="{ breit: f.nurLogo }" /><span
                v-else
                class="vs-zeichen"
                ><Ico n="cloud"
              /></span>
              <b v-if="!(logoVorschau && f.nurLogo)">{{ theme.name }}</b>
            </div>
            <h4>{{ t('Willkommen zurück', 'Welcome back') }}</h4>
            <p>
              {{ f.loginText || t('Melde dich an, um deine Dateien zu verwalten.', 'Sign in to manage your files.') }}
            </p>
            <i class="vs-feld"></i><i class="vs-feld"></i><i class="vs-knopf"></i>
          </div>
          <div class="vs-fuss">
            <span v-if="f.fusszeile">{{ f.fusszeile }}</span
            ><span v-if="!f.ohneHinweis" class="vs-hinweis"
              ><Ico n="cloud" /> {{ t('Mit VylarisCloud geteilt', 'Shared with VylarisCloud') }}</span
            >
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.link {
  color: var(--a);
}
.klein {
  font-size: 12.5px;
}
.zwei-spalten {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 420px);
  gap: 18px;
  align-items: start;
}
.spalte .block + .block {
  margin-top: 14px;
}
.bild-wahl {
  display: flex;
  gap: 14px;
  align-items: center;
  margin: 12px 0 14px;
}
.bild-feld {
  width: 96px;
  height: 64px;
  border-radius: 12px;
  border: 1px dashed var(--linie2);
  display: grid;
  place-items: center;
  color: var(--text3);
  background: repeating-conic-gradient(var(--flaeche2) 0 25%, var(--flaeche) 0 50%) 0 0 / 14px 14px;
  overflow: hidden;
}
.bild-feld img {
  max-width: 86%;
  max-height: 80%;
  object-fit: contain;
}
.bild-feld.klein-bild {
  width: 64px;
}
.bild-feld svg {
  width: 22px;
  height: 22px;
}
.opt {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  cursor: pointer;
}
.opt small {
  display: block;
  color: var(--text3);
  font-size: 12px;
}
textarea.eingabe {
  resize: vertical;
}
.ende {
  justify-content: flex-end;
  margin-top: 14px;
}
.vorschau-spalte {
  position: sticky;
  top: 90px;
  display: grid;
  gap: 10px;
}
.vs {
  border-radius: 18px;
  padding: 0 0 14px;
  overflow: hidden;
  border: 1px solid var(--linie);
  transition:
    background 0.4s,
    color 0.4s;
}
.vs.dunkel {
  --v-bg: #070708;
  --v-fl: #0e0e10;
  --v-li: #1f1f23;
  --v-t: #f4f3f5;
  --v-t2: #a3a1a8;
  --v-t3: #6d6b73;
  background: var(--v-bg);
  color: var(--v-t);
}
.vs.hell {
  --v-bg: #f6f5f3;
  --v-fl: #ffffff;
  --v-li: #e4e1dc;
  --v-t: #18171a;
  --v-t2: #5c5a60;
  --v-t3: #8d8a90;
  background: var(--v-bg);
  color: var(--v-t);
}
.vs-tab {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 9px 14px;
  font-size: 11.5px;
  color: var(--v-t2);
  border-bottom: 1px solid var(--v-li);
  background: var(--v-fl);
}
.vs-tab img,
.vs-tab svg {
  width: 14px;
  height: 14px;
  object-fit: contain;
  color: var(--a);
}
.vs-karte {
  margin: 22px auto 14px;
  width: 82%;
  background: var(--v-fl);
  border: 1px solid var(--v-li);
  border-radius: 16px;
  padding: 18px;
  display: grid;
  gap: 8px;
}
.vs-marke {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 4px;
}
.vs-marke img {
  width: 24px;
  height: 24px;
  object-fit: contain;
  border-radius: 6px;
}
.vs-marke img.breit {
  width: auto;
  height: 26px;
  max-width: 160px;
  border-radius: 0;
}
.vs-zeichen {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: var(--a);
  color: #fff;
  display: grid;
  place-items: center;
}
.vs-zeichen svg {
  width: 12px;
  height: 12px;
}
.vs-marke b {
  font-family: var(--f-display);
  font-size: 15px;
  letter-spacing: -0.02em;
}
.vs h4 {
  font-family: var(--f-display);
  font-size: 18px;
  letter-spacing: -0.02em;
  margin: 0;
}
.vs p {
  margin: 0 0 6px;
  font-size: 11.5px;
  color: var(--v-t2);
}
.vs-feld {
  display: block;
  height: 26px;
  border-radius: 7px;
  border: 1px solid var(--v-li);
  background: var(--v-bg);
}
.vs-knopf {
  display: block;
  height: 28px;
  border-radius: 7px;
  background: var(--a);
  margin-top: 4px;
}
.vs-fuss {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  color: var(--v-t3);
}
.vs-hinweis {
  display: inline-flex;
  gap: 5px;
  align-items: center;
}
.vs-hinweis svg {
  width: 10px;
  height: 10px;
  color: var(--a);
}
@media (max-width: 960px) {
  .zwei-spalten {
    grid-template-columns: 1fr;
  }
  .vorschau-spalte {
    position: static;
  }
}
</style>
