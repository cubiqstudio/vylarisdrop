#!/usr/bin/env node
// Entwicklerwerkzeug: kleiner SFTP-Server (ssh2) auf einem Verzeichnis — für Tests der Speicher-Erweiterungen,
// wenn kein OpenSSH zur Hand ist. Nicht für den Produktivbetrieb (kein Rechtekonzept, Klartext-Passwort in der Kommandozeile).
//
//   node scripts/test-sftp-server.mjs --root /tmp/sftp-root --host 192.0.2.2 --port 2205 \
//        --user box --password geheim [--pubkey ~/.ssh/id_ed25519.pub] [--control 2206] [--delay 20] [--hostkey schluessel.pem]
//
// Hinweis: Loopback (127.0.0.1) lehnt VylarisCloud als Ziel ab (SSRF-Schutz) — eine andere lokale Adresse des Rechners
// verwenden (z. B. die Container-IP). Fehler provozieren über den Steueranschluss (nur 127.0.0.1), Zeilenprotokoll:
//   echo rotate  | nc 127.0.0.1 2206   neuer Host-Schlüssel (gilt für neue Verbindungen)  -> Warnung "Host-Schlüssel geändert"
//   echo delay 200                     jede SFTP-Anfrage um 200 ms verzögern
//   echo hang / unhang                 Server antwortet nicht mehr (Blackhole) / wieder normal
//   echo drop                          alle Verbindungen sofort trennen
//   echo dropafter 5000000             Verbindungen nach ca. N übertragenen Bytes (Lesen/Schreiben) trennen, 0 = aus
//   echo hangafter 5000000             nach ca. N übertragenen Bytes nicht mehr antworten (Blackhole mitten im Transfer)
//   echo stats                         Zähler (Verbindungen, Bytes, offene Handles)
import { createServer as netServer } from 'node:net'
import { createRequire } from 'node:module'
import { promises as fs, constants as fsc } from 'node:fs'
import { resolve, join, dirname, sep, basename } from 'node:path'
import { createHash, timingSafeEqual } from 'node:crypto'

const require = createRequire(import.meta.url)
let ssh2
try {
  ssh2 = require('ssh2')
} catch {
  ssh2 = require(join(process.cwd(), 'node_modules', 'ssh2'))
}
const { Server, utils } = ssh2
const { STATUS_CODE, OPEN_MODE } = utils.sftp

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n)
  return i > 0 ? process.argv[i + 1] : d
}
const ROOT = resolve(arg('root', './sftp-root'))
const HOST = arg('host', '0.0.0.0')
const PORT = Number(arg('port', '2205'))
const USER = arg('user', 'box')
const PASS = arg('password', 'box')
const PUBKEY = arg('pubkey', '')
const CONTROL = Number(arg('control', '0'))
const HOSTKEY_DATEI = arg('hostkey', '')
let delay = Number(arg('delay', '0'))
let hang = false
let dropAfter = 0
let hangAfter = 0

const gleich = (a, b) => {
  const x = Buffer.from(String(a)),
    y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}
const neuerHostKey = () => utils.generateKeyPairSync('ed25519').private
let hostKey = neuerHostKey()
if (HOSTKEY_DATEI) {
  // Host-Schlüssel über Neustarts behalten (sonst gäbe jeder Start eine „Host-Schlüssel geändert“-Warnung)
  try {
    hostKey = await fs.readFile(HOSTKEY_DATEI, 'utf8')
  } catch {
    await fs.writeFile(HOSTKEY_DATEI, hostKey, { mode: 0o600 })
  }
}
const fingerabdruck = (privat) => {
  const k = utils.parseKey(privat)
  return 'SHA256:' + createHash('sha256').update(k.getPublicSSH()).digest('base64').replace(/=+$/, '')
}
const erlaubteSchluessel = []
if (PUBKEY) {
  for (const z of (await fs.readFile(PUBKEY, 'utf8')).split('\n').filter(Boolean)) {
    const k = utils.parseKey(z)
    if (!(k instanceof Error)) erlaubteSchluessel.push(k)
  }
}

await fs.mkdir(ROOT, { recursive: true })
const zaehler = { verbindungen: 0, offen: 0, bytes: 0, handles: 0 }
const verbindungen = new Set()

// Pfad im Wurzelverzeichnis (nie daraus ausbrechen)
const echt = (p) => {
  const r = resolve(ROOT, '.' + resolve('/', String(p || '/')))
  if (r !== ROOT && !r.startsWith(ROOT + sep)) throw Object.assign(new Error('weg'), { code: 'EACCES' })
  return r
}
const code = (e) =>
  e?.code === 'ENOENT'
    ? STATUS_CODE.NO_SUCH_FILE
    : e?.code === 'EACCES' || e?.code === 'EPERM'
      ? STATUS_CODE.PERMISSION_DENIED
      : STATUS_CODE.FAILURE
const attrs = (s) => ({
  mode: s.mode,
  uid: s.uid,
  gid: s.gid,
  size: s.size,
  atime: Math.floor(s.atimeMs / 1000),
  mtime: Math.floor(s.mtimeMs / 1000)
})
const flags = (f) => {
  let m = 0
  if (f & OPEN_MODE.READ && f & OPEN_MODE.WRITE) m = fsc.O_RDWR
  else if (f & OPEN_MODE.WRITE) m = fsc.O_WRONLY
  else m = fsc.O_RDONLY
  if (f & OPEN_MODE.CREAT) m |= fsc.O_CREAT
  if (f & OPEN_MODE.TRUNC) m |= fsc.O_TRUNC
  if (f & OPEN_MODE.EXCL) m |= fsc.O_EXCL
  if (f & OPEN_MODE.APPEND) m |= fsc.O_APPEND
  return m
}
const warte = () => (delay ? new Promise((r) => setTimeout(r, delay)) : Promise.resolve())

function sftp(stream, conn) {
  const handles = new Map()
  let nr = 0
  const neu = (h) => {
    const id = Buffer.alloc(4)
    id.writeUInt32BE(++nr)
    handles.set(id.readUInt32BE(0), h)
    zaehler.handles++
    return id
  }
  const hol = (b) => handles.get(Buffer.from(b).readUInt32BE(0))
  const los = (b) => {
    handles.delete(Buffer.from(b).readUInt32BE(0))
    zaehler.handles--
  }
  const mit = (id, fn) => async (...a) => {
    if (hang) return
    await warte()
    try {
      await fn(...a)
    } catch (e) {
      stream.status(id, code(e))
    }
  }
  const bytesZaehlen = (n) => {
    zaehler.bytes += n
    if (hangAfter && zaehler.bytes >= hangAfter) {
      hangAfter = 0
      hang = true
      console.log('[test-sftp] hangafter erreicht: antworte nicht mehr')
    }
    if (dropAfter && zaehler.bytes >= dropAfter) {
      dropAfter = 0
      console.log('[test-sftp] dropafter erreicht: trenne Verbindungen')
      for (const c of verbindungen) c.end ? c.end() : c.destroy()
      for (const s of sockets) s.destroy()
    }
  }
  stream.on('REALPATH', (id, p) => mit(id, async () => {
    const r = resolve('/', String(p || '/'))
    stream.name(id, [{ filename: r, longname: r, attrs: {} }])
  })())
  stream.on('STAT', (id, p) => mit(id, async () => stream.attrs(id, attrs(await fs.stat(echt(p)))))())
  stream.on('LSTAT', (id, p) => mit(id, async () => stream.attrs(id, attrs(await fs.lstat(echt(p)))))())
  stream.on('FSTAT', (id, h) => mit(id, async () => stream.attrs(id, attrs(await hol(h).fh.stat())))())
  stream.on('SETSTAT', (id) => stream.status(id, STATUS_CODE.OK))
  stream.on('MKDIR', (id, p) => mit(id, async () => {
    await fs.mkdir(echt(p))
    stream.status(id, STATUS_CODE.OK)
  })())
  stream.on('REMOVE', (id, p) => mit(id, async () => {
    await fs.unlink(echt(p))
    stream.status(id, STATUS_CODE.OK)
  })())
  stream.on('RMDIR', (id, p) => mit(id, async () => {
    await fs.rmdir(echt(p))
    stream.status(id, STATUS_CODE.OK)
  })())
  stream.on('RENAME', (id, a, b) => mit(id, async () => {
    await fs.rename(echt(a), echt(b))
    stream.status(id, STATUS_CODE.OK)
  })())
  stream.on('OPEN', (id, p, f) => mit(id, async () => {
    const fh = await fs.open(echt(p), flags(f), 0o644)
    stream.handle(id, neu({ fh }))
  })())
  stream.on('READ', (id, h, off, len) => mit(id, async () => {
    const b = Buffer.alloc(len)
    const { bytesRead } = await hol(h).fh.read(b, 0, len, off)
    if (!bytesRead) return stream.status(id, STATUS_CODE.EOF)
    bytesZaehlen(bytesRead)
    stream.data(id, b.subarray(0, bytesRead))
  })())
  stream.on('WRITE', (id, h, off, data) => mit(id, async () => {
    await hol(h).fh.write(data, 0, data.length, off)
    bytesZaehlen(data.length)
    stream.status(id, STATUS_CODE.OK)
  })())
  stream.on('CLOSE', (id, h) => mit(id, async () => {
    const e = hol(h)
    if (e?.fh) await e.fh.close()
    los(h)
    stream.status(id, STATUS_CODE.OK)
  })())
  stream.on('OPENDIR', (id, p) => mit(id, async () => {
    const liste = await fs.readdir(echt(p), { withFileTypes: true })
    stream.handle(id, neu({ liste, fertig: false }))
  })())
  stream.on('READDIR', (id, h) => mit(id, async () => {
    const e = hol(h)
    if (e.fertig) return stream.status(id, STATUS_CODE.EOF)
    e.fertig = true
    stream.name(id, e.liste.map((d) => ({ filename: d.name, longname: d.name, attrs: {} })))
  })())
  stream.on('close', () => {
    for (const e of handles.values()) e.fh?.close().catch(() => {})
    zaehler.handles -= handles.size
  })
}

const sockets = new Set()
function neuerServer() {
  return new Server({ hostKeys: [hostKey] }, (client) => {
    zaehler.verbindungen++
    zaehler.offen++
    verbindungen.add(client)
    client.on('close', () => {
      zaehler.offen--
      verbindungen.delete(client)
    })
    client.on('error', () => {})
    client
      .on('authentication', (ctx) => {
        if (ctx.username !== USER) return ctx.reject()
        if (ctx.method === 'password' && gleich(ctx.password, PASS)) return ctx.accept()
        if (ctx.method === 'publickey' && erlaubteSchluessel.length) {
          const ok = erlaubteSchluessel.some(
            (k) => ctx.key.algo === k.type && gleich(ctx.key.data.toString('base64'), k.getPublicSSH().toString('base64'))
          )
          if (ok && (!ctx.signature || erlaubteSchluessel.some((k) => k.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true)))
            return ctx.accept()
        }
        ctx.reject(['password', ...(erlaubteSchluessel.length ? ['publickey'] : [])])
      })
      .on('ready', () => {
        client.on('session', (accept) => {
          const session = accept()
          session.on('sftp', (acceptSftp) => sftp(acceptSftp(), client))
        })
      })
  })
}

// Jeder Host-Schlüssel-Wechsel braucht einen neuen Server (die Schlüssel stehen in den Optionen); wir nutzen einen
// Weiterleiter, der neue Verbindungen an den jeweils aktuellen ssh2-Server übergibt.
let aktuell = neuerServer()
const frontend = netServer((sock) => {
  sockets.add(sock)
  sock.on('close', () => sockets.delete(sock))
  sock.on('error', () => {})
  if (hang) {
    sock.pause() // Blackhole: Verbindung steht, es kommt nichts zurück
    return
  }
  aktuell.injectSocket(sock)
})
frontend.listen(PORT, HOST, () => {
  console.log(`[test-sftp] ${HOST}:${PORT}  Wurzel ${ROOT}  Benutzer ${USER}`)
  console.log(`[test-sftp] Host-Schlüssel ${fingerabdruck(hostKey)}`)
})

if (CONTROL) {
  netServer((c) => {
    let puffer = ''
    c.on('data', (d) => {
      puffer += d
      let i
      while ((i = puffer.indexOf('\n')) >= 0) {
        const [befehl, wert] = puffer.slice(0, i).trim().split(/\s+/)
        puffer = puffer.slice(i + 1)
        if (befehl === 'rotate') {
          hostKey = neuerHostKey()
          aktuell = neuerServer()
          c.write(`neuer Host-Schluessel ${fingerabdruck(hostKey)}\n`)
        } else if (befehl === 'delay') {
          delay = Number(wert) || 0
          c.write(`delay ${delay}\n`)
        } else if (befehl === 'hang') {
          hang = true
          c.write('hang\n')
        } else if (befehl === 'unhang') {
          hang = false
          for (const s of sockets) s.resume()
          c.write('unhang\n')
        } else if (befehl === 'drop') {
          for (const s of sockets) s.destroy()
          c.write('drop\n')
        } else if (befehl === 'dropafter') {
          zaehler.bytes = 0
          dropAfter = Number(wert) || 0
          c.write(`dropafter ${dropAfter}\n`)
        } else if (befehl === 'hangafter') {
          zaehler.bytes = 0
          hangAfter = Number(wert) || 0
          c.write(`hangafter ${hangAfter}\n`)
        } else if (befehl === 'stats') {
          c.write(JSON.stringify({ ...zaehler, delay, hang, dropAfter, hostKey: fingerabdruck(hostKey) }) + '\n')
        } else c.write('unbekannt\n')
      }
    })
    c.on('error', () => {})
  }).listen(CONTROL, '127.0.0.1', () => console.log(`[test-sftp] Steueranschluss 127.0.0.1:${CONTROL}`))
}

process.on('uncaughtException', (e) => console.error('[test-sftp] Fehler:', e?.message))
process.on('SIGTERM', () => process.exit(0))
void dirname
void basename
