<script setup lang="ts">
useHead({ title: () => t('API-Doku', 'API docs') })
const { data: spec } = await (useFetch as any)('/api/v1/openapi.json', { key: 'openapi' })
const basis = computed(() => spec.value?.servers?.[0]?.url || '')
const kopiert = ref('')
async function kopie(k: string, s: string) {
  if (await kopieren(s)) {
    kopiert.value = k
    setTimeout(() => {
      if (kopiert.value === k) kopiert.value = ''
    }, 1500)
  }
}

const RECHT: Record<string, { de: string; en: string }> = {
  read: { de: 'Lesen', en: 'Read' },
  upload: { de: 'Hochladen', en: 'Upload' },
  manage: { de: 'Verwalten', en: 'Manage' }
}
const GRUPPEN = computed(() => {
  const s = spec.value
  if (!s) return []
  const gruppen: Record<string, any[]> = {}
  for (const [pfad, ops] of Object.entries<any>(s.paths)) {
    for (const [methode, o] of Object.entries<any>(ops)) {
      const g = o.tags?.[0] || 'API'
      ;(gruppen[g] ||= []).push({
        id: `${methode}-${pfad}`.replace(/[^a-z0-9]+/gi, '-'),
        methode: methode.toUpperCase(),
        pfad,
        o
      })
    }
  }
  const NAMEN: Record<string, string> = {
    Account: t('Konto', 'Account'),
    Files: t('Dateien', 'Files'),
    Folders: t('Ordner', 'Folders')
  }
  return Object.entries(gruppen).map(([g, eps]) => ({ g, name: NAMEN[g] || g, eps }))
})

function beispiel(schema: any, tiefe = 0): any {
  if (!schema || tiefe > 6) return null
  if (schema.$ref) return beispiel(spec.value.components.schemas[schema.$ref.split('/').pop()], tiefe + 1)
  if (schema.example !== undefined) return schema.example
  const typ = Array.isArray(schema.type) ? schema.type.find((x: string) => x !== 'null') : schema.type
  if (schema.enum) return schema.enum[0]
  if (typ === 'object') {
    const o: any = {}
    for (const [k, v] of Object.entries<any>(schema.properties || {})) o[k] = beispiel(v, tiefe + 1)
    return o
  }
  if (typ === 'array') return schema.items ? [beispiel(schema.items, tiefe + 1)] : []
  if (typ === 'integer') return 0
  if (typ === 'boolean') return false
  if (schema.format === 'date-time') return '2026-10-23T12:00:00.000Z'
  return typ === 'string' ? '…' : null
}
function curl(ep: any) {
  const b = basis.value
  const z = [
    `curl -X ${ep.methode} "${b}${ep.pfad.replace('{id}', '1234')}${ep.methode === 'GET' && ep.pfad === '/files' ? '?per_page=10' : ''}"`,
    '  -H "Authorization: Bearer vd_DEIN_TOKEN"'
  ]
  if (ep.o.requestBody?.content?.['multipart/form-data'])
    z.push('  -H "x-vd-expires: 7d"', '  -F "file=@screenshot.png"')
  else if (ep.o.requestBody?.content?.['application/json']) {
    const body =
      ep.pfad === '/folders' ? { name: 'Screenshots' } : { name: 'neuer-name.png', expires: '30d', favorite: true }
    z.push('  -H "Content-Type: application/json"', `  -d '${JSON.stringify(body)}'`)
  }
  return z.join(' \\\n')
}
const antwort = (ep: any) =>
  JSON.stringify(beispiel(ep.o.responses?.['200']?.content?.['application/json']?.schema), null, 2)
const felder = (ep: any) => {
  const sch = ep.o.requestBody?.content?.['application/json']?.schema
  return sch
    ? Object.entries<any>(sch.properties || {}).map(([k, v]) => ({
        name: k,
        typ: [].concat(v.type || 'object').join(' | '),
        info: v.description || ''
      }))
    : []
}

const code = reactive<Record<string, string>>({})
async function faerben(k: string, text: string, sprache: string) {
  code[k] = (await hervorheben(text, sprache)).html
}

const EREIGNIS_TEXT = computed<Record<string, string>>(() => ({
  'file.uploaded': t(
    'Eine Datei wurde hochgeladen (Panel, ShareX, API, Teil-Upload).',
    'A file was uploaded (panel, ShareX, API, chunked upload).'
  ),
  'file.deleted': t('Eine Datei kam in den Papierkorb.', 'A file was moved to the trash.'),
  'file.restored': t('Eine Datei wurde aus dem Papierkorb geholt.', 'A file was restored from the trash.'),
  'request.uploaded': t('Jemand hat über eine Datei-Anfrage hochgeladen.', 'Someone uploaded through a file request.'),
  'virus.found': t('Der Virenscan hat eine Datei in Quarantäne gelegt.', 'The virus scan quarantined a file.'),
  'rule.applied': t('Eine Speicher-Regel hat Dateien bearbeitet.', 'A storage rule processed files.')
}))
const WH_BEISPIEL = JSON.stringify(
  {
    id: '8812',
    event: 'file.uploaded',
    created_at: '2026-10-23T12:00:00.000Z',
    data: {
      file: {
        id: '1234',
        slug: 'kX9q2Rb',
        name: 'screenshot.png',
        type: 'image',
        size: 48213,
        urls: { page: 'https://cloud.example.com/v/kX9q2Rb' }
      }
    }
  },
  null,
  2
)
const SPRACHEN_WH = [
  {
    k: 'node',
    name: 'Node.js',
    sprache: 'javascript',
    code: `import { createHmac, timingSafeEqual } from 'node:crypto'

// rohBody = der unveränderte Text des Requests (nicht neu serialisieren!)
export function echt(rohBody, kopf, geheimnis) {
  const teile = Object.fromEntries(kopf.split(',').map(x => x.split('=')))
  if (Math.abs(Date.now() / 1000 - Number(teile.t)) > 300) return false // älter als 5 min
  const soll = createHmac('sha256', geheimnis).update(\`\${teile.t}.\${rohBody}\`).digest('hex')
  return soll.length === teile.v1?.length && timingSafeEqual(Buffer.from(soll), Buffer.from(teile.v1))
}`
  },
  {
    k: 'python',
    name: 'Python',
    sprache: 'python',
    code: `import hmac, hashlib, time

def echt(roh_body: bytes, kopf: str, geheimnis: str) -> bool:
    teile = dict(x.split("=", 1) for x in kopf.split(","))
    if abs(time.time() - int(teile["t"])) > 300:
        return False
    soll = hmac.new(geheimnis.encode(), f"{teile['t']}.".encode() + roh_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(soll, teile.get("v1", ""))`
  },
  {
    k: 'php',
    name: 'PHP',
    sprache: 'php',
    code: `<?php
function echt(string $rohBody, string $kopf, string $geheimnis): bool {
    parse_str(str_replace(',', '&', $kopf), $teile);
    if (abs(time() - (int)$teile['t']) > 300) return false;
    $soll = hash_hmac('sha256', $teile['t'] . '.' . $rohBody, $geheimnis);
    return hash_equals($soll, $teile['v1'] ?? '');
}
// $rohBody = file_get_contents('php://input'); $kopf = $_SERVER['HTTP_X_VYLARISCLOUD_SIGNATURE'];`
  }
]
const whSprache = ref('node')
const FEHLER = computed(() => [
  {
    c: 400,
    t: t('Eingabe ungültig — die Meldung sagt, was fehlt.', 'Invalid input — the message says what is missing.')
  },
  { c: 401, t: t('Kein oder ungültiges Token.', 'Missing or invalid token.') },
  { c: 403, t: t('Dem Token fehlt das nötige Recht.', 'The token lacks the required permission.') },
  { c: 404, t: t('Gibt es nicht oder gehört nicht dir.', 'Does not exist or is not yours.') },
  { c: 413, t: t('Datei zu groß oder Speicher voll.', 'File too large or storage full.') },
  {
    c: 429,
    t: t(
      'Mehr als 600 Anfragen pro Minute — Retry-After beachten.',
      'More than 600 requests per minute — respect Retry-After.'
    )
  }
])
async function allesFaerben() {
  for (const gr of GRUPPEN.value)
    for (const ep of gr.eps) {
      await faerben('c-' + ep.id, curl(ep), 'bash')
      if (ep.o.responses?.['200']?.content) await faerben('r-' + ep.id, antwort(ep), 'json')
    }
  await faerben('wh-body', WH_BEISPIEL, 'json')
  for (const s of SPRACHEN_WH) await faerben('wh-' + s.k, s.code, s.sprache)
}
onMounted(() => {
  void allesFaerben()
})
watch(GRUPPEN, () => {
  if (import.meta.client) void allesFaerben()
})
</script>

<template>
  <section class="rein">
    <div class="kopf">
      <div>
        <div class="eyebrow"><Ico n="code" /> {{ t('Verwaltung', 'Manage') }}</div>
        <h1>{{ t('API-Doku', 'API docs') }}</h1>
        <p>
          {{
            t(
              'Alles, was das Panel kann, auch per Skript — mit Token aus den Upload-Werkzeugen.',
              'Everything the panel does, by script too — with a token from the upload tools.'
            )
          }}
        </p>
      </div>
      <div class="reihe">
        <a href="/api/v1/openapi.json" target="_blank" rel="noopener" class="knopf"><Ico n="download" /> OpenAPI</a
        ><NuxtLink to="/werkzeuge" class="knopf rot"><Ico n="key" /> {{ t('Token anlegen', 'Create token') }}</NuxtLink>
      </div>
    </div>

    <div v-if="spec" class="doku">
      <nav class="inhalt" :aria-label="t('Inhalt', 'Contents')">
        <a href="#start">{{ t('Loslegen', 'Getting started') }}</a>
        <template v-for="g in GRUPPEN" :key="g.g"
          ><a :href="`#g-${g.g}`">{{ g.name }}</a
          ><a v-for="ep in g.eps" :key="ep.id" :href="`#${ep.id}`" class="unter"
            ><i :class="'m-' + ep.methode">{{ ep.methode }}</i
            >{{ ep.pfad }}</a
          ></template
        >
        <a href="#webhooks">Webhooks</a>
        <a href="#fehler">{{ t('Fehler', 'Errors') }}</a>
      </nav>

      <div class="inhalt-rechts">
        <article id="start" class="block">
          <h2>{{ t('Loslegen', 'Getting started') }}</h2>
          <p class="leise">
            {{
              t(
                'Jede Anfrage trägt ein Token im Kopf. Welche Endpunkte es benutzen darf, legst du beim Anlegen fest: Hochladen, Lesen, Verwalten.',
                'Every request carries a token in its header. You choose which endpoints it may use when creating it: upload, read, manage.'
              )
            }}
          </p>
          <div class="basis">
            <span class="etikett">Base URL</span><code class="mono">{{ basis }}</code
            ><button class="knopf nur-icon" :aria-label="t('Kopieren', 'Copy')" @click="kopie('basis', basis)">
              <Ico :n="kopiert === 'basis' ? 'check' : 'copy'" />
            </button>
          </div>
          <div class="basis">
            <span class="etikett">Header</span><code class="mono">Authorization: Bearer vd_…</code>
          </div>
          <p class="sehrleise klein">
            {{
              t(
                'Antworten sind JSON. Zeiten in UTC (ISO 8601), Größen in Byte. Höchstens 600 Anfragen pro Minute und Token.',
                'Responses are JSON. Times in UTC (ISO 8601), sizes in bytes. At most 600 requests per minute and token.'
              )
            }}
          </p>
        </article>

        <template v-for="g in GRUPPEN" :key="g.g">
          <h2 :id="`g-${g.g}`" class="gruppe">{{ g.name }}</h2>
          <article v-for="ep in g.eps" :id="ep.id" :key="ep.id" class="block ep">
            <div class="ep-kopf">
              <i :class="['methode', 'm-' + ep.methode]">{{ ep.methode }}</i
              ><code class="mono pfad">{{ ep.pfad }}</code>
              <span class="chip neutral recht"
                ><Ico n="key" /> {{ t(RECHT[ep.o['x-recht']]?.de || '', RECHT[ep.o['x-recht']]?.en || '') }}</span
              >
            </div>
            <p class="zusammen">{{ t(ep.o['x-de'] || ep.o.summary, ep.o.summary) }}</p>
            <table v-if="ep.o.parameters?.filter((p: any) => p.in !== 'path').length" class="tab">
              <thead>
                <tr>
                  <th>{{ t('Parameter', 'Parameter') }}</th>
                  <th>{{ t('Wo', 'In') }}</th>
                  <th>{{ t('Typ', 'Type') }}</th>
                  <th>{{ t('Bedeutung', 'Meaning') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in ep.o.parameters.filter((p: any) => p.in !== 'path')" :key="p.name">
                  <td class="mono">{{ p.name }}</td>
                  <td>{{ p.in === 'query' ? 'Query' : 'Header' }}</td>
                  <td class="mono">{{ p.schema?.enum ? p.schema.enum.join(' | ') : p.schema?.type }}</td>
                  <td>
                    {{ p.description || ''
                    }}<template v-if="p.schema?.default !== undefined">
                      {{ t('Standard', 'Default') }}: {{ p.schema.default }}</template
                    >
                  </td>
                </tr>
              </tbody>
            </table>
            <table v-if="felder(ep).length" class="tab">
              <thead>
                <tr>
                  <th>{{ t('Feld', 'Field') }}</th>
                  <th>{{ t('Typ', 'Type') }}</th>
                  <th>{{ t('Bedeutung', 'Meaning') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="f in felder(ep)" :key="f.name">
                  <td class="mono">{{ f.name }}</td>
                  <td class="mono">{{ f.typ }}</td>
                  <td>{{ f.info }}</td>
                </tr>
              </tbody>
            </table>
            <div class="code-paar">
              <div class="code">
                <div class="code-kopf">
                  <span>{{ t('Anfrage', 'Request') }}</span
                  ><button
                    class="knopf nur-icon klein"
                    :aria-label="t('Kopieren', 'Copy')"
                    @click="kopie('c-' + ep.id, curl(ep))"
                  >
                    <Ico :n="kopiert === 'c-' + ep.id ? 'check' : 'copy'" />
                  </button>
                </div>
                <pre class="hljs mono" v-html="code['c-' + ep.id] || ''"></pre>
              </div>
              <div v-if="ep.o.responses?.['200']?.content" class="code">
                <div class="code-kopf">
                  <span>{{ t('Antwort', 'Response') }} · 200</span>
                </div>
                <pre class="hljs mono" v-html="code['r-' + ep.id] || ''"></pre>
              </div>
            </div>
          </article>
        </template>

        <h2 id="webhooks" class="gruppe">Webhooks</h2>
        <article class="block">
          <p class="leise">
            {{
              t(
                'VylarisCloud schickt bei Ereignissen einen POST an deine Adresse. Einrichten unter „Webhooks“. Antwortet sie nicht mit 2xx, versucht VylarisCloud es nach 1 min, 5 min, 30 min und 2 h erneut; nach 20 Fehlschlägen in Folge wird der Webhook abgeschaltet.',
                'VylarisCloud sends a POST to your URL on events. Set it up under “Webhooks”. Without a 2xx answer VylarisCloud retries after 1 min, 5 min, 30 min and 2 h; after 20 failures in a row the webhook is disabled.'
              )
            }}
          </p>
          <table class="tab">
            <thead>
              <tr>
                <th>{{ t('Ereignis', 'Event') }}</th>
                <th>{{ t('Wann', 'When') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in spec['x-webhooks'].events" :key="e">
                <td class="mono">{{ e }}</td>
                <td>{{ EREIGNIS_TEXT[e] }}</td>
              </tr>
              <tr>
                <td class="mono">ping</td>
                <td>{{ t('Knopf „Test senden“.', 'The “Send test” button.') }}</td>
              </tr>
            </tbody>
          </table>
          <table class="tab">
            <thead>
              <tr>
                <th>Header</th>
                <th>{{ t('Inhalt', 'Content') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(v, k) in spec['x-webhooks'].headers" :key="k">
                <td class="mono">{{ k }}</td>
                <td class="mono klein">{{ v }}</td>
              </tr>
            </tbody>
          </table>
          <div class="code-paar">
            <div class="code">
              <div class="code-kopf">
                <span>{{ t('Beispiel-Inhalt', 'Example body') }}</span>
              </div>
              <pre class="hljs mono" v-html="code['wh-body'] || ''"></pre>
            </div>
            <div class="code">
              <div class="code-kopf">
                <span class="reiter-klein"
                  ><button
                    v-for="s in SPRACHEN_WH"
                    :key="s.k"
                    type="button"
                    :class="{ an: whSprache === s.k }"
                    @click="whSprache = s.k"
                  >
                    {{ s.name }}
                  </button></span
                >
                <button
                  class="knopf nur-icon klein"
                  :aria-label="t('Kopieren', 'Copy')"
                  @click="kopie('wh', SPRACHEN_WH.find((s) => s.k === whSprache)!.code)"
                >
                  <Ico :n="kopiert === 'wh' ? 'check' : 'copy'" />
                </button>
              </div>
              <pre class="hljs mono" v-html="code['wh-' + whSprache] || ''"></pre>
            </div>
          </div>
        </article>

        <h2 id="fehler" class="gruppe">{{ t('Fehler', 'Errors') }}</h2>
        <article class="block">
          <p class="leise">
            {{
              t(
                'Fehler kommen als JSON mit „statusCode“ und „message“ — die Meldung folgt der Sprache des Kontos.',
                'Errors come as JSON with “statusCode” and “message” — the message follows the account language.'
              )
            }}
          </p>
          <table class="tab">
            <tbody>
              <tr v-for="f in FEHLER" :key="f.c">
                <td class="mono">{{ f.c }}</td>
                <td>{{ f.t }}</td>
              </tr>
            </tbody>
          </table>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.doku {
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr);
  gap: 22px;
  align-items: start;
}
.inhalt {
  position: sticky;
  top: 86px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  max-height: calc(100vh - 110px);
  overflow-y: auto;
}
.inhalt a {
  color: var(--text2);
  text-decoration: none;
  padding: 5px 10px;
  border-radius: 8px;
}
.inhalt a:hover {
  background: var(--flaeche);
  color: var(--text);
}
.inhalt a:not(.unter) {
  font-weight: 600;
  color: var(--text);
  margin-top: 6px;
}
.inhalt .unter {
  font-family: var(--f-mono);
  font-size: 11.5px;
  display: flex;
  gap: 6px;
  align-items: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.inhalt .unter i {
  font-style: normal;
  font-size: 9.5px;
  width: 40px;
  flex-shrink: 0;
}
.inhalt-rechts {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.inhalt-rechts .block + .block {
  margin-top: 0;
}
.gruppe {
  font-family: var(--f-display);
  font-size: 22px;
  letter-spacing: -0.02em;
  margin: 14px 0 0;
  scroll-margin-top: 80px;
}
article {
  scroll-margin-top: 80px;
}
article h2 {
  font-size: 18px;
  margin: 0 0 6px;
}
.basis {
  display: flex;
  gap: 8px;
  align-items: center;
  border: 1px solid var(--linie);
  background: var(--bg);
  border-radius: 10px;
  padding: 5px 5px 5px 12px;
  margin-top: 8px;
  min-height: 40px;
}
.basis code {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
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
  width: 70px;
  flex-shrink: 0;
}
.klein {
  font-size: 12px;
}
.ep-kopf {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.methode {
  font-style: normal;
  font-family: var(--f-mono);
  font-size: 11px;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: 7px;
}
.m-GET {
  color: var(--ok);
  background: var(--ok-bg);
}
.m-POST {
  color: var(--info);
  background: var(--info-bg);
}
.m-PATCH {
  color: var(--warn);
  background: var(--warn-bg);
}
.m-DELETE {
  color: var(--rot);
  background: var(--rot-bg);
}
.inhalt .unter i.m-GET,
.inhalt .unter i.m-POST,
.inhalt .unter i.m-PATCH,
.inhalt .unter i.m-DELETE {
  background: none;
}
.pfad {
  font-size: 14.5px;
  font-weight: 600;
}
.recht {
  margin-left: auto;
  font-size: 11px;
}
.recht svg {
  width: 11px;
  height: 11px;
}
.zusammen {
  margin: 8px 0 12px;
  font-size: 14px;
  color: var(--text2);
}
.tab {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  margin: 6px 0 12px;
  display: block;
  overflow-x: auto;
}
.tab th,
.tab td {
  text-align: left;
  padding: 7px 10px;
  border-bottom: 1px solid var(--linie);
  vertical-align: top;
}
.tab th {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text3);
  font-weight: 600;
}
.tab td.mono {
  font-family: var(--f-mono);
  font-size: 12px;
  white-space: nowrap;
}
.code-paar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
}
.code {
  border: 1px solid var(--linie);
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg);
  min-width: 0;
}
.code-kopf {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 6px 6px 12px;
  border-bottom: 1px solid var(--linie);
  font-size: 11px;
  color: var(--text3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
  min-height: 36px;
}
.code pre {
  margin: 0;
  padding: 12px;
  font-size: 12px;
  line-height: 1.6;
  overflow: auto;
  max-height: 360px;
  white-space: pre;
}
.reiter-klein {
  display: flex;
  gap: 2px;
  text-transform: none;
  letter-spacing: 0;
}
.reiter-klein button {
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 12px;
  color: var(--text3);
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.reiter-klein button.an {
  background: var(--flaeche2);
  color: var(--text);
  font-weight: 600;
}
@media (max-width: 1100px) {
  .code-paar {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 860px) {
  .doku {
    grid-template-columns: 1fr;
  }
  .inhalt {
    display: none;
  }
}
</style>
