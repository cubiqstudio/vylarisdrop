#!/usr/bin/env bash
# Regressionstests fuer die Zugriffs-Haertung der VylarisCloud (curl + python3 + psql): Seitensperren, Aufruf-Grenze, Team-Ordner,
# Rollen-Grenzen, Namens-Orakel, Webhook-Filter, Absender-Adresse, Passwort-Freigaben. PASS/FAIL je Fall.
#
# Aufruf:  scripts/test-zugriff.sh [Basis-URL] [Cookie-Datei des Inhabers] [DB-Name]
#   Standard: http://127.0.0.1:3381  /tmp/vdt-vd_zk/cookie.txt  vd_zk   (PostgreSQL: 127.0.0.1:$PGPORT_, Standard 54381, Trust)
# Voraussetzungen: curl, python3 (Standardbibliothek), psql. Der Inhaber (admin) ist angemeldet. Die Testkonten (zgt_*) werden angelegt
# und am Ende entfernt. Pro "Teams" wird ueber die Einstellungstabelle eingeschaltet und am Ende wieder ausgeschaltet.
# Pro frischem Serverstart einmal ausfuehren (Rate-Limits liegen im Speicher des Servers). Der Test spricht den Server ueber
# 127.0.0.1 an; wie hinter einem lokalen Reverse-Proxy zaehlt dann der LETZTE X-Forwarded-For-Eintrag als Absender.
set -u
BASE="${1:-http://127.0.0.1:3381}"
COOKIE="${2:-/tmp/vdt-vd_zk/cookie.txt}"
DB="${3:-vd_zk}"
PGPORT_="${PGPORT_:-54381}"
SUF='Zgt-Test-Passwort-2026!'
T="$(mktemp -d)"
PASS=0; FAIL=0
PSQL() { psql -h 127.0.0.1 -p "$PGPORT_" -U postgres -tA "$DB" -c "$1" 2>/dev/null; }

ok()   { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf 'FAIL  %s  -- %s\n' "$1" "${2:-}"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1" "ist '$2', erwartet '$3'"; fi; }
ne()   { if [ "$2" != "$3" ]; then ok "$1"; else fail "$1" "ist '$2', sollte anders sein"; fi; }
has()  { if printf '%s' "$2" | grep -qF -- "$3"; then ok "$1"; else fail "$1" "'$3' fehlt in: $(printf '%s' "$2" | head -c 300)"; fi; }
hasnt(){ if printf '%s' "$2" | grep -qF -- "$3"; then fail "$1" "'$3' ist enthalten"; else ok "$1"; fi; }
j()    { python3 -c "import sys,json
try:
  d=json.load(sys.stdin)
  for k in sys.argv[1].split('.'):
    d=d[int(k)] if isinstance(d,list) else d[k]
  print(d)
except Exception: print('')" "$1"; }

# nip: eine frische Absender-IP je Aufruf (die Sperren zaehlen je IP)
echo $((RANDOM % 1000)) >"$T/ipn"
nip() { local n; n=$(( $(cat "$T/ipn") + 1 )); echo "$n" >"$T/ipn"; echo "10.88.$((n / 250)).$((n % 250 + 1))"; }
# req <Cookie-Datei|-> <METHODE> <Pfad> [curl-Optionen]  ->  CODE, $T/b
req() {
  local ck="$1" m="$2" p="$3"; shift 3
  local a=(-s -o "$T/b" -D "$T/h" -w '%{http_code}' -X "$m" --path-as-is -H "X-Forwarded-For: $(nip)")
  [ "$ck" != "-" ] && a+=(-b "$ck")
  CODE=$(curl "${a[@]}" "$@" "$BASE$p")
}
json() { req "$1" "$2" "$3" -H 'content-type: application/json' -d "$4"; }
body() { cat "$T/b"; }
login() { curl -s -c "$T/c-$1" -H "X-Forwarded-For: $(nip)" -H 'content-type: application/json' -d "{\"username\":\"$1\",\"password\":\"$SUF\"}" "$BASE/api/auth/login" >/dev/null; }
mk_user() { # <name> [rolle]
  curl -s -b "$COOKIE" -H 'content-type: application/json' -d "{\"username\":\"$1\",\"email\":\"$1@example.com\",\"password\":\"$SUF\",\"role\":\"${2:-user}\"}" "$BASE/api/users" >/dev/null
  login "$1"
}
uid_of() { PSQL "SELECT id FROM users WHERE username='$1'"; }
# seite <Cookie-Datei|-> <Pfad>  ->  "CODE>Weiterleitung"
seite() {
  local a=(-s -o /dev/null -w '%{http_code}>%{redirect_url}' --path-as-is -H "X-Forwarded-For: $(nip)")
  [ "$1" != "-" ] && a+=(-b "$1")
  curl "${a[@]}" "$BASE$2"
}
# hoch <Cookie> <Name> <Inhalt-Datei> [x-vd-max-views] [Ordner-ID]  ->  SLUG, FID, CODE
hoch() {
  local a=(-s -b "$1" -H "X-Forwarded-For: $(nip)" -F "file=@$3;filename=$2")
  [ -n "${4:-}" ] && a+=(-H "x-vd-max-views: $4")
  [ -n "${5:-}" ] && a+=(-H "x-vd-folder: $5")
  curl "${a[@]}" -o "$T/b" -w '%{http_code}' "$BASE/api/upload" >"$T/code"; CODE=$(cat "$T/code")
  SLUG=$(body | j files.0.slug); FID=$(body | j files.0.id)
}
views() { PSQL "SELECT views FROM files WHERE slug='$1'"; }
roh() { # <Slug> [curl-Optionen]  ->  CODE (anonym, /raw/)
  local s="$1"; shift
  curl -s -o /dev/null -w '%{http_code}' -H "X-Forwarded-For: $(nip)" "$@" "$BASE/raw/$s"
}
setze_pro() {
  PSQL "INSERT INTO settings(key,value) VALUES('lizenz','{\"schluessel\":\"TEST\",\"art\":\"online\",\"status\":\"aktiv\",\"code\":\"\",\"plan\":\"Pro\",\"trial\":false,\"ablauf\":null,\"features\":[],\"maxGeraete\":1,\"geraete\":1,\"zuletztOk\":$(date +%s)000,\"zuletztVersuch\":0,\"meldung\":\"\"}') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value" >/dev/null
  PSQL "SELECT pg_notify('vd_settings', 'x|lizenz')" >/dev/null
  sleep 1
}
cleanup() {
  PSQL "DELETE FROM users WHERE username LIKE 'zgt\_%'" >/dev/null
  PSQL "DELETE FROM teams WHERE name LIKE 'zgt-%'" >/dev/null
  PSQL "DELETE FROM rollen WHERE name LIKE 'zgt-%'" >/dev/null
  PSQL "DELETE FROM settings WHERE key = 'lizenz'" >/dev/null
  PSQL "SELECT pg_notify('vd_settings', 'x|lizenz')" >/dev/null
  rm -rf "$T"
}
trap cleanup EXIT

curl -sf "$BASE/api/public/health" >/dev/null || { echo "Instanz unter $BASE nicht erreichbar"; exit 2; }
cleanup_vorher() { PSQL "DELETE FROM users WHERE username LIKE 'zgt\_%'" >/dev/null; PSQL "DELETE FROM teams WHERE name LIKE 'zgt-%'" >/dev/null; PSQL "DELETE FROM rollen WHERE name LIKE 'zgt-%'" >/dev/null; }
cleanup_vorher
printf 'zgt-geheimer-inhalt-0123456789\n' >"$T/klein.txt"
python3 - "$T" <<'EOF'
import struct, sys, zlib, os
def png(pfad, b, h, rausch):
    roh = b''.join(b'\x00' + (os.urandom(b * 3) if rausch else bytes([(x * 7 + y) % 256 for x in range(b) for _ in range(3)])) for y in range(h))
    def blk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(pfad, 'wb').write(b'\x89PNG\r\n\x1a\n' + blk(b'IHDR', struct.pack('>IIBBBBB', b, h, 8, 2, 0, 0, 0)) + blk(b'IDAT', zlib.compress(roh, 0)) + blk(b'IEND', b''))
png(sys.argv[1] + '/bild.png', 400, 300, False)
png(sys.argv[1] + '/gross.png', 200, 170, True)
png(sys.argv[1] + '/winzig.png', 4, 4, False)
EOF

echo "== Vorbereitung: Testkonten =="
for n in anna eva tok; do mk_user "zgt_$n"; done
mk_user zgt_adam admin
ANNA="$T/c-zgt_anna"; EVA="$T/c-zgt_eva"; ADAM="$T/c-zgt_adam"
[ -n "$(uid_of zgt_anna)" ] && [ -n "$(uid_of zgt_adam)" ] || { echo "Konten konnten nicht angelegt werden"; exit 2; }

# ---------------------------------------------------------------------------------------------------------------------------------
echo "== 1. Seiten: Sperrliste ist unabhaengig von Gross-/Kleinschreibung und Kodierung =="
for p in /nutzer /Nutzer /NUTZER /nutzer/ /Nutzer/ /System /system /Server /LIZENZEN /Lizenzen/ '/Lizenzen/?x=1' /Speicher/Ziele /speicher/ziele '/%4eutzer' /%4Eutzer /Sso /Pro /Teams /Marke /Sicherung //nutzer; do
  r=$(seite "$ANNA" "$p"); eq "Nutzer ($p) wird weggeleitet" "${r%%>*}" 302
done
r=$(seite "$ANNA" /nutzer); eq "  ... auf die Startseite" "${r#*>}" "$BASE/"
r=$(seite "$ANNA" /Nutzer); eq "  ... auch bei /Nutzer" "${r#*>}" "$BASE/"
for p in /Sso /sso /Lizenzen /lizenzen /SSO; do r=$(seite "$ADAM" "$p"); eq "Admin ($p): Inhaber-Seite gesperrt" "${r%%>*}" 302; done
for p in /Nutzer /nutzer /System /Teams; do r=$(seite "$ADAM" "$p"); eq "Admin ($p): Admin-Seite offen" "${r%%>*}" 200; done
for p in /Nutzer /Lizenzen /SSO /nutzer; do r=$(seite "$COOKIE" "$p"); eq "Inhaber ($p) darf" "${r%%>*}" 200; done
r=$(seite "$ANNA" /einstellungen); eq "Einstellungen fuer Nutzer offen" "${r%%>*}" 200
r=$(seite - /Nutzer); eq "ohne Anmeldung: /Nutzer -> Anmeldung" "${r%%>*}>${r#*>}" "302>$BASE/login"
EINST_OWNER=$(curl -s -b "$COOKIE" "$BASE/einstellungen?reiter=installation")
has "Inhaber sieht den Reiter Installation (Kontrolle)" "$EINST_OWNER" "Hotlink"
EINST_ANNA=$(curl -s -b "$ANNA" "$BASE/einstellungen?reiter=installation")
hasnt "Nutzer sieht den Reiter Installation nicht (?reiter=installation)" "$EINST_ANNA" "Hotlink"
EINST_ANNA2=$(curl -s -b "$ANNA" "$BASE/einstellungen?reiter=darstellung")
has "  ... normaler Reiter bleibt (Kontrolle)" "$EINST_ANNA2" "einstellungen"

# ---------------------------------------------------------------------------------------------------------------------------------
echo "== 2. Aufruf-Grenze (max_views) ist nicht umgehbar =="
# a) Range-Kopf zaehlt wie jeder Abruf
hoch "$ANNA" einmal-a.txt "$T/klein.txt" 1; A=$SLUG; eq "Upload mit max_views=1 -> 200" "$CODE" 200
eq "Range bytes=1- (erster Abruf) -> 206" "$(roh "$A" -H 'Range: bytes=1-')" 206
eq "  ... wurde gezaehlt" "$(views "$A")" 1
eq "Range bytes=00- danach -> 404" "$(roh "$A" -H 'Range: bytes=00-')" 404
eq "Range bytes=-30 danach -> 404" "$(roh "$A" -H 'Range: bytes=-30')" 404
eq "Abruf ohne Range danach -> 404" "$(roh "$A")" 404
eq "/d/ mit Range danach -> 404" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Range: bytes=00-' "$BASE/d/$A")" 404
# b) Fortsetzung nur mit dem Cookie eines gezaehlten Abrufs
hoch "$ANNA" einmal-b.txt "$T/klein.txt" 1; B=$SLUG
eq "normaler Abruf zaehlt -> 200" "$(curl -s -o /dev/null -c "$T/jar-b" -w '%{http_code}' "$BASE/raw/$B")" 200
eq "  ... views = 1" "$(views "$B")" 1
eq "Fortsetzung (Range bytes=5-) mit Cookie -> 206" "$(roh "$B" -b "$T/jar-b" -H 'Range: bytes=5-')" 206
eq "  ... zaehlt nicht erneut" "$(views "$B")" 1
eq "dieselbe Range ohne Cookie -> 404" "$(roh "$B" -H 'Range: bytes=5-')" 404
eq "Cookie ohne Range-Kopf -> 404 (kein Freibrief fuer Volldownload)" "$(roh "$B" -b "$T/jar-b")" 404
# c) zaehlen=0 und Bot-Kennung schalten das Zaehlen nicht ab
hoch "$ANNA" einmal-c.txt "$T/klein.txt" 1; C=$SLUG
req - GET "/api/public/datei/$C?zaehlen=0"; eq "API mit zaehlen=0 (1. Aufruf) -> 200" "$CODE" 200
eq "  ... wurde trotzdem gezaehlt" "$(views "$C")" 1
req - GET "/api/public/datei/$C?zaehlen=0"; eq "  ... 2. Aufruf mit zaehlen=0 -> 404" "$CODE" 404
hoch "$ANNA" einmal-d.txt "$T/klein.txt" 1; D=$SLUG
req - GET "/api/public/datei/$D" -A 'Discordbot/2.0'; eq "API mit Bot-Kennung (1. Aufruf) -> 200" "$CODE" 200
eq "  ... wurde trotzdem gezaehlt" "$(views "$D")" 1
req - GET "/api/public/datei/$D" -A 'Discordbot/2.0'; eq "  ... 2. Aufruf mit Bot-Kennung -> 404" "$CODE" 404
hoch "$ANNA" einmal-e.txt "$T/klein.txt" 2; E=$SLUG
M=$(curl -s "$BASE/api/public/datei/$E?zaehlen=0" | j medium)
eq "Vorschau-Token (medium) nur nach gezaehltem Aufruf: views = 1" "$(views "$E")" 1
eq "  ... medium liefert den Inhalt (Seite zeigt sie nach dem letzten Aufruf)" "$(curl -s -o /dev/null -w '%{http_code}' "$M")" 200
eq "  ... und zaehlt nicht erneut" "$(views "$E")" 1
# ohne Grenze bleibt alles wie bisher
hoch "$ANNA" frei.txt "$T/klein.txt"; F=$SLUG
req - GET "/api/public/datei/$F?zaehlen=0"; eq "Datei ohne Grenze: zaehlen=0 -> 200" "$CODE" 200
eq "  ... zaehlt nicht (Verhalten unveraendert)" "$(views "$F")" 0
eq "  ... Range bytes=1- -> 206" "$(roh "$F" -H 'Range: bytes=1-')" 206
# d) Vorschaubild /t/ gehoert zur Aufruf-Grenze
hoch "$ANNA" einmal-f.png "$T/bild.png" 1; G=$SLUG
for i in $(seq 1 30); do [ "$(PSQL "SELECT vorschau FROM files WHERE slug='$G'")" = t ] && break; sleep 1; done
if [ "$(PSQL "SELECT vorschau FROM files WHERE slug='$G'")" = t ]; then
  eq "Vorschau /t/ einer Einmal-Datei (1. Abruf) -> 200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/t/$G")" 200
  eq "  ... wurde gezaehlt" "$(views "$G")" 1
  eq "  ... 2. Abruf -> 404" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/t/$G")" 404
else
  fail "Vorschau /t/ konnte nicht erzeugt werden (Test uebersprungen)" "vorschau bleibt false"
fi
# e) Galerie: Dateien mit Grenze erscheinen dort nicht
json "$ANNA" POST /api/folders '{"name":"zgt-galerie"}'; GO=$(body | j ordner.id)
hoch "$ANNA" gal-limit.txt "$T/klein.txt" 3 "$GO"; hoch "$ANNA" gal-ok.txt "$T/klein.txt" "" "$GO"
json "$ANNA" PATCH "/api/folders/$GO" '{"galerie":{"an":true}}'; GT=$(body | j galerie.token)
req - GET "/api/public/galerie/$GT"; GAL=$(body)
has "Galerie zeigt die normale Datei" "$GAL" "gal-ok.txt"
hasnt "Galerie zeigt die Datei mit Aufruf-Grenze nicht" "$GAL" "gal-limit.txt"
curl -s -o "$T/gal.zip" "$BASE/g/$GT/zip"
eq "Galerie-ZIP enthaelt die Datei mit Grenze nicht" "$(python3 -c "import zipfile,sys; print(','.join(sorted(zipfile.ZipFile(sys.argv[1]).namelist())))" "$T/gal.zip" 2>/dev/null)" "gal-ok.txt"

# ---------------------------------------------------------------------------------------------------------------------------------
echo "== 3. Prozent-Kodierung, Namens-Orakel, Passwort-Freigabe =="
for p in '/r/%E0%A4%A' '/d/%E0%A4%A' '/raw/%' '/t/%' '/s/%' '/l/%E0' '/r/x%00y' '/t/x%00y' '/api/public/datei/%' '/api/public/datei/x%00y'; do
  r=$(curl -s -o /dev/null -w '%{http_code}' --path-as-is "$BASE$p"); eq "ungueltige Kodierung $p -> 404" "$r" 404
done
req - POST '/api/public/datei/%E0/entsperren' -H 'content-type: application/json' -d '{"passwort":"x"}'; eq "entsperren mit ungueltiger Kodierung -> 404" "$CODE" 404

json "$ANNA" POST /api/folders '{"name":"zgt-privat"}'; AO=$(body | j ordner.id)
hoch "$ANNA" zgt-geheim.txt "$T/klein.txt" "" "$AO"
json "$ANNA" POST /api/folders "{\"name\":\"ZGT-Sub\",\"parent_id\":$AO}"
json "$EVA" POST /api/folders '{"name":"zgt-probe"}'; EO=$(body | j ordner.id)
json "$EVA" PATCH "/api/folders/$EO" "{\"name\":\"zgt-geheim.txt\",\"parent_id\":$AO}"; eq "fremder Zielordner, Dateiname raten -> 404" "$CODE" 404
eq "  ... eigener Ordner bleibt unveraendert (kein 'name (2)')" "$(PSQL "SELECT name FROM folders WHERE id=$EO")" zgt-probe
json "$EVA" PATCH "/api/folders/$EO" "{\"name\":\"zgt-sub\",\"parent_id\":$AO}"; eq "fremder Zielordner, Ordnername raten -> 404" "$CODE" 404
eq "  ... eigener Ordner bleibt unveraendert" "$(PSQL "SELECT name FROM folders WHERE id=$EO")" zgt-probe
json "$EVA" PATCH "/api/folders/$EO" '{"name":"zgt-probe2"}'; eq "normales Umbenennen -> 200" "$CODE" 200
eq "  ... Name geaendert" "$(PSQL "SELECT name FROM folders WHERE id=$EO")" zgt-probe2

hoch "$ANNA" pw.txt "$T/klein.txt"; P=$SLUG; PID=$FID
json "$ANNA" PATCH "/api/files/$PID" '{"passwort":"Datei-Pw-12345"}'; eq "Datei-Passwort setzen -> 200" "$CODE" 200
json - POST "/api/public/datei/$P/entsperren" '{"passwort":"Datei-Pw-12345"}'
curl -s -o /dev/null -c "$T/jar-pw" -H 'content-type: application/json' -d '{"passwort":"Datei-Pw-12345"}' "$BASE/api/public/datei/$P/entsperren"
eq "mit Entsperr-Cookie -> 200" "$(curl -s -o /dev/null -w '%{http_code}' -b "$T/jar-pw" "$BASE/r/$P.txt")" 200
json "$ANNA" PATCH "/api/files/$PID" '{"passwort":"Neues-Pw-67890"}'
eq "nach Passwortaenderung gilt das alte Cookie nicht mehr (Weiterleitung auf die Seite)" "$(curl -s -o /dev/null -w '%{http_code}' -b "$T/jar-pw" "$BASE/r/$P.txt")" 302
curl -s -o /dev/null -c "$T/jar-pw2" -H 'content-type: application/json' -d '{"passwort":"Neues-Pw-67890"}' "$BASE/api/public/datei/$P/entsperren"
eq "  ... mit dem neuen Passwort entsperrt -> 200" "$(curl -s -o /dev/null -w '%{http_code}' -b "$T/jar-pw2" "$BASE/r/$P.txt")" 200
json "$ANNA" PATCH "/api/files/$PID" '{"passwort":"Drittes-Pw-13579"}'
eq "  ... und nach der naechsten Aenderung wieder nicht" "$(curl -s -o /dev/null -w '%{http_code}' -b "$T/jar-pw2" "$BASE/r/$P.txt")" 302

# ---------------------------------------------------------------------------------------------------------------------------------
echo "== 4. Absender-Adresse: ein vom Client gesetzter erster X-Forwarded-For-Wert hebt die Sperre nicht auf =="
mk_user zgt_brut
CODES=""
for i in $(seq 1 14); do
  c=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Forwarded-For: 10.99.$i.1, 10.98.0.250" -H 'content-type: application/json' -d '{"username":"zgt_brut","password":"falsch-falsch"}' "$BASE/api/auth/login")
  CODES="$CODES $c"
done
has "Login: Wechsel des ersten XFF-Werts umgeht die Sperre nicht (429 kommt)" "$CODES" 429
CODES=""
for i in $(seq 1 14); do
  c=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Forwarded-For: 10.97.$i.1, 10.96.0.250" -H 'content-type: application/json' -d '{"passwort":"falsch"}' "$BASE/api/public/datei/$P/entsperren")
  CODES="$CODES $c"
done
has "Datei-Passwort: ebenso (429 kommt)" "$CODES" 429
c=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Forwarded-For: 10.95.0.1" -H 'content-type: application/json' -d "{\"username\":\"zgt_brut\",\"password\":\"$SUF\"}" "$BASE/api/auth/login")
eq "eine andere Absender-Adresse ist nicht gesperrt" "$c" 200

# ---------------------------------------------------------------------------------------------------------------------------------
echo "== 5. Webhook-Ziele im internen Netz (auch IPv6-Schreibweisen) =="
for z in 'http://[::ffff:7f00:1]:3381/api/public/health' 'http://[::ffff:127.0.0.1]/x' 'http://[::ffff:a9fe:a9fe]/latest/meta-data' 'http://[::ffff:a00:5]/' 'http://[64:ff9b::7f00:1]/' 'http://[::7f00:1]/' 'http://[::1]/' 'http://127.0.0.1:3381/api/public/health' 'http://[2002:7f00:1::]/'; do
  json "$ANNA" POST /api/webhooks "{\"url\":\"$z\",\"ereignisse\":[\"file.uploaded\"]}"; WID=$(body | j id)
  json "$ANNA" POST "/api/webhooks/$WID/test" '{}'
  has "Webhook-Test an $z wird blockiert" "$(body)" "internen Netz"
  req "$ANNA" DELETE "/api/webhooks/$WID" >/dev/null
done

# ---------------------------------------------------------------------------------------------------------------------------------
echo "== 6. Token-Obergrenze gilt auch fuer Werkzeug-Profile =="
TOK="$T/c-zgt_tok"
for i in $(seq 1 25); do json "$TOK" POST /api/config/curl '{}' >/dev/null; done
eq "25 Profile angelegt" "$(PSQL "SELECT count(*) FROM upload_tokens WHERE user_id=$(uid_of zgt_tok) AND art='api'")" 25
json "$TOK" POST /api/config/curl '{}'; eq "26. Profil -> 400" "$CODE" 400
json "$TOK" POST /api/config/sharex '{}'; eq "ShareX-Profil ebenso -> 400" "$CODE" 400
json "$TOK" POST /api/tokens '{"name":"x"}'; eq "POST /api/tokens bleibt bei der Obergrenze -> 400" "$CODE" 400

# ---------------------------------------------------------------------------------------------------------------------------------
echo "== 7. Teams: Ordner anderer Mitglieder =="
setze_pro
for n in lead mem; do mk_user "zgt_$n"; done
LEAD="$T/c-zgt_lead"; MEM="$T/c-zgt_mem"; UL=$(uid_of zgt_lead); UM=$(uid_of zgt_mem)
json "$COOKIE" POST /api/pro/teams '{"aktion":"anlegen","name":"zgt-team"}'; TEAM=$(body | j id); eq "Team angelegt (Pro an)" "$CODE" 200
json "$COOKIE" POST /api/pro/teams "{\"aktion\":\"mitglied\",\"id\":$TEAM,\"user_id\":$UL,\"rolle\":\"leitung\"}"
json "$COOKIE" POST /api/pro/teams "{\"aktion\":\"mitglied\",\"id\":$TEAM,\"user_id\":$UM,\"rolle\":\"mitglied\"}"
json "$LEAD" POST /api/folders "{\"name\":\"zgt-teamordner\",\"team_id\":$TEAM}"; TF=$(body | j ordner.id); eq "Leitung legt Team-Ordner an" "$CODE" 200
json "$MEM" POST /api/folders "{\"name\":\"MemSub\",\"parent_id\":$TF}"; MS=$(body | j ordner.id); eq "Mitglied legt Unterordner an" "$CODE" 200
json "$LEAD" POST /api/folders "{\"name\":\"LeadSubInMemSub\",\"parent_id\":$MS}"; LS=$(body | j ordner.id)
hoch "$LEAD" lead-secret-team-doc.txt "$T/klein.txt" "" "$MS"; eq "Leitung laedt Datei in den Ordner des Mitglieds" "$CODE" 200
json "$MEM" DELETE "/api/folders/$MS" '{}'; eq "Mitglied darf den Ordner mit Fremdinhalt nicht ueber den alten Weg loeschen -> 403" "$CODE" 403
eq "  ... Ordner der Leitung noch da" "$(PSQL "SELECT count(*) FROM folders WHERE id=$LS")" 1
eq "  ... Datei der Leitung noch im Ordner" "$(PSQL "SELECT count(*) FROM files WHERE folder_id=$MS AND name='lead-secret-team-doc.txt'")" 1
json "$MEM" PATCH "/api/folders/$MS" '{"galerie":{"an":true}}'; eq "Mitglied darf Ordner mit Fremdinhalt nicht oeffentlich machen -> 403" "$CODE" 403
eq "  ... keine Galerie angelegt" "$(PSQL "SELECT count(*) FROM folders WHERE id=$MS AND galerie_token IS NOT NULL")" 0
json "$MEM" PATCH "/api/folders/$MS" '{"public":true}'; eq "  ... auch 'public' nicht -> 403" "$CODE" 403
json "$MEM" POST /api/folders "{\"name\":\"MemSub2\",\"parent_id\":$TF}"; MS2=$(body | j ordner.id)
hoch "$MEM" mem-eigen.txt "$T/klein.txt" "" "$MS2"
json "$MEM" PATCH "/api/folders/$MS2" '{"galerie":{"an":true}}'; MT=$(body | j galerie.token); eq "Mitglied darf den Ordner mit EIGENEN Dateien veroeffentlichen -> 200" "$CODE" 200
hoch "$LEAD" lead-spaeter.txt "$T/klein.txt" "" "$MS2"
req - GET "/api/public/galerie/$MT"; GAL=$(body)
has "  ... Galerie zeigt die eigene Datei" "$GAL" "mem-eigen.txt"
hasnt "  ... Dateien der Leitung, die spaeter hinzukommen, erscheinen nicht" "$GAL" "lead-spaeter.txt"
json "$LEAD" PATCH "/api/folders/$MS" '{"galerie":{"an":true}}'; LT=$(body | j galerie.token); eq "Leitung darf den Ordner des Mitglieds veroeffentlichen -> 200" "$CODE" 200
req - GET "/api/public/galerie/$LT"; has "  ... und die Galerie zeigt die Datei der Leitung" "$(body)" "lead-secret-team-doc.txt"
json "$MEM" POST /api/folders "{\"name\":\"MemLeer\",\"parent_id\":$TF}"; ML=$(body | j ordner.id)
json "$MEM" DELETE "/api/folders/$ML" '{}'; eq "Mitglied loescht seinen leeren Ordner -> 200" "$CODE" 200
# Ausscheiden aus dem Team
json "$COOKIE" POST /api/pro/teams "{\"aktion\":\"mitglied\",\"id\":$TEAM,\"user_id\":$UM,\"rolle\":null}"; eq "Mitglied wird aus dem Team entfernt" "$CODE" 200
req "$MEM" GET "/api/cloud/zip?ordner=$MS2"; ne "Ausgeschiedener: ZIP des Team-Ordners nicht mehr abrufbar" "$CODE" 200
hoch "$MEM" nachher.txt "$T/klein.txt" "" "$MS2"; ne "  ... Hochladen in den Team-Ordner nicht mehr moeglich" "$CODE" 200
json "$MEM" PATCH "/api/folders/$MS2" '{"galerie":{"an":true}}'; eq "  ... Galerie umstellen nicht mehr moeglich -> 404" "$CODE" 404
json "$MEM" PATCH "/api/folders/$MS2" '{"team_id":null}'; eq "  ... Team aussperren (team_id=null) nicht moeglich -> 404" "$CODE" 404
eq "  ... Ordner gehoert weiter dem Team" "$(PSQL "SELECT team_id FROM folders WHERE id=$MS2")" "$TEAM"
json "$MEM" DELETE "/api/folders/$MS2" '{}'; eq "  ... Loeschen nicht moeglich -> 404" "$CODE" 404
json "$LEAD" PATCH "/api/folders/$MS2" '{"name":"MemSub2-neu"}'; eq "Leitung verwaltet den Ordner weiter -> 200" "$CODE" 200

# ---------------------------------------------------------------------------------------------------------------------------------
echo "== 8. Rollen-Grenzen gelten auch nach dem Anlegen =="
json "$COOKIE" POST /api/pro/rollen '{"aktion":"anlegen","name":"zgt-eng","rechte":{"hochladen":true,"anfragen":true,"import":true,"maxDateiMb":0.05,"ablaufMaxTage":1}}'; ROLLE=$(body | j id)
eq "Rolle mit Grenzen angelegt" "$CODE" 200
mk_user zgt_rl; RL="$T/c-zgt_rl"; UR=$(uid_of zgt_rl)
json "$COOKIE" POST /api/pro/rollen "{\"aktion\":\"zuweisen\",\"id\":$ROLLE,\"user_id\":$UR}"; eq "Rolle zugewiesen" "$CODE" 200
hoch "$RL" gross.png "$T/gross.png"; eq "Upload ueber der Rollengrenze -> 413" "$CODE" 413
hoch "$RL" winzig.png "$T/winzig.png"; WZ=$FID; eq "kleiner Upload -> 200" "$CODE" 200
hoch "$RL" klein.txt "$T/klein.txt"; KL=$FID
# Ablauf-Grenze
eq "Upload bekommt Ablaufdatum (ablaufMaxTage)" "$(PSQL "SELECT expires_at IS NOT NULL AND expires_at <= now() + interval '1 day 1 minute' FROM files WHERE id=$KL")" t
for w in 'null' '"365d"' '""' '"never"'; do
  json "$RL" PATCH "/api/files/$KL" "{\"ablauf\":$w}"
  eq "PATCH ablauf=$w bleibt innerhalb der Rollengrenze" "$(PSQL "SELECT expires_at IS NOT NULL AND expires_at <= now() + interval '1 day 1 minute' FROM files WHERE id=$KL")" t
done
json "$RL" POST /api/files/bulk "{\"ids\":[\"$KL\"],\"aktion\":\"ablauf\",\"wert\":null}"
eq "Sammelaktion ablauf=null bleibt innerhalb der Rollengrenze" "$(PSQL "SELECT expires_at IS NOT NULL AND expires_at <= now() + interval '1 day 1 minute' FROM files WHERE id=$KL")" t
json "$RL" PATCH "/api/files/$KL" '{"ablauf":"2h"}'
eq "kuerzerer Ablauf (2h) bleibt moeglich" "$(PSQL "SELECT expires_at <= now() + interval '2 hours 1 minute' FROM files WHERE id=$KL")" t
# Bild ersetzen
req "$RL" PUT "/api/files/$WZ/inhalt" -H 'content-type: image/png' --data-binary "@$T/gross.png"; eq "Bild ersetzen ueber der Rollengrenze -> 413" "$CODE" 413
req "$RL" PUT "/api/files/$WZ/inhalt" -H 'content-type: image/png' --data-binary "@$T/winzig.png"; eq "Bild ersetzen unter der Rollengrenze -> 200" "$CODE" 200
# Datei-Anfrage (Gast-Upload)
json "$RL" POST /api/anfragen '{"titel":"zgt-anfrage"}'; AT=$(body | j anfrage.token); [ -z "$AT" ] && AT=$(PSQL "SELECT token FROM anfragen WHERE user_id=$UR ORDER BY id DESC LIMIT 1")
head -c 200000 /dev/zero | tr '\0' 'x' >"$T/zweihunderttausend.txt"
req - POST "/api/public/anfrage/$AT/upload" -F "file=@$T/zweihunderttausend.txt"; eq "Gast-Upload ueber der Rollengrenze des Empfaengers -> 413" "$CODE" 413
req - POST "/api/public/anfrage/$AT/upload" -F "file=@$T/klein.txt"; eq "Gast-Upload unter der Grenze -> 200" "$CODE" 200
# Vorbereitung fuer den Rechteentzug: angefangener Chunk-Upload, Import, App-Passwort
json "$RL" POST /api/upload/start '{"name":"zgt-chunk.txt","size":31}'; UPID=$(body | j id); eq "Chunk-Upload gestartet" "$CODE" 200
req "$RL" PUT "/api/upload/$UPID/0" -H 'content-type: application/octet-stream' --data-binary "@$T/klein.txt"; eq "Chunk uebertragen" "$CODE" 200
json "$RL" POST /api/import '{"quelle":"sharex","weg":"datei"}'; IMP=$(body | j id); eq "Import angelegt" "$CODE" 200
json "$RL" POST /api/sync/zugaenge '{"name":"zgt","schreiben":true}'; DAVPW=$(body | j klar); eq "App-Passwort angelegt" "$CODE" 200
eq "WebDAV COPY mit Recht 'hochladen' -> 201" "$(curl -s -o /dev/null -w '%{http_code}' -u "zgt_rl:$DAVPW" -X COPY -H "Destination: $BASE/dav/zgt-kopie-vorher.txt" "$BASE/dav/klein.txt")" 201
# Rechte entziehen
json "$COOKIE" POST /api/pro/rollen "{\"aktion\":\"aendern\",\"id\":$ROLLE,\"rechte\":{\"hochladen\":false,\"anfragen\":false,\"import\":false,\"maxDateiMb\":0.05,\"ablaufMaxTage\":1}}"; eq "Rechte entzogen" "$CODE" 200
sleep 1
json "$RL" POST /api/upload/start '{"name":"zgt-neu.txt","size":10}'; eq "Kontrolle: neuer Chunk-Upload -> 403" "$CODE" 403
req "$RL" POST "/api/upload/$UPID/fertig" -H 'content-type: application/json' -d '{}'; eq "angefangenen Chunk-Upload abschliessen -> 403" "$CODE" 403
eq "  ... keine Datei entstanden" "$(PSQL "SELECT count(*) FROM files WHERE user_id=$UR AND name='zgt-chunk.txt'")" 0
req - POST "/api/public/anfrage/$AT/upload" -F "file=@$T/klein.txt"; eq "bestehende Datei-Anfrage nimmt keine Gast-Uploads mehr an -> 410" "$CODE" 410
json "$RL" POST "/api/import/$IMP/analysieren" '{"zugang":{}}'; eq "Import analysieren ohne Recht -> 403" "$CODE" 403
eq "WebDAV COPY ohne Recht 'hochladen' -> 403" "$(curl -s -o /dev/null -w '%{http_code}' -u "zgt_rl:$DAVPW" -X COPY -H "Destination: $BASE/dav/zgt-kopie-nachher.txt" "$BASE/dav/klein.txt")" 403
eq "  ... keine Kopie entstanden" "$(PSQL "SELECT count(*) FROM files WHERE user_id=$UR AND name='zgt-kopie-nachher.txt'")" 0
eq "WebDAV MOVE (legt nichts Neues an) bleibt moeglich" "$(curl -s -o /dev/null -w '%{http_code}' -u "zgt_rl:$DAVPW" -X MOVE -H "Destination: $BASE/dav/zgt-verschoben.txt" "$BASE/dav/zgt-kopie-vorher.txt")" 201

echo
echo "Ergebnis: $PASS bestanden, $FAIL fehlgeschlagen"
[ "$FAIL" -eq 0 ]
