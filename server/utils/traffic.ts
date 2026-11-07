import { Transform, type Readable } from 'node:stream'
import { q, q1 } from './db'
import { istPro } from './lizenz'
import { getTraffic } from './settings'
import { rechteVon } from './teams'
import { imHintergrund } from './benachrichtigen'

const GB = 1024 ** 3
const offen = new Map<string, number>()
let uhr: ReturnType<typeof setTimeout> | null = null
let zuletztAufgeraeumt = 0

export function trafficZaehlen(userId: number, fileId: string | number, bytes: number) {
  if (!(bytes > 0)) return
  const k = `${userId}|${fileId}`
  offen.set(k, (offen.get(k) || 0) + bytes)
  if (!uhr)
    uhr = setTimeout(() => {
      uhr = null
      void trafficSchreiben()
    }, 10_000)
}

export async function gezaehlt(strom: Readable, userId: number, fileId: string | number): Promise<Readable> {
  if (!(await istPro('traffic'))) return strom
  const t = new Transform({
    transform(stueck: Buffer, _e, weiter) {
      trafficZaehlen(userId, fileId, stueck.length)
      weiter(null, stueck)
    }
  })
  strom.on('error', (e) => t.destroy(e))
  t.on('close', () => strom.destroy())
  return strom.pipe(t)
}

export async function trafficSchreiben() {
  if (!offen.size) return
  const teile = [...offen]
  offen.clear()
  const u: number[] = [],
    f: string[] = [],
    b: number[] = []
  for (const [k, n] of teile) {
    const [a, c] = k.split('|')
    u.push(Number(a))
    f.push(c!)
    b.push(n)
  }
  try {
    await q(
      `INSERT INTO traffic (tag, user_id, file_id, bytes)
      SELECT (now() AT TIME ZONE 'Europe/Berlin')::date, x.u, x.f, x.b FROM unnest($1::int[], $2::bigint[], $3::bigint[]) AS x(u, f, b)
      ON CONFLICT (tag, user_id, file_id) DO UPDATE SET bytes = traffic.bytes + EXCLUDED.bytes`,
      [u, f, b]
    )
  } catch (e) {
    for (const [k, n] of teile) offen.set(k, (offen.get(k) || 0) + n)
    if (!uhr)
      uhr = setTimeout(() => {
        uhr = null
        void trafficSchreiben()
      }, 30_000)
    console.error('[vylariscloud] Traffic konnte nicht gespeichert werden:', (e as any)?.message)
    return
  }
  for (const id of new Set(u)) {
    verbrauchCache.delete(id)
    await warnen(id).catch(() => {})
  }
  if (Date.now() - zuletztAufgeraeumt > 86400_000) {
    zuletztAufgeraeumt = Date.now()
    await q("DELETE FROM traffic WHERE tag < (now() AT TIME ZONE 'Europe/Berlin')::date - interval '400 days'").catch(
      () => {}
    )
  }
}

const MONAT = "date_trunc('month', now() AT TIME ZONE 'Europe/Berlin')::date"
const verbrauchCache = new Map<number, { wert: number; bis: number }>()
const offenVon = (userId: number) => {
  let s = 0
  for (const [k, n] of offen) if (k.startsWith(`${userId}|`)) s += n
  return s
}

export async function monatsVerbrauch(userId: number): Promise<number> {
  let c = verbrauchCache.get(userId)
  if (!c || c.bis < Date.now()) {
    const r = await q1<{ s: string }>(
      `SELECT coalesce(sum(bytes), 0) AS s FROM traffic WHERE user_id = $1 AND tag >= ${MONAT}`,
      [userId]
    )
    c = { wert: Number(r?.s || 0), bis: Date.now() + 30_000 }
    verbrauchCache.set(userId, c)
  }
  return c.wert + offenVon(userId)
}

export async function trafficGrenze(userId: number): Promise<number | null> {
  const u = await q1<{ id: number; role: any; rolle_id: number | null }>(
    'SELECT id, role, rolle_id FROM users WHERE id = $1',
    [userId]
  )
  if (!u || u.role === 'owner') return null
  const gb = (await rechteVon(u)).trafficGb ?? (await getTraffic()).grenzeGb
  return gb && gb > 0 ? Math.round(gb * GB) : null
}

export async function trafficPruefen(userId: number): Promise<void> {
  if (!(await istPro('traffic'))) return
  const g = await trafficGrenze(userId)
  if (g && (await monatsVerbrauch(userId)) >= g)
    throw fehler(
      429,
      'Das Traffic-Kontingent dieses Kontos ist für diesen Monat aufgebraucht.',
      'The traffic quota of this account has been used up for this month.'
    )
}

function monatJetzt() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

async function warnen(userId: number) {
  const g = await trafficGrenze(userId)
  if (!g) return
  const anteil = (await monatsVerbrauch(userId)) / g
  const stufe = anteil >= 1 ? 100 : anteil >= 0.8 ? 80 : 0
  if (!stufe) return
  const u = await q1<{ prefs: any }>('SELECT prefs FROM users WHERE id = $1', [userId])
  const monat = monatJetzt()
  const [m, s] = String(u?.prefs?.trafficGewarnt || '').split(':')
  if (m === monat && Number(s) >= stufe) return
  await q("UPDATE users SET prefs = prefs || jsonb_build_object('trafficGewarnt', $2::text) WHERE id = $1", [
    userId,
    `${monat}:${stufe}`
  ])
  const en = u?.prefs?.lang === 'en',
    gbText = (g / GB).toLocaleString(en ? 'en' : 'de', { maximumFractionDigits: 1 })
  imHintergrund(
    userId,
    'traffic',
    stufe === 100
      ? en
        ? {
            titel: 'Traffic quota used up',
            text: `Your ${gbText} GB of traffic for this month are used up. Your files are no longer delivered publicly until the end of the month.`
          }
        : {
            titel: 'Traffic aufgebraucht',
            text: `Deine ${gbText} GB Traffic für diesen Monat sind aufgebraucht. Bis zum Monatsende werden deine Dateien nicht mehr öffentlich ausgeliefert.`
          }
      : en
        ? { titel: 'Traffic at 80%', text: `You have used 80% of your ${gbText} GB monthly traffic.` }
        : {
            titel: 'Traffic zu 80 % verbraucht',
            text: `Du hast 80 % deiner ${gbText} GB Traffic für diesen Monat verbraucht.`
          }
  )
}

export async function trafficAuswertung(userId: number, tage: number) {
  await trafficSchreiben()
  const par = [userId, String(tage)]
  const zeitraum = `t.tag > (now() AT TIME ZONE 'Europe/Berlin')::date - ($2 || ' days')::interval`
  const proTag = await q<{ tag: string; b: string }>(
    `SELECT to_char(t.tag, 'YYYY-MM-DD') AS tag, sum(t.bytes) AS b FROM traffic t WHERE t.user_id = $1 AND ${zeitraum} GROUP BY t.tag`,
    par
  )
  const top = await q<{ id: string; name: string | null; slug: string | null; art: string | null; b: string }>(
    `SELECT t.file_id AS id, f.name, f.slug, f.art, sum(t.bytes) AS b
    FROM traffic t LEFT JOIN files f ON f.id = t.file_id WHERE t.user_id = $1 AND ${zeitraum} GROUP BY t.file_id, f.name, f.slug, f.art ORDER BY 5 DESC LIMIT 8`,
    par
  )
  const map = new Map(proTag.map((r) => [r.tag, Number(r.b)]))
  const liste: Array<{ tag: string; bytes: number }> = []
  const heute = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }))
  for (let i = tage - 1; i >= 0; i--) {
    const d = new Date(heute)
    d.setDate(d.getDate() - i)
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    liste.push({ tag: k, bytes: map.get(k) || 0 })
  }
  verbrauchCache.delete(userId)
  return {
    tage: liste,
    gesamt: liste.reduce((a, x) => a + x.bytes, 0),
    top: top.map((r) => ({ id: String(r.id), name: r.name, slug: r.slug, art: r.art, bytes: Number(r.b) })),
    monat: await monatsVerbrauch(userId),
    grenze: await trafficGrenze(userId)
  }
}

export async function trafficProKonto(): Promise<Map<number, number>> {
  await trafficSchreiben()
  const r = await q<{ user_id: number; s: string }>(
    `SELECT user_id, sum(bytes) AS s FROM traffic WHERE tag >= ${MONAT} GROUP BY user_id`
  )
  return new Map(r.map((x) => [x.user_id, Number(x.s)]))
}
