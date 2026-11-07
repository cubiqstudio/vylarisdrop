import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { st } from './settings'
import { datenordner } from './speicher'
import { istDomain, proxyInfo } from './netz'
import { dienstKann } from './update'

export type WsArt = 'nginx' | 'apache'
export const WS_ARTEN: readonly WsArt[] = ['nginx', 'apache']
const INSTALL =
  'curl -fsSL https://raw.githubusercontent.com/cubiqstudio/vylarisdrop/main/deploy/install.sh | sudo bash -s --'
export function wsBefehl(art: WsArt, domain: string): string {
  return `${INSTALL} --webserver=${art}${istDomain(domain) ? ` --domain ${domain}` : ''}`
}

const pfad = (n: string) => join(datenordner(), n)
async function lesenJson(n: string): Promise<any> {
  try {
    return JSON.parse(await fs.readFile(pfad(n), 'utf8'))
  } catch {
    return null
  }
}
const text = (v: unknown, max = 300) => String(v ?? '').slice(0, max)

async function protokoll(): Promise<string> {
  const f = await fs.open(pfad('.webserver.log'), 'r').catch(() => null)
  if (!f) return ''
  try {
    const { size, mtimeMs } = await f.stat()
    if (Date.now() - mtimeMs > 6 * 3600_000) return ''
    const n = Math.min(size, 16_000),
      b = Buffer.alloc(n)
    await f.read(b, 0, n, size - n)
    const t = b
      .toString('utf8')
      .replace(/\r(?!\n)/g, '\n')
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
      .replace(/[\x00-\x08\x0b-\x1f]/g, '')
    return (size > n ? t.slice(t.indexOf('\n') + 1) : t).split('\n').slice(-200).join('\n')
  } finally {
    await f.close()
  }
}

async function anfrageLiegt(): Promise<{ da: boolean; alt: boolean }> {
  const s = await fs.stat(pfad('.update-anfrage')).catch(() => null)
  return { da: !!s, alt: !!s && Date.now() - s.mtimeMs > 3 * 60_000 }
}

export async function webserverStand() {
  const proxy = proxyInfo()
  const updater = await fs.stat(pfad('.updater')).then(
    () => true,
    () => false
  )
  const kann = updater && (await dienstKann('webserver'))
  const i = await lesenJson('.webserver-info')
  const l = await lesenJson('.webserver-status')
  const anfrage = await anfrageLiegt()
  const lauf =
    l && typeof l === 'object'
      ? {
          status: text(l.status, 20),
          zeit: text(l.zeit, 40),
          id: text(l.id, 32),
          domain: text(l.domain, 253),
          art: text(l.art, 10),
          https: l.https === true,
          meldung: text(l.meldung, 500)
        }
      : null
  const haengt = !!lauf && lauf.status === 'laeuft' && Date.now() - new Date(lauf.zeit).getTime() > 30 * 60_000
  return {
    portModus: !!proxy,
    port: proxy?.port || 0,
    dienst: updater,
    kann,
    info:
      i && typeof i === 'object'
        ? {
            zeit: text(i.zeit, 40),
            modus: i.modus === 'port' ? 'port' : 'caddy',
            webserver: ['nginx', 'apache2', 'httpd'].includes(i.webserver) ? String(i.webserver) : '',
            portsFrei: i.portsFrei === true,
            belegtVon: text(i.belegtVon, 40),
            paketverwaltung: i.paketverwaltung === true,
            certbot: i.certbot === true
          }
        : null,
    lauf: lauf ? { ...lauf, haengt } : null,
    angefragt: anfrage.da,
    nichtAbgeholt: anfrage.alt,
    protokoll: lauf ? await protokoll() : '',
    befehl: { nginx: wsBefehl('nginx', proxy?.domain || ''), apache: wsBefehl('apache', proxy?.domain || '') }
  }
}

async function anfrageSchreiben(inhalt: Record<string, string>): Promise<string> {
  const id = randomBytes(8).toString('hex')
  await fs.writeFile(pfad('.update-anfrage'), JSON.stringify({ id, ...inhalt, zeit: new Date().toISOString() }), {
    mode: 0o644
  })
  return id
}

export async function webserverInfoAnfragen(): Promise<boolean> {
  if (!proxyInfo() || !(await dienstKann('webserver'))) return false
  if ((await anfrageLiegt()).da) return false
  const l = await lesenJson('.webserver-status')
  if (l?.status === 'laeuft' && Date.now() - new Date(l.zeit).getTime() < 30 * 60_000) return false
  await anfrageSchreiben({ aktion: 'webserver-info' })
  return true
}

export async function webserverAnfragen(art: unknown, domain: unknown): Promise<string> {
  if (!proxyInfo())
    throw fehler(
      409,
      st(
        'Diese Installation hat einen eigenen Caddy — dort holt Caddy das Zertifikat selbst.',
        'This installation has its own Caddy — Caddy gets the certificate itself.'
      )
    )
  if (typeof art !== 'string' || !(WS_ARTEN as readonly string[]).includes(art))
    throw fehler(400, st('Bitte nginx oder Apache wählen.', 'Please choose nginx or Apache.'))
  const d = String(domain ?? '')
    .trim()
    .toLowerCase()
  if (!istDomain(d))
    throw fehler(
      400,
      st(
        'Bitte gib eine gültige Domain ein, z. B. cloud.meinefirma.de',
        'Please enter a valid domain, e.g. cloud.mycompany.com'
      )
    )
  if (
    !(await fs.stat(pfad('.updater')).then(
      () => true,
      () => false
    )) ||
    !(await dienstKann('webserver'))
  ) {
    throw fehler(
      409,
      st(
        `Der Dienst auf dem Server kann das noch nicht — einmal auf dem Server ausführen: ${wsBefehl(art as WsArt, d)}`,
        `The service on the server cannot do this yet — run once on the server: ${wsBefehl(art as WsArt, d)}`
      )
    )
  }
  const l = await lesenJson('.webserver-status')
  if (l?.status === 'laeuft' && Date.now() - new Date(l.zeit).getTime() < 30 * 60_000)
    throw fehler(409, st('Die Einrichtung des Webservers läuft schon.', 'The web server setup is already running.'))
  const a = await anfrageLiegt()
  if (a.da) {
    const alt = await fs.readFile(pfad('.update-anfrage'), 'utf8').catch(() => '')
    if (!/"aktion":"webserver-info"/.test(alt))
      throw fehler(
        409,
        st(
          'Der Dienst auf dem Server hat noch einen anderen Auftrag — bitte gleich noch einmal versuchen.',
          'The server service still has another job — please try again in a moment.'
        )
      )
  }
  return anfrageSchreiben({ aktion: 'webserver', art, domain: d })
}
