#!/usr/bin/env bash
# Tests der App-Kopplung (Android-App, /api/app/...) der VylarisCloud (curl + python3). Laeuft gegen eine laufende Instanz
# und gibt PASS/FAIL je Fall aus.
#
# Aufruf:  scripts/test-app.sh [Basis-URL] [Cookie-Datei des Inhabers] [DB-Name]
#   Standard: http://127.0.0.1:3281  /tmp/vdt-vd_aa/cookie.txt  vd_aa
# Voraussetzungen: curl, python3, psql (Postgres 127.0.0.1:$PGPORT_, Standard 54281, Trust). Der Inhaber (admin) ist angemeldet;
# Testkonten (appt_*) werden angelegt und am Ende entfernt. DATA_DIR = Datenordner der Instanz (fuer den APK-Test),
# LOG_FILE = Protokoll der Instanz (Test: keine Geheimnisse im Log).
# Pro frischem Serverstart (oder 10 Minuten Abstand) einmal ausfuehren: die Rate-Limits liegen im Speicher des Servers.
# Jeder Fall nutzt eine eigene (per X-Forwarded-For vorgetaeuschte) Absender-IP, damit sich die Fehlversuch-Sperren nicht stoeren.
set -u
BASE="${1:-http://127.0.0.1:3281}"
COOKIE="${2:-/tmp/vdt-vd_aa/cookie.txt}"
DB="${3:-vd_aa}"
PGPORT_="${PGPORT_:-54281}"
DATA_DIR="${DATA_DIR:-/tmp/vdt-$DB/data}"
LOG_FILE="${LOG_FILE:-/tmp/vdt-$DB/app.log}"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
PASS=0; FAIL=0
PSQL() { psql -h 127.0.0.1 -p "$PGPORT_" -U postgres -tA "$DB" -c "$1" 2>/dev/null; }

ok()   { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf 'FAIL  %s  -- %s\n' "$1" "${2:-}"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1" "ist '$2', erwartet '$3'"; fi; }
has()  { if printf '%s' "$2" | grep -qF -- "$3"; then ok "$1"; else fail "$1" "'$3' fehlt in: $(printf '%s' "$2" | head -c 300)"; fi; }
hasnt(){ if printf '%s' "$2" | grep -qF -- "$3"; then fail "$1" "'$3' ist enthalten"; else ok "$1"; fi; }
match(){ if printf '%s' "$2" | grep -qE -- "$3"; then ok "$1"; else fail "$1" "'$2' passt nicht auf $3"; fi; }
j()    { python3 -c "import sys,json
try:
  d=json.load(sys.stdin)
  for k in sys.argv[1].split('.'):
    d=d[int(k)] if isinstance(d,list) else d[k]
  print(d)
except Exception: print('')" "$1"; }

# nip: eine frische Absender-IP je Aufruf (Zaehler in einer Datei, weil $(nip) in einer Unter-Shell laeuft)
echo $((RANDOM % 1000)) >"$T/ipn"
nip() { local n; n=$(( $(cat "$T/ipn") + 1 )); echo "$n" >"$T/ipn"; echo "10.77.$((n / 250)).$((n % 250 + 1))"; }
# req <Cookie-Datei|-> <Bearer|-> <IP|-> <METHODE> <Pfad> [curl-Optionen]  ->  CODE, $T/b
req() {
  local ck="$1" bt="$2" ip="$3" m="$4" p="$5"; shift 5
  local a=(-s -o "$T/b" -D "$T/h" -w '%{http_code}' -X "$m")
  [ "$ck" != "-" ] && a+=(-b "$ck")
  [ "$bt" != "-" ] && a+=(-H "Authorization: Bearer $bt")
  [ "$ip" != "-" ] && a+=(-H "X-Forwarded-For: $ip")
  CODE=$(curl "${a[@]}" "$@" "$BASE$p")
}
json() { req "$1" "$2" "$3" "$4" "$5" -H 'content-type: application/json' -d "$6"; }
body() { cat "$T/b"; }
hdr() { grep -i "^$1:" "$T/h" | head -1 | sed -E "s/^[^:]*:[[:space:]]*//; s/\r$//"; }
login() { curl -s -c "$T/c-$1" -H 'content-type: application/json' -d "{\"username\":\"$1\",\"password\":\"$SUF\"}" "$BASE/api/auth/login" >/dev/null; }
mk_user() { curl -s -b "$COOKIE" -H 'content-type: application/json' -d "{\"username\":\"$1\",\"email\":\"$1@example.com\",\"password\":\"$SUF\",\"role\":\"user\"}" "$BASE/api/users" >/dev/null; }
uid_of() { PSQL "SELECT id FROM users WHERE username='$1'"; }
# neuer_code <Cookie-Datei>  ->  CODE_KLAR (Anzeigeform)
neuer_code() { json "$1" - - POST /api/app/koppelcode '{}'; CODE_KLAR=$(body | j code); }
# koppeln <Code> <Geraet> [IP]  ->  CODE, TOKEN
koppeln() { json - - "${3:-$(nip)}" POST /api/app/koppeln "{\"code\":\"$1\",\"geraet\":\"$2\"}"; TOKEN=$(body | j token); }

echo "== Vorbereitung =="
curl -sf "$BASE/api/public/health" >/dev/null || { echo "Instanz unter $BASE nicht erreichbar"; exit 2; }
PSQL "DELETE FROM users WHERE username LIKE 'appt\_%'" >/dev/null
PSQL "DELETE FROM upload_tokens WHERE name LIKE 'appt-%'" >/dev/null
SUF="App-Test-Passwort-2026!"
for n in appt_bob appt_carol appt_dave appt_erin; do mk_user $n; login $n; done
BOB="$T/c-appt_bob"; CAROL="$T/c-appt_carol"; DAVE="$T/c-appt_dave"; ERIN="$T/c-appt_erin"
ADMIN_ID=$(uid_of admin)
[ -n "$ADMIN_ID" ] && [ -n "$(uid_of appt_bob)" ] || { echo "Konten konnten nicht angelegt werden"; exit 2; }

# Die Rate-Limits (20 Codes je Nutzer und 10 Minuten usw.) liegen im Speicher des Servers: ein Lauf braucht ~15 Codes des Inhabers.
json "$COOKIE" - - POST /api/app/koppelcode '{}'
[ "$CODE" = 200 ] || { echo "Abbruch: koppelcode liefert $CODE (Rate-Limit eines frueheren Laufs?). 10 Minuten warten oder die Instanz neu starten."; exit 2; }

echo "== Ohne Anmeldung =="
json - - - POST /api/app/koppelcode '{}';             eq "koppelcode ohne Anmeldung -> 401" "$CODE" 401
json - - - POST /api/app/token '{"geraet":"x"}';      eq "token ohne Anmeldung -> 401" "$CODE" 401
req - - - GET /api/app/geraete;                       eq "geraete ohne Anmeldung -> 401" "$CODE" 401
req - - - DELETE /api/app/geraete/1;                  eq "Widerruf ohne Anmeldung -> 401" "$CODE" 401
req - - - GET /api/app/ich;                           eq "ich ohne Token -> 401" "$CODE" 401
req - - - POST /api/app/sitzung;                      eq "sitzung ohne Token -> 401" "$CODE" 401
req - "vd_app_$(printf '0%.0s' $(seq 48))" - GET /api/app/ich; eq "ich mit erfundenem App-Token -> 401" "$CODE" 401
req - "vd_app_abc" - GET /api/app/ich;                eq "ich mit Murks-Token -> 401" "$CODE" 401

echo "== Kopplungscode erzeugen =="
json "$COOKIE" - - POST /api/app/koppelcode '{}'
eq "koppelcode (angemeldet) -> 200" "$CODE" 200
C1=$(body | j code); LINK=$(body | j link)
match "Code hat die Form ABCD-EFGH (ohne 0 1 I L O U-Verwechslungen)" "$C1" '^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$'
eq "ablaufSek = 300" "$(body | j ablaufSek)" 300
has "Link zeigt auf /app/koppeln?c=<Code>" "$LINK" "/app/koppeln?c=$C1"
QRTXT=$(body | j qr); has "Antwort enthaelt QR-Code (SVG)" "${QRTXT:0:200}" "<svg"
eq "Cache-Control: no-store" "$(hdr cache-control)" "no-store"
N=$(PSQL "SELECT count(*) FROM app_koppelcodes WHERE code_hash LIKE '%${C1//-/}%' OR code_hash = '${C1//-/}' OR code_hash = '$C1'")
eq "Code steht nicht im Klartext in der Datenbank" "$N" 0
eq "Code ist als SHA-256-Hash gespeichert (64 Hex)" "$(PSQL "SELECT bool_and(code_hash ~ '^[0-9a-f]{64}$') FROM app_koppelcodes")" t
D=$(PSQL "SELECT round(extract(epoch FROM ablauf_at - now()))::int FROM app_koppelcodes WHERE user_id=$ADMIN_ID ORDER BY id DESC LIMIT 1")
if [ "$D" -ge 295 ] && [ "$D" -le 300 ]; then ok "Ablauf in der Datenbank: ~5 Minuten ($D s)"; else fail "Ablauf in der Datenbank" "$D s"; fi
req "$COOKIE" - - POST /api/app/koppelcode -H 'Origin: http://boese.example' -H 'content-type: application/json' -d '{}'
eq "koppelcode mit fremdem Origin -> 403" "$CODE" 403

echo "== Koppeln =="
koppeln "$C1" "Pixel 8"
eq "koppeln mit gueltigem Code -> 200" "$CODE" 200
match "Token hat die Form vd_app_ + 48 Hex" "$TOKEN" '^vd_app_[0-9a-f]{48}$'
eq "nutzer.name" "$(body | j nutzer.name)" admin
eq "nutzer.rolle" "$(body | j nutzer.rolle)" owner
eq "nutzer.id" "$(body | j nutzer.id)" "$ADMIN_ID"
eq "server.name" "$(body | j server.name)" VylarisCloud
match "server.version" "$(body | j server.version)" '^[0-9]+\.[0-9]+\.[0-9]+$'
match "server.farbe" "$(body | j server.farbe)" '^#[0-9a-fA-F]{6}$'
eq "Cache-Control: no-store" "$(hdr cache-control)" "no-store"
APP1="$TOKEN"
H1=$(printf '%s' "$APP1" | sha256sum | cut -d' ' -f1)
eq "Token nur als Hash gespeichert" "$(PSQL "SELECT count(*) FROM upload_tokens WHERE key_hash='$H1' AND art='app'")" 1
eq "Klartext-Token kommt in keiner Spalte vor" "$(PSQL "SELECT count(*) FROM upload_tokens t WHERE t::text LIKE '%$APP1%'")" 0
eq "Rechte: upload + lesen" "$(PSQL "SELECT rechte::text FROM upload_tokens WHERE key_hash='$H1'")" '["upload", "lesen"]'
APP1_ID=$(PSQL "SELECT id FROM upload_tokens WHERE key_hash='$H1'")
eq "Geraetename uebernommen" "$(PSQL "SELECT name FROM upload_tokens WHERE id=$APP1_ID")" "Pixel 8"
json - - "$(nip)" POST /api/app/koppeln "{\"code\":\"$C1\",\"geraet\":\"Zweitversuch\"}"
eq "Code nur einmal verwendbar -> 404" "$CODE" 404
MELDUNG_BENUTZT=$(body)

echo "== Falsche, abgelaufene und benutzte Codes sehen gleich aus =="
json - - "$(nip)" POST /api/app/koppeln '{"code":"ZZZZ-ZZZZ","geraet":"x"}'
eq "unbekannter Code -> 404" "$CODE" 404
eq "gleiche Meldung: unbekannt = benutzt" "$(body)" "$MELDUNG_BENUTZT"
neuer_code "$COOKIE"; CX="$CODE_KLAR"
PSQL "UPDATE app_koppelcodes SET ablauf_at = now() - interval '1 second' WHERE code_hash = '$(printf 'vd-koppelcode:%s' "${CX//-/}" | sha256sum | cut -d' ' -f1)'" >/dev/null
json - - "$(nip)" POST /api/app/koppeln "{\"code\":\"$CX\",\"geraet\":\"x\"}"
eq "abgelaufener Code (Zeit zurueckgedreht) -> 404" "$CODE" 404
eq "gleiche Meldung: abgelaufen = benutzt" "$(body)" "$MELDUNG_BENUTZT"
neuer_code "$COOKIE"; CY="$CODE_KLAR"
PSQL "UPDATE app_koppelcodes SET ablauf_at = now() + interval '2 seconds' WHERE code_hash = '$(printf 'vd-koppelcode:%s' "${CY//-/}" | sha256sum | cut -d' ' -f1)'" >/dev/null
sleep 3
json - - "$(nip)" POST /api/app/koppeln "{\"code\":\"$CY\",\"geraet\":\"x\"}"
eq "Code, der waehrend des Wartens ablaeuft -> 404" "$CODE" 404
neuer_code "$COOKIE"; CZ="$CODE_KLAR"
PSQL "UPDATE app_koppelcodes SET ablauf_at = now() + interval '5 seconds' WHERE code_hash = '$(printf 'vd-koppelcode:%s' "${CZ//-/}" | sha256sum | cut -d' ' -f1)'" >/dev/null
koppeln "$CZ" "Knapp"
eq "Code kurz vor Ablauf noch gueltig -> 200" "$CODE" 200
for roh in "" "ABC" "AAAAAAAA" "0000-0000" "ILLO-ILLO" "ABCD-EFGH-IJKL" "$(printf 'A%.0s' $(seq 200))"; do
  json - - "$(nip)" POST /api/app/koppeln "{\"code\":\"$roh\",\"geraet\":\"x\"}"
  eq "Murks-Code '${roh:0:12}' -> 404, gleiche Meldung" "$CODE $(body)" "404 $MELDUNG_BENUTZT"
done
json - - "$(nip)" POST /api/app/koppeln '{"code":12345678}';          eq "Zahl statt Text als Code -> 404" "$CODE" 404
json - - "$(nip)" POST /api/app/koppeln '{"code":{"$ne":""}}';        eq "Objekt statt Text als Code -> 404" "$CODE" 404
json - - "$(nip)" POST /api/app/koppeln '[1,2]';                      eq "Array als Body -> 400" "$CODE" 400
json - - "$(nip)" POST /api/app/koppeln '';                           eq "leerer Body -> 400" "$CODE" 400
neuer_code "$COOKIE"; CN="$CODE_KLAR"
koppeln "$(printf '%s' "${CN//-/}" | tr 'A-Z' 'a-z')" "klein"
eq "Eingabe ohne Bindestrich, kleingeschrieben -> 200" "$CODE" 200

echo "== Gleichzeitige Einloesung desselben Codes =="
PRP="10.$((RANDOM % 200 + 20)).$((RANDOM % 250))"
neuer_code "$COOKIE"; CP="$CODE_KLAR"
for i in 1 2 3 4 5 6 7 8; do
  ( curl -s -o /dev/null -w '%{http_code}\n' -H 'content-type: application/json' -H "X-Forwarded-For: $PRP.$i" -d "{\"code\":\"$CP\",\"geraet\":\"par$i\"}" "$BASE/api/app/koppeln" >"$T/par$i" ) &
done
wait
ERGEBNIS=$(cat "$T"/par? | sort | uniq -c | tr -s ' ' | tr '\n' ';')
eq "genau einer von 8 parallelen Aufrufen bekommt ein Token" "$(cat "$T"/par? | grep -c '^200$')" 1
eq "die anderen 7 bekommen 404" "$(cat "$T"/par? | grep -c '^404$')" 7
eq "es entstand genau ein Geraet 'par*'" "$(PSQL "SELECT count(*) FROM upload_tokens WHERE art='app' AND user_id=$ADMIN_ID AND name LIKE 'par%'")" 1

echo "== /api/app/ich =="
req - "$APP1" - GET /api/app/ich
eq "ich mit App-Token -> 200" "$CODE" 200
eq "ich: nutzer.name" "$(body | j nutzer.name)" admin
eq "ich: geraet.name" "$(body | j geraet.name)" "Pixel 8"
eq "ich: geraet.id" "$(body | j geraet.id)" "$APP1_ID"
eq "ich: server.name" "$(body | j server.name)" VylarisCloud
eq "ich setzt zuletzt benutzt" "$(PSQL "SELECT last_used_at IS NOT NULL FROM upload_tokens WHERE id=$APP1_ID")" t
PSQL "UPDATE upload_tokens SET last_used_at = now() - interval '1 day' WHERE id=$APP1_ID" >/dev/null
req - "$APP1" - GET /api/app/ich
eq "ich aktualisiert zuletzt benutzt sofort (nicht erst nach 60 s)" "$(PSQL "SELECT now() - last_used_at < interval '10 seconds' FROM upload_tokens WHERE id=$APP1_ID")" t
req "$COOKIE" - - GET /api/app/ich
eq "ich mit Browser-Sitzung statt Token -> 401" "$CODE" 401

echo "== /api/app/sitzung =="
rm -f "$T/webview.txt"
curl -s -c "$T/webview.txt" -o "$T/b" -D "$T/h" -w '%{http_code}' -X POST -H "Authorization: Bearer $APP1" "$BASE/api/app/sitzung" >"$T/code"; CODE=$(cat "$T/code")
eq "sitzung mit App-Token -> 200" "$CODE" 200
eq "sitzung: nutzer.name" "$(body | j nutzer.name)" admin
SC=$(grep -i '^set-cookie: vd_session=' "$T/h" | head -1 | tr -d '\r')
has "sitzung setzt das Sitzungs-Cookie vd_session" "$SC" "vd_session="
has "Cookie: HttpOnly" "$SC" "HttpOnly"
has "Cookie: SameSite=Lax" "$SC" "SameSite=Lax"
has "Cookie: Path=/" "$SC" "Path=/"
has "Cookie: 30 Tage" "$SC" "Max-Age=2592000"
curl -s -c "$T/webweg.txt" -D "$T/h2" -H 'content-type: application/json' -d "{\"username\":\"appt_bob\",\"password\":\"$SUF\"}" "$BASE/api/auth/login" -o /dev/null
SC2=$(grep -i '^set-cookie: vd_session=' "$T/h2" | head -1 | tr -d '\r')
eq "Cookie-Eigenschaften wie bei der Web-Anmeldung" "$(printf '%s' "$SC" | sed -E 's/vd_session=[^;]*//; s/Expires=[^;]*//I' | tr 'A-Z' 'a-z' | tr -d ' ;')" "$(printf '%s' "$SC2" | sed -E 's/vd_session=[^;]*//; s/Expires=[^;]*//I' | tr 'A-Z' 'a-z' | tr -d ' ;')"
req "$T/webview.txt" - - GET /api/account
eq "/api/account mit dem Cookie aus sitzung -> 200" "$CODE" 200
eq "/api/account: Konto ist admin" "$(body | j username)" admin
req "$T/webview.txt" - - POST /api/app/koppelcode
eq "die WebView-Sitzung hat Web-Rechte (koppelcode) -> 200" "$CODE" 200
eq "Sitzung merkt sich das Geraet" "$(PSQL "SELECT count(*) FROM sessions WHERE app_geraet=$APP1_ID")" 1
curl -s -b "$T/webview.txt" -c "$T/webview.txt" -o /dev/null -X POST -H "Authorization: Bearer $APP1" "$BASE/api/app/sitzung"
curl -s -c "$T/webview.txt" -o /dev/null -X POST -H "Authorization: Bearer $APP1" "$BASE/api/app/sitzung"
eq "wiederholtes sitzung haeuft keine Sitzungen an (1 je Geraet)" "$(PSQL "SELECT count(*) FROM sessions WHERE app_geraet=$APP1_ID")" 1

echo "== Normales Upload-Token (ShareX) ist kein Sitzungs-Dieb =="
json "$COOKIE" - - POST /api/tokens '{"name":"appt-sharex","rechte":["upload","lesen","verwalten"]}'
SHAREX=$(body | j klar)
match "ShareX-Token hat die normale Form vd_<48 Hex>" "$SHAREX" '^vd_[0-9a-f]{48}$'
req - "$SHAREX" - POST /api/app/sitzung;  eq "sitzung mit ShareX-Token -> 401" "$CODE" 401
hasnt "  ... und es wird kein Cookie gesetzt" "$(cat "$T/h")" "vd_session"
req - "$SHAREX" - GET /api/app/ich;       eq "ich mit ShareX-Token -> 401" "$CODE" 401
req - "$SHAREX" - GET /api/v1/me;         eq "ShareX-Token funktioniert weiter an der API v1 -> 200" "$CODE" 200
echo "x" >"$T/s.txt"
req - "$SHAREX" - POST /api/upload -F "file=@$T/s.txt;filename=appt-sharex.txt"
eq "ShareX-Token laedt weiter hoch -> 200" "$CODE" 200
req "$COOKIE" - - GET /api/tokens
hasnt "App-Geraete erscheinen nicht in der Token-Liste der Upload-Werkzeuge" "$(body)" "vd_app_"
eq "Token-Liste enthaelt das ShareX-Token" "$(body | j tokens.0.name)" "appt-sharex"

echo "== App-Token bei Verwaltungs-Routen =="
chk() { # <Beschreibung> <Methode> <Pfad> [Body]
  json - "$APP1" - "$2" "$3" "${4:-{\}}"; case "$CODE" in 401|403) ok "$1 -> $CODE";; *) fail "$1" "Status $CODE";; esac; }
chk "GET /api/users (Admin)" GET /api/users
chk "POST /api/users (Konto anlegen)" POST /api/users '{"username":"appt_boese","email":"b@example.com","password":"Boese-Passwort-2026!","role":"admin"}'
chk "POST /api/pro/lizenz (Inhaber)" POST /api/pro/lizenz '{"aktion":"entfernen"}'
chk "GET /api/account (Konto)" GET /api/account
chk "POST /api/account/password (Passwort aendern)" POST /api/account/password '{"current":"x","next":"Neues-Passwort-2026!"}'
chk "POST /api/tokens (weiteres Token erzeugen)" POST /api/tokens '{"name":"appt-boese","rechte":["upload","lesen","verwalten"]}'
chk "POST /api/app/koppelcode (weiteren Code erzeugen)" POST /api/app/koppelcode
chk "POST /api/app/token (weiteres App-Token erzeugen)" POST /api/app/token '{"geraet":"x"}'
chk "GET /api/app/geraete" GET /api/app/geraete
chk "DELETE /api/app/geraete/<id>" DELETE /api/app/geraete/$APP1_ID
chk "GET /api/files (Panel-Dateiliste)" GET /api/files
chk "GET /api/settings (Einstellungen)" GET /api/settings
chk "GET /api/system/monitoring (System)" GET /api/system/monitoring
eq "kein Konto 'appt_boese' entstanden" "$(PSQL "SELECT count(*) FROM users WHERE username='appt_boese'")" 0
eq "App-Token lebt nach all den Versuchen noch" "$(req - "$APP1" - GET /api/app/ich; echo $CODE)" 200

echo "== Upload und API v1 mit App-Token =="
printf 'Hallo aus der App %s\n' "$$" >"$T/app.txt"
req - "$APP1" - POST /api/upload -F "file=@$T/app.txt;filename=appt-aus-app.txt"
eq "POST /api/upload mit App-Token -> 200" "$CODE" 200
RAW=$(body | j raw); UPID=$(body | j files.0.id)
if [ -n "$RAW" ]; then curl -s "$RAW" -o "$T/zurueck.txt" 2>/dev/null || curl -s "$BASE$(printf '%s' "$RAW" | sed -E 's#^https?://[^/]+##')" -o "$T/zurueck.txt"; fi
if cmp -s "$T/app.txt" "$T/zurueck.txt"; then ok "hochgeladene Datei kommt unveraendert an"; else fail "hochgeladene Datei kommt an" "Antwort: $(head -c 200 "$T/b")"; fi
eq "Datei gehoert dem Konto admin" "$(PSQL "SELECT u.username FROM files f JOIN users u ON u.id=f.user_id WHERE f.name='appt-aus-app.txt' ORDER BY f.id DESC LIMIT 1")" admin
req - "$APP1" - GET /api/v1/me;           eq "GET /api/v1/me mit App-Token -> 200" "$CODE" 200
req - "$APP1" - GET /api/v1/files;        eq "GET /api/v1/files (lesen) -> 200" "$CODE" 200
json - "$APP1" - POST /api/v1/folders '{"name":"appt-ordner"}'
eq "POST /api/v1/folders (verwalten) -> 403: kein Verwaltungsrecht" "$CODE" 403
req - "$APP1" - DELETE "/api/v1/files/${UPID:-0}"
eq "DELETE /api/v1/files/<id> (verwalten) -> 403" "$CODE" 403
for f in $(PSQL "SELECT id FROM files WHERE name LIKE 'appt-%'"); do curl -s -b "$COOKIE" -X DELETE "$BASE/api/files/$f" >/dev/null; done

echo "== Geraeteliste und Widerruf =="
req "$COOKIE" - - GET /api/app/geraete
eq "geraete -> 200" "$CODE" 200
has "Liste enthaelt 'Pixel 8'" "$(body)" "Pixel 8"
hasnt "Liste enthaelt keine Token" "$(body)" "vd_app_"
hasnt "Liste enthaelt keinen Hash" "$(body)" "$H1"
eq "Listeneintrag hat id/name/erstellt/zuletzt_benutzt" "$(body | python3 -c 'import sys,json; d=json.load(sys.stdin)["geraete"]; g=[x for x in d if x["name"]=="Pixel 8"][0]; print(sorted(g.keys()))')" "['erstellt', 'id', 'name', 'zuletzt_benutzt']"
# fremdes Geraet
req "$BOB" - - DELETE /api/app/geraete/$APP1_ID
eq "fremdes Geraet widerrufen (bob -> admin) -> 404" "$CODE" 404
req - "$APP1" - GET /api/app/ich
eq "  ... das Geraet funktioniert weiter" "$CODE" 200
req "$BOB" - - GET /api/app/geraete
hasnt "bob sieht die Geraete des Inhabers nicht" "$(body)" "Pixel 8"
req "$BOB" - - DELETE /api/app/geraete/abc;  eq "Widerruf mit Murks-ID -> 400" "$CODE" 400
req "$BOB" - - DELETE /api/app/geraete/-1;   eq "Widerruf mit negativer ID -> 400" "$CODE" 400
json "$COOKIE" - - POST /api/tokens '{"name":"appt-sharex2"}'; SX2=$(body | j token.id)
req "$COOKIE" - - DELETE /api/app/geraete/$SX2
eq "Widerruf-Route greift nicht auf normale Token zu -> 404" "$CODE" 404
eq "  ... das normale Token ist noch da" "$(PSQL "SELECT count(*) FROM upload_tokens WHERE id=$SX2")" 1
# Widerruf wirkt sofort (Token, Upload, laufende WebView-Sitzung)
req "$T/webview.txt" - - GET /api/account; eq "vor dem Widerruf: WebView-Sitzung gueltig" "$CODE" 200
req "$COOKIE" - - DELETE /api/app/geraete/$APP1_ID
eq "Widerruf des eigenen Geraets -> 200" "$CODE" 200
req - "$APP1" - GET /api/app/ich;                     eq "nach Widerruf: ich -> 401 (sofort)" "$CODE" 401
req - "$APP1" - POST /api/app/sitzung;                eq "nach Widerruf: sitzung -> 401" "$CODE" 401
req - "$APP1" - POST /api/upload -F "file=@$T/app.txt;filename=appt-nach-widerruf.txt"
eq "nach Widerruf: Upload -> 401" "$CODE" 401
req - "$APP1" - GET /api/v1/me;                       eq "nach Widerruf: API v1 -> 401" "$CODE" 401
req "$T/webview.txt" - - GET /api/account
eq "nach Widerruf: die schon laufende WebView-Sitzung ist ebenfalls beendet -> 401" "$CODE" 401
eq "  ... Sitzung aus der Datenbank entfernt" "$(PSQL "SELECT count(*) FROM sessions WHERE app_geraet=$APP1_ID")" 0
req "$COOKIE" - - DELETE /api/app/geraete/$APP1_ID;   eq "zweiter Widerruf -> 404" "$CODE" 404
req "$COOKIE" - - GET /api/account
eq "Browser-Sitzung des Inhabers bleibt unberuehrt -> 200" "$CODE" 200

echo "== /api/app/token (Browser-Sitzung -> App-Token) und Hoechstzahl 10 =="
json "$BOB" - - POST /api/app/token '{"geraet":"Tablet"}'
eq "token mit Sitzung -> 200" "$CODE" 200
TK1=$(body | j token)
match "Token hat die Form vd_app_ + 48 Hex" "$TK1" '^vd_app_[0-9a-f]{48}$'
eq "nutzer.name = bob" "$(body | j nutzer.name)" appt_bob
req - "$TK1" - GET /api/app/ich;  eq "das Token funktioniert (ich) -> 200" "$CODE" 200
json "$BOB" - - POST /api/app/token '{}'; eq "ohne Geraetename -> 200" "$CODE" 200
eq "  ... Standardname 'App'" "$(PSQL "SELECT name FROM upload_tokens WHERE user_id=$(uid_of appt_bob) AND art='app' ORDER BY id DESC LIMIT 1")" App
json "$BOB" - - POST /api/app/token '{"geraet":"<b>Boese</b>\u0000\u0007 Name mit sehr viel Text dahinter dahinter dahinter dahinter dahinter dahinter"}'
NAME=$(PSQL "SELECT name FROM upload_tokens WHERE user_id=$(uid_of appt_bob) AND art='app' ORDER BY id DESC LIMIT 1")
eq "Geraetename wird bereinigt (keine <>, Steuerzeichen, hoechstens 60 Zeichen)" "$(printf '%s' "$NAME" | grep -c '[<>]')|$([ ${#NAME} -le 60 ] && echo kurz)" "0|kurz"
BOB_ID=$(uid_of appt_bob)
PSQL "DELETE FROM upload_tokens WHERE user_id=$BOB_ID AND art='app'" >/dev/null
TOK=()
for i in 1 2 3 4 5 6 7 8 9 10; do json "$BOB" - - POST /api/app/token "{\"geraet\":\"G$i\"}"; TOK[$i]=$(body | j token); sleep 0.05; done
eq "10 Geraete angelegt" "$(PSQL "SELECT count(*) FROM upload_tokens WHERE user_id=$BOB_ID AND art='app'")" 10
req - "${TOK[1]}" - GET /api/app/ich   # G1 wird benutzt, G2 ist damit das am laengsten ungenutzte
json "$BOB" - - POST /api/app/token '{"geraet":"G11"}'; TOK[11]=$(body | j token)
eq "elftes Geraet -> 200" "$CODE" 200
eq "weiterhin hoechstens 10 Geraete" "$(PSQL "SELECT count(*) FROM upload_tokens WHERE user_id=$BOB_ID AND art='app'")" 10
req - "${TOK[2]}" - GET /api/app/ich;  eq "das am laengsten ungenutzte (G2) wurde ersetzt -> 401" "$CODE" 401
req - "${TOK[1]}" - GET /api/app/ich;  eq "das kuerzlich benutzte (G1) bleibt -> 200" "$CODE" 200
req - "${TOK[11]}" - GET /api/app/ich; eq "das neue (G11) funktioniert -> 200" "$CODE" 200
for i in 12 13 14; do json "$BOB" - - POST /api/app/token "{\"geraet\":\"G$i\"}"; done
eq "auch nach weiteren Aufrufen hoechstens 10" "$(PSQL "SELECT count(*) FROM upload_tokens WHERE user_id=$BOB_ID AND art='app'")" 10
# gleichzeitig angelegte Geraete ueberschreiten die Grenze nicht
for i in 1 2 3 4 5 6; do ( curl -s -o /dev/null -b "$BOB" -H 'content-type: application/json' -d "{\"geraet\":\"P$i\"}" "$BASE/api/app/token" ) & done; wait
eq "6 gleichzeitige Anlegungen: weiterhin hoechstens 10" "$(PSQL "SELECT count(*) FROM upload_tokens WHERE user_id=$BOB_ID AND art='app'")" 10
req "$BOB" - - GET /api/tokens
eq "die 25-Token-Grenze der Upload-Werkzeuge zaehlt App-Geraete nicht (Liste leer)" "$(body | j tokens)" "[]"

echo "== Kopplungscodes: Obergrenze und Rate-Limit je Nutzer =="
FIRST=""
for i in 1 2 3 4 5 6; do neuer_code "$DAVE"; [ -z "$FIRST" ] && FIRST="$CODE_KLAR"; done
eq "hoechstens 5 offene Codes je Nutzer" "$(PSQL "SELECT count(*) FROM app_koppelcodes WHERE user_id=$(uid_of appt_dave) AND benutzt_at IS NULL AND ablauf_at > now()")" 5
koppeln "$FIRST" "alt"
eq "der aelteste (erste) Code wurde dabei verdraengt -> 404" "$CODE" 404
koppeln "$CODE_KLAR" "neu"
eq "der neueste Code funktioniert -> 200" "$CODE" 200
# abgelaufene Altlasten werden bei der naechsten Code-Erzeugung entfernt
PSQL "INSERT INTO app_koppelcodes (user_id, code_hash, ablauf_at) VALUES ($(uid_of appt_dave), 'alt-test-hash', now() - interval '3 hours')" >/dev/null
neuer_code "$DAVE"
eq "alte abgelaufene Codes werden aufgeraeumt" "$(PSQL "SELECT count(*) FROM app_koppelcodes WHERE code_hash='alt-test-hash'")" 0
ANZ=7
for i in $(seq 1 14); do json "$DAVE" - - POST /api/app/koppelcode '{}'; ANZ=$((ANZ+1)); [ "$CODE" = 429 ] && break; done
eq "Rate-Limit je Nutzer: ab dem 21. Code in 10 Minuten -> 429" "$CODE $ANZ" "429 21"
has "429-Meldung auf Deutsch/Englisch lesbar" "$(body)" "Zu viele"
json "$ERIN" - - POST /api/app/koppelcode '{}'; eq "anderer Nutzer ist von der Sperre nicht betroffen -> 200" "$CODE" 200

echo "== Geloeschtes Konto =="
json "$CAROL" - - POST /api/app/token '{"geraet":"Carols Handy"}'; CT=$(body | j token)
req - "$CT" - GET /api/app/ich; eq "Carols Token vor dem Loeschen -> 200" "$CODE" 200
curl -s -o /dev/null -c "$T/carol-wv.txt" -X POST -H "Authorization: Bearer $CT" "$BASE/api/app/sitzung"
req "$T/carol-wv.txt" - - GET /api/account; eq "Carols WebView-Sitzung vor dem Loeschen -> 200" "$CODE" 200
neuer_code "$CAROL"; CC="$CODE_KLAR"
req "$COOKIE" - - DELETE /api/users/$(uid_of appt_carol)
eq "Konto loeschen (Inhaber) -> 200" "$CODE" 200
req - "$CT" - GET /api/app/ich;      eq "geloeschtes Konto: ich -> 401" "$CODE" 401
req - "$CT" - POST /api/app/sitzung; eq "geloeschtes Konto: sitzung -> 401" "$CODE" 401
req - "$CT" - POST /api/upload -F "file=@$T/app.txt;filename=appt-geloescht.txt"
eq "geloeschtes Konto: Upload -> 401" "$CODE" 401
req "$T/carol-wv.txt" - - GET /api/account; eq "geloeschtes Konto: WebView-Sitzung -> 401" "$CODE" 401
koppeln "$CC" "Carol spaet"
eq "geloeschtes Konto: offener Kopplungscode -> 404" "$CODE" 404

echo "== Protokoll: keine Geheimnisse =="
EV=$(PSQL "SELECT string_agg(type || ' ' || detail::text, E'\n') FROM events WHERE type LIKE 'app\_%'")
has "Ereignis-Protokoll kennt app_gekoppelt" "$EV" "app_gekoppelt"
has "Ereignis-Protokoll kennt app_geraet_widerrufen" "$EV" "app_geraet_widerrufen"
has "Ereignis-Protokoll kennt app_koppelcode" "$EV" "app_koppelcode"
FEHLT=0
for geheim in "$APP1" "$TK1" "${TOK[1]}" "$CT" "$C1" "$CN" "$CP" "${C1//-/}" "${CN//-/}"; do
  [ -z "$geheim" ] && continue
  printf '%s' "$EV" | grep -qF -- "$geheim" && FEHLT=$((FEHLT+1))
  if [ -f "$LOG_FILE" ]; then grep -qF -- "$geheim" "$LOG_FILE" && FEHLT=$((FEHLT+1)); fi
done
eq "weder Token noch Codes in Ereignissen oder im Server-Log" "$FEHLT" 0
if [ -f "$LOG_FILE" ]; then ok "Server-Log war lesbar ($(wc -l <"$LOG_FILE") Zeilen)"; else fail "Server-Log" "$LOG_FILE fehlt"; fi

echo "== Download und Seiten =="
rm -f "$DATA_DIR/VylarisCloud.apk"
curl -s -o "$T/b" -D "$T/h" -w '%{http_code}' "$BASE/app/download" >"$T/code"; CODE=$(cat "$T/code")
eq "ohne hinterlegte App: /app/download -> 404" "$CODE" 404
has "  ... mit freundlichem Text" "$(body)" "noch nicht hinterlegt"
req - - - GET /api/app/info
eq "info (oeffentlich): apk=False" "$(body | j apk)" False
head -c 123456 /dev/urandom >"$T/App.apk"
cp "$T/App.apk" "$DATA_DIR/VylarisCloud.apk"
curl -s -o "$T/dl.apk" -D "$T/h" -w '%{http_code}' "$BASE/app/download" >"$T/code"; CODE=$(cat "$T/code")
eq "mit hinterlegter App: /app/download -> 200 (ohne Anmeldung)" "$CODE" 200
eq "  ... Content-Type = Android-Paket" "$(hdr content-type)" "application/vnd.android.package-archive"
has "  ... als Anhang VylarisCloud.apk" "$(hdr content-disposition)" 'attachment; filename="VylarisCloud.apk"'
eq "  ... Content-Length" "$(hdr content-length)" 123456
if cmp -s "$T/App.apk" "$T/dl.apk"; then ok "  ... Inhalt Byte fuer Byte gleich"; else fail "Inhalt der APK"; fi
req - - - GET /api/app/info
eq "info (oeffentlich): apk=True" "$(body | j apk)" True
match "info: Server-Adresse" "$(body | j server)" '^https?://'
curl -s -o "$T/seite.html" -w '%{http_code}' "$BASE/app/koppeln?c=ABCD-EFGH" >"$T/code"; CODE=$(cat "$T/code")
eq "/app/koppeln ohne Anmeldung -> 200 (keine Umleitung)" "$CODE" 200
has "  ... Seite zeigt den Code" "$(cat "$T/seite.html")" "ABCD-EFGH"
has "  ... und den Knopf 'In der App oeffnen'" "$(cat "$T/seite.html")" "vylariscloud://koppeln?s="
has "  ... und den Download-Knopf (APK ist hinterlegt)" "$(cat "$T/seite.html")" "/app/download"
curl -s -o "$T/seite2.html" -w '%{http_code}' "$BASE/app/koppeln?c=boese%3Cscript%3E" >"$T/code"; CODE=$(cat "$T/code")
eq "/app/koppeln mit Murks-Code -> 200" "$CODE" 200
hasnt "  ... Murks-Code wird nicht ausgegeben" "$(cat "$T/seite2.html")" "boese<script>"
curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$BASE/geraete" >"$T/code"
has "/geraete ohne Anmeldung -> Anmeldeseite" "$(cat "$T/code")" "/login"
rm -f "$DATA_DIR/VylarisCloud.apk"

echo "== Rate-Limit beim Koppeln (je IP) =="
RP="10.$((RANDOM % 200 + 20)).$((RANDOM % 250))"   # pro Lauf andere IPs (die Sperre gilt 10 Minuten im Speicher des Servers)
IPX="$RP.99"
neuer_code "$COOKIE"; CG="$CODE_KLAR"
LETZTER=""
for i in $(seq 1 10); do json - - "$IPX" POST /api/app/koppeln '{"code":"ZZZZ-ZZZZ","geraet":"x"}'; LETZTER="$LETZTER $CODE"; done
eq "10 Fehlversuche von einer IP: alle 404" "$(echo $LETZTER)" "404 404 404 404 404 404 404 404 404 404"
json - - "$IPX" POST /api/app/koppeln '{"code":"ZZZZ-ZZZZ","geraet":"x"}'
eq "11. Versuch -> 429" "$CODE" 429
eq "  ... mit Retry-After" "$(hdr retry-after)" 600
json - - "$IPX" POST /api/app/koppeln "{\"code\":\"$CG\",\"geraet\":\"x\"}"
eq "  ... auch der richtige Code ist von dieser IP aus gesperrt -> 429" "$CODE" 429
koppeln "$CG" "andere IP" "$RP.100"
eq "  ... von einer anderen IP aus gilt derselbe Code -> 200" "$CODE" 200
eq "erfolgreiche Kopplungen zaehlen nicht als Fehlversuch" "$(for i in 1 2 3 4 5 6 7 8 9 10 11 12; do neuer_code "$ERIN"; json - - "$RP.101" POST /api/app/koppeln "{\"code\":\"$CODE_KLAR\",\"geraet\":\"ok$i\"}"; echo $CODE; done | sort -u | tr '\n' ' ')" "200 "

echo "== App-Geraete enden mit Passwortaenderung, Admin-Reset und Alle-Sitzungen-beenden =="
# Frisches Konto, damit die Rate-Limits (Passwort 8/10 min) der anderen Faelle nicht stoeren
mk_user appt_frank; login appt_frank; FRANK="$T/c-appt_frank"; FRANK_ID=$(uid_of appt_frank)
neuer_code "$FRANK"; koppeln "$CODE_KLAR" "pw-a"; TF1="$TOKEN"
neuer_code "$FRANK"; koppeln "$CODE_KLAR" "pw-b"; TF2="$TOKEN"
req - "$TF1" - POST /api/app/sitzung -c "$T/f1.txt"; eq "Geraet A: Sitzung vor Passwortaenderung -> 200" "$CODE" 200
json "$T/f1.txt" - - POST /api/account/password "{\"current\":\"$SUF\",\"password\":\"$SUF-neu\"}"
eq "Passwortaenderung aus der App-Sitzung -> 200" "$CODE" 200
req "$T/f1.txt" - - GET /api/account; eq "  ... die eigene App-Sitzung (Geraet A) bleibt gueltig" "$CODE" 200
req - "$TF1" - GET /api/app/ich;      eq "  ... Geraet A bleibt gekoppelt" "$CODE" 200
req - "$TF2" - GET /api/app/ich;      eq "  ... Geraet B ist widerrufen -> 401" "$CODE" 401
req - "$TF2" - POST /api/app/sitzung; eq "  ... Geraet B erzeugt keine neue Sitzung mehr -> 401" "$CODE" 401
json "$T/f1.txt" - - POST /api/app/token '{"geraet":"pw-c"}'; TF3=$(body | j token)
curl -s -c "$T/c-appt_frank2" -H 'content-type: application/json' -d "{\"username\":\"appt_frank\",\"password\":\"$SUF-neu\"}" "$BASE/api/auth/login" >/dev/null
req "$T/c-appt_frank2" - - DELETE /api/account/sessions
eq "Alle Sitzungen beenden: Geraete werden mitgezaehlt" "$(body | j geraete)" 2
req - "$TF3" - POST /api/app/sitzung; eq "  ... Geraet C erzeugt keine Sitzung mehr -> 401" "$CODE" 401
req - "$TF1" - POST /api/app/sitzung; eq "  ... auch Geraet A nicht (Sitzung kam aus anderem Fenster) -> 401" "$CODE" 401
mk_user appt_gina
login appt_gina; GINA="$T/c-appt_gina"; GINA_ID=$(uid_of appt_gina)
neuer_code "$GINA"; koppeln "$CODE_KLAR" "reset"; TG="$TOKEN"
req - "$TG" - POST /api/app/sitzung; eq "Nutzer-Geraet vor Admin-Reset: Sitzung -> 200" "$CODE" 200
json "$COOKIE" - - PATCH "/api/users/$GINA_ID" '{"password":"Reset-Passwort-2026!"}'; eq "Admin setzt Passwort zurueck -> 200" "$CODE" 200
req - "$TG" - GET /api/app/ich;       eq "  ... das Geraet des Nutzers ist widerrufen -> 401" "$CODE" 401
eq "  ... und die Zeile ist weg" "$(PSQL "SELECT count(*) FROM upload_tokens WHERE user_id=$GINA_ID AND art='app'")" 0

echo "== Zaehler-Schluessel: fremde X-Forwarded-For-Werte sperren keine Nutzer =="
json "$COOKIE" - - POST /api/app/token '{"geraet":"appt-vorher"}'; eq "Token holen als Inhaber -> 200" "$CODE" 200
for i in $(seq 1 25); do req - - "$ADMIN_ID" GET /api/app/ich >/dev/null; done
json "$COOKIE" - - POST /api/app/token '{"geraet":"appt-nachher"}'
eq "  ... nach 25 Anfragen mit X-Forwarded-For: <Nutzer-ID> weiterhin 200" "$CODE" 200

echo "== Aufraeumen =="
PSQL "DELETE FROM users WHERE username LIKE 'appt\_%'" >/dev/null
PSQL "DELETE FROM upload_tokens WHERE name LIKE 'appt-%'" >/dev/null
PSQL "DELETE FROM upload_tokens WHERE art='app' AND user_id=$ADMIN_ID" >/dev/null
PSQL "DELETE FROM app_koppelcodes" >/dev/null
echo
echo "Ergebnis: $PASS bestanden, $FAIL fehlgeschlagen"
[ "$FAIL" -eq 0 ]
