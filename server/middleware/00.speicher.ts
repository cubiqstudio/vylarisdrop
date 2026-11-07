import http from 'node:http'
import { clientIp } from '../utils/auth'
import { q1 } from '../utils/db'
import { S3_ZIEL, WEBDAV_ZIEL, speicherKonfiguriert } from '../utils/speicherdienst'

const ordnerCache = new Map<string, { ordner: string | null; bis: number }>()
async function unterOrdner(login: string): Promise<string | null> {
  const c = ordnerCache.get(login)
  if (c && c.bis > Date.now()) return c.ordner
  const z = await q1<{ ordner: string }>('SELECT ordner FROM speicher_unterkonten WHERE login = $1', [login]).catch(
    () => null
  )
  ordnerCache.set(login, { ordner: z?.ordner ?? null, bis: Date.now() + 30_000 })
  if (ordnerCache.size > 2000) ordnerCache.clear()
  return z?.ordner ?? null
}
function pfadAus(roh: string): string | null {
  let p: string
  try {
    p = decodeURIComponent(roh.split('?')[0]!)
  } catch {
    return null
  }
  if (p.includes('\0') || /(^|\/)\.\.(\/|$)/.test(p) || p.includes('\\')) return null
  return p.replace(/\/{2,}/g, '/')
}
async function unterkontoErlaubt(req: http.IncomingMessage): Promise<boolean> {
  const auth = String(req.headers.authorization || '')
  if (!auth.startsWith('Basic ')) return true
  let login = ''
  try {
    login = Buffer.from(auth.slice(6), 'base64').toString('utf8').split(':')[0]!
  } catch {
    return true
  }
  if (!/^rd\d{6}-sub\d+$/.test(login)) return true
  const ordner = await unterOrdner(login)
  if (!ordner) return true
  const drin = (p: string | null) => !!p && (p === `/webdav/${ordner}` || p.startsWith(`/webdav/${ordner}/`))
  const p = pfadAus(req.url || '/')
  if (p === '/webdav/' || p === '/webdav') return ['PROPFIND', 'OPTIONS', 'HEAD'].includes(req.method || '')
  if (!drin(p)) return false
  const ziel = req.headers.destination
  if (ziel) {
    let zp: string | null = null
    try {
      zp = pfadAus(new URL(String(ziel), 'http://x').pathname)
    } catch {
      zp = null
    }
    if (!drin(zp)) return false
  }
  return true
}

const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer'])

function istS3(req: http.IncomingMessage): boolean {
  const auth = String(req.headers.authorization || '')
  if (auth.startsWith('AWS4-HMAC-SHA256 ')) return true
  const url = req.url || ''
  if (/[?&]X-Amz-(Signature|Credential)=/i.test(url)) return true
  return req.method === 'OPTIONS' && /x-amz-/i.test(String(req.headers['access-control-request-headers'] || ''))
}

function weiterreichen(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ziel: string,
  extra: Record<string, string> = {}
): Promise<void> {
  return new Promise((fertig) => {
    const z = new URL(ziel)
    const kopf: http.OutgoingHttpHeaders = {}
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && !HOP.has(k)) kopf[k] = v
    Object.assign(kopf, extra)
    const restVerwerfen = () => {
      req.unpipe(hoch)
      req.resume()
    }
    const hoch = http.request(
      { host: z.hostname, port: z.port || 80, method: req.method, path: req.url, headers: kopf },
      (antwort) => {
        const aus: http.OutgoingHttpHeaders = {}
        for (const [k, v] of Object.entries(antwort.headers)) if (v !== undefined && !HOP.has(k)) aus[k] = v
        res.writeHead(antwort.statusCode || 502, aus)
        antwort.pipe(res)
        antwort.on('end', () => {
          if (!req.complete) restVerwerfen()
          fertig()
        })
        antwort.on('error', () => {
          if (!res.writableEnded) res.end()
          fertig()
        })
      }
    )
    hoch.on('error', (e: any) => {
      if (res.writableEnded) {
        restVerwerfen()
        fertig()
        return
      }
      if (e.code !== 'EPIPE' && e.code !== 'ECONNRESET')
        console.error('[vylariscloud] Speicher-Weiterleitung:', e.code || e.message)
      if (!res.headersSent) {
        res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('Speicherdienst nicht erreichbar / storage service unavailable')
      } else res.end()
      restVerwerfen()
      fertig()
    })
    res.on('close', () => {
      hoch.destroy()
      fertig()
    })
    req.pipe(hoch)
  })
}

export default defineEventHandler(async (event) => {
  const req = event.node.req
  const pfad = (req.url || '/').split('?')[0]!
  const webdav = pfad === '/webdav' || pfad.startsWith('/webdav/')
  if (!webdav && !istS3(req)) return
  if (!speicherKonfiguriert()) {
    if (webdav)
      throw fehler(
        404,
        'Speicher ist auf dieser Installation nicht eingeschaltet.',
        'Storage is not enabled on this installation.'
      )
    return
  }
  if (webdav) {
    if (pfad === '/webdav') req.url = '/webdav/' + (req.url || '').slice(7)
    if (!(await unterkontoErlaubt(req))) {
      req.resume()
      event.node.res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      event.node.res.end('Kein Zugriff außerhalb des eigenen Ordners / no access outside your own folder')
      return
    }
    await weiterreichen(req, event.node.res, WEBDAV_ZIEL, { 'x-forwarded-for': clientIp(event) })
  } else {
    await weiterreichen(req, event.node.res, S3_ZIEL)
  }
})
