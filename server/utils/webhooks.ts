import { createHmac, randomBytes } from 'node:crypto'
import { lookup as dnsLookup } from 'node:dns'
import { isIP } from 'node:net'
import http from 'node:http'
import https from 'node:https'
import { q, q1, ereignis } from './db'
import { getSetting } from './settings'
import { melde, VERSION } from './knoten'
import { imHintergrund } from './benachrichtigen'

export const EREIGNISSE = [
  'file.uploaded',
  'file.deleted',
  'file.restored',
  'request.uploaded',
  'virus.found',
  'rule.applied'
] as const
export type Ereignis = (typeof EREIGNISSE)[number] | 'ping'
const WARTEN = [60, 300, 1800, 7200]
const MAX_VERSUCHE = 5
const AUS_NACH = 20

export const neuesGeheimnis = () => 'whsec_' + randomBytes(24).toString('base64url')
export const webhookEinst = async () => ({ intern: false, ...(await getSetting<{ intern?: boolean }>('webhooks', {})) })

// IPv6-Adresse (auch mit eingebettetem IPv4-Teil, "::" und Zonenkennung) in 16 Bytes; null, wenn sie sich nicht lesen lässt
function ipv6Bytes(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0]!
  const m4 = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s)
  if (m4) {
    if (isIP(m4[2]!) !== 4) return null
    const o = m4[2]!.split('.').map(Number) as [number, number, number, number]
    s = `${m4[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`
  }
  const teile = s.split('::')
  if (teile.length > 2) return null
  const kopf = teile[0] ? teile[0].split(':') : []
  const rest = teile.length === 2 && teile[1] ? teile[1].split(':') : []
  let gruppen = kopf
  if (teile.length === 2) {
    const fehlt = 8 - kopf.length - rest.length
    if (fehlt < 0) return null
    gruppen = [...kopf, ...Array(fehlt).fill('0'), ...rest]
  }
  if (gruppen.length !== 8) return null
  const aus: number[] = []
  for (const g of gruppen) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    const n = parseInt(g, 16)
    aus.push(n >> 8, n & 255)
  }
  return aus
}

function privat(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number]
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    )
  }
  const v = ipv6Bytes(ip)
  if (!v) return true
  const v4 = (o: number) => privat(`${v[o]}.${v[o + 1]}.${v[o + 2]}.${v[o + 3]}`)
  const nullen = (von: number, bis: number) => v.slice(von, bis).every((x) => x === 0)
  // ::ffff:a.b.c.d (IPv4-gemappt, auch in der Hex-Schreibweise ::ffff:7f00:1), ::a.b.c.d (IPv4-kompatibel, umfasst :: und ::1)
  if (nullen(0, 10) && v[10] === 0xff && v[11] === 0xff) return v4(12)
  if (nullen(0, 12)) return v4(12)
  // 64:ff9b::/96 (NAT64) und 2002::/16 (6to4) tragen eine IPv4-Adresse in sich
  if (v[0] === 0 && v[1] === 0x64 && v[2] === 0xff && v[3] === 0x9b && nullen(4, 12)) return v4(12)
  if (v[0] === 0x20 && v[1] === 0x02) return v4(2)
  // fc00::/7 (privat), fe80::/10 (Link-Lokal), fec0::/10 (veraltet, standortlokal), ff00::/8 (Multicast)
  return (v[0]! & 0xfe) === 0xfc || (v[0] === 0xfe && ((v[1]! & 0xc0) === 0x80 || (v[1]! & 0xc0) === 0xc0)) || v[0] === 0xff
}

export function urlPruefen(roh: string): string {
  let u: URL
  try {
    u = new URL(String(roh).trim())
  } catch {
    throw fehler(400, 'Das ist keine gültige Adresse.', 'That is not a valid URL.')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:')
    throw fehler(400, 'Nur http:// und https:// sind erlaubt.', 'Only http:// and https:// are allowed.')
  if (u.username || u.password)
    throw fehler(
      400,
      'Zugangsdaten gehören nicht in die Adresse — nutze das Geheimnis zur Prüfung.',
      'Credentials do not belong in the URL — use the secret for verification.'
    )
  if (u.toString().length > 500) throw fehler(400, 'Die Adresse ist zu lang.', 'The URL is too long.')
  return u.toString()
}

function sichererLookup(erlaubeIntern: boolean) {
  return (host: string, opts: any, cb: any) => {
    dnsLookup(host, { ...opts, all: true }, (err, adressen: any) => {
      if (err) return cb(err)
      const liste = (Array.isArray(adressen) ? adressen : [{ address: adressen, family: opts?.family || 4 }]) as Array<{
        address: string
        family: number
      }>
      const ok = erlaubeIntern ? liste : liste.filter((a) => !privat(a.address))
      if (!ok.length) return cb(Object.assign(new Error('Ziel liegt im internen Netz'), { code: 'VD_INTERN' }))
      if (opts?.all) return cb(null, ok)
      cb(null, ok[0]!.address, ok[0]!.family)
    })
  }
}

function senden(
  url: string,
  body: string,
  kopf: Record<string, string>,
  erlaubeIntern: boolean
): Promise<{ code: number; text: string; ms: number }> {
  const u = new URL(url)
  const t0 = Date.now()
  if (isIP(u.hostname.replace(/^\[|\]$/g, '')) && !erlaubeIntern && privat(u.hostname.replace(/^\[|\]$/g, '')))
    return Promise.reject(Object.assign(new Error('Ziel liegt im internen Netz'), { code: 'VD_INTERN' }))
  const mod = u.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = mod.request(
      u,
      {
        method: 'POST',
        lookup: sichererLookup(erlaubeIntern) as any,
        timeout: 10_000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': `VylarisCloud-Webhook/${VERSION}`,
          ...kopf
        }
      },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (c: string) => {
          if (text.length < 2000) text += c
        })
        res.on('end', () => resolve({ code: res.statusCode || 0, text: text.slice(0, 500), ms: Date.now() - t0 }))
      }
    )
    req.on('timeout', () =>
      req.destroy(Object.assign(new Error('Zeitlimit (10 s) überschritten'), { code: 'VD_ZEIT' }))
    )
    req.on('error', reject)
    req.end(body)
  })
}

export function webhookAusloesen(userId: number, ereignisName: Ereignis, data: Record<string, unknown>): void {
  void (async () => {
    const hooks = await q<{ id: number }>(
      `SELECT id FROM webhooks WHERE user_id = $1 AND aktiv AND ereignisse @> $2::jsonb`,
      [userId, JSON.stringify([ereignisName])]
    )
    if (!hooks.length) return
    const jetzt = new Date().toISOString()
    for (const h of hooks) {
      await q(`INSERT INTO webhook_lieferungen (webhook_id, ereignis, nutzlast) VALUES ($1, $2, $3::jsonb)`, [
        h.id,
        ereignisName,
        JSON.stringify({ event: ereignisName, created_at: jetzt, data })
      ])
    }
    void zustellen()
    await melde('vd_arbeit', 'webhooks')
  })().catch((e) => console.warn('[vylariscloud] Webhook auslösen:', e?.message))
}

let laeuft = false
export async function zustellen(): Promise<void> {
  if (laeuft) return
  laeuft = true
  try {
    const { intern } = await webhookEinst()
    for (let runde = 0; runde < 20; runde++) {
      const offen = await q<{
        id: string
        webhook_id: number
        ereignis: string
        nutzlast: any
        versuche: number
        url: string
        geheimnis: string
        user_id: number
        name: string
      }>(
        `UPDATE webhook_lieferungen l SET naechster_at = now() + interval '2 minutes' FROM webhooks w
         WHERE l.id IN (SELECT id FROM webhook_lieferungen WHERE status = 'offen' AND naechster_at <= now() ORDER BY naechster_at LIMIT 10 FOR UPDATE SKIP LOCKED)
           AND w.id = l.webhook_id
         RETURNING l.id, l.webhook_id, l.ereignis, l.nutzlast, l.versuche, w.url, w.geheimnis, w.user_id, w.name`
      )
      if (!offen.length) return
      await Promise.all(offen.map((l) => eineLieferung(l, intern)))
    }
  } finally {
    laeuft = false
  }
}

async function eineLieferung(
  l: {
    id: string
    webhook_id: number
    ereignis: string
    nutzlast: any
    versuche: number
    url: string
    geheimnis: string
    user_id: number
    name: string
  },
  intern: boolean
) {
  const body = JSON.stringify({ id: String(l.id), ...l.nutzlast })
  const ts = Math.floor(Date.now() / 1000)
  const sig = createHmac('sha256', l.geheimnis).update(`${ts}.${body}`).digest('hex')
  let code = 0,
    text = '',
    ms = 0
  try {
    const r = await senden(
      l.url,
      body,
      { 'X-VylarisCloud-Event': l.ereignis, 'X-VylarisCloud-Delivery': String(l.id), 'X-VylarisCloud-Signature': `t=${ts},v1=${sig}` },
      intern
    )
    code = r.code
    text = r.text
    ms = r.ms
  } catch (e: any) {
    text =
      e?.code === 'VD_INTERN'
        ? 'Ziel liegt im internen Netz (gesperrt)'
        : e?.code === 'VD_ZEIT'
          ? 'Zeitlimit (10 s) überschritten'
          : String(e?.code || e?.message || e).slice(0, 200)
  }
  const ok = code >= 200 && code < 300
  const versuche = l.versuche + 1
  const endgueltig = ok || versuche >= MAX_VERSUCHE || text.startsWith('Ziel liegt im internen Netz')
  await q(
    `UPDATE webhook_lieferungen SET status = $2, versuche = $3, antwort_code = $4, antwort = $5, dauer_ms = $6,
      naechster_at = now() + ($7 || ' seconds')::interval, erledigt_at = CASE WHEN $8 THEN now() ELSE NULL END WHERE id = $1`,
    [
      l.id,
      ok ? 'ok' : endgueltig ? 'fehler' : 'offen',
      versuche,
      code || null,
      text,
      ms || null,
      String(WARTEN[Math.min(versuche - 1, WARTEN.length - 1)]),
      endgueltig
    ]
  )
  const h = await q1<{ fehler_in_folge: number }>(
    `UPDATE webhooks SET zuletzt_at = now(), zuletzt_status = $2, fehler_in_folge = CASE WHEN $3 THEN 0 ELSE fehler_in_folge + 1 END
    WHERE id = $1 RETURNING fehler_in_folge`,
    [l.webhook_id, code || null, ok]
  )
  if (h && h.fehler_in_folge >= AUS_NACH) {
    const aus = await q('UPDATE webhooks SET aktiv = false WHERE id = $1 AND aktiv RETURNING id', [l.webhook_id])
    if (aus.length) {
      await ereignis('webhook_aus', l.user_id, { name: l.name.slice(0, 60), url: l.url.slice(0, 120) })
      imHintergrund(l.user_id, 'webhook', {
        titel: 'Webhook abgeschaltet',
        text: `„${l.name || l.url}“ ist ${AUS_NACH}-mal hintereinander fehlgeschlagen und wurde abgeschaltet. Letzte Antwort: ${text || code}`
      })
    }
  }
}

export async function lieferungenAufraeumen() {
  await q(`DELETE FROM webhook_lieferungen WHERE status <> 'offen' AND created_at < now() - interval '14 days'`)
  await q(`DELETE FROM webhook_lieferungen l USING (SELECT id, row_number() OVER (PARTITION BY webhook_id ORDER BY created_at DESC) AS n FROM webhook_lieferungen WHERE status <> 'offen') x
    WHERE l.id = x.id AND x.n > 200`)
}

export const zustellerStarten = () => {
  setInterval(() => {
    void zustellen().catch(() => {})
  }, 15_000).unref?.()
}
