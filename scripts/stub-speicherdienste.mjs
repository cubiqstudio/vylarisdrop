#!/usr/bin/env node
// Kleiner Nachbau der Admin-Schnittstellen von SFTPGo, Garage (Admin-API v2) und dem S3-Teil von Garage — NUR für Tests
// (scripts/test-speicher-budget.sh). Kein Docker nötig. Bildet genau das nach, was VylarisCloud benutzt:
//   SFTPGo : POST /api/v2/token (Basic), GET /api/v2/status, /users[/name] (GET/POST/PUT/DELETE), /folders[/name], POST /quotas/folders/name/scan
//   Garage : GetClusterHealth, CreateBucket, UpdateBucket, GetBucketInfo, DeleteBucket, CreateKey, AllowBucketKey, DeleteKey
//   S3     : ListObjectsV2, DeleteObjects, ListMultipartUploads (nur zum Leeren eines Buckets beim Löschen)
// Aufruf: node stub-speicherdienste.mjs [sftpgoPort=33221] [garagePort=33222] [s3Port=33223]
//   Zugangsdaten per Umgebung: STUB_SFTPGO_PW (Standard "sftpgo-test-pw"), STUB_GARAGE_TOKEN (Standard "garage-test-token")
// Steuerung (nur am SFTPGo-Port, Pfad /__stub/...): GET state · POST reset · POST folder-belegt {name,bytes} · POST bucket-belegt {alias,bytes}
//   · POST user-quota {name,quota_size} · POST bucket-quota {alias,maxSize} · POST ausfall {an}
// Der Stub speichert alles nur im Arbeitsspeicher und gibt Zugangsdaten nie aus.
import http from 'node:http'
import { randomBytes } from 'node:crypto'

const [pS, pG, pB] = [Number(process.argv[2] || 33221), Number(process.argv[3] || 33222), Number(process.argv[4] || 33223)]
const PW = process.env.STUB_SFTPGO_PW || 'sftpgo-test-pw'
const TOKEN = process.env.STUB_GARAGE_TOKEN || 'garage-test-token'

let users, folders, buckets, keys, ausfall, aufrufe
const reset = () => {
  users = new Map()
  folders = new Map()
  buckets = new Map() // id -> {id, alias, quotas:{maxSize,maxObjects}, bytes, objects, keys:Set}
  keys = new Map()
  ausfall = false
  aufrufe = { sftpgo: 0, garage: 0, s3: 0, token: 0 }
}
reset()
const fruehToken = new Set()

const lies = (req) =>
  new Promise((ok) => {
    const t = []
    req.on('data', (c) => t.push(c))
    req.on('end', () => {
      const s = Buffer.concat(t).toString('utf8')
      try {
        ok(s ? JSON.parse(s) : {})
      } catch {
        ok({ __kaputt: true, roh: s })
      }
    })
  })
const antwort = (res, status, obj) => {
  const s = obj === undefined ? '' : typeof obj === 'string' ? obj : JSON.stringify(obj)
  res.writeHead(status, { 'content-type': typeof obj === 'string' ? 'application/xml' : 'application/json' })
  res.end(s)
}

// ---------- SFTPGo ----------
const sftpgo = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const p = url.pathname
  if (p.startsWith('/__stub/')) {
    const b = req.method === 'POST' ? await lies(req) : {}
    const was = p.slice(8)
    if (was === 'state')
      return antwort(res, 200, {
        users: Object.fromEntries(users),
        folders: Object.fromEntries(folders),
        buckets: Object.fromEntries([...buckets].map(([k, v]) => [k, { ...v, keys: [...v.keys] }])),
        keys: Object.fromEntries(keys),
        aufrufe
      })
    if (was === 'reset') return (reset(), antwort(res, 200, { ok: true }))
    if (was === 'ausfall') return ((ausfall = !!b.an), antwort(res, 200, { ok: true, ausfall }))
    if (was === 'folder-belegt') {
      const f = folders.get(b.name)
      if (!f) return antwort(res, 404, { error: 'kein Ordner' })
      f.used_quota_size = Number(b.bytes)
      f.used_quota_files = Number(b.bytes) > 0 ? 1 : 0
      return antwort(res, 200, { ok: true })
    }
    if (was === 'bucket-belegt') {
      const x = [...buckets.values()].find((v) => v.alias === b.alias)
      if (!x) return antwort(res, 404, { error: 'kein Bucket' })
      x.bytes = Number(b.bytes)
      return antwort(res, 200, { ok: true })
    }
    if (was === 'user-quota') {
      const u = users.get(b.name)
      if (!u) return antwort(res, 404, { error: 'kein Nutzer' })
      for (const f of u.virtual_folders || []) f.quota_size = Number(b.quota_size)
      return antwort(res, 200, { ok: true })
    }
    if (was === 'bucket-quota') {
      const x = [...buckets.values()].find((v) => v.alias === b.alias)
      if (!x) return antwort(res, 404, { error: 'kein Bucket' })
      x.quotas.maxSize = b.maxSize
      return antwort(res, 200, { ok: true })
    }
    return antwort(res, 404, { error: 'unbekannt' })
  }
  if (ausfall) return req.socket.destroy()
  aufrufe.sftpgo++
  if (p === '/api/v2/token') {
    aufrufe.token++
    const a = String(req.headers.authorization || '')
    const ok = a.startsWith('Basic ') && Buffer.from(a.slice(6), 'base64').toString() === `vylariscloud:${PW}`
    if (!ok) return antwort(res, 401, { message: 'Zugang abgelehnt' })
    const t = randomBytes(16).toString('hex')
    fruehToken.add(t)
    return antwort(res, 200, { access_token: t, expires_at: new Date(Date.now() + 20 * 60_000).toISOString() })
  }
  const auth = String(req.headers.authorization || '')
  if (!auth.startsWith('Bearer ') || !fruehToken.has(auth.slice(7))) return antwort(res, 401, { message: 'kein Token' })
  const teile = p.replace(/^\/api\/v2\//, '').split('/').map(decodeURIComponent)
  const [was, name, unter] = teile
  const body = ['POST', 'PUT'].includes(req.method) ? await lies(req) : {}
  if (was === 'status') return antwort(res, 200, { message: 'ok' })
  if (was === 'users') {
    if (!name) {
      if (req.method !== 'POST') return antwort(res, 405, {})
      if (!body.username || users.has(body.username)) return antwort(res, 409, { error: 'Nutzer gibt es schon' })
      for (const f of body.virtual_folders || [])
        if (!folders.has(f.name)) return antwort(res, 400, { error: `Ordner ${f.name} gibt es nicht` })
      users.set(body.username, { ...body, last_login: 0 })
      return antwort(res, 201, body)
    }
    const u = users.get(name)
    if (req.method === 'GET') return u ? antwort(res, 200, u) : antwort(res, 404, { message: 'nicht gefunden' })
    if (!u) return antwort(res, 404, { message: 'nicht gefunden' })
    if (req.method === 'PUT') {
      for (const f of body.virtual_folders || [])
        if (!folders.has(f.name)) return antwort(res, 400, { error: `Ordner ${f.name} gibt es nicht` })
      users.set(name, { ...body, username: name, last_login: u.last_login })
      return antwort(res, 200, { message: 'ok' })
    }
    if (req.method === 'DELETE') return (users.delete(name), antwort(res, 200, { message: 'ok' }))
  }
  if (was === 'folders') {
    if (!name) {
      if (req.method !== 'POST') return antwort(res, 405, {})
      if (!body.name || folders.has(body.name)) return antwort(res, 409, { error: 'Ordner gibt es schon' })
      folders.set(body.name, { ...body, used_quota_size: 0, used_quota_files: 0 })
      return antwort(res, 201, body)
    }
    const f = folders.get(name)
    if (req.method === 'GET') return f ? antwort(res, 200, f) : antwort(res, 404, { message: 'nicht gefunden' })
    if (!f) return antwort(res, 404, { message: 'nicht gefunden' })
    if (req.method === 'PUT') return (folders.set(name, { ...f, ...body, name }), antwort(res, 200, { message: 'ok' }))
    if (req.method === 'DELETE') return (folders.delete(name), antwort(res, 200, { message: 'ok' }))
  }
  if (was === 'quotas' && name === 'folders' && teile[3] === 'scan') return antwort(res, 202, { message: 'ok' })
  return antwort(res, 404, { message: 'unbekannt ' + p })
})

// ---------- Garage ----------
const garage = http.createServer(async (req, res) => {
  if (ausfall) return req.socket.destroy()
  aufrufe.garage++
  const url = new URL(req.url, 'http://x')
  if (String(req.headers.authorization || '') !== `Bearer ${TOKEN}`) return antwort(res, 403, { message: 'Token falsch' })
  const was = url.pathname.replace(/^\/v2\//, '')
  const id = url.searchParams.get('id') || ''
  const body = req.method === 'POST' ? await lies(req) : {}
  if (was === 'GetClusterHealth') return antwort(res, 200, { status: 'healthy' })
  if (was === 'CreateBucket') {
    const alias = String(body.globalAlias || '')
    if (!alias) return antwort(res, 400, { message: 'Alias fehlt' })
    if ([...buckets.values()].some((b) => b.alias === alias)) return antwort(res, 409, { message: 'Alias gibt es schon' })
    const bid = randomBytes(32).toString('hex')
    buckets.set(bid, { id: bid, alias, quotas: { maxSize: null, maxObjects: null }, bytes: 0, objects: 0, keys: new Set() })
    return antwort(res, 200, { id: bid, globalAliases: [alias] })
  }
  if (was === 'CreateKey') {
    const k = 'GK' + randomBytes(10).toString('hex')
    keys.set(k, { name: body.name || '', secret: randomBytes(16).toString('hex') })
    return antwort(res, 200, { accessKeyId: k, secretAccessKey: keys.get(k).secret, name: body.name })
  }
  if (was === 'AllowBucketKey') {
    const b = buckets.get(body.bucketId)
    if (!b || !keys.has(body.accessKeyId)) return antwort(res, 404, { message: 'Bucket oder Schlüssel fehlt' })
    b.keys.add(body.accessKeyId)
    return antwort(res, 200, { id: b.id })
  }
  if (was === 'DeleteKey') {
    if (!keys.has(id)) return antwort(res, 404, { message: 'Schlüssel fehlt' })
    keys.delete(id)
    for (const b of buckets.values()) b.keys.delete(id)
    return antwort(res, 200, {})
  }
  const b = buckets.get(id)
  if (['UpdateBucket', 'GetBucketInfo', 'DeleteBucket'].includes(was)) {
    if (!b) return antwort(res, 404, { message: 'Bucket fehlt' })
    if (was === 'GetBucketInfo')
      return antwort(res, 200, {
        id: b.id,
        globalAliases: [b.alias],
        bytes: b.bytes,
        objects: b.objects,
        unfinishedMultipartUploadBytes: 0,
        quotas: b.quotas,
        keys: [...b.keys].map((k) => ({ accessKeyId: k }))
      })
    if (was === 'UpdateBucket') {
      if (body.quotas) b.quotas = { maxSize: body.quotas.maxSize ?? null, maxObjects: body.quotas.maxObjects ?? null }
      return antwort(res, 200, { id: b.id })
    }
    if (was === 'DeleteBucket') return (buckets.delete(id), antwort(res, 200, {}))
  }
  return antwort(res, 404, { message: 'unbekannt ' + was })
})

// ---------- S3 (nur Leeren) ----------
const s3 = http.createServer(async (req, res) => {
  if (ausfall) return req.socket.destroy()
  aufrufe.s3++
  const url = new URL(req.url, 'http://x')
  for await (const _ of req) void _
  if (url.searchParams.has('uploads'))
    return antwort(res, 200, '<?xml version="1.0"?><ListMultipartUploadsResult><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>')
  if (req.method === 'POST' && url.searchParams.has('delete'))
    return antwort(res, 200, '<?xml version="1.0"?><DeleteResult></DeleteResult>')
  return antwort(
    res,
    200,
    '<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated><KeyCount>0</KeyCount></ListBucketResult>'
  )
})

for (const [srv, port] of [[sftpgo, pS], [garage, pG], [s3, pB]]) srv.listen(port, '127.0.0.1')
console.log(`stub-speicherdienste: SFTPGo ${pS}, Garage ${pG}, S3 ${pB}`)
