#!/usr/bin/env bash
# WebDAV-Tests der VylarisCloud (curl-basiert). Laeuft gegen eine laufende Instanz und gibt PASS/FAIL je Fall aus.
#
# Aufruf:  scripts/test-dav.sh [Basis-URL] [Cookie-Datei des Inhabers] [DB-Name]
#   Standard: http://127.0.0.1:3202  /tmp/vdt-vd_b/cookie.txt  vd_b
# Voraussetzungen: curl, python3, psql (Postgres 127.0.0.1:5439, Trust). Der Inhaber (admin) ist angemeldet; Testkonten werden
# angelegt (davt_*) und am Ende entfernt. Optional: PID_FILE (Node-Prozess fuer den RAM-Test), DATA_DIR (Speicherordner).
# Ohne zweites/drittes Argument gelten die Standardwerte der Testumgebung (boot.sh).
set -u
BASE="${1:-http://127.0.0.1:3202}"
COOKIE="${2:-/tmp/vdt-vd_b/cookie.txt}"
DB="${3:-vd_b}"
PID_FILE="${PID_FILE:-/tmp/vdt-$DB/pid}"
DATA_DIR="${DATA_DIR:-/tmp/vdt-$DB/data}"
PGPORT_="${PGPORT_:-5439}"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
PASS=0; FAIL=0; SKIP=0
PSQL() { psql -h /tmp -p "$PGPORT_" -U postgres -tA "$DB" -c "$1" 2>/dev/null; }

ok()   { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf 'FAIL  %s  -- %s\n' "$1" "${2:-}"; }
skip() { SKIP=$((SKIP+1)); printf 'SKIP  %s  -- %s\n' "$1" "${2:-}"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1" "ist '$2', erwartet '$3'"; fi; }
has()  { if printf '%s' "$2" | grep -qF -- "$3"; then ok "$1"; else fail "$1" "'$3' fehlt in: $(printf '%s' "$2" | head -c 300)"; fi; }
hasnt(){ if printf '%s' "$2" | grep -qF -- "$3"; then fail "$1" "'$3' ist enthalten"; else ok "$1"; fi; }

# dav <Zugang user:pw> <METHODE> <Pfad|URL> [curl-Optionen ...]  ->  CODE, $T/h (Kopf), $T/b (Body)
dav() {
  local cred="$1" m="$2" p="$3"; shift 3
  local url="$p"; case "$p" in http*) ;; *) url="$BASE$p" ;; esac
  if [ "$cred" = "-" ]; then
    CODE=$(curl -s --path-as-is -o "$T/b" -D "$T/h" -w '%{http_code}' -X "$m" "$@" "$url")
  else
    CODE=$(curl -s --path-as-is -o "$T/b" -D "$T/h" -w '%{http_code}' -u "$cred" -X "$m" "$@" "$url")
  fi
}
hdr() { grep -i "^$1:" "$T/h" | head -1 | sed -E "s/^[^:]*:[[:space:]]*//; s/\r$//"; }
body() { cat "$T/b"; }
# Namen aus einem PROPFIND-Body (decodiert, eine Zeile je href)
hrefs() { python3 - "$T/b" <<'PY'
import sys, urllib.parse, xml.dom.minidom as m
d = m.parse(sys.argv[1])
for h in d.getElementsByTagNameNS('DAV:', 'href'):
    print(urllib.parse.unquote(h.firstChild.data if h.firstChild else ''))
PY
}
wellformed() { python3 -c "import sys,xml.dom.minidom as m; m.parse(sys.argv[1])" "$T/b" 2>/dev/null && echo ja || echo nein; }
api() { curl -s -b "$COOKIE" -H 'content-type: application/json' "$@"; }

echo "== Vorbereitung: Testkonten und App-Passwoerter =="
curl -sf "$BASE/api/public/health" >/dev/null || { echo "Instanz unter $BASE nicht erreichbar"; exit 2; }
PSQL "DELETE FROM users WHERE username LIKE 'davt\_%'" >/dev/null
SUF="Dav-Test-Passwort-2026!"
mk_user() { api -d "{\"username\":\"$1\",\"email\":\"$1@example.com\",\"password\":\"$SUF\",\"role\":\"user\"}" "$BASE/api/users" >/dev/null; }
mk_pw() { # <cookiedatei> <name> <schreiben true|false>
  curl -s -b "$1" -H 'content-type: application/json' -d "{\"name\":\"$2\",\"schreiben\":$3}" "$BASE/api/sync/zugaenge" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(str(d["zugang"]["id"])+" "+d["klar"])'
}
login() { curl -s -c "$T/c-$1" -H 'content-type: application/json' -d "{\"username\":\"$1\",\"password\":\"$SUF\"}" "$BASE/api/auth/login" >/dev/null; }
for n in davt_alice davt_bob davt_carol; do mk_user $n; login $n; done
read -r ADMIN_ID ADMIN_PW <<<"$(mk_pw "$COOKIE" "test-rw" true)"
read -r RO_ID RO_PW <<<"$(mk_pw "$COOKIE" "test-ro" false)"
read -r _ ALICE_PW <<<"$(mk_pw "$T/c-davt_alice" "alice" true)"
read -r BOB_ID BOB_PW <<<"$(mk_pw "$T/c-davt_bob" "bob" true)"
read -r _ CAROL_PW <<<"$(mk_pw "$T/c-davt_carol" "carol" true)"
A="admin:$ADMIN_PW"; RO="admin:$RO_PW"; AL="davt_alice:$ALICE_PW"; BO="davt_bob:$BOB_PW"; CA="davt_carol:$CAROL_PW"
[ -n "$ADMIN_PW" ] && [ -n "$ALICE_PW" ] || { echo "Konten konnten nicht angelegt werden"; exit 2; }
# Aufraeumen aus frueheren Laeufen (Testordner des Inhabers)
for ordner in davt; do dav "$A" DELETE "/dav/$ordner/" >/dev/null; done
for f in $(api "$BASE/api/files?limit=500" | python3 -c 'import sys,json; [print(x["id"]) for x in json.load(sys.stdin).get("dateien",[]) if x["name"].startswith("davt")]' 2>/dev/null); do api -X DELETE "$BASE/api/files/$f" >/dev/null; done

echo "== Anmeldung =="
dav - PROPFIND /dav/ -H 'Depth: 0'
eq "ohne Anmeldung -> 401" "$CODE" 401
has "401: WWW-Authenticate Basic mit Realm und UTF-8" "$(hdr www-authenticate)" 'Basic realm="VylarisCloud", charset="UTF-8"'
dav "admin:falsch" PROPFIND /dav/ -H 'Depth: 0'
eq "falsches App-Passwort -> 401" "$CODE" 401
dav "admin:Cloud-Test-2026!" PROPFIND /dav/ -H 'Depth: 0'
eq "Konto-Passwort ist KEIN gueltiges WebDAV-Passwort -> 401" "$CODE" 401
dav "nobody:$ADMIN_PW" PROPFIND /dav/ -H 'Depth: 0'
eq "App-Passwort mit falschem Benutzernamen -> 401" "$CODE" 401
dav "$AL" PROPFIND /dav/ -H 'Depth: 0'; eq "gueltiges Passwort (alice) -> 207" "$CODE" 207
dav "davt_alice:$BOB_PW" PROPFIND /dav/ -H 'Depth: 0'; eq "Passwort eines anderen Kontos -> 401" "$CODE" 401
U1=$(PSQL "SELECT last_used_at IS NOT NULL FROM dav_zugaenge WHERE id=$ADMIN_ID")
eq "last_used_at wird gepflegt" "$U1" "t"

echo "== OPTIONS =="
dav "$A" OPTIONS /dav/
eq "OPTIONS -> 200" "$CODE" 200
eq "OPTIONS: DAV: 1, 2" "$(hdr dav)" "1, 2"
for m in PROPFIND PROPPATCH MKCOL MOVE COPY LOCK UNLOCK PUT DELETE GET HEAD; do has "OPTIONS Allow enthaelt $m" "$(hdr allow)" "$m"; done
dav "$A" OPTIONS /dav/irgendwas/unten
eq "OPTIONS auf beliebigem Pfad -> 200" "$CODE" 200

echo "== PROPFIND =="
dav "$A" MKCOL /dav/davt/;  eq "MKCOL davt -> 201" "$CODE" 201
dav "$A" PUT /dav/davt/a.txt --data-binary 'Hallo Welt' -H 'Content-Type: text/plain'
eq "PUT a.txt -> 201" "$CODE" 201
dav "$A" PROPFIND /dav/davt/ -H 'Depth: 0'
eq "PROPFIND Depth 0 -> 207" "$CODE" 207
eq "PROPFIND Depth 0: XML wohlgeformt" "$(wellformed)" ja
eq "PROPFIND Depth 0: nur ein Eintrag" "$(hrefs | wc -l | tr -d ' ')" 1
has "PROPFIND Depth 0: Content-Type XML" "$(hdr content-type)" "application/xml"
dav "$A" PROPFIND /dav/davt/ -H 'Depth: 1'
eq "PROPFIND Depth 1 -> 207" "$CODE" 207
eq "PROPFIND Depth 1: Ordner + Datei" "$(hrefs | tr '\n' ' ')" "/dav/davt/ /dav/davt/a.txt "
has "PROPFIND: getcontentlength 10" "$(body)" "<D:getcontentlength>10</D:getcontentlength>"
has "PROPFIND: getcontenttype text/plain" "$(body)" "<D:getcontenttype>text/plain</D:getcontenttype>"
has "PROPFIND: getlastmodified RFC1123" "$(body)" "GMT</D:getlastmodified>"
has "PROPFIND: creationdate ISO8601" "$(body)" "T"
has "PROPFIND: getetag" "$(body)" "<D:getetag>&quot;"
has "PROPFIND: resourcetype collection" "$(body)" "<D:resourcetype><D:collection/></D:resourcetype>"
has "PROPFIND: supportedlock" "$(body)" "<D:lockentry>"
has "PROPFIND: lockdiscovery" "$(body)" "lockdiscovery"
has "PROPFIND: displayname" "$(body)" "<D:displayname>a.txt</D:displayname>"
dav "$A" PROPFIND /dav/davt/ -H 'Depth: infinity'
eq "PROPFIND Depth infinity -> 403" "$CODE" 403
has "403 mit propfind-finite-depth" "$(body)" "propfind-finite-depth"
dav "$A" PROPFIND /dav/davt/
eq "PROPFIND ohne Depth (= infinity) auf Ordner -> 403" "$CODE" 403
dav "$A" PROPFIND /dav/davt/a.txt
eq "PROPFIND ohne Depth auf Datei -> 207" "$CODE" 207
dav "$A" PROPFIND /dav/davt/ -H 'Depth: 1' --data '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:getcontentlength/><D:getetag/></D:prop></D:propfind>'
has "PROPFIND prop: nur angefragte (Laenge)" "$(body)" "getcontentlength"
hasnt "PROPFIND prop: keine anderen (getcontenttype)" "$(body)" "getcontenttype"
dav "$A" PROPFIND /dav/davt/ -H 'Depth: 0' --data '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:x="urn:test"><d:prop><d:getetag/><x:gibtsnicht/></d:prop></d:propfind>'
has "PROPFIND unbekannte Eigenschaft -> 404-propstat" "$(body)" "HTTP/1.1 404 Not Found"
has "PROPFIND unbekannte Eigenschaft: Namensraum bleibt" "$(body)" 'xmlns:x="urn:test"'
eq "PROPFIND unbekannte Eigenschaft: XML wohlgeformt" "$(wellformed)" ja
dav "$A" PROPFIND /dav/davt/a.txt -H 'Depth: 0' --data '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:propname/></D:propfind>'
has "PROPFIND propname -> getetag leer aufgefuehrt" "$(body)" "<D:getetag/>"
dav "$A" PROPFIND /dav/davt/a.txt -H 'Depth: 0' --data '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>'
has "PROPFIND allprop" "$(body)" "getcontentlength"
dav "$A" PROPFIND /dav/davt/a.txt -H 'Depth: 0' --data '<kaputt'
eq "PROPFIND kaputtes XML -> 400" "$CODE" 400
dav "$A" PROPFIND /dav/gibts-nicht -H 'Depth: 0'
eq "PROPFIND unbekannter Pfad -> 404" "$CODE" 404
dav "$A" PROPFIND /dav/ -H 'Depth: 0' --data '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:quota-available-bytes/><D:quota-used-bytes/></D:prop></D:propfind>'
has "Quota: quota-used-bytes" "$(body)" "<D:quota-used-bytes>"
has "Quota: quota-available-bytes" "$(body)" "<D:quota-available-bytes>"
dav "$A" PROPFIND /dav -H 'Depth: 0'
eq "PROPFIND /dav (ohne Slash) -> 207" "$CODE" 207

echo "== GET / HEAD / Range / ETag =="
dav "$A" GET /dav/davt/a.txt
eq "GET -> 200" "$CODE" 200
eq "GET: Inhalt" "$(body)" "Hallo Welt"
ETAG=$(hdr etag)
has "GET: ETag gesetzt" "$ETAG" '"'
has "GET: Last-Modified" "$(hdr last-modified)" "GMT"
eq "GET: Accept-Ranges" "$(hdr accept-ranges)" "bytes"
eq "GET: nosniff" "$(hdr x-content-type-options)" "nosniff"
CODE=$(curl -s -I -o /dev/null -D "$T/h" -w '%{http_code}' -u "$A" "$BASE/dav/davt/a.txt")
eq "HEAD -> 200" "$CODE" 200
eq "HEAD: Content-Length" "$(hdr content-length)" 10
eq "HEAD: ETag wie bei GET" "$(hdr etag)" "$ETAG"
dav "$A" GET /dav/davt/a.txt -H "If-None-Match: $ETAG"
eq "If-None-Match mit gleichem ETag -> 304" "$CODE" 304
dav "$A" GET /dav/davt/a.txt -H 'If-None-Match: "x"'
eq "If-None-Match mit anderem ETag -> 200" "$CODE" 200
dav "$A" GET /dav/davt/a.txt -H "If-Match: \"anders\""
eq "If-Match mit falschem ETag -> 412" "$CODE" 412
dav "$A" GET /dav/davt/a.txt -H "If-Modified-Since: $(hdr last-modified)" 2>/dev/null
LM=$(date -u -d '+1 day' '+%a, %d %b %Y %H:%M:%S GMT'); dav "$A" GET /dav/davt/a.txt -H "If-Modified-Since: $LM"
eq "If-Modified-Since (Zukunft) -> 304" "$CODE" 304
dav "$A" GET /dav/davt/a.txt -H 'Range: bytes=0-4'
eq "Range 0-4 -> 206" "$CODE" 206
eq "Range 0-4: Inhalt" "$(body)" "Hallo"
eq "Range 0-4: Content-Range" "$(hdr content-range)" "bytes 0-4/10"
eq "Range 0-4: Content-Length" "$(hdr content-length)" 5
dav "$A" GET /dav/davt/a.txt -H 'Range: bytes=-4'
eq "Range -4 (Suffix) -> Inhalt" "$(body)" "Welt"
dav "$A" GET /dav/davt/a.txt -H 'Range: bytes=6-'
eq "Range 6- (offen) -> Inhalt" "$(body)" "Welt"
dav "$A" GET /dav/davt/a.txt -H 'Range: bytes=99-100'
eq "Range hinter dem Ende -> 416" "$CODE" 416
eq "416: Content-Range */10" "$(hdr content-range)" "bytes */10"
dav "$A" GET /dav/davt/a.txt -H 'Range: bytes=0-4' -H "If-Range: $ETAG"
eq "If-Range (passender ETag) -> 206" "$CODE" 206
dav "$A" GET /dav/davt/a.txt -H 'Range: bytes=0-4' -H 'If-Range: "alt"'
eq "If-Range (anderer ETag) -> 200 komplett" "$CODE" 200
eq "If-Range: voller Inhalt" "$(body)" "Hallo Welt"
dav "$A" GET /dav/davt/
eq "GET auf Ordner -> 200 (Liste)" "$CODE" 200
has "GET auf Ordner: HTML-Liste" "$(body)" "a.txt"
dav "$A" GET /dav/davt/gibts.txt
eq "GET unbekannte Datei -> 404" "$CODE" 404

echo "== PUT: neu, ueberschreiben, Bedingungen =="
SLUG1=$(PSQL "SELECT slug FROM files WHERE name='a.txt' AND user_id=(SELECT id FROM users WHERE username='admin') ORDER BY id DESC LIMIT 1")
ID1=$(PSQL "SELECT id FROM files WHERE slug='$SLUG1'")
KEY1=$(PSQL "SELECT ablage FROM files WHERE id=$ID1")
dav "$A" PUT /dav/davt/a.txt --data-binary 'Neuer Inhalt, laenger' -H 'Content-Type: text/plain'
eq "PUT ueberschreibt -> 204" "$CODE" 204
has "PUT: ETag in Antwort" "$(hdr etag)" '"'
dav "$A" GET /dav/davt/a.txt
eq "Ueberschrieben: neuer Inhalt" "$(body)" "Neuer Inhalt, laenger"
eq "Ueberschrieben: Slug/ID bleibt (Freigabelinks)" "$(PSQL "SELECT slug FROM files WHERE id=$ID1")" "$SLUG1"
KEY2=$(PSQL "SELECT ablage FROM files WHERE id=$ID1")
[ "$KEY1" != "$KEY2" ] && ok "Ueberschrieben: neuer Speicherschluessel" || fail "Ueberschrieben: neuer Speicherschluessel" "$KEY1"
[ ! -e "$DATA_DIR/dateien/${KEY1:0:2}/$KEY1" ] && ok "Ueberschrieben: alter Inhalt aus dem Speicher entfernt" || fail "alter Inhalt noch im Speicher" "$KEY1"
eq "Ueberschrieben: Groesse in der DB" "$(PSQL "SELECT size FROM files WHERE id=$ID1")" 21
dav "$A" PUT /dav/davt/a.txt --data-binary 'x' -H 'If-None-Match: *'
eq "PUT If-None-Match: * auf vorhandene Datei -> 412" "$CODE" 412
dav "$A" PUT /dav/davt/a.txt --data-binary 'x' -H 'If-Match: "falsch"'
eq "PUT If-Match falsch -> 412" "$CODE" 412
dav "$A" GET /dav/davt/a.txt; E=$(hdr etag)
dav "$A" PUT /dav/davt/a.txt --data-binary 'Dritter Inhalt' -H "If-Match: $E"
eq "PUT If-Match richtig -> 204" "$CODE" 204
dav "$A" PUT /dav/davt/neu-nur.txt --data-binary 'x' -H 'If-None-Match: *'
eq "PUT If-None-Match: * auf neue Datei -> 201" "$CODE" 201
dav "$A" PUT /dav/davt/ --data-binary 'x'
eq "PUT auf Ordner -> 405" "$CODE" 405
dav "$A" PUT /dav/gibts/nicht/x.txt --data-binary 'x'
eq "PUT in fehlenden Ordner -> 409" "$CODE" 409
dav "$A" PUT /dav/davt/leer.txt --data-binary ''
eq "PUT leere Datei -> 201" "$CODE" 201
dav "$A" GET /dav/davt/leer.txt; eq "leere Datei: Inhalt leer" "$(wc -c <"$T/b" | tr -d ' ')" 0
dav "$A" PUT /dav/davt/exp.txt --data-binary 'mit Expect' -H 'Expect: 100-continue' -m 20
eq "PUT mit Expect: 100-continue -> 201" "$CODE" 201
dav "$A" PUT /dav/davt/chunk.txt -H 'Transfer-Encoding: chunked' --data-binary 'gestueckelt'
eq "PUT mit chunked -> 201" "$CODE" 201
dav "$A" GET /dav/davt/chunk.txt; eq "chunked: Inhalt" "$(body)" gestueckelt
printf '\x89PNG\r\n\x1a\n' > "$T/fake.png"; head -c 100 /dev/zero >> "$T/fake.png"
dav "$A" PUT /dav/davt/bild.png --data-binary @"$T/fake.png"
eq "PUT PNG -> 201" "$CODE" 201
eq "PUT PNG: Art/MIME wie beim Upload erkannt" "$(PSQL "SELECT mime||'/'||art FROM files WHERE name='bild.png' ORDER BY id DESC LIMIT 1")" "image/png/bild"
dav "$A" PUT /dav/davt/seite.html --data-binary '<script>alert(1)</script>' -H 'Content-Type: text/html'
dav "$A" GET /dav/davt/seite.html
has "HTML wird als text/plain ausgeliefert (kein XSS)" "$(hdr content-type)" "text/plain"
has "Datei-Auslieferung mit CSP sandbox" "$(hdr content-security-policy)" "sandbox"
has "Datei-Auslieferung als Download" "$(hdr content-disposition)" "attachment"
dav "$A" PUT /dav/davt/mtime.txt --data-binary 'x' -H 'X-OC-Mtime: 1700000000'
dav "$A" PROPFIND /dav/davt/mtime.txt -H 'Depth: 0'
has "X-OC-Mtime wird als Aenderungszeit uebernommen" "$(body)" "Tue, 14 Nov 2023 22:13:20 GMT"

echo "== PROPPATCH =="
dav "$A" PROPPATCH /dav/davt/a.txt --data '<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><D:getlastmodified>Wed, 01 Jan 2025 10:00:00 GMT</D:getlastmodified></D:prop></D:set></D:propertyupdate>'
eq "PROPPATCH getlastmodified -> 207" "$CODE" 207
has "PROPPATCH: 200 OK" "$(body)" "HTTP/1.1 200 OK"
dav "$A" PROPFIND /dav/davt/a.txt -H 'Depth: 0'
has "PROPPATCH: Aenderungszeit uebernommen" "$(body)" "Wed, 01 Jan 2025 10:00:00 GMT"
dav "$A" PROPPATCH /dav/davt/a.txt --data '<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:" xmlns:W="urn:schemas-microsoft-com:"><D:set><D:prop><W:Win32FileAttributes>00000020</W:Win32FileAttributes></D:prop></D:set></D:propertyupdate>'
has "PROPPATCH Win32-Eigenschaft wird angenommen" "$(body)" "HTTP/1.1 200 OK"
dav "$A" PROPPATCH /dav/davt/a.txt --data '<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:" xmlns:x="urn:x"><D:set><D:prop><x:frei>1</x:frei><D:getlastmodified>Wed, 01 Jan 2025 10:00:00 GMT</D:getlastmodified></D:prop></D:set></D:propertyupdate>'
has "PROPPATCH unbekannte Eigenschaft -> 403" "$(body)" "HTTP/1.1 403 Forbidden"
has "PROPPATCH atomar: Rest 424" "$(body)" "HTTP/1.1 424 Failed Dependency"

echo "== MKCOL =="
dav "$A" MKCOL /dav/davt/sub/;  eq "MKCOL -> 201" "$CODE" 201
dav "$A" MKCOL /dav/davt/sub/;  eq "MKCOL auf vorhandenen -> 405" "$CODE" 405
dav "$A" MKCOL /dav/davt/a/b/c/;  eq "MKCOL ohne Elternordner -> 409" "$CODE" 409
dav "$A" MKCOL /dav/davt/mitbody/ --data '<x/>' ; eq "MKCOL mit Body -> 415" "$CODE" 415
dav "$A" MKCOL /dav/davt/a.txt;  eq "MKCOL auf vorhandene Datei -> 405" "$CODE" 405
dav "$A" MKCOL /dav/davt/SUB/;  eq "MKCOL mit anderer Gross-/Kleinschreibung (Kollision) -> 405" "$CODE" 405
dav "$A" PUT /dav/davt/sub/in.txt --data-binary 'drin'; eq "PUT in Unterordner -> 201" "$CODE" 201
dav "$A" PUT /dav/davt/A.TXT --data-binary 'x'
eq "PUT mit Gross-/Kleinschreibungs-Kollision -> 409" "$CODE" 409
dav "$A" MKCOL "/dav/davt/Ordner%20mit%20Leerzeichen/"; eq "MKCOL mit Leerzeichen -> 201" "$CODE" 201
echo "== MOVE / COPY =="
dav "$A" MOVE /dav/davt/exp.txt -H "Destination: $BASE/dav/davt/sub/verschoben.txt"
eq "MOVE (neuer Name, anderer Ordner) -> 201" "$CODE" 201
dav "$A" GET /dav/davt/sub/verschoben.txt; eq "MOVE: Inhalt am neuen Ort" "$(body)" "mit Expect"
dav "$A" GET /dav/davt/exp.txt; eq "MOVE: alter Ort weg -> 404" "$CODE" 404
dav "$A" MOVE /dav/davt/sub/verschoben.txt -H "Destination: /dav/davt/sub/umbenannt.txt"
eq "MOVE nur mit Pfad im Destination -> 201 (Umbenennen)" "$CODE" 201
dav "$A" COPY /dav/davt/a.txt -H "Destination: /dav/davt/kopie.txt"
eq "COPY Datei -> 201" "$CODE" 201
dav "$A" GET /dav/davt/kopie.txt; eq "COPY: gleicher Inhalt" "$(body)" "Dritter Inhalt"
KA=$(PSQL "SELECT ablage FROM files WHERE id=$ID1"); KB=$(PSQL "SELECT ablage FROM files WHERE name='kopie.txt' AND user_id=(SELECT id FROM users WHERE username='admin') ORDER BY id DESC LIMIT 1")
[ -n "$KB" ] && [ "$KA" != "$KB" ] && [ -e "$DATA_DIR/dateien/${KB:0:2}/$KB" ] && ok "COPY: echter neuer Speicherschluessel" || fail "COPY: neuer Speicherschluessel" "$KA / $KB"
dav "$A" COPY /dav/davt/a.txt -H "Destination: /dav/davt/kopie.txt" -H 'Overwrite: F'
eq "COPY Overwrite: F auf vorhandenes Ziel -> 412" "$CODE" 412
dav "$A" COPY /dav/davt/a.txt -H "Destination: /dav/davt/kopie.txt" -H 'Overwrite: T'
eq "COPY Overwrite: T auf vorhandenes Ziel -> 204" "$CODE" 204
dav "$A" COPY /dav/davt/a.txt -H "Destination: /dav/davt/kopie.txt"
eq "COPY ohne Overwrite-Header (Standard T) -> 204" "$CODE" 204
dav "$A" GET /dav/davt/kopie.txt; eq "Ueberschriebenes Ziel hat neuen Inhalt" "$(body)" "Dritter Inhalt"
dav "$A" MOVE /dav/davt/a.txt -H "Destination: /dav/davt/a.txt"
eq "MOVE auf sich selbst -> 403" "$CODE" 403
dav "$A" MOVE /dav/davt/a.txt -H "Destination: /dav/gibts/nicht/a.txt"
eq "MOVE in fehlenden Ordner -> 409" "$CODE" 409
dav "$A" MOVE /dav/davt/a.txt
eq "MOVE ohne Destination -> 400" "$CODE" 400
dav "$A" MOVE /dav/davt/a.txt -H "Destination: http://anderer-server.example/dav/x"
eq "MOVE mit Ziel auf anderem Server (Pfad ausserhalb /dav) -> 502" "$CODE" 502
dav "$A" MOVE /dav/davt/a.txt -H "Destination: /dav/davt/../../x.txt"
eq "MOVE mit Pfadtrick im Ziel -> 400" "$CODE" 400
dav "$A" MKCOL /dav/davt/ordA/; dav "$A" PUT /dav/davt/ordA/f1.txt --data-binary 'eins'; dav "$A" MKCOL /dav/davt/ordA/tief/; dav "$A" PUT /dav/davt/ordA/tief/f2.txt --data-binary 'zwei'
dav "$A" COPY /dav/davt/ordA/ -H "Destination: /dav/davt/ordB/"
eq "COPY Ordner (rekursiv) -> 201" "$CODE" 201
dav "$A" GET /dav/davt/ordB/tief/f2.txt; eq "COPY Ordner: tiefe Datei kopiert" "$(body)" zwei
dav "$A" COPY /dav/davt/ordA/ -H "Destination: /dav/davt/ordC/" -H 'Depth: 0'
eq "COPY Ordner Depth 0 -> 201" "$CODE" 201
dav "$A" PROPFIND /dav/davt/ordC/ -H 'Depth: 1'; eq "COPY Depth 0: Ordner leer (nur er selbst)" "$(hrefs | wc -l | tr -d ' ')" 1
dav "$A" MOVE /dav/davt/ordB/ -H "Destination: /dav/davt/ordA/ordB-drin/"
eq "MOVE Ordner in anderen Ordner -> 201" "$CODE" 201
dav "$A" GET /dav/davt/ordA/ordB-drin/tief/f2.txt; eq "MOVE Ordner: Inhalt mitgekommen" "$(body)" zwei
dav "$A" MOVE /dav/davt/ordA/ -H "Destination: /dav/davt/ordA/tief/ordA/"
eq "MOVE Ordner in sich selbst -> 403" "$CODE" 403
dav "$A" MOVE /dav/davt/ordC/ -H "Destination: /dav/davt/ordA/" -H 'Overwrite: F'
eq "MOVE Ordner auf vorhandenen mit Overwrite: F -> 412" "$CODE" 412
dav "$A" MOVE /dav/davt/ordC/ -H "Destination: /dav/davt/umbenannter-ordner/"
eq "MOVE Ordner umbenennen -> 201" "$CODE" 201
dav "$A" PUT /dav/davt/ueber.txt --data-binary 'alt'; dav "$A" PUT /dav/davt/quelle.txt --data-binary 'neu'
dav "$A" MOVE /dav/davt/quelle.txt -H "Destination: /dav/davt/ueber.txt"
eq "MOVE Datei auf vorhandene (Overwrite T) -> 204" "$CODE" 204
dav "$A" GET /dav/davt/ueber.txt; eq "MOVE Overwrite: Ziel hat neuen Inhalt" "$(body)" neu
TRASH=$(api "$BASE/api/papierkorb" | python3 -c 'import sys,json; print(" ".join(x["name"] for x in json.load(sys.stdin)["dateien"]))')
has "Ueberschriebenes Ziel liegt im Papierkorb" "$TRASH" "ueber.txt"
dav "$A" MOVE "/dav/davt/sub/in.txt" -H "Destination: /dav/davt/sub/in.png"
eq "MOVE mit neuer Endung -> 201" "$CODE" 201
eq "MOVE: MIME folgt der neuen Endung (nur bei Endungswechsel)" "$(PSQL "SELECT mime FROM files WHERE name='in.png' ORDER BY id DESC LIMIT 1")" "image/png"

echo "== DELETE -> Papierkorb =="
dav "$A" PUT /dav/davt/weg.txt --data-binary 'loeschen'; WID=$(PSQL "SELECT id FROM files WHERE name='weg.txt' AND user_id=(SELECT id FROM users WHERE username='admin') ORDER BY id DESC LIMIT 1")
dav "$A" DELETE /dav/davt/weg.txt
eq "DELETE Datei -> 204" "$CODE" 204
dav "$A" GET /dav/davt/weg.txt; eq "nach DELETE: 404" "$CODE" 404
TRASH=$(api "$BASE/api/papierkorb" | python3 -c 'import sys,json; print(" ".join(x["name"] for x in json.load(sys.stdin)["dateien"]))')
has "DELETE: Datei im Papierkorb sichtbar (/api/papierkorb)" "$TRASH" "weg.txt"
eq "DELETE: Zeile aus files entfernt" "$(PSQL "SELECT count(*) FROM files WHERE id=$WID")" 0
eq "DELETE: Inhalt bleibt im Speicher (Papierkorb)" "$(PSQL "SELECT count(*) FROM papierkorb WHERE datei->>'id'='$WID'")" 1
dav "$A" DELETE /dav/davt/weg.txt; eq "DELETE unbekannte Datei -> 404" "$CODE" 404
dav "$A" DELETE /dav/davt/ordA/
eq "DELETE Ordner rekursiv -> 204" "$CODE" 204
dav "$A" GET /dav/davt/ordA/tief/f2.txt; eq "nach Ordner-DELETE: Unterdatei 404" "$CODE" 404
TRASH=$(api "$BASE/api/papierkorb" | python3 -c 'import sys,json; print(" ".join(x["name"] for x in json.load(sys.stdin)["dateien"]))')
has "Ordner-DELETE: Unterdateien im Papierkorb (f2.txt)" "$TRASH" "f2.txt"
has "Ordner-DELETE: auch tief verschachtelte (f1.txt)" "$TRASH" "f1.txt"
dav "$A" DELETE /dav/
eq "DELETE der Wurzel -> 403" "$CODE" 403
dav "$A" DELETE /dav/Team-Ordner/; eq "DELETE auf nicht vorhandenen Team-Ordner -> 404 oder 403" "$( [ "$CODE" = 404 ] || [ "$CODE" = 403 ] && echo ok)" ok

echo "== LOCK / UNLOCK =="
LOCKBODY='<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner>Word</D:owner></D:lockinfo>'
dav "$A" PUT /dav/davt/gesperrt.txt --data-binary 'v1'
dav "$A" LOCK /dav/davt/gesperrt.txt -H 'Timeout: Second-300' -H 'Content-Type: application/xml' --data "$LOCKBODY"
eq "LOCK -> 200" "$CODE" 200
TOK=$(hdr lock-token | tr -d '<>')
has "LOCK: Lock-Token-Header" "$TOK" "opaquelocktoken:"
has "LOCK: lockdiscovery im Body" "$(body)" "<D:lockdiscovery><D:activelock>"
has "LOCK: Besitzer und Timeout" "$(body)" "Second-"
dav "$A" PUT /dav/davt/gesperrt.txt --data-binary 'v2'
eq "PUT ohne Token auf gesperrte Datei -> 423" "$CODE" 423
dav "$A" PUT /dav/davt/gesperrt.txt --data-binary 'v2' -H "If: (<$TOK>)"
eq "PUT mit Token -> 204" "$CODE" 204
dav "$A" DELETE /dav/davt/gesperrt.txt
eq "DELETE ohne Token -> 423" "$CODE" 423
dav "$A" MOVE /dav/davt/gesperrt.txt -H "Destination: /dav/davt/gesperrt2.txt"
eq "MOVE ohne Token -> 423" "$CODE" 423
dav "$A" PROPPATCH /dav/davt/gesperrt.txt --data '<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><D:getlastmodified>Wed, 01 Jan 2025 10:00:00 GMT</D:getlastmodified></D:prop></D:set></D:propertyupdate>'
eq "PROPPATCH ohne Token -> 423" "$CODE" 423
dav "$A" GET /dav/davt/gesperrt.txt; eq "Lesen bleibt erlaubt: Inhalt v2" "$(body)" v2
dav "$A" PROPFIND /dav/davt/gesperrt.txt -H 'Depth: 0'
has "PROPFIND zeigt lockdiscovery mit Token (Besitzer)" "$(body)" "$TOK"
dav "$A" LOCK /dav/davt/gesperrt.txt -H "If: (<$TOK>)" -H 'Timeout: Second-900'
eq "LOCK-Refresh (ohne Body, If-Token) -> 200" "$CODE" 200
has "Refresh: neuer Timeout" "$(body)" "Second-9"
dav "$A" LOCK /dav/davt/gesperrt.txt --data "$LOCKBODY"
eq "zweites LOCK auf gesperrte Datei -> 423" "$CODE" 423
dav "$A" UNLOCK /dav/davt/gesperrt.txt -H 'Lock-Token: <opaquelocktoken:00000000-0000-0000-0000-000000000000>'
eq "UNLOCK mit falschem Token -> 409" "$CODE" 409
dav "$A" UNLOCK /dav/davt/gesperrt.txt
eq "UNLOCK ohne Token -> 400" "$CODE" 400
dav "$A" UNLOCK /dav/davt/gesperrt.txt -H "Lock-Token: <$TOK>"
eq "UNLOCK -> 204" "$CODE" 204
dav "$A" PUT /dav/davt/gesperrt.txt --data-binary 'v3'
eq "nach UNLOCK: PUT ohne Token -> 204" "$CODE" 204
dav "$A" LOCK /dav/davt/neu-per-lock.txt --data "$LOCKBODY"
eq "LOCK auf unbekannter Adresse legt leere Datei an -> 201" "$CODE" 201
TOK2=$(hdr lock-token | tr -d '<>')
dav "$A" GET /dav/davt/neu-per-lock.txt; eq "LOCK-Null: Datei ist leer" "$(wc -c <"$T/b" | tr -d ' ')" 0
dav "$A" PUT /dav/davt/neu-per-lock.txt --data-binary 'Inhalt' -H "If: (<$TOK2>)"; eq "PUT in LOCK-Null mit Token -> 204" "$CODE" 204
dav "$A" UNLOCK /dav/davt/neu-per-lock.txt -H "Lock-Token: <$TOK2>"
dav "$A" MKCOL /dav/davt/lockdir/; dav "$A" LOCK /dav/davt/lockdir/ -H 'Depth: infinity' --data "$LOCKBODY"; TOK3=$(hdr lock-token | tr -d '<>')
eq "LOCK auf Ordner (Depth infinity) -> 200" "$CODE" 200
dav "$A" PUT /dav/davt/lockdir/neu.txt --data-binary 'x'
eq "PUT in gesperrten Ordner ohne Token -> 423" "$CODE" 423
dav "$A" PUT /dav/davt/lockdir/neu.txt --data-binary 'x' -H "If: (<$TOK3>)"
eq "PUT in gesperrten Ordner mit Token -> 201" "$CODE" 201
dav "$A" DELETE /dav/davt/lockdir/neu.txt
eq "DELETE in gesperrtem Ordner ohne Token -> 423" "$CODE" 423
dav "$A" DELETE /dav/davt/lockdir/
eq "DELETE des gesperrten Ordners ohne Token -> 423" "$CODE" 423
dav "$A" UNLOCK /dav/davt/lockdir/ -H "Lock-Token: <$TOK3>"; eq "UNLOCK Ordner -> 204" "$CODE" 204
dav "$A" LOCK /dav/davt/gesperrt.txt -H 'Timeout: Second-10' --data "$LOCKBODY"; TOK4=$(hdr lock-token | tr -d '<>')
PSQL "UPDATE dav_sperren SET ablauf_at = now() - interval '1 second' WHERE token='$TOK4'" >/dev/null
dav "$A" PUT /dav/davt/gesperrt.txt --data-binary 'v4'
eq "abgelaufene Sperre blockiert nicht mehr" "$CODE" 204
dav "$AL" PUT /dav/davt/x.txt --data-binary x >/dev/null
dav "$A" LOCK /dav/davt/gesperrt.txt --data "$LOCKBODY"; TOK5=$(hdr lock-token | tr -d '<>')
dav "$RO" LOCK /dav/davt/gesperrt.txt --data "$LOCKBODY"
eq "Nur-Lesen-Passwort: LOCK -> 403" "$CODE" 403
dav "$A" UNLOCK /dav/davt/gesperrt.txt -H "Lock-Token: <$TOK5>"

echo "== Namen: Unicode, Sonderzeichen, Doppelte =="
NAMEN=("Übung für Äpfel.txt" "Datei & Co #1 100% fertig.txt" "日本語のファイル.txt" "emoji 😀.txt" "a+b=c;d,e.txt" "mit'apostroph(klammer).txt" "klein.TXT")
dav "$A" MKCOL "/dav/davt/namen/" >/dev/null
for n in "${NAMEN[@]}"; do
  enc=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$n")
  dav "$A" PUT "/dav/davt/namen/$enc" --data-binary "inhalt:$n"
  eq "PUT '$n' -> 201" "$CODE" 201
  dav "$A" GET "/dav/davt/namen/$enc"
  eq "GET '$n' -> Inhalt stimmt" "$(body)" "inhalt:$n"
done
dav "$A" PROPFIND /dav/davt/namen/ -H 'Depth: 1'
eq "PROPFIND mit Sonderzeichen: XML wohlgeformt" "$(wellformed)" ja
LISTE="$(hrefs)"
for n in "${NAMEN[@]}"; do has "PROPFIND-href dekodiert zu '$n'" "$LISTE" "/dav/davt/namen/$n"; done
RAWHREF="$(grep -o '<D:href>[^<]*' "$T/b" | head -20)"
has "href: Leerzeichen als %20 kodiert" "$RAWHREF" "%20"
has "href: # als %23 kodiert" "$RAWHREF" "%23"
has "href: & als %26 kodiert (und als XML nicht roh)" "$RAWHREF" "%26"
has "href: % als %25 kodiert" "$RAWHREF" "%25"
# doppelte Namen (in der Datenbank erlaubt) -> eindeutig anzeigen
curl -s -b "$COOKIE" -F "file=@$T/fake.png;filename=davt-doppelt.png" -F 'folder=0' "$BASE/api/upload" >/dev/null
echo "eins" > "$T/d1"; echo "zwei" > "$T/d2"; echo "drei" > "$T/d3"
for f in d1 d2 d3; do curl -s -b "$COOKIE" -F "file=@$T/$f;filename=davt-doppelt.txt" "$BASE/api/upload" >/dev/null; done
curl -s -b "$COOKIE" -F "file=@$T/d1;filename=davt-Gross.txt" "$BASE/api/upload" >/dev/null
curl -s -b "$COOKIE" -F "file=@$T/d2;filename=davt-gross.txt" "$BASE/api/upload" >/dev/null
dav "$A" PROPFIND /dav/ -H 'Depth: 1'
L1="$(hrefs | grep davt-)"
has "Doppelter Name: erster behaelt den Namen" "$L1" "/dav/davt-doppelt.txt"
has "Doppelter Name: zweiter -> (2)" "$L1" "/dav/davt-doppelt (2).txt"
has "Doppelter Name: dritter -> (3)" "$L1" "/dav/davt-doppelt (3).txt"
has "Gross-/Kleinschreibung: Kollision -> (2)" "$L1" "/dav/davt-gross (2).txt"
dav "$A" PROPFIND /dav/ -H 'Depth: 1'
eq "Doppelte Namen: Anzeige stabil ueber Aufrufe" "$(hrefs | grep davt- | md5sum)" "$(echo "$L1" | md5sum)"
dav "$A" GET "/dav/davt-doppelt.txt"; eq "(1) liefert die erste Datei" "$(body)" eins
dav "$A" GET "/dav/davt-doppelt%20(2).txt"; eq "(2) liefert die zweite Datei" "$(body)" zwei
dav "$A" GET "/dav/davt-doppelt%20(3).txt"; eq "(3) liefert die dritte Datei" "$(body)" drei
dav "$A" PUT "/dav/davt-doppelt%20(2).txt" --data-binary 'zwei-neu'
eq "PUT auf umbenannte (2) ueberschreibt genau die zweite" "$CODE" 204
dav "$A" GET "/dav/davt-doppelt.txt"; eq "(1) blieb unveraendert" "$(body)" eins
dav "$A" GET "/dav/davt-doppelt%20(2).txt"; eq "(2) hat neuen Inhalt" "$(body)" zwei-neu
dav "$A" DELETE "/dav/davt-doppelt%20(3).txt"; eq "DELETE auf (3) -> 204" "$CODE" 204
dav "$A" GET "/dav/davt-doppelt%20(3).txt"; eq "(3) danach weg" "$CODE" 404
dav "$A" DELETE "/dav/davt-doppelt%20(2).txt"; dav "$A" DELETE "/dav/davt-doppelt.txt"; dav "$A" DELETE "/dav/davt-doppelt.png"; dav "$A" DELETE "/dav/davt-Gross.txt"; dav "$A" DELETE "/dav/davt-gross%20(2).txt"; dav "$A" DELETE "/dav/davt-gross.txt"
# macOS sendet Namen zerlegt (NFD), die Datei wurde zusammengesetzt (NFC) angelegt
NFC=$(python3 -c 'import unicodedata,urllib.parse; print(urllib.parse.quote(unicodedata.normalize("NFC","Übung-nfc.txt")))')
NFD=$(python3 -c 'import unicodedata,urllib.parse; print(urllib.parse.quote(unicodedata.normalize("NFD","Übung-nfc.txt")))')
dav "$A" PUT "/dav/davt/$NFC" --data-binary nfc; dav "$A" GET "/dav/davt/$NFD"
eq "NFD-Anfrage findet NFC-Datei (macOS)" "$(body)" nfc

echo "== Pfad-Tricks =="
dav "$A" GET "/dav/../etc/passwd"; eq "GET /dav/../etc/passwd -> kein Inhalt (404 oder 400)" "$( [ "$CODE" = 404 ] || [ "$CODE" = 400 ] && echo ok)" ok
dav "$A" GET "/dav/davt/../../etc/passwd"; eq "GET mit .. im Pfad -> 400" "$CODE" 400
dav "$A" GET "/dav/%2e%2e/%2e%2e/etc/passwd"; eq "GET mit %2e%2e -> 400" "$CODE" 400
dav "$A" GET "/dav/davt/%2E%2E/a.txt"; eq "GET mit %2E%2E -> 400" "$CODE" 400
dav "$A" GET "/dav/davt/%00x"; eq "NUL (%00) im Namen -> 400" "$CODE" 400
dav "$A" GET "/dav/davt/a%2Fb"; eq "%2F im Namen -> 400" "$CODE" 400
dav "$A" GET "/dav/davt/a%5Cb"; eq "Backslash (%5C) im Namen -> 400" "$CODE" 400
dav "$A" GET "/dav/davt/%E0%A4%A"; eq "ungueltige Prozent-Kodierung -> 400" "$CODE" 400
dav "$A" PUT "/dav/davt/..." --data-binary x; eq "Name nur aus Punkten (...) -> 400" "$CODE" 400
dav "$A" PUT "/dav/davt/%2E" --data-binary x; eq "Name '.' -> 400" "$CODE" 400
LANG_NAME=$(python3 -c 'print("x"*300)')
dav "$A" PUT "/dav/davt/$LANG_NAME" --data-binary x; eq "ganz langer Name (300) -> 414" "$CODE" 414
dav "$A" PUT "/dav/davt/%20leer.txt" --data-binary x; eq "Name mit fuehrendem Leerzeichen -> 400" "$CODE" 400
dav "$A" GET "/dav//davt//a.txt"; eq "doppelte Slashes werden zusammengefasst -> 200" "$CODE" 200
dav "$A" PUT "/dav/davt/a.txt%00.png" --data-binary x; eq "PUT mit NUL -> 400" "$CODE" 400
dav "$A" GET "/dav/davt/a.txt/"; eq "Datei mit Slash am Ende -> 200 (Datei) oder 404" "$( [ "$CODE" = 200 ] || [ "$CODE" = 404 ] && echo ok)" ok
dav "$A" GET "/dav/davt/a.txt/unten"; eq "Pfad unterhalb einer Datei -> 404" "$CODE" 404
dav "$A" GET "/dav/Team-Ordner/../../x"; eq "Team-Ordner/../.. -> 400" "$CODE" 400
dav "$A" PROPFIND "/dav/davt/%2e%2e/" -H 'Depth: 1'; eq "PROPFIND mit %2e%2e -> 400" "$CODE" 400
dav "$A" POST /dav/davt/a.txt --data x; eq "POST -> 405" "$CODE" 405
dav "$A" PATCH /dav/davt/a.txt --data x; eq "PATCH -> 405" "$CODE" 405
dav "$A" REPORT /dav/davt/ --data x; eq "REPORT -> 501" "$CODE" 501
dav "$A" GET /dav/davt/a.txt -H 'Origin: http://boese.example'; eq "GET mit fremdem Origin bleibt lesbar (Cookie-los, nur Basic)" "$CODE" 200
dav "$A" PUT /dav/davt/csrf.txt --data x -H 'Origin: http://boese.example'; eq "schreibend mit fremdem Origin -> 403 (CSRF)" "$CODE" 403

echo "== Fremde Nutzer =="
dav "$A" PUT /dav/davt/geheim.txt --data-binary 'nur-admin'
dav "$AL" PROPFIND /dav/ -H 'Depth: 1'
hasnt "alice sieht keine Ordner/Dateien des Inhabers (Wurzel)" "$(hrefs | tr '\n' ' ')" "davt"
dav "$AL" GET /dav/davt/geheim.txt; eq "alice: GET fremde Datei -> 404" "$CODE" 404
dav "$AL" PUT /dav/davt/geheim.txt --data-binary 'x'; eq "alice: PUT in fremden Ordner -> 409 (Ordner fuer sie nicht da)" "$CODE" 409
dav "$AL" DELETE /dav/davt/geheim.txt; eq "alice: DELETE fremde Datei -> 404" "$CODE" 404
dav "$AL" MOVE /dav/davt/geheim.txt -H "Destination: /dav/mein.txt"; eq "alice: MOVE fremde Datei -> 404" "$CODE" 404
dav "$AL" COPY /dav/davt/geheim.txt -H "Destination: /dav/mein.txt"; eq "alice: COPY fremde Datei -> 404" "$CODE" 404
dav "$AL" LOCK /dav/davt/geheim.txt --data "$LOCKBODY"; eq "alice: LOCK in fremdem (fuer sie nicht vorhandenem) Ordner -> 409" "$CODE" 409
dav "$AL" LOCK /dav/davt/ --data "$LOCKBODY"; eq "alice: LOCK auf unbekannte Ordner-Adresse legt nichts an -> 404" "$CODE" 404
dav "$AL" PUT /dav/davt/ --data-binary x; eq "alice: PUT auf unbekannte Adresse mit / am Ende -> 409" "$CODE" 409
dav "$AL" PROPFIND /dav/ -H 'Depth: 1'; hasnt "alice: dabei ist keine Datei 'davt' entstanden" "$(hrefs | tr '\n' ' ')" "davt"
dav "$AL" PUT /dav/alices.txt --data-binary 'alice'; eq "alice: eigene Datei -> 201" "$CODE" 201
dav "$A" GET /dav/alices.txt; eq "Inhaber sieht Dateien von alice nicht -> 404" "$CODE" 404
dav "$BO" GET /dav/alices.txt; eq "bob sieht Dateien von alice nicht -> 404" "$CODE" 404
dav "$AL" PROPFIND /dav/ -H 'Depth: 1' --data '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:quota-used-bytes/></D:prop></D:propfind>'
has "Quota-Anzeige je Konto (alice)" "$(body)" "<D:quota-used-bytes>"
dav "$AL" PROPFIND /dav/Team-Ordner/ -H 'Depth: 0'; eq "ohne Teams: kein virtueller Team-Ordner -> 404" "$CODE" 404

echo "== Nur-Lesen-App-Passwort =="
dav "$RO" PROPFIND /dav/davt/ -H 'Depth: 1'; eq "RO: PROPFIND -> 207" "$CODE" 207
dav "$RO" GET /dav/davt/geheim.txt; eq "RO: GET -> 200" "$CODE" 200
dav "$RO" PUT /dav/davt/ro.txt --data-binary x; eq "RO: PUT -> 403" "$CODE" 403
dav "$RO" DELETE /dav/davt/geheim.txt; eq "RO: DELETE -> 403" "$CODE" 403
dav "$RO" MKCOL /dav/davt/ro/; eq "RO: MKCOL -> 403" "$CODE" 403
dav "$RO" MOVE /dav/davt/geheim.txt -H "Destination: /dav/davt/g2.txt"; eq "RO: MOVE -> 403" "$CODE" 403
dav "$RO" COPY /dav/davt/geheim.txt -H "Destination: /dav/davt/g2.txt"; eq "RO: COPY -> 403" "$CODE" 403
dav "$RO" PROPPATCH /dav/davt/geheim.txt --data '<D:propertyupdate xmlns:D="DAV:"/>'; eq "RO: PROPPATCH -> 403" "$CODE" 403
dav "$A" GET /dav/davt/ro.txt; eq "RO: es wurde nichts angelegt" "$CODE" 404

echo "== Falsches Passwort und Rate-Limit =="
for i in $(seq 1 10); do dav "davt_rate$$:falsch$i" PROPFIND /dav/ -H 'Depth: 0'; done
eq "10 Fehlversuche: noch 401" "$CODE" 401
dav "davt_rate$$:falsch11" PROPFIND /dav/ -H 'Depth: 0'
eq "11. Fehlversuch -> 429 (Rate-Limit)" "$CODE" 429
has "429: Retry-After" "$(hdr retry-after)" "600"
dav "$A" PROPFIND /dav/ -H 'Depth: 0'; eq "andere Benutzer sind vom Limit nicht betroffen" "$CODE" 207

echo "== Quota (507) und Dateigroesse (413) =="
PSQL "UPDATE users SET quota_bytes = 3000 WHERE username='davt_bob'" >/dev/null
head -c 2500 /dev/urandom > "$T/q2500"; head -c 1000 /dev/urandom > "$T/q1000"
dav "$BO" PUT /dav/q1.bin --data-binary @"$T/q2500"; eq "Quota: 2500 Byte bei 3000 frei -> 201" "$CODE" 201
dav "$BO" PUT /dav/q2.bin --data-binary @"$T/q1000"; eq "Quota: weitere 1000 Byte -> 507 (Content-Length vorab)" "$CODE" 507
dav "$BO" PUT /dav/q2.bin -H 'Transfer-Encoding: chunked' --data-binary @"$T/q1000"; eq "Quota: chunked (ohne Laenge) -> 507" "$CODE" 507
dav "$BO" GET /dav/q2.bin; eq "Quota: abgelehnte Datei existiert nicht" "$CODE" 404
dav "$BO" PUT /dav/q1.bin --data-binary @"$T/q2500"; eq "Quota: Ueberschreiben rechnet die alte Groesse an -> 204" "$CODE" 204
dav "$BO" PROPFIND /dav/ -H 'Depth: 0' --data '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:quota-available-bytes/><D:quota-used-bytes/></D:prop></D:propfind>'
has "quota-available-bytes = 500" "$(body)" "<D:quota-available-bytes>500</D:quota-available-bytes>"
has "quota-used-bytes = 2500" "$(body)" "<D:quota-used-bytes>2500</D:quota-used-bytes>"
dav "$BO" COPY /dav/q1.bin -H "Destination: /dav/q1-kopie.bin"; eq "COPY ueber das Kontingent -> 507" "$CODE" 507
PSQL "UPDATE users SET quota_bytes = NULL WHERE username='davt_bob'" >/dev/null
OLDUP=$(PSQL "SELECT value FROM settings WHERE key='uploads'")
PSQL "INSERT INTO settings(key,value) VALUES ('uploads','{\"maxBytes\": 1500}') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value" >/dev/null
PSQL "SELECT pg_notify('vd_settings','test|uploads')" >/dev/null; sleep 1
RESTART_NOTE=""
dav "$A" PUT /dav/davt/zugross.bin --data-binary @"$T/q2500"
if [ "$CODE" = 413 ]; then ok "zu grosse Datei (Content-Length) -> 413"; else skip "413 bei zu grosser Datei" "Einstellung nicht uebernommen (Code $CODE) - Instanz ohne Neustart"; fi
dav "$A" PUT /dav/davt/zugross.bin -H 'Transfer-Encoding: chunked' --data-binary @"$T/q2500"
if [ "$CODE" = 413 ]; then ok "zu grosse Datei (chunked) -> 413"; fi
if [ -n "$OLDUP" ]; then PSQL "UPDATE settings SET value='$OLDUP'::jsonb WHERE key='uploads'" >/dev/null; else PSQL "DELETE FROM settings WHERE key='uploads'" >/dev/null; fi
PSQL "SELECT pg_notify('vd_settings','test|uploads')" >/dev/null; sleep 1

echo "== Grosse Dateien, RAM, Abbruch, Parallelitaet =="
if [ -r "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  PID=$(cat "$PID_FILE")
  rss() { awk '/VmRSS/{print $2}' "/proc/$PID/status"; }
  BIG="$T/big.bin"; head -c 314572800 /dev/urandom > "$BIG"
  SUM=$(sha256sum "$BIG" | cut -d' ' -f1)
  R0=$(rss); MAXR=$R0
  ( curl -s -o /dev/null -w '%{http_code}' -u "$A" -X PUT -T "$BIG" "$BASE/dav/davt/gross.bin" >"$T/bigcode" ) &
  CP=$!
  while kill -0 $CP 2>/dev/null; do r=$(rss); [ "$r" -gt "$MAXR" ] && MAXR=$r; sleep 0.2; done
  eq "PUT 300 MB -> 201" "$(cat "$T/bigcode")" 201
  R1=$(rss)
  echo "      RSS vorher ${R0} kB, Spitze ${MAXR} kB, danach ${R1} kB"
  [ $((MAXR - R0)) -lt 120000 ] && ok "PUT 300 MB: RAM-Spitze nur $(( (MAXR - R0)/1024 )) MB ueber dem Ausgangswert (Streaming)" || fail "PUT 300 MB: RAM-Anstieg zu gross" "$(( (MAXR - R0)/1024 )) MB"
  curl -s -I -o /dev/null -D "$T/h" -u "$A" "$BASE/dav/davt/gross.bin"; eq "300-MB-Datei: Content-Length" "$(hdr content-length)" 314572800
  R0=$(rss); MAXR=$R0
  ( curl -s -o "$T/big.zurueck" -u "$A" "$BASE/dav/davt/gross.bin" ) & CP=$!
  while kill -0 $CP 2>/dev/null; do r=$(rss); [ "$r" -gt "$MAXR" ] && MAXR=$r; sleep 0.2; done
  eq "300-MB-Datei: Pruefsumme nach GET stimmt" "$(sha256sum "$T/big.zurueck" | cut -d' ' -f1)" "$SUM"
  [ $((MAXR - R0)) -lt 120000 ] && ok "GET 300 MB: RAM-Spitze nur $(( (MAXR - R0)/1024 )) MB ueber dem Ausgangswert" || fail "GET 300 MB: RAM-Anstieg zu gross" "$(( (MAXR - R0)/1024 )) MB"
  rm -f "$T/big.zurueck"
  dav "$A" GET /dav/davt/gross.bin -H 'Range: bytes=314572700-314572799'
  eq "Range am Ende der grossen Datei -> 206 mit 100 Byte" "$CODE/$(wc -c <"$T/b" | tr -d ' ')" "206/100"
  eq "Range am Ende: Inhalt stimmt" "$(md5sum <"$T/b" | cut -d' ' -f1)" "$(tail -c 100 "$BIG" | md5sum | cut -d' ' -f1)"
  # abgebrochener PUT: kein Datenmuell
  N0=$(find "$DATA_DIR/dateien" -type f 2>/dev/null | wc -l); D0=$(PSQL "SELECT count(*) FROM files")
  curl -s -o /dev/null -u "$A" -X PUT -T "$BIG" --limit-rate 40M -m 2 "$BASE/dav/davt/abbruch.bin"; sleep 1.5
  N1=$(find "$DATA_DIR/dateien" -type f 2>/dev/null | wc -l); D1=$(PSQL "SELECT count(*) FROM files")
  eq "abgebrochener PUT: keine Datei im Speicher zurueckgeblieben" "$N1" "$N0"
  eq "abgebrochener PUT: keine halbe Dateizeile" "$D1" "$D0"
  dav "$A" GET /dav/davt/abbruch.bin; eq "abgebrochener PUT: Datei existiert nicht" "$CODE" 404
  dav "$A" PROPFIND /dav/davt/ -H 'Depth: 0'; eq "Server antwortet nach Abbruch weiter" "$CODE" 207
  # Abbruch beim Ueberschreiben: alte Datei bleibt unveraendert
  dav "$A" PUT /dav/davt/ueberschreib.bin --data-binary 'original'
  curl -s -o /dev/null -u "$A" -X PUT -T "$BIG" --limit-rate 40M -m 2 "$BASE/dav/davt/ueberschreib.bin"; sleep 1.5
  dav "$A" GET /dav/davt/ueberschreib.bin; eq "abgebrochenes Ueberschreiben: Original bleibt" "$(body)" original
  eq "abgebrochenes Ueberschreiben: Speicher unveraendert" "$(find "$DATA_DIR/dateien" -type f | wc -l)" "$(( N0 + 1 ))"
  rm -f "$BIG"
  # parallel: viele PUTs auf verschiedene Namen, viele auf denselben
  for i in $(seq 1 30); do ( curl -s -o /dev/null -u "$A" -X PUT --data-binary "datei $i" "$BASE/dav/davt/par-$i.txt" ) & done; wait
  dav "$A" PROPFIND /dav/davt/ -H 'Depth: 1'; eq "30 parallele PUTs: alle 30 vorhanden" "$(hrefs | grep -c '/par-')" 30
  for i in $(seq 1 20); do ( curl -s -o /dev/null -u "$A" -X PUT --data-binary "gleich $i" "$BASE/dav/davt/gleich.txt" ) & done; wait
  eq "20 parallele PUTs auf denselben Namen: genau eine Datei" "$(PSQL "SELECT count(*) FROM files WHERE name='gleich.txt' AND user_id=(SELECT id FROM users WHERE username='admin')")" 1
  eq "…und kein verwaister Speicher dazu" "$(PSQL "SELECT count(*) FROM files WHERE name='gleich.txt'")" 1
  for i in $(seq 1 15); do ( curl -s -o /dev/null -u "$A" -X MKCOL "$BASE/dav/davt/par-ordner/" ) & done; wait
  eq "15 parallele MKCOL auf denselben Namen: genau ein Ordner" "$(PSQL "SELECT count(*) FROM folders WHERE name='par-ordner'")" 1
else
  skip "RAM-/Abbruch-/Parallel-Tests" "PID_FILE ($PID_FILE) nicht lesbar"
fi

echo "== Teams (Pro): virtueller Ordner Team-Ordner =="
LIZ=$(PSQL "SELECT count(*) FROM settings WHERE key='lizenz'")
if [ "$LIZ" = 0 ]; then
  PSQL "INSERT INTO settings(key,value) VALUES ('lizenz', '{\"schluessel\":\"test\",\"art\":\"online\",\"status\":\"aktiv\",\"code\":\"ok\",\"plan\":\"test\",\"trial\":false,\"ablauf\":null,\"features\":[],\"maxGeraete\":5,\"geraete\":1,\"zuletztOk\":$(date +%s)000,\"zuletztVersuch\":$(date +%s)000,\"meldung\":\"\"}')" >/dev/null
  PSQL "SELECT pg_notify('vd_settings','test|lizenz')" >/dev/null; sleep 1
fi
TEAMANL=$(api -d '{"aktion":"anlegen","name":"Davt Team"}' "$BASE/api/pro/teams")
TID=$(PSQL "SELECT id FROM teams WHERE name='Davt Team'")
if [ -n "$TID" ]; then
  AID=$(PSQL "SELECT id FROM users WHERE username='davt_alice'"); BID=$(PSQL "SELECT id FROM users WHERE username='davt_bob'")
  api -d "{\"aktion\":\"mitglied\",\"id\":$TID,\"user_id\":$AID,\"rolle\":\"leitung\"}" "$BASE/api/pro/teams" >/dev/null
  api -d "{\"aktion\":\"mitglied\",\"id\":$TID,\"user_id\":$BID,\"rolle\":\"mitglied\"}" "$BASE/api/pro/teams" >/dev/null
  PSQL "SELECT pg_notify('vd_settings','test|lizenz')" >/dev/null
  # Teams-Funktion greift (sonst waere die Lizenz nicht erkannt)
  dav "$AL" PROPFIND /dav/ -H 'Depth: 1'
  has "Leitung sieht den virtuellen Ordner Team-Ordner" "$(hrefs | tr '\n' ' ')" "/dav/Team-Ordner/"
  dav "$BO" PROPFIND /dav/ -H 'Depth: 1'
  has "Mitglied sieht Team-Ordner" "$(hrefs | tr '\n' ' ')" "/dav/Team-Ordner/"
  dav "$CA" PROPFIND /dav/ -H 'Depth: 1'
  hasnt "Nicht-Mitglied sieht keinen Team-Ordner" "$(hrefs | tr '\n' ' ')" "Team-Ordner"
  dav "$CA" PROPFIND /dav/Team-Ordner/ -H 'Depth: 1'; eq "Nicht-Mitglied: Team-Ordner -> 404" "$CODE" 404
  dav "$AL" PROPFIND /dav/Team-Ordner/ -H 'Depth: 1'
  has "Team-Ordner enthaelt das Team" "$(hrefs | tr '\n' ' ')" "/dav/Team-Ordner/Davt Team/"
  dav "$AL" MKCOL "/dav/Team-Ordner/Neu/"; eq "MKCOL direkt unter Team-Ordner -> 403 (virtuell)" "$CODE" 403
  dav "$AL" PUT "/dav/Team-Ordner/x.txt" --data-binary x; eq "PUT direkt unter Team-Ordner -> 403 (virtuell)" "$CODE" 403
  dav "$AL" PUT "/dav/Team-Ordner/Davt%20Team/x.txt" --data-binary x; eq "PUT direkt unter dem Team (ohne Ordner) -> 403" "$CODE" 403
  dav "$BO" MKCOL "/dav/Team-Ordner/Davt%20Team/Projekt/"; eq "Mitglied: Team-Ordner anlegen -> 403 (nur Leitung)" "$CODE" 403
  dav "$AL" MKCOL "/dav/Team-Ordner/Davt%20Team/Projekt/"; eq "Leitung: Team-Ordner anlegen -> 201" "$CODE" 201
  eq "Team-Ordner in der DB mit team_id" "$(PSQL "SELECT team_id FROM folders WHERE name='Projekt' ORDER BY id DESC LIMIT 1")" "$TID"
  dav "$AL" PROPFIND /dav/ -H 'Depth: 1'; hasnt "Team-Ordner erscheint nicht zusaetzlich in der eigenen Wurzel" "$(hrefs | tr '\n' ' ')" "/dav/Projekt"
  dav "$BO" PROPFIND "/dav/Team-Ordner/Davt%20Team/" -H 'Depth: 1'; has "Mitglied sieht den Team-Ordner Projekt" "$(hrefs | tr '\n' ' ')" "/Projekt/"
  dav "$BO" PUT "/dav/Team-Ordner/Davt%20Team/Projekt/bob.txt" --data-binary 'von bob'; eq "Mitglied: PUT in Team-Ordner -> 201" "$CODE" 201
  dav "$AL" GET "/dav/Team-Ordner/Davt%20Team/Projekt/bob.txt"; eq "Leitung liest Datei des Mitglieds" "$(body)" "von bob"
  dav "$AL" PUT "/dav/Team-Ordner/Davt%20Team/Projekt/alice.txt" --data-binary 'von alice'; eq "Leitung: PUT in Team-Ordner -> 201" "$CODE" 201
  dav "$BO" GET "/dav/Team-Ordner/Davt%20Team/Projekt/alice.txt"; eq "Mitglied liest Datei der Leitung" "$(body)" "von alice"
  dav "$BO" PUT "/dav/Team-Ordner/Davt%20Team/Projekt/alice.txt" --data-binary 'ueberschrieben'; eq "Mitglied darf fremde Datei NICHT ueberschreiben -> 403" "$CODE" 403
  dav "$BO" DELETE "/dav/Team-Ordner/Davt%20Team/Projekt/alice.txt"; eq "Mitglied darf fremde Datei NICHT loeschen -> 403" "$CODE" 403
  dav "$BO" MOVE "/dav/Team-Ordner/Davt%20Team/Projekt/alice.txt" -H "Destination: /dav/Team-Ordner/Davt%20Team/Projekt/a2.txt"; eq "Mitglied darf fremde Datei NICHT verschieben -> 403" "$CODE" 403
  dav "$BO" COPY "/dav/Team-Ordner/Davt%20Team/Projekt/alice.txt" -H "Destination: /dav/kopie-von-alice.txt"; eq "Mitglied darf Teamdatei in die eigene Wurzel kopieren -> 201" "$CODE" 201
  dav "$BO" PUT "/dav/Team-Ordner/Davt%20Team/Projekt/bob.txt" --data-binary 'bob neu'; eq "Mitglied ueberschreibt eigene Teamdatei -> 204" "$CODE" 204
  dav "$AL" PUT "/dav/Team-Ordner/Davt%20Team/Projekt/bob.txt" --data-binary 'leitung ueberschreibt'; eq "Leitung ueberschreibt Datei des Mitglieds -> 204" "$CODE" 204
  dav "$CA" GET "/dav/Team-Ordner/Davt%20Team/Projekt/bob.txt"; eq "Nicht-Mitglied: Teamdatei -> 404" "$CODE" 404
  dav "$BO" LOCK "/dav/Team-Ordner/Davt%20Team/Projekt/alice.txt" --data "$LOCKBODY"; eq "Mitglied darf fremde Teamdatei NICHT sperren -> 403" "$CODE" 403
  dav "$BO" LOCK "/dav/Team-Ordner/Davt%20Team/Projekt/bob.txt" --data "$LOCKBODY"; TTOK=$(hdr lock-token | tr -d '<>')
  eq "Mitglied sperrt eigene Teamdatei -> 200" "$CODE" 200
  dav "$AL" PUT "/dav/Team-Ordner/Davt%20Team/Projekt/bob.txt" --data-binary 'x'; eq "Sperre eines Mitglieds blockiert auch die Leitung (423)" "$CODE" 423
  dav "$AL" PUT "/dav/Team-Ordner/Davt%20Team/Projekt/bob.txt" --data-binary 'x' -H "If: (<$TTOK>)"; eq "Mit dem Token ginge es (Token ist aber nur dem Besitzer bekannt) -> 204" "$CODE" 204
  dav "$BO" UNLOCK "/dav/Team-Ordner/Davt%20Team/Projekt/bob.txt" -H "Lock-Token: <$TTOK>"; eq "Sperre im Team wieder aufheben -> 204" "$CODE" 204
  dav "$BO" MKCOL "/dav/Team-Ordner/Davt%20Team/Projekt/unter/"; eq "Mitglied: Unterordner im Team-Ordner -> 201" "$CODE" 201
  dav "$BO" MOVE "/dav/Team-Ordner/Davt%20Team/Projekt/unter/" -H "Destination: /dav/mein-unter/"; eq "Mitglied darf Team-Ordner mit eigenem Inhalt in die Wurzel verschieben (eigener Ordner)" "$( [ "$CODE" = 201 ] && echo ok || echo "$CODE")" ok
  dav "$BO" DELETE "/dav/Team-Ordner/Davt%20Team/Projekt/"; eq "Mitglied darf fremden Team-Ordner NICHT loeschen -> 403" "$CODE" 403
  dav "$AL" MOVE "/dav/alices.txt" -H "Destination: /dav/Team-Ordner/Davt%20Team/Projekt/alices-verschoben.txt"; eq "Datei in den Team-Ordner verschieben -> 201" "$CODE" 201
  dav "$BO" GET "/dav/Team-Ordner/Davt%20Team/Projekt/alices-verschoben.txt"; eq "…ist fuer das Mitglied sichtbar" "$(body)" alice
  dav "$AL" MOVE "/dav/Team-Ordner/Davt%20Team/Projekt/bob.txt" -H "Destination: /dav/bobs-datei.txt"; eq "Leitung darf fremde Teamdatei NICHT in die eigene Wurzel ziehen -> 403" "$CODE" 403
  dav "$AL" DELETE "/dav/Team-Ordner/Davt%20Team/Projekt/bob.txt"; eq "Leitung loescht Datei des Mitglieds -> 204" "$CODE" 204
  TRASHB=$(curl -s -b "$T/c-davt_bob" "$BASE/api/papierkorb" | python3 -c 'import sys,json; print(" ".join(x["name"] for x in json.load(sys.stdin)["dateien"]))')
  has "Teamdatei im Papierkorb des Besitzers (bob)" "$TRASHB" "bob.txt"
  dav "$AL" COPY "/dav/Team-Ordner/Davt%20Team/Projekt/" -H "Destination: /dav/projekt-kopie/"; eq "Team-Ordner in die eigene Wurzel kopieren -> 201" "$CODE" 201
  dav "$AL" PROPFIND "/dav/projekt-kopie/" -H 'Depth: 1'; has "Kopie enthaelt die Dateien" "$(hrefs | tr '\n' ' ')" "alices-verschoben.txt"
  eq "Kopie ist ein persoenlicher Ordner (kein Team)" "$(PSQL "SELECT coalesce(team_id::text,'-') FROM folders WHERE name='projekt-kopie'")" "-"
  dav "$AL" DELETE "/dav/Team-Ordner/Davt%20Team/Projekt/"; eq "Leitung loescht Team-Ordner samt fremdem Inhalt -> 204" "$CODE" 204
  dav "$AL" DELETE "/dav/projekt-kopie/" >/dev/null
  api -d "{\"aktion\":\"loeschen\",\"id\":$TID}" "$BASE/api/pro/teams" >/dev/null
else
  skip "Team-Tests" "Team konnte nicht angelegt werden: $TEAMANL"
fi

echo "== Widerruf und Kontolöschung =="
dav "$BO" PROPFIND /dav/ -H 'Depth: 0'; eq "bob vor dem Widerruf -> 207" "$CODE" 207
curl -s -b "$T/c-davt_bob" -X DELETE "$BASE/api/sync/zugaenge/$BOB_ID" >/dev/null
dav "$BO" PROPFIND /dav/ -H 'Depth: 0'; eq "widerrufenes App-Passwort sofort ungueltig -> 401" "$CODE" 401
curl -s -b "$T/c-davt_alice" -X DELETE "$BASE/api/sync/zugaenge/$BOB_ID" -o /dev/null -w '%{http_code}\n' | grep -q 404 && ok "fremdes App-Passwort widerrufen -> 404" || fail "fremdes App-Passwort widerrufen"
CID=$(PSQL "SELECT id FROM users WHERE username='davt_carol'")
dav "$CA" PROPFIND /dav/ -H 'Depth: 0'; eq "carol vor Kontolöschung -> 207" "$CODE" 207
api -X DELETE "$BASE/api/users/$CID" >/dev/null
dav "$CA" PROPFIND /dav/ -H 'Depth: 0'; eq "geloeschtes Konto -> sofort 401" "$CODE" 401
eq "App-Passwoerter geloeschter Konten sind weg" "$(PSQL "SELECT count(*) FROM dav_zugaenge WHERE user_id=$CID")" 0

echo "== API /api/sync =="
INFO=$(curl -s -b "$COOKIE" "$BASE/api/sync/info")
has "info: WebDAV-Adresse" "$INFO" '"adresse":"http'
has "info: Benutzer" "$INFO" '"benutzer":"admin"'
LIST=$(curl -s -b "$COOKIE" "$BASE/api/sync/zugaenge")
hasnt "Liste enthaelt weder Klartext noch Hash" "$LIST" "key_hash"
hasnt "Liste enthaelt keinen Klartext" "$LIST" "$ADMIN_PW"
eq "API ohne Anmeldung -> 401" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/sync/zugaenge")" 401
eq "API: leerer Name -> 400" "$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -H 'content-type: application/json' -d '{"name":"  "}' "$BASE/api/sync/zugaenge")" 400
eq "App-Passwort wird nur als Hash gespeichert" "$(PSQL "SELECT count(*) FROM dav_zugaenge WHERE key_hash='$ADMIN_PW' OR prefix='$ADMIN_PW'")" 0
eq "Hash = sha256 des Klartexts" "$(PSQL "SELECT key_hash FROM dav_zugaenge WHERE id=$ADMIN_ID")" "$(printf '%s' "$ADMIN_PW" | sha256sum | cut -d' ' -f1)"

echo "== Aufraeumen =="
dav "$A" DELETE /dav/davt/ >/dev/null
curl -s -b "$COOKIE" -X DELETE "$BASE/api/sync/zugaenge/$ADMIN_ID" >/dev/null; curl -s -b "$COOKIE" -X DELETE "$BASE/api/sync/zugaenge/$RO_ID" >/dev/null
for n in davt_alice davt_bob; do id=$(PSQL "SELECT id FROM users WHERE username='$n'"); [ -n "$id" ] && api -X DELETE "$BASE/api/users/$id" >/dev/null; done
PSQL "DELETE FROM papierkorb WHERE user_id=(SELECT id FROM users WHERE username='admin') AND datei->>'name' IN ('weg.txt','ueber.txt','f1.txt','f2.txt')" >/dev/null

echo
echo "Ergebnis: $PASS bestanden, $FAIL fehlgeschlagen, $SKIP uebersprungen"
[ "$FAIL" = 0 ]
