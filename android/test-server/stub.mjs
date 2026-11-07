// Stub-Server für die App-Tests: bildet den Vertrag /api/app/*, /api/public/*, /api/upload nach.
// Start: node stub.mjs [port]   (Port 0 = frei wählen). Ausgabe: "LISTENING <port>"
// Dieselben JVM-Tests laufen später gegen den echten Server (VD_TEST_SERVER).
import http from 'node:http'
import crypto from 'node:crypto'

const ADMIN = { id: 1, name: 'admin', rolle: 'owner', pass: 'Cloud-Test-2026!' }
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const sitzungen = new Map() // cookie -> nutzer
const codes = new Map() // code -> { bis, benutzt }
const geraete = [] // { id, token, name, widerrufen }
const uploads = new Map()
const gespeichert = [] // { name, size, sha256, mime }
const dateien = new Map() // slug -> { daten, mime }
const fehlversuche = new Map() // ip -> { n, bis }
let geraetNr = 0
let dateiNr = 0
const TEIL = 65536

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const json = (res, status, obj, kopf = {}) => {
  const t = JSON.stringify(obj)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(t), ...kopf })
  res.end(t)
}
const fehler = (res, status, message) => json(res, status, { statusCode: status, statusMessage: 'Error', message })
const lesen = (req, max = 1 << 30) =>
  new Promise((ok, nein) => {
    const teile = []
    let n = 0
    req.on('data', (c) => {
      n += c.length
      if (n > max) return nein(new Error('zu gross'))
      teile.push(c)
    })
    req.on('end', () => ok(Buffer.concat(teile)))
    req.on('error', nein)
  })
const jsonBody = async (req) => {
  try {
    return JSON.parse((await lesen(req, 1 << 20)).toString() || '{}')
  } catch {
    return {}
  }
}
const cookieAus = (req) => {
  const m = /(?:^|;\s*)vd_session=([0-9a-f]{64})/.exec(req.headers.cookie || '')
  return m ? m[1] : null
}
const sitzungVon = (req) => (cookieAus(req) ? sitzungen.get(cookieAus(req)) : null)
const tokenVon = (req) => {
  const m = /^Bearer\s+(vd_app_[0-9a-f]{48})$/.exec(req.headers.authorization || '')
  if (!m) return null
  const g = geraete.find((x) => x.token === m[1] && !x.widerrufen)
  if (g) g.zuletzt = Date.now()
  return g || null
}
const originOk = (req) => {
  const o = req.headers.origin
  if (!o) return true
  try {
    return new URL(o).host === req.headers.host
  } catch {
    return false
  }
}
const basis = (req) => `http://${req.headers.host}`
const nutzerJson = () => ({ id: ADMIN.id, name: ADMIN.name, rolle: ADMIN.rolle })
const serverJson = () => ({ name: 'VylarisCloud', version: '1.1.0', farbe: '#1e73be' })
const ip = (req) => req.socket.remoteAddress || ''

function neuesGeraet(name) {
  const token = 'vd_app_' + crypto.randomBytes(24).toString('hex')
  const g = { id: ++geraetNr, token, name: String(name || 'Gerät').slice(0, 80), widerrufen: false, zuletzt: Date.now() }
  // höchstens 10 je Nutzer: das am längsten ungenutzte ersetzen
  const aktiv = geraete.filter((x) => !x.widerrufen)
  if (aktiv.length >= 10) aktiv.sort((a, b) => a.zuletzt - b.zuletzt)[0].widerrufen = true
  geraete.push(g)
  return token
}

function teile(buf, grenze) {
  // minimaler multipart-Parser: liefert [{ name, filename, mime, daten }]
  const sep = Buffer.from('--' + grenze)
  const r = []
  let pos = buf.indexOf(sep)
  while (pos >= 0) {
    const start = pos + sep.length
    if (buf.slice(start, start + 2).toString() === '--') break
    const kopfEnde = buf.indexOf('\r\n\r\n', start)
    const naechst = buf.indexOf(sep, kopfEnde)
    if (kopfEnde < 0 || naechst < 0) break
    const kopf = buf.slice(start + 2, kopfEnde).toString('utf8')
    const daten = buf.slice(kopfEnde + 4, naechst - 2)
    const cd = /content-disposition:[^\r\n]*/i.exec(kopf)?.[0] || ''
    r.push({
      name: /name="([^"]*)"/.exec(cd)?.[1],
      filename: /filename="([^"]*)"/.exec(cd)?.[1],
      mime: /content-type:\s*([^\r\n]+)/i.exec(kopf)?.[1],
      daten
    })
    pos = naechst
  }
  return r
}

const dateiAntwort = (req, d) => {
  const slug = 'f' + ++dateiNr
  dateien.set(slug, { daten: d.daten, mime: d.mime || 'application/octet-stream' })
  return {
    id: String(dateiNr),
    slug,
    name: d.name,
    size: d.size,
    links: { seite: `${basis(req)}/v/${slug}`, direkt: `${basis(req)}/r/${slug}`, download: `${basis(req)}/d/${slug}` }
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x')
    const p = url.pathname
    const m = req.method
    if (m !== 'GET' && m !== 'HEAD' && !originOk(req)) return fehler(res, 403, 'Anfrage von fremder Seite abgelehnt')

    if (p === '/api/public/health' && m === 'GET') return json(res, 200, { ok: true, instance: 'stub' })
    if (p === '/api/public/theme' && m === 'GET')
      return json(res, 200, { setup: true, color: '#1e73be', name: 'VylarisCloud Stub', lang: 'de', user: null, pro: false, marke: { weiss: false, logo: '', icon: '' } })
    if (p === '/umleitung-test' && m === 'GET') {
      res.writeHead(301, { location: 'https://example.invalid/' })
      return res.end()
    }

    if (p === '/api/auth/login' && m === 'POST') {
      const b = await jsonBody(req)
      if (String(b.username).toLowerCase() !== ADMIN.name || b.password !== ADMIN.pass) return fehler(res, 401, 'Benutzername oder Passwort falsch.')
      const c = crypto.randomBytes(32).toString('hex')
      sitzungen.set(c, ADMIN)
      return json(res, 200, { ok: true }, { 'set-cookie': `vd_session=${c}; Path=/; HttpOnly; SameSite=Lax` })
    }

    if (p === '/api/app/koppelcode' && m === 'POST') {
      if (!sitzungVon(req)) return fehler(res, 401, 'Nicht angemeldet')
      const offen = [...codes.values()].filter((c) => !c.benutzt && c.bis > Date.now())
      if (offen.length >= 5) return fehler(res, 429, 'Zu viele offene Codes')
      let c = ''
      for (let i = 0; i < 8; i++) c += ALPHABET[crypto.randomInt(ALPHABET.length)]
      const code = c.slice(0, 4) + '-' + c.slice(4)
      codes.set(code, { bis: Date.now() + 300_000, benutzt: false })
      return json(res, 200, { code, ablaufSek: 300, link: `${basis(req)}/app/koppeln?c=${code}` })
    }

    if (p === '/api/app/koppeln' && m === 'POST') {
      const f = fehlversuche.get(ip(req)) || { n: 0, bis: 0 }
      if (f.bis > Date.now() && f.n >= 8) return fehler(res, 429, 'Zu viele Versuche. Bitte später erneut.')
      const b = await jsonBody(req)
      const c = codes.get(String(b.code || '').toUpperCase())
      if (!c || c.benutzt || c.bis < Date.now()) {
        fehlversuche.set(ip(req), { n: (f.bis > Date.now() ? f.n : 0) + 1, bis: f.bis > Date.now() ? f.bis : Date.now() + 600_000 })
        return fehler(res, 404, 'Code unbekannt, abgelaufen oder schon benutzt.')
      }
      c.benutzt = true
      return json(res, 200, { ok: true, token: neuesGeraet(b.geraet), nutzer: nutzerJson(), server: serverJson() })
    }

    if (p === '/api/app/token' && m === 'POST') {
      if (!sitzungVon(req)) return fehler(res, 401, 'Nicht angemeldet')
      const b = await jsonBody(req)
      return json(res, 200, { ok: true, token: neuesGeraet(b.geraet), nutzer: nutzerJson(), server: serverJson() })
    }

    if (p === '/api/app/sitzung' && m === 'POST') {
      if (!tokenVon(req)) return fehler(res, 401, 'Token ungültig oder widerrufen')
      const c = crypto.randomBytes(32).toString('hex')
      sitzungen.set(c, ADMIN)
      return json(res, 200, { ok: true, nutzer: nutzerJson() }, { 'set-cookie': `vd_session=${c}; Path=/; HttpOnly; SameSite=Lax` })
    }

    if (p === '/api/app/ich' && m === 'GET') {
      const g = tokenVon(req)
      if (!g) return fehler(res, 401, 'Token ungültig oder widerrufen')
      return json(res, 200, { nutzer: nutzerJson(), geraet: { id: g.id, name: g.name }, server: serverJson() })
    }

    if (p === '/api/app/geraete' && m === 'GET') {
      if (!sitzungVon(req)) return fehler(res, 401, 'Nicht angemeldet')
      return json(res, 200, geraete.filter((g) => !g.widerrufen).map((g) => ({ id: g.id, name: g.name })))
    }
    let mm = /^\/api\/app\/geraete\/(\d+)$/.exec(p)
    if (mm && m === 'DELETE') {
      if (!sitzungVon(req)) return fehler(res, 401, 'Nicht angemeldet')
      const g = geraete.find((x) => x.id === Number(mm[1]) && !x.widerrufen)
      if (!g) return fehler(res, 404, 'Nicht gefunden')
      g.widerrufen = true
      return json(res, 200, { ok: true })
    }

    // Upload: einfach (Bearer-Token ODER Sitzung)
    if (p === '/api/upload' && m === 'POST') {
      if (!tokenVon(req) && !sitzungVon(req)) return fehler(res, 401, 'Nicht angemeldet oder Token ungültig.')
      const typ = req.headers['content-type'] || ''
      const gr = /boundary=(.+)$/.exec(typ)?.[1]
      if (!typ.startsWith('multipart/form-data') || !gr) return fehler(res, 415, 'Bitte als multipart/form-data senden.')
      const t = teile(await lesen(req), gr).filter((x) => x.filename !== undefined)
      if (!t.length || !t[0].daten.length) return fehler(res, 400, 'Keine Datei im Upload.')
      const files = t.map((x) => {
        const d = { name: x.filename, size: x.daten.length, sha256: sha(x.daten), mime: x.mime, daten: x.daten }
        gespeichert.push({ name: d.name, size: d.size, sha256: d.sha256, mime: d.mime })
        return dateiAntwort(req, d)
      })
      return json(res, 200, { ok: true, url: files[0].links.seite, raw: files[0].links.direkt, download: files[0].links.download, files })
    }

    // Upload in Stücken: nur Sitzung (wie im echten Server: requireUser)
    if (p === '/api/upload/start' && m === 'POST') {
      if (!sitzungVon(req)) return fehler(res, 401, 'Nicht angemeldet')
      const b = await jsonBody(req)
      if (!Number.isSafeInteger(b.size) || b.size <= 0) return fehler(res, 400, 'Ungültige Dateigröße.')
      const id = crypto.randomBytes(12).toString('hex')
      uploads.set(id, { name: b.name, size: b.size, mime: b.mime, teile: Math.ceil(b.size / TEIL), erhalten: new Map() })
      return json(res, 200, { id, teilGroesse: TEIL, teile: Math.ceil(b.size / TEIL) })
    }
    mm = /^\/api\/upload\/([0-9a-f]+)\/(\d+)$/.exec(p)
    if (mm && m === 'PUT') {
      if (!sitzungVon(req)) return fehler(res, 401, 'Nicht angemeldet')
      const u = uploads.get(mm[1])
      if (!u) return fehler(res, 404, 'Upload nicht gefunden (abgelaufen?).')
      const nr = Number(mm[2])
      if (nr >= u.teile) return fehler(res, 400, 'Ungültige Stück-Nummer.')
      const soll = nr === u.teile - 1 ? u.size - nr * TEIL : TEIL
      const daten = await lesen(req)
      if (daten.length !== soll) return fehler(res, 400, 'Das Stück ist unvollständig.')
      u.erhalten.set(nr, daten)
      return json(res, 200, { ok: true })
    }
    mm = /^\/api\/upload\/([0-9a-f]+)\/fertig$/.exec(p)
    if (mm && m === 'POST') {
      if (!sitzungVon(req)) return fehler(res, 401, 'Nicht angemeldet')
      const u = uploads.get(mm[1])
      if (!u) return fehler(res, 404, 'Upload nicht gefunden (abgelaufen?).')
      if (u.erhalten.size !== u.teile) return fehler(res, 409, `Es fehlen noch ${u.teile - u.erhalten.size} Stück(e).`)
      const alles = Buffer.concat([...u.erhalten.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1]))
      uploads.delete(mm[1])
      const d = { name: u.name, size: alles.length, sha256: sha(alles), mime: u.mime, daten: alles }
      gespeichert.push({ name: d.name, size: d.size, sha256: d.sha256, mime: d.mime })
      return json(res, 200, { ok: true, file: dateiAntwort(req, d) })
    }
    mm = /^\/api\/upload\/([0-9a-f]+)$/.exec(p)
    if (mm && m === 'DELETE') {
      if (!sitzungVon(req)) return fehler(res, 401, 'Nicht angemeldet')
      uploads.delete(mm[1])
      return json(res, 200, { ok: true })
    }

    mm = /^\/(?:r|d)\/(f\d+)$/.exec(p)
    if (mm && m === 'GET') {
      const f = dateien.get(mm[1])
      if (!f) return fehler(res, 404, 'Nicht gefunden')
      res.writeHead(200, { 'content-type': f.mime, 'content-length': f.daten.length })
      return res.end(f.daten)
    }
    // Nur für Tests: was der Stub empfangen hat
    if (p === '/__test/dateien' && m === 'GET') return json(res, 200, gespeichert)
    if (p === '/__test/widerrufen' && m === 'POST') {
      const b = await jsonBody(req)
      const g = geraete.find((x) => x.token === b.token)
      if (g) g.widerrufen = true
      return json(res, 200, { ok: !!g })
    }
    fehler(res, 404, 'Nicht gefunden')
  } catch (e) {
    if (!res.headersSent) fehler(res, 500, String(e.message || e))
    else res.destroy()
  }
})

server.listen(Number(process.argv[2] ?? 0), '127.0.0.1', () => console.log('LISTENING ' + server.address().port))
