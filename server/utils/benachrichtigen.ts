import nodemailer from 'nodemailer'
import { q, q1 } from './db'
import { getDesign, getSetting } from './settings'
import { kontingentVon } from './hochladen'
import type { Nutzer } from './auth'

export type Art = 'upload' | 'anfrage' | 'speicher' | 'virus' | 'webhook' | 'system' | 'traffic'
export interface BenachEinst {
  discord?: string
  email?: boolean
  arten?: Partial<Record<Art, boolean>>
}
export interface Mail {
  host: string
  port: number
  sicher: boolean
  user: string
  pass: string
  von: string
}

export const STANDARD: Record<Art, boolean> = {
  upload: false,
  anfrage: true,
  speicher: true,
  virus: true,
  webhook: true,
  system: true,
  traffic: true
}
export const WEBHOOK =
  /^https:\/\/(?:ptb\.|canary\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d{5,25}\/[\w-]{20,100}$/

export const getMail = () => getSetting<Mail | null>('mail', null)
export const mailBereit = (m: Mail | null): m is Mail => !!(m && m.host && m.von)

function transport(m: Mail) {
  return nodemailer.createTransport({
    host: m.host,
    port: m.port || 587,
    secure: !!m.sicher,
    ...(m.user ? { auth: { user: m.user, pass: m.pass } } : {}),
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000
  })
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export async function mailSenden(an: string, betreff: string, text: string, link?: { url: string; text: string }) {
  const m = await getMail()
  if (!mailBereit(m)) throw new Error('kein-smtp')
  const d = await getDesign()
  const html = `<!doctype html><html><body style="margin:0;background:#f4f3f1;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18171a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:16px;border:1px solid #e4e1dc"><tr><td style="padding:28px 28px 8px">
<div style="font-weight:700;font-size:15px;color:${d.color}">${esc(d.name)}</div>
<h1 style="font-size:20px;margin:14px 0 8px;letter-spacing:-.02em">${esc(betreff)}</h1>
<p style="font-size:14.5px;line-height:1.6;color:#5c5a60;margin:0 0 20px;white-space:pre-line">${esc(text)}</p>
${link ? `<a href="${esc(link.url)}" style="display:inline-block;background:${d.color};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 18px;border-radius:10px">${esc(link.text)}</a>` : ''}
</td></tr><tr><td style="padding:20px 28px 26px;font-size:12px;color:#8d8a90">Benachrichtigungen stellst du in ${esc(d.name)} unter Einstellungen ein.</td></tr></table>
</td></tr></table></body></html>`
  await transport(m).sendMail({
    from: m.von,
    to: an,
    subject: `${betreff} · ${d.name}`,
    text: `${text}${link ? `\n\n${link.url}` : ''}`,
    html
  })
}

async function discordSenden(url: string, titel: string, text: string, link?: { url: string; text: string }) {
  const d = await getDesign()
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
    body: JSON.stringify({
      username: d.name.slice(0, 80),
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: titel.slice(0, 250),
          description: text.slice(0, 3500),
          color: Number.parseInt(d.color.slice(1), 16),
          ...(link ? { url: link.url } : {}),
          timestamp: new Date().toISOString()
        }
      ]
    })
  })
  if (!r.ok) throw new Error(`discord ${r.status}`)
}

export interface Nachricht {
  titel: string
  text: string
  link?: { url: string; text: string }
}

export async function benachrichtigen(
  userId: number,
  art: Art | 'test',
  n: Nachricht,
  erzwingen = false
): Promise<{ discord?: string; email?: string }> {
  const u = await q1<{ email: string; prefs: any }>('SELECT email, prefs FROM users WHERE id = $1', [userId])
  if (!u) return {}
  const e: BenachEinst = u.prefs?.benachrichtigung || {}
  if (!erzwingen && art !== 'test' && !(e.arten?.[art] ?? STANDARD[art])) return {}
  const aus: { discord?: string; email?: string } = {}
  if (e.discord && WEBHOOK.test(e.discord)) {
    try {
      await discordSenden(e.discord, n.titel, n.text, n.link)
      aus.discord = 'ok'
    } catch (x: any) {
      aus.discord = 'fehler'
      console.warn('[vylariscloud] Discord-Benachrichtigung:', x?.message)
    }
  }
  if (e.email && u.email) {
    try {
      await mailSenden(u.email, n.titel, n.text, n.link)
      aus.email = 'ok'
    } catch (x: any) {
      aus.email = x?.message === 'kein-smtp' ? 'kein-smtp' : 'fehler'
      if (aus.email === 'fehler') console.warn('[vylariscloud] E-Mail-Benachrichtigung:', x?.message)
    }
  }
  return aus
}

export const imHintergrund = (userId: number, art: Art, n: Nachricht) => {
  void benachrichtigen(userId, art, n).catch(() => {})
}

export async function nachUpload(u: Nutzer, datei: { name: string; size: number | string }, seite: string) {
  const en = u.prefs?.lang === 'en'
  imHintergrund(
    u.id,
    'upload',
    en
      ? { titel: 'New upload', text: `${datei.name} was uploaded.`, link: { url: seite, text: 'Open file' } }
      : { titel: 'Neuer Upload', text: `${datei.name} wurde hochgeladen.`, link: { url: seite, text: 'Datei öffnen' } }
  )
  await speicherPruefen(u).catch(() => {})
}

export async function speicherPruefen(u: Nutzer) {
  const k = await kontingentVon(u)
  if (!k) return
  const r = await q1<{ s: string }>('SELECT coalesce(sum(size), 0) AS s FROM files WHERE user_id = $1', [u.id])
  const anteil = Number(r?.s || 0) / k
  const gewarnt = !!u.prefs?.speicherGewarnt
  if (anteil >= 0.9 && !gewarnt) {
    await q(`UPDATE users SET prefs = prefs || '{"speicherGewarnt": true}'::jsonb WHERE id = $1`, [u.id])
    const pz = Math.round(anteil * 100),
      en = u.prefs?.lang === 'en'
    imHintergrund(
      u.id,
      'speicher',
      en
        ? { titel: 'Storage almost full', text: `Your storage is ${pz}% full. Delete old files to make room.` }
        : {
            titel: 'Speicher fast voll',
            text: `Dein Speicher ist zu ${pz} % belegt. Lösche alte Dateien, um Platz zu schaffen.`
          }
    )
  } else if (anteil < 0.85 && gewarnt) {
    await q(`UPDATE users SET prefs = prefs - 'speicherGewarnt' WHERE id = $1`, [u.id])
  }
}
