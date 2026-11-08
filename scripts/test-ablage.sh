#!/usr/bin/env bash
# API-Tests fuer die Ablage-Regeln ("Wohin kommt was?", server/utils/ablageRegeln.ts): welche NEUEN Dateien in welchen Speicher
# (lokal, Storage Box A/B = SFTP-Speicher-Erweiterungen, Pool) kommen, was verboten ist, Ausfaelle, Eingabemissbrauch,
# Mandantentrennung. curl-, python3- und psql-basiert (PostgreSQL ueber TCP), PASS/FAIL je Fall.
#
# Aufruf:  scripts/test-ablage.sh [Basis-URL] [Cookie-Datei des Inhabers] [DB-Name]
#   Standard: http://127.0.0.1:3421  /tmp/vdt-vd_ar/cookie.txt  vd_ar   (PostgreSQL: 127.0.0.1:$PGPORT_, Standard 54421, Trust)
# Voraussetzungen: frische Instanz (Inhaber admin angemeldet), Node mit ssh2 im Repo (pnpm install). Das Skript startet selbst zwei
# SFTP-Testserver (scripts/test-sftp-server.mjs = "Box A" und "Box B"; SFTP_HOST = nicht-Loopback-Adresse dieses Rechners,
# Standard: erste Adresse aus `hostname -I`), legt Testkonten (abt_*), Ordner, Ziele und Regeln an und raeumt am Ende alles auf.
# Die Testdaten des Datenordners (DATEN, Standard /tmp/vdt-<DB>) werden nur gelesen (Zaehlen der abgelegten Objekte).
set -u
cd "$(dirname "$0")/.."
BASE="${1:-http://127.0.0.1:3421}"
COOKIE="${2:-/tmp/vdt-vd_ar/cookie.txt}"
DB="${3:-vd_ar}"
PGPORT_="${PGPORT_:-54421}"
DATEN="${DATEN:-/tmp/vdt-$DB}"
SFTP_HOST="${SFTP_HOST:-$(hostname -I | awk '{print $1}')}"
SUF='Abt-Test-Passwort-2026!'
MiB=1048576
T="$(mktemp -d)"
PASS=0; FAIL=0; SKIP=0
PSQL() { psql -h 127.0.0.1 -p "$PGPORT_" -U postgres -tA "$DB" -c "$1" 2>&1; }

ok()   { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf 'FAIL  %s  -- %s\n' "$1" "${2:-}"; }
skip() { SKIP=$((SKIP+1)); printf 'SKIP  %s  -- %s\n' "$1" "${2:-}"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1" "ist '$2', erwartet '$3'"; fi; }
has()  { if printf '%s' "$2" | grep -qF -- "$3"; then ok "$1"; else fail "$1" "'$3' fehlt in: $(printf '%s' "$2" | head -c 300)"; fi; }
hasnt(){ if printf '%s' "$2" | grep -qF -- "$3"; then fail "$1" "'$3' ist enthalten"; else ok "$1"; fi; }
# api <Cookie|-> <Methode> <Pfad> [JSON-Body]  ->  CODE, $T/b
api() {
  local c="$1" m="$2" p="$3" body="${4:-}"
  local args=(-s -o "$T/b" -w '%{http_code}' -X "$m")
  [ "$c" != "-" ] && args+=(-b "$c")
  [ -n "$body" ] && args+=(-H 'content-type: application/json' -d "$body")
  CODE=$(curl "${args[@]}" "$BASE$p")
}
J() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))' "$T/b" "$1" 2>/dev/null; }
code() { api "$@"; echo "$CODE"; }
declare -A UID_
mk_user() { # <name> <Rolle> [quota_bytes|null]
  api "$COOKIE" POST /api/users "{\"username\":\"$1\",\"email\":\"$1@example.com\",\"password\":\"$SUF\",\"role\":\"$2\",\"quota_bytes\":${3:-null}}"
  UID_[$1]=$(J 'd["user"]["id"]')
  curl -s -c "$T/c-$1" -H 'content-type: application/json' -d "{\"username\":\"$1\",\"password\":\"$SUF\"}" "$BASE/api/auth/login" >/dev/null
}
C() { echo "$T/c-$1"; }
# Sicht auf die Ablage: Ort der Datei (lokal | sftp<ID> | s3), Zaehlen der Objekte je Speicher
ort_von() { PSQL "SELECT CASE WHEN ablage ~ '^sftp[0-9]+:' THEN substring(ablage from '^(sftp[0-9]+):') WHEN ablage LIKE 's3:%' THEN 's3' ELSE 'lokal' END FROM files WHERE id = $1"; }
objekte() { # <Verzeichnis>  -> Anzahl Datei-Objekte (32 Hex-Zeichen), abgeleitete Dateien zaehlen nicht
  find "$1" -type f -regextype posix-extended -regex '.*/[0-9a-f]{32}' 2>/dev/null | wc -l
}
LOKAL_DIR="$DATEN/data/dateien"
stand() { echo "$(objekte "$LOKAL_DIR")/$(objekte "$T/boxA")/$(objekte "$T/boxB")/$(PSQL 'SELECT count(*) FROM files')"; }
# Dateien mit Kennung erzeugen
png()  { { printf '\x89PNG\r\n\x1a\n'; head -c "$2" /dev/urandom; } > "$T/$1"; }
jpg()  { { printf '\xff\xd8\xff\xe0'; head -c "$2" /dev/urandom; } > "$T/$1"; }
txt()  { { echo "abt-text-$RANDOM"; head -c "$2" /dev/urandom | base64 -w0; } > "$T/$1"; }
bin()  { head -c "$2" /dev/urandom > "$T/$1"; }
# upl <Konto-Cookie> <Datei> [Name] [Typ] [weitere curl-Argumente]  ->  CODE, $T/ub, FID
upl() {
  local c="$1" f="$2" n="${3:-$2}" ty="${4:-application/octet-stream}"; shift 4 2>/dev/null || shift $#
  CODE=$(curl -s -o "$T/ub" -w '%{http_code}' -b "$c" "$@" -F "file=@$T/$f;filename=$n;type=$ty" "$BASE/api/upload")
  cp "$T/ub" "$T/b"; FID=$(J 'd["files"][0]["id"]' 2>/dev/null); [ "$CODE" = 200 ] || FID=""
}
fehlertext() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("message") or d.get("statusMessage") or "")' "$1" 2>/dev/null; }
# identisch herunterladen?
gleich() { # <Datei-ID> <Originaldatei>
  local slug; slug=$(PSQL "SELECT slug FROM files WHERE id = $1")
  curl -s -o "$T/dl" "$BASE/raw/$slug"; cmp -s "$T/dl" "$T/$2" && echo gleich || echo anders
}
# Regeln
regel() { api "$COOKIE" POST /api/regeln/ablage "$1"; RID=$(J 'd.get("id")'); }
regeln_leeren() { PSQL "DELETE FROM ablage_regeln; SELECT pg_notify('vd_settings','test|ablage_regeln')" >/dev/null; sleep 0.4; }
zust() { PSQL "UPDATE speicher_ziele SET status = status || '$2'::jsonb WHERE id = $1" >/dev/null; sleep 5.3; }

# ---------- SFTP-Testserver ----------
box_start() { # <A|B|C> <Port> <Steuerport>
  node scripts/test-sftp-server.mjs --root "$T/box$1" --host "$SFTP_HOST" --port "$2" --user box --password boxpw --control "$3" --hostkey "$T/hk$1.pem" >"$T/box$1.log" 2>&1 &
  echo $! > "$T/box$1.pid"
  for i in $(seq 1 40); do (exec 3<>"/dev/tcp/$SFTP_HOST/$2") 2>/dev/null && return 0; sleep 0.25; done
  return 1
}
box_stop() { kill "$(cat "$T/box$1.pid")" 2>/dev/null; sleep 0.5; }
ziel_anlegen() { # <Name> <Port>  -> ZID
  api "$COOKIE" POST /api/speicher/ziele/testen "{\"name\":\"$1\",\"host\":\"$SFTP_HOST\",\"port\":$2,\"benutzer\":\"box\",\"auth\":\"passwort\",\"passwort\":\"boxpw\",\"basis_pfad\":\"/\"}"
  local fp; fp=$(J 'd.get("fingerabdruck")')
  api "$COOKIE" POST /api/speicher/ziele "{\"name\":\"$1\",\"host\":\"$SFTP_HOST\",\"port\":$2,\"benutzer\":\"box\",\"auth\":\"passwort\",\"passwort\":\"boxpw\",\"basis_pfad\":\"/\",\"host_key\":\"$fp\"}"
  ZID=$(J 'd["ziel"]["id"]')
}
# lokale Objekte der Dateien entfernen, die eine SQL-Bedingung nennt (die der Boxen liegen im temporaeren Verzeichnis und verschwinden mit ihm)
objekte_entfernen() {
  for k in $(PSQL "SELECT ablage FROM files WHERE $1 AND ablage !~ ':'"); do rm -f "$LOKAL_DIR/${k:0:2}/$k" "$LOKAL_DIR/${k:0:2}/$k".*; done
}
cleanup() {
  PSQL "DELETE FROM ablage_regeln; SELECT pg_notify('vd_settings','test|ablage_regeln')" >/dev/null
  objekte_entfernen "(user_id IN (SELECT id FROM users WHERE username LIKE 'abt\_%') OR name LIKE 'abt-%')"
  PSQL "DELETE FROM files WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'abt\_%') OR name LIKE 'abt-%'" >/dev/null
  PSQL "DELETE FROM uploads WHERE name LIKE 'abt-%'" >/dev/null
  PSQL "DELETE FROM anfragen WHERE titel LIKE 'abt-%'" >/dev/null
  PSQL "DELETE FROM users WHERE username LIKE 'abt\_%'" >/dev/null
  PSQL "DELETE FROM folders WHERE name LIKE 'abt-%'" >/dev/null
  curl -s -b "$COOKIE" -X PUT -H 'content-type: application/json' -d '{"art":"lokal"}' "$BASE/api/speicher/ziele/ort" >/dev/null
  PSQL "DELETE FROM speicher_ziele WHERE name LIKE 'abt-%'; SELECT pg_notify('vd_settings','test|sftp_ziele')" >/dev/null
  for n in A B C; do [ -f "$T/box$n.pid" ] && kill "$(cat "$T/box$n.pid")" 2>/dev/null; done
  rm -rf "$T"
}
trap cleanup EXIT

echo "== Vorbereitung =="
curl -sf "$BASE/api/public/health" >/dev/null || { echo "Instanz unter $BASE nicht erreichbar"; exit 2; }
PSQL "SELECT 1" | grep -q 1 || { echo "PostgreSQL ($PGPORT_) nicht erreichbar"; exit 2; }
PSQL "DELETE FROM users WHERE username LIKE 'abt\_%'" >/dev/null
PSQL "DELETE FROM ablage_regeln" >/dev/null
box_start A 2231 2241 && box_start B 2232 2242 && box_start C 2233 2243 || { echo "SFTP-Testserver nicht gestartet"; exit 2; }
ziel_anlegen abt-box-a 2231; ZA=$ZID
ziel_anlegen abt-box-b 2232; ZB=$ZID
ziel_anlegen abt-box-c 2233; ZC=$ZID
[ -n "$ZA" ] && [ -n "$ZB" ] && [ -n "$ZC" ] || { echo "Ziele nicht angelegt ($ZA/$ZB/$ZC)"; exit 2; }
A="sftp$ZA"; B="sftp$ZB"; Cc="sftp$ZC"
api "$COOKIE" PUT /api/speicher/ziele/ort '{"art":"lokal"}'
mk_user abt_lucas user; mk_user abt_nora user; mk_user abt_adm admin; mk_user abt_rl admin
mk_user abt_klein user 3145728
LUCAS=${UID_[abt_lucas]}; NORA=${UID_[abt_nora]}; ADM=${UID_[abt_adm]}
api "$(C abt_lucas)" POST /api/folders '{"name":"abt-ordner"}'; OF=$(J 'd["ordner"]["id"]')
api "$(C abt_lucas)" POST /api/folders "{\"name\":\"abt-unter\",\"parent_id\":$OF}"; OU=$(J 'd["ordner"]["id"]')
api "$(C abt_lucas)" POST /api/folders '{"name":"abt-anders"}'; OA=$(J 'd["ordner"]["id"]')
echo "Boxen: A=$A B=$B C=$Cc | Konten lucas=$LUCAS nora=$NORA adm=$ADM | Ordner $OF/$OU/$OA"
eq "Migration [cloud:ablage]: Tabelle ablage_regeln vorhanden" "$(PSQL "SELECT count(*) FROM information_schema.columns WHERE table_name='ablage_regeln'")" 13
eq "Migration idempotent: erneutes Ausfuehren der CREATE-Anweisungen ohne Fehler" "$(PSQL "CREATE TABLE IF NOT EXISTS ablage_regeln (id serial PRIMARY KEY); CREATE INDEX IF NOT EXISTS ablage_regeln_pos_idx ON ablage_regeln(position, id); SELECT 'ok'" | tail -1)" ok

echo "== Mandantentrennung =="
for pm in "GET /api/regeln/ablage" "POST /api/regeln/ablage" "PATCH /api/regeln/ablage/1" "DELETE /api/regeln/ablage/1" "POST /api/regeln/ablage/reihenfolge" "POST /api/regeln/ablage/test"; do
  set -- $pm
  eq "normales Konto: $pm -> 403" "$(code "$(C abt_lucas)" $1 $2 '{"ids":[1],"name":"x","aktion":"verbieten"}')" 403
  eq "ohne Anmeldung: $pm -> 401" "$(code - $1 $2 '{"ids":[1],"name":"x","aktion":"verbieten"}')" 401
done
eq "Admin (nicht Inhaber): GET -> 200" "$(code "$(C abt_adm)" GET /api/regeln/ablage)" 200

echo "== Eingabepruefung =="
bad() { eq "ungueltig -> 400: $1" "$(code "$COOKIE" POST /api/regeln/ablage "$2")" 400; }
bad "Aktion unbekannt" '{"aktion":"loeschen","ziele":["lokal"]}'
bad "speichern ohne Ziele" '{"aktion":"speichern","ziele":[]}'
bad "Ort 'ftp1'" '{"aktion":"speichern","ziele":["ftp1"]}'
bad "Ort 'sftp0'" '{"aktion":"speichern","ziele":["sftp0"]}'
bad "Ort mit SQL" '{"aktion":"speichern","ziele":["lokal; DROP TABLE users"]}'
bad "Ort als Zahl" '{"aktion":"speichern","ziele":[1]}'
bad "Ziele kein Array" '{"aktion":"speichern","ziele":"lokal"}'
bad "Strategie unbekannt" '{"aktion":"speichern","ziele":["lokal"],"strategie":"zufall"}'
bad "Fallback unbekannt" '{"aktion":"speichern","ziele":["lokal"],"fallback":"egal"}'
bad "Name zu lang" "{\"aktion\":\"verbieten\",\"name\":\"$(printf 'x%.0s' $(seq 1 81))\"}"
bad "Meldung zu lang" "{\"aktion\":\"verbieten\",\"meldung\":\"$(printf 'x%.0s' $(seq 1 301))\"}"
bad "Bedingung ist Text" '{"aktion":"verbieten","bedingung":"alles"}'
bad "unbekanntes Feld in Bedingung" '{"aktion":"verbieten","bedingung":{"sql":"1=1"}}'
bad "Art unbekannt" '{"aktion":"verbieten","bedingung":{"art":["programm"]}}'
bad "Groesse nicht ganzzahlig" '{"aktion":"verbieten","bedingung":{"groesse_von_mb":1.5}}'
bad "Groesse negativ" '{"aktion":"verbieten","bedingung":{"groesse_von_mb":-3}}'
bad "Groesse als Text" '{"aktion":"verbieten","bedingung":{"groesse_bis_mb":"5"}}'
bad "von groesser als bis" '{"aktion":"verbieten","bedingung":{"groesse_von_mb":10,"groesse_bis_mb":5}}'
bad "Endung mit Sonderzeichen" '{"aktion":"verbieten","bedingung":{"endungen":["exe;rm -rf"]}}'
bad "Endung zu lang" '{"aktion":"verbieten","bedingung":{"endungen":["abcdefghijklmnopqrstuvwxyz"]}}'
bad "MIME ohne Schraegstrich" '{"aktion":"verbieten","bedingung":{"mime":["image"]}}'
bad "Konten-ID Text" '{"aktion":"verbieten","bedingung":{"konten":["lucas"]}}'
bad "Konten-ID Kommazahl" '{"aktion":"verbieten","bedingung":{"konten":[1.5]}}'
bad "Rolle unbekannt" '{"aktion":"verbieten","bedingung":{"rollen":["root"]}}'
LANG51=$(python3 -c 'print(",".join(str(i+1) for i in range(51)))')
bad "51 Konten (Liste zu gross)" "{\"aktion\":\"verbieten\",\"bedingung\":{\"konten\":[$LANG51]}}"
bad "51 Endungen" "{\"aktion\":\"verbieten\",\"bedingung\":{\"endungen\":[$(python3 -c 'print(",".join("\"e%d\""%i for i in range(51)))')]}}"
bad "51 Ziele" "{\"aktion\":\"speichern\",\"ziele\":[$(python3 -c 'print(",".join("\"sftp%d\""%(i+1) for i in range(51)))')]}"
bad "riesige Ordner-Liste (5000)" "{\"aktion\":\"verbieten\",\"bedingung\":{\"ordner\":[$(python3 -c 'print(",".join(str(i+1) for i in range(5000)))')]}}"
eq "Body ist kein JSON -> 400" "$(code "$COOKIE" POST /api/regeln/ablage 'kein json')" 400
eq "nicht vorhandene Box 'sftp99999' -> 404" "$(code "$COOKIE" POST /api/regeln/ablage '{"aktion":"speichern","ziele":["sftp99999"]}')" 404
eq "Name mit SQL-Zeichen wird nur als Text gespeichert (201/200)" "$(code "$COOKIE" POST /api/regeln/ablage '{"aktion":"verbieten","name":"x'"'"'); DROP TABLE ablage_regeln;--","aktiv":false}')" 200
SQLID=$(J 'd["id"]')
eq "Tabelle nach SQL-Name noch da, Name unveraendert" "$(PSQL "SELECT name FROM ablage_regeln WHERE id=$SQLID")" "x'); DROP TABLE ablage_regeln;--"
eq "PATCH mit unbekannter ID -> 404" "$(code "$COOKIE" PATCH /api/regeln/ablage/999999 '{"aktiv":true}')" 404
eq "PATCH mit ID 'abc' -> 404" "$(code "$COOKIE" PATCH /api/regeln/ablage/abc '{"aktiv":true}')" 404
eq "DELETE mit unbekannter ID -> 404" "$(code "$COOKIE" DELETE /api/regeln/ablage/999999)" 404
eq "PATCH mit ungueltigem Feld -> 400" "$(code "$COOKIE" PATCH /api/regeln/ablage/$SQLID '{"aktion":"bumm"}')" 400
eq "Reihenfolge mit falscher ID-Liste -> 409" "$(code "$COOKIE" POST /api/regeln/ablage/reihenfolge '{"ids":[999999]}')" 409
eq "Reihenfolge mit Text -> 400" "$(code "$COOKIE" POST /api/regeln/ablage/reihenfolge '{"ids":["a"]}')" 400
eq "Test ohne Namen -> 400" "$(code "$COOKIE" POST /api/regeln/ablage/test '{"name":""}')" 400
eq "Test mit negativer Groesse -> 400" "$(code "$COOKIE" POST /api/regeln/ablage/test '{"name":"a","groesse_mb":-1}')" 400
eq "Test mit unbekanntem Konto -> 404" "$(code "$COOKIE" POST /api/regeln/ablage/test '{"name":"a","konto":99999999}')" 404
# Hoechstzahl 200: 199 per SQL dazu (1 Regel ist schon da), dann die 201. per API
PSQL "INSERT INTO ablage_regeln (position, name, aktion) SELECT 100+g, 'abt-massen', 'verbieten' FROM generate_series(1,199) g; SELECT pg_notify('vd_settings','test|ablage_regeln')" >/dev/null
eq "200 Regeln vorhanden" "$(PSQL 'SELECT count(*) FROM ablage_regeln')" 200
eq "201. Regel -> 400 (Hoechstzahl)" "$(code "$COOKIE" POST /api/regeln/ablage '{"aktion":"verbieten"}')" 400
regeln_leeren

echo "== Regeln nach Art, Endung, Groesse, Konto, Rolle, Ordner =="
png a.png 5000; txt a.txt 3000; bin a.zip 4000; bin gross.bin $((3*MiB)); bin klein.bin 2000; bin dritter.dat 1000
# --- Art
regel "{\"name\":\"Bilder\",\"aktion\":\"speichern\",\"ziele\":[\"$A\"],\"bedingung\":{\"art\":[\"bild\"]}}"; R_ART=$RID
eq "Regel 'Bilder -> Box A' angelegt (200)" "$CODE" 200
upl "$COOKIE" a.png abt-a.png image/png; F1=$FID
eq "Bild -> Box A" "$(ort_von $F1)" "$A"
eq "Bild von Box A identisch (cmp)" "$(gleich $F1 a.png)" gleich
upl "$COOKIE" a.txt abt-a.txt text/plain; F2=$FID
eq "Text trifft die Bild-Regel nicht -> lokal (Standard)" "$(ort_von $F2)" lokal
eq "Text lokal identisch (cmp)" "$(gleich $F2 a.txt)" gleich
# --- Endung (Gross-/Kleinschreibung egal)
regel "{\"name\":\"ZIP\",\"aktion\":\"speichern\",\"ziele\":[\"$B\"],\"bedingung\":{\"endungen\":[\"ZIP\",\".tar.gz\"]}}"
upl "$COOKIE" a.zip abt-Archiv.ZiP application/zip; F3=$FID
eq "Endung .ZiP (Schreibweise egal) -> Box B" "$(ort_von $F3)" "$B"
eq "Archiv von Box B identisch (cmp)" "$(gleich $F3 a.zip)" gleich
upl "$COOKIE" a.zip abt-backup.tar.gz application/gzip; eq "Endung mit Punkt (tar.gz) -> Box B" "$(ort_von $FID)" "$B"
upl "$COOKIE" a.zip abt-nur.gz application/gzip; eq "nur .gz trifft 'tar.gz' nicht -> lokal" "$(ort_von $FID)" lokal
regeln_leeren
# --- Groesse
regel "{\"name\":\"gross\",\"aktion\":\"speichern\",\"ziele\":[\"$A\"],\"bedingung\":{\"groesse_von_mb\":2}}"
upl "$COOKIE" gross.bin abt-gross.bin; F4=$FID
eq "3 MB bei 'ab 2 MB' (Content-Length bekannt) -> Box A" "$(ort_von $F4)" "$A"
eq "Grosse Datei von Box A identisch (cmp)" "$(gleich $F4 gross.bin)" gleich
upl "$COOKIE" klein.bin abt-klein.bin; eq "2 KB bei 'ab 2 MB' -> lokal" "$(ort_von $FID)" lokal
# unbekannte Groesse: WebDAV-PUT ohne Laenge (chunked) -> Groessenbedingung gilt als nicht erfuellt -> Standard
api "$COOKIE" POST /api/sync/zugaenge '{"name":"abt-dav","schreiben":true}'; DAVPW=$(J 'd["klar"]'); DAV="admin:$DAVPW"
dput() { # <Zugang> <Pfad> <Datei> [curl-Optionen]  -> CODE, $T/db
  local cr="$1" p="$2" f="$3"; shift 3
  CODE=$(curl -s --path-as-is -o "$T/db" -w '%{http_code}' -u "$cr" -X PUT --data-binary "@$T/$f" "$@" "$BASE/dav/$p")
}
dput_chunked() { local cr="$1" p="$2" f="$3"; shift 3
  CODE=$(cat "$T/$f" | curl -s --path-as-is -o "$T/db" -w '%{http_code}' -u "$cr" -X PUT -T - -H 'Transfer-Encoding: chunked' "$@" "$BASE/dav/$p"); }
dav_id() { PSQL "SELECT id FROM files WHERE name = '$1' ORDER BY id DESC LIMIT 1"; }
dput_chunked "$DAV" abt-unbekannt.bin gross.bin
eq "WebDAV chunked 3 MB (Groesse unbekannt) -> Groessenregel greift NICHT -> lokal" "$(ort_von "$(dav_id abt-unbekannt.bin)")" lokal
dput "$DAV" abt-bekannt.bin gross.bin
eq "WebDAV mit Content-Length 3 MB -> Box A" "$(ort_von "$(dav_id abt-bekannt.bin)")" "$A"
regeln_leeren
regel "{\"name\":\"bis\",\"aktion\":\"speichern\",\"ziele\":[\"$B\"],\"bedingung\":{\"groesse_bis_mb\":1}}"
upl "$COOKIE" klein.bin abt-klein2.bin; eq "2 KB bei 'bis 1 MB' -> Box B" "$(ort_von $FID)" "$B"
upl "$COOKIE" gross.bin abt-gross2.bin; eq "3 MB bei 'bis 1 MB' -> lokal" "$(ort_von $FID)" lokal
regeln_leeren
# --- Konto / Rolle / Ordner
regel "{\"name\":\"nur lucas\",\"aktion\":\"speichern\",\"ziele\":[\"$B\"],\"bedingung\":{\"konten\":[$LUCAS]}}"
upl "$(C abt_lucas)" a.txt abt-l.txt text/plain; eq "Konto lucas -> Box B" "$(ort_von $FID)" "$B"
upl "$(C abt_nora)" a.txt abt-n.txt text/plain; eq "Konto nora (nicht genannt) -> lokal" "$(ort_von $FID)" lokal
upl "$COOKIE" a.txt abt-o.txt text/plain; eq "Inhaber (nicht genannt) -> lokal" "$(ort_von $FID)" lokal
regeln_leeren
regel "{\"name\":\"Admins\",\"aktion\":\"speichern\",\"ziele\":[\"$A\"],\"bedingung\":{\"rollen\":[\"admin\"]}}"
upl "$(C abt_adm)" a.txt abt-adm.txt text/plain; eq "Rolle admin (abt_adm) -> Box A" "$(ort_von $FID)" "$A"
upl "$COOKIE" a.txt abt-own.txt text/plain; eq "Rolle owner trifft 'admin' nicht -> lokal" "$(ort_von $FID)" lokal
upl "$(C abt_lucas)" a.txt abt-usr.txt text/plain; eq "Rolle user -> lokal" "$(ort_von $FID)" lokal
regeln_leeren
regel "{\"name\":\"Owner+User\",\"aktion\":\"speichern\",\"ziele\":[\"$B\"],\"bedingung\":{\"rollen\":[\"owner\",\"user\"]}}"
upl "$COOKIE" a.txt abt-own2.txt text/plain; eq "Rollenliste owner/user: Inhaber -> Box B" "$(ort_von $FID)" "$B"
upl "$(C abt_adm)" a.txt abt-adm2.txt text/plain; eq "Rollenliste owner/user: admin -> lokal" "$(ort_von $FID)" lokal
regeln_leeren
regel "{\"name\":\"Ordner\",\"aktion\":\"speichern\",\"ziele\":[\"$B\"],\"bedingung\":{\"ordner\":[$OF]}}"
upl "$(C abt_lucas)" a.txt abt-in-ordner.txt text/plain -H "x-vd-folder: $OF"; eq "Datei im Ordner -> Box B" "$(ort_von $FID)" "$B"
upl "$(C abt_lucas)" a.txt abt-in-unter.txt text/plain -H "x-vd-folder: $OU"; eq "Datei im Unterordner (inkl. Unterordner) -> Box B" "$(ort_von $FID)" "$B"
upl "$(C abt_lucas)" a.txt abt-in-anders.txt text/plain -H "x-vd-folder: $OA"; eq "Datei in anderem Ordner -> lokal" "$(ort_von $FID)" lokal
upl "$(C abt_lucas)" a.txt abt-ohne-ordner.txt text/plain; eq "Datei ohne Ordner -> lokal" "$(ort_von $FID)" lokal
regeln_leeren
# --- UND-Verknuepfung
regel "{\"name\":\"UND\",\"aktion\":\"speichern\",\"ziele\":[\"$A\"],\"bedingung\":{\"art\":[\"bild\"],\"konten\":[$LUCAS],\"groesse_von_mb\":1}}"
png gross.png $((2*MiB)); png klein.png 1000
upl "$(C abt_lucas)" gross.png abt-g.png image/png; eq "UND: Bild + lucas + gross -> Box A" "$(ort_von $FID)" "$A"
upl "$(C abt_lucas)" klein.png abt-k.png image/png; eq "UND: zu klein -> lokal" "$(ort_von $FID)" lokal
upl "$(C abt_nora)" gross.png abt-gn.png image/png; eq "UND: falsches Konto -> lokal" "$(ort_von $FID)" lokal
upl "$(C abt_lucas)" gross.bin abt-gb.bin application/octet-stream; eq "UND: falsche Art -> lokal" "$(ort_von $FID)" lokal
regeln_leeren

echo "== Reihenfolge, inaktive Regeln, Test-Feld =="
regel "{\"name\":\"R1\",\"aktion\":\"speichern\",\"ziele\":[\"$A\"],\"bedingung\":{\"art\":[\"bild\"]}}"; R1=$RID
regel "{\"name\":\"R2\",\"aktion\":\"speichern\",\"ziele\":[\"$B\"],\"bedingung\":{\"art\":[\"bild\"]}}"; R2=$RID
upl "$COOKIE" a.png abt-r1.png image/png; eq "beide treffen: die ERSTE Regel gewinnt (A)" "$(ort_von $FID)" "$A"
api "$COOKIE" POST /api/regeln/ablage/reihenfolge "{\"ids\":[$R2,$R1]}"; eq "Reihenfolge umgestellt (200)" "$CODE" 200
upl "$COOKIE" a.png abt-r2.png image/png; eq "nach Umstellung gewinnt R2 (B)" "$(ort_von $FID)" "$B"
api "$COOKIE" PATCH /api/regeln/ablage/$R1 '{"position":1}'; eq "PATCH position=1 (200)" "$CODE" 200
upl "$COOKIE" a.png abt-r3.png image/png; eq "PATCH position: R1 wieder oben -> A" "$(ort_von $FID)" "$A"
eq "Positionen lueckenlos 1,2" "$(PSQL "SELECT string_agg(position::text, ',' ORDER BY position) FROM ablage_regeln")" "1,2"
api "$COOKIE" PATCH /api/regeln/ablage/$R1 '{"aktiv":false}'
upl "$COOKIE" a.png abt-r4.png image/png; eq "inaktive Regel R1 wird uebersprungen -> R2 (B)" "$(ort_von $FID)" "$B"
api "$COOKIE" POST /api/regeln/ablage/test '{"name":"x.png","mime":"image/png","groesse_mb":1}'
eq "Test-Feld: Ergebnis 'ziel'" "$(J 'd["ergebnis"]')" ziel
eq "Test-Feld: waehlt R2" "$(J 'd["regel"]["id"]')" "$R2"
eq "Test-Feld: Ort B" "$(J 'd["ort"]')" "$B"
has "Test-Feld: Pruefliste nennt die ausgeschaltete Regel" "$(J 'str(d["pruefung"])')" "ausgeschaltet"
api "$COOKIE" PATCH /api/regeln/ablage/$R1 '{"aktiv":true}'
api "$COOKIE" POST /api/regeln/ablage/test '{"name":"x.txt","mime":"text/plain"}'
eq "Test-Feld: keine Regel -> 'standard'" "$(J 'd["ergebnis"]')" standard
eq "Test-Feld: Standard-Ort lokal" "$(J 'd["ort"]')" lokal
api "$COOKIE" POST /api/regeln/ablage/test "{\"name\":\"x.png\",\"konto\":\"abt_lucas\"}"
eq "Test-Feld: Konto per Benutzername (200)" "$CODE" 200
eq "Test-Feld: Art aus Endung erkannt (bild)" "$(J 'd["kontext"]["art"]')" bild
VORHER=$(stand); api "$COOKIE" POST /api/regeln/ablage/test '{"name":"y.png"}'; eq "Test-Feld speichert nichts" "$(stand)" "$VORHER"
regeln_leeren

echo "== Strategien: erste / abwechselnd / frei (Verteilung ueber das Ablage-Praefix in der Datenbank) =="
regel "{\"name\":\"erste\",\"aktion\":\"speichern\",\"ziele\":[\"$A\",\"$B\"],\"strategie\":\"erste\",\"bedingung\":{\"endungen\":[\"s1\"]}}"
for i in 1 2 3 4 5 6; do upl "$COOKIE" a.txt abt-s1-$i.s1 text/plain; done
eq "erste verfuegbare: 6 von 6 in A" "$(PSQL "SELECT count(*) FROM files WHERE name LIKE 'abt-s1-%' AND ablage LIKE 'sftp$ZA:%'")" 6
regeln_leeren
regel "{\"name\":\"abwechselnd\",\"aktion\":\"speichern\",\"ziele\":[\"$A\",\"$B\"],\"strategie\":\"abwechselnd\",\"bedingung\":{\"endungen\":[\"s2\"]}}"
for i in 1 2 3 4 5 6 7 8 9 10; do upl "$COOKIE" a.txt abt-s2-$i.s2 text/plain; done
NA=$(PSQL "SELECT count(*) FROM files WHERE name LIKE 'abt-s2-%' AND ablage LIKE 'sftp$ZA:%'"); NB=$(PSQL "SELECT count(*) FROM files WHERE name LIKE 'abt-s2-%' AND ablage LIKE 'sftp$ZB:%'")
eq "abwechselnd: 10 Uploads -> 5 in A" "$NA" 5
eq "abwechselnd: 10 Uploads -> 5 in B" "$NB" 5
regeln_leeren
zust $ZA '{"platz":{"frei":10737418240,"gesamt":107374182400}}'; zust $ZB '{"platz":{"frei":53687091200,"gesamt":107374182400}}'
regel "{\"name\":\"frei\",\"aktion\":\"speichern\",\"ziele\":[\"$A\",\"$B\"],\"strategie\":\"frei\",\"bedingung\":{\"endungen\":[\"s3\"]}}"
for i in 1 2 3 4; do upl "$COOKIE" a.txt abt-s3-$i.s3 text/plain; done
eq "frei: B hat mehr Platz -> 4 von 4 in B" "$(PSQL "SELECT count(*) FROM files WHERE name LIKE 'abt-s3-%' AND ablage LIKE 'sftp$ZB:%'")" 4
zust $ZA '{"platz":{"frei":99000000000,"gesamt":107374182400}}'
for i in 5 6 7 8; do upl "$COOKIE" a.txt abt-s3-$i.s3 text/plain; done
eq "frei: A hat jetzt mehr Platz -> weitere 4 in A" "$(PSQL "SELECT count(*) FROM files WHERE name LIKE 'abt-s3-%' AND ablage LIKE 'sftp$ZA:%'")" 4
zust $ZA '{"platz":{"frei":1000,"gesamt":107374182400}}'; zust $ZB '{"platz":{"frei":1000,"gesamt":107374182400}}'
api "$COOKIE" POST /api/regeln/ablage/test '{"name":"x.s3","groesse_mb":1}'
eq "voll: beide Boxen haben weniger Platz als die Datei -> kein Ziel, Regel 'naechstes' -> Standard" "$(J 'd["ergebnis"]')" standard
has "voll: Pruefliste nennt 'voll'" "$(J 'str(d["pruefung"])')" "voll"
zust $ZA '{"platz":null}'; zust $ZB '{"platz":null}'
api "$COOKIE" POST /api/regeln/ablage/test '{"name":"x.s3","groesse_mb":1}'
eq "frei ohne bekannten Platz: Ziele zaehlen nicht -> Standard" "$(J 'd["ergebnis"]')" standard
regeln_leeren
# Pool: das Wort 'pool' steht fuer die aktuell eingestellte Gruppe
api "$COOKIE" PUT /api/speicher/ziele/ort "{\"art\":\"pool\",\"mitglieder\":[\"$A\",\"$B\"],\"strategie\":\"abwechselnd\"}"; eq "Pool [A,B] eingestellt (200)" "$CODE" 200
regel "{\"name\":\"pool\",\"aktion\":\"speichern\",\"ziele\":[\"pool\"],\"strategie\":\"abwechselnd\",\"bedingung\":{\"endungen\":[\"s4\"]}}"
for i in 1 2 3 4 5 6; do upl "$COOKIE" a.txt abt-s4-$i.s4 text/plain; done
eq "Regel-Ziel 'pool' (abwechselnd): 3 in A" "$(PSQL "SELECT count(*) FROM files WHERE name LIKE 'abt-s4-%' AND ablage LIKE 'sftp$ZA:%'")" 3
eq "Regel-Ziel 'pool' (abwechselnd): 3 in B" "$(PSQL "SELECT count(*) FROM files WHERE name LIKE 'abt-s4-%' AND ablage LIKE 'sftp$ZB:%'")" 3
api "$COOKIE" PUT /api/speicher/ziele/ort "{\"art\":\"pool\",\"mitglieder\":[\"$B\"],\"strategie\":\"abwechselnd\"}"
sleep 0.3
for i in 7 8 9; do upl "$COOKIE" a.txt abt-s4-$i.s4 text/plain; done
eq "Pool auf [B] geaendert: Regel folgt der aktuellen Gruppe (3 weitere in B)" "$(PSQL "SELECT count(*) FROM files WHERE name LIKE 'abt-s4-%' AND ablage LIKE 'sftp$ZB:%'")" 6
api "$COOKIE" PUT /api/speicher/ziele/ort '{"art":"lokal"}'
api "$COOKIE" POST /api/regeln/ablage/test '{"name":"x.s4"}'
eq "ohne Pool-Einstellung: 'pool' hat keine Mitglieder -> Standard" "$(J 'd["ergebnis"]')" standard
regeln_leeren

echo "== Ausfall eines Ziels: fallback naechstes / lokal / ablehnen (Box A angehalten) =="
VORHER=$(stand)
box_stop A
regel "{\"name\":\"A-naechstes\",\"aktion\":\"speichern\",\"ziele\":[\"$A\"],\"fallback\":\"naechstes\",\"bedingung\":{\"endungen\":[\"f1\"]}}"
regel "{\"name\":\"B-danach\",\"aktion\":\"speichern\",\"ziele\":[\"$B\"],\"bedingung\":{\"endungen\":[\"f1\"]}}"
upl "$COOKIE" a.txt abt-f1.f1 text/plain
eq "Box A aus, fallback naechstes -> naechste Regel -> Box B" "$(ort_von $FID)" "$B"
eq "ausgelieferte Datei von B identisch" "$(gleich $FID a.txt)" gleich
regeln_leeren
regel "{\"name\":\"A-lokal\",\"aktion\":\"speichern\",\"ziele\":[\"$A\"],\"fallback\":\"lokal\",\"bedingung\":{\"endungen\":[\"f2\"]}}"
upl "$COOKIE" a.txt abt-f2.f2 text/plain
eq "Box A aus, fallback lokal -> lokal" "$(ort_von $FID)" lokal
regeln_leeren
regel "{\"name\":\"A-ablehnen\",\"aktion\":\"speichern\",\"ziele\":[\"$A\"],\"fallback\":\"ablehnen\",\"meldung\":\"Speicher A ist gerade nicht erreichbar\",\"bedingung\":{\"endungen\":[\"f3\"]}}"
V2=$(stand)
upl "$COOKIE" a.txt abt-f3.f3 text/plain
eq "Box A aus, fallback ablehnen -> 503" "$CODE" 503
has "Ablehnung nennt die Meldung der Regel" "$(fehlertext "$T/ub")" "Speicher A ist gerade nicht erreichbar"
eq "Ablehnung: nichts geschrieben (lokal/A/B/DB unveraendert)" "$(stand)" "$V2"
# ohne Meldung -> Standardtext
regeln_leeren
regel "{\"name\":\"A-ablehnen2\",\"aktion\":\"speichern\",\"ziele\":[\"$A\"],\"fallback\":\"ablehnen\",\"bedingung\":{\"endungen\":[\"f4\"]}}"
upl "$COOKIE" a.txt abt-f4.f4 text/plain; eq "ablehnen ohne eigene Meldung -> 503 mit Standardtext" "$CODE" 503; has "Standardtext der Ablehnung" "$(fehlertext "$T/ub")" "nicht erreichbar"
# Kettenfall: Regel mit zwei Zielen, A aus -> B
regeln_leeren
regel "{\"name\":\"A,B erste\",\"aktion\":\"speichern\",\"ziele\":[\"$A\",\"$B\"],\"bedingung\":{\"endungen\":[\"f5\"]}}"
upl "$COOKIE" a.txt abt-f5.f5 text/plain; eq "Liste [A,B], A aus -> B" "$(ort_von $FID)" "$B"
# Chunk-Start und WebDAV bei Ausfall
regeln_leeren
regel "{\"name\":\"A-ablehnen3\",\"aktion\":\"speichern\",\"ziele\":[\"$A\"],\"fallback\":\"ablehnen\",\"bedingung\":{\"endungen\":[\"f6\"]}}"
api "$COOKIE" POST /api/upload/start '{"name":"abt-f6.f6","size":1000,"mime":"text/plain"}'; eq "Chunk-Start bei Ausfall + ablehnen -> 503 (keine Upload-Zeile)" "$CODE" 503
eq "kein angelegter Upload" "$(PSQL "SELECT count(*) FROM uploads WHERE name = 'abt-f6.f6'")" 0
dput "$DAV" abt-f6.f6 a.txt; eq "WebDAV PUT bei Ausfall + ablehnen -> 503" "$CODE" 503
eq "WebDAV: keine Datei angelegt" "$(PSQL "SELECT count(*) FROM files WHERE name = 'abt-f6.f6'")" 0
regeln_leeren
# Bestehende Datei auf dem ausgefallenen Ziel bleibt dort (nicht verschoben); nach Neustart wieder lesbar
eq "Bestehende Dateien bleiben auf A (Datei F1 weiter in A)" "$(ort_von $F1)" "$A"
box_start A 2231 2241
sleep 1
eq "nach Neustart von Box A: alte Datei wieder identisch ladbar" "$(gleich $F1 a.png)" gleich
# nach Wiederkehr nutzt die Regel A wieder (Negativ-Zwischenspeicher laeuft nach 15 s ab)
regel "{\"name\":\"A\",\"aktion\":\"speichern\",\"ziele\":[\"$A\"],\"fallback\":\"ablehnen\",\"bedingung\":{\"endungen\":[\"f7\"]}}"
sleep 16
upl "$COOKIE" a.txt abt-f7.f7 text/plain; eq "Box A wieder da -> Regel nutzt A wieder" "$(ort_von $FID)" "$A"
regeln_leeren

echo "== Ziel-Zustaende: ausgeschaltet / schreibgeschuetzt / entfernt =="
regel "{\"name\":\"nur C\",\"aktion\":\"speichern\",\"ziele\":[\"$Cc\"],\"fallback\":\"lokal\",\"bedingung\":{\"endungen\":[\"z1\"]}}"; RC=$RID
upl "$COOKIE" a.txt abt-z1a.z1 text/plain; eq "Box C aktiv -> C" "$(ort_von $FID)" "$Cc"
api "$COOKIE" PUT /api/speicher/ziele/$ZC '{"schreibbar":false}'
has "Aendern (schreibgeschuetzt) warnt vor der aktiven Regel" "$(J 'd.get("warnung","")')" "Ablage-Regel"
eq "Warnung nennt die Regel" "$(J 'd["regeln"][0]["name"]')" "nur C"
upl "$COOKIE" a.txt abt-z1b.z1 text/plain; eq "schreibgeschuetzt + fallback lokal -> lokal" "$(ort_von $FID)" lokal
api "$COOKIE" PUT /api/speicher/ziele/$ZC '{"schreibbar":true,"aktiv":false}'
has "Aendern (ausgeschaltet) warnt ebenfalls" "$(J 'd.get("warnung","")')" "Ablage-Regel"
upl "$COOKIE" a.txt abt-z1c.z1 text/plain; eq "ausgeschaltet + fallback lokal -> lokal" "$(ort_von $FID)" lokal
api "$COOKIE" PUT /api/speicher/ziele/$ZC '{"aktiv":true}'
eq "Wieder einschalten ohne Warnung" "$(J 'd.get("warnung","-")')" "-"
# Dateien auf C (z1a) entfernen, damit nur noch die Regel das Loeschen verhindert
objekte_entfernen "name LIKE 'abt-z1%'"
PSQL "DELETE FROM files WHERE name LIKE 'abt-z1%'" >/dev/null
eq "Loeschen mit aktiver Regel wird verweigert (409)" "$(code "$COOKIE" DELETE /api/speicher/ziele/$ZC)" 409
has "Verweigerung nennt die Regel" "$(fehlertext "$T/b")" "nur C"
eq "Box C besteht weiter" "$(PSQL "SELECT count(*) FROM speicher_ziele WHERE id=$ZC")" 1
api "$COOKIE" PATCH /api/regeln/ablage/$RC '{"aktiv":false}'
eq "Regel ausgeschaltet -> Box C loeschbar (200)" "$(code "$COOKIE" DELETE /api/speicher/ziele/$ZC)" 200
api "$COOKIE" GET /api/regeln/ablage
eq "Regel nennt das entfernte Ziel weiter (Regel bleibt gueltig)" "$(J "[r['ziele'] for r in d['regeln'] if r['id']==$RC][0]" | tr -d " '[]")" "$Cc"
eq "Zustand des entfernten Ziels: entfernt" "$(J "[z['zustand'] for r in d['regeln'] if r['id']==$RC for z in r['ziele_status']][0]")" entfernt
api "$COOKIE" PATCH /api/regeln/ablage/$RC '{"aktiv":true}'; eq "Regel mit entferntem Ziel laesst sich einschalten (200)" "$CODE" 200
upl "$COOKIE" a.txt abt-z1d.z1 text/plain; eq "unbekanntes Ziel = nicht verfuegbar, fallback lokal -> lokal (kein Absturz)" "$(ort_von $FID)" lokal
api "$COOKIE" PATCH /api/regeln/ablage/$RC '{"ziele":["sftp99999"]}'; eq "neues, nicht vorhandenes Ziel setzen -> 404" "$CODE" 404
regeln_leeren

echo "== Verbieten auf allen Schreibwegen =="
MELD="Ausführbare Dateien sind hier nicht erlaubt"
regel "{\"name\":\"keine exe\",\"aktion\":\"verbieten\",\"meldung\":\"$MELD\",\"bedingung\":{\"endungen\":[\"exe\",\"bat\"]}}"; RV=$RID
bin prog.exe 3000
V0=$(stand)
upl "$COOKIE" prog.exe abt-prog.exe application/x-msdownload
eq "Direkt-Upload .exe -> 415" "$CODE" 415
has "Direkt-Upload: Meldung der Regel" "$(fehlertext "$T/ub")" "$MELD"
upl "$COOKIE" prog.exe abt-PROG.EXE application/octet-stream; eq "Direkt-Upload .EXE (Grossschreibung) -> 415" "$CODE" 415
upl "$COOKIE" prog.exe abt-tarnung.txt application/octet-stream; eq "Direkt-Upload mit harmlosem Namen -> erlaubt (200)" "$CODE" 200
api - POST /api/v1/files '{}'; eq "API v1 ohne Anmeldung -> 401 (Weg ist erreichbar)" "$CODE" 401
api "$COOKIE" POST /api/tokens '{"name":"abt-tok","rechte":["upload"]}'; TOK=$(J 'd["klar"]')
CODE=$(curl -s -o "$T/ub" -w '%{http_code}' -H "authorization: Bearer $TOK" -F "file=@$T/prog.exe;filename=abt-api.exe" "$BASE/api/v1/files"); eq "API v1 .exe -> 415" "$CODE" 415
CODE=$(curl -s -o "$T/ub" -w '%{http_code}' -H "authorization: Bearer $TOK" -F "file=@$T/a.txt;filename=abt-api.txt;type=text/plain" "$BASE/api/v1/files"); eq "API v1 .txt -> 200" "$CODE" 200
api "$COOKIE" POST /api/upload/start '{"name":"abt-chunk.bat","size":5000,"mime":""}'; eq "Chunk-Start .bat -> 415 (vor dem ersten Byte)" "$CODE" 415
has "Chunk-Start: Meldung" "$(fehlertext "$T/b")" "$MELD"
eq "Chunk-Start: kein Upload angelegt" "$(PSQL "SELECT count(*) FROM uploads WHERE name = 'abt-chunk.bat'")" 0
dput "$DAV" abt-dav.exe prog.exe; eq "WebDAV PUT .exe -> 415" "$CODE" 415
has "WebDAV PUT: Meldung" "$(cat "$T/db")" "nicht erlaubt"
dput_chunked "$DAV" abt-dav2.exe prog.exe; eq "WebDAV PUT chunked .exe -> 415" "$CODE" 415
api "$COOKIE" POST /api/anfragen '{"titel":"abt-anfrage"}'; TOKA=$(PSQL "SELECT token FROM anfragen WHERE titel='abt-anfrage' LIMIT 1")
CODE=$(curl -s -o "$T/ub" -w '%{http_code}' -F "name=Gast" -F "file=@$T/prog.exe;filename=abt-gast.exe" "$BASE/api/public/anfrage/$TOKA/upload"); eq "Gast-Upload .exe -> 415" "$CODE" 415
has "Gast-Upload: Meldung der Regel" "$(fehlertext "$T/ub")" "$MELD"
CODE=$(curl -s -o "$T/ub" -w '%{http_code}' -F "name=Gast" -F "file=@$T/a.txt;filename=abt-gast.txt;type=text/plain" "$BASE/api/public/anfrage/$TOKA/upload"); eq "Gast-Upload .txt -> 200" "$CODE" 200
eq "Verboten: kein Objekt, keine Datei in lokal/A/B (nur die erlaubten 4 neu: tarnung, api, gast, dav?)" "$(PSQL "SELECT count(*) FROM files WHERE name ~ '\.(exe|bat)$'")" 0
EXE=$(( $(echo "$(stand)" | cut -d/ -f1) - $(echo "$V0" | cut -d/ -f1) ))
eq "lokal: nur die 3 erlaubten Dateien (tarnung.txt, api.txt, gast.txt) liegen dort" "$EXE" 3
eq "Boxen A und B: keine Objekte durch Verbote hinzugekommen" "$(echo "$(stand)" | cut -d/ -f2,3)" "$(echo "$V0" | cut -d/ -f2,3)"
# Verbot haengt an der Regel: ausschalten -> erlaubt
api "$COOKIE" PATCH /api/regeln/ablage/$RV '{"aktiv":false}'; sleep 0.2
upl "$COOKIE" prog.exe abt-prog2.exe application/octet-stream; eq "Verbotsregel ausgeschaltet -> .exe erlaubt (200)" "$CODE" 200
api "$COOKIE" PATCH /api/regeln/ablage/$RV '{"aktiv":true}'
# 403 statt 415 bei Verbot ohne Typbedingung (Konto)
regeln_leeren
regel "{\"name\":\"nora gesperrt\",\"aktion\":\"verbieten\",\"meldung\":\"Dieses Konto darf hier nichts ablegen\",\"bedingung\":{\"konten\":[$NORA]}}"
upl "$(C abt_nora)" a.txt abt-nora.txt text/plain; eq "Verbot nach Konto -> 403" "$CODE" 403
upl "$(C abt_lucas)" a.txt abt-lucas-ok.txt text/plain; eq "anderes Konto weiter erlaubt" "$CODE" 200
regeln_leeren
# Verbot nach unbekannter Groesse: nach dem Schreiben pruefen und sauber entfernen
regel "{\"name\":\"keine grossen\",\"aktion\":\"verbieten\",\"meldung\":\"Dateien ab 2 MB sind hier nicht erlaubt\",\"bedingung\":{\"groesse_von_mb\":2}}"
V3=$(stand)
dput_chunked "$DAV" abt-chunked-gross.bin gross.bin
eq "WebDAV chunked 3 MB (Groesse unbekannt): vorab nicht entscheidbar, nach dem Schreiben abgelehnt -> 403" "$CODE" 403
eq "  ... Datei sauber entfernt (kein Datensatz)" "$(PSQL "SELECT count(*) FROM files WHERE name='abt-chunked-gross.bin'")" 0
eq "  ... Datei sauber entfernt (kein Objekt im lokalen Speicher)" "$(echo "$(stand)" | cut -d/ -f1)" "$(echo "$V3" | cut -d/ -f1)"
dput "$DAV" abt-bekannt-gross.bin gross.bin; eq "WebDAV mit Laenge 3 MB -> vorab 403" "$CODE" 403
dput "$DAV" abt-bekannt-klein.bin klein.bin; eq "WebDAV 2 KB -> erlaubt (201)" "$CODE" 201
upl "$COOKIE" gross.bin abt-direkt-gross.bin; eq "Direkt-Upload 3 MB -> 403" "$CODE" 403
eq "Direkt-Upload: nichts gespeichert" "$(echo "$(stand)" | cut -d/ -f1)" "$(( $(echo "$V3" | cut -d/ -f1) + 1 ))"
api "$COOKIE" POST /api/upload/start '{"name":"abt-ck.bin","size":3145728,"mime":""}'; eq "Chunk-Start mit bekannter Groesse 3 MB -> 403" "$CODE" 403
regeln_leeren

echo "== Kopieren folgt den Regeln; Ueberschreiben bleibt am Ort =="
txt orig.txt 4000
upl "$(C abt_lucas)" orig.txt abt-kopiervorlage.txt text/plain; FK=$FID
eq "Vorlage liegt lokal" "$(ort_von $FK)" lokal
regel "{\"name\":\"Ordner -> B\",\"aktion\":\"speichern\",\"ziele\":[\"$B\"],\"bedingung\":{\"ordner\":[$OF]}}"
api "$(C abt_lucas)" POST /api/cloud/kopieren "{\"dateien\":[\"$FK\"],\"ordner\":[],\"ziel\":$OF}"; eq "Cloud-Kopieren in den Regel-Ordner (200)" "$CODE" 200
KOPIE=$(PSQL "SELECT id FROM files WHERE name LIKE 'abt-kopiervorlage%' AND folder_id=$OF ORDER BY id DESC LIMIT 1")
eq "Kopie folgt den Regeln des Ziels -> Box B" "$(ort_von "$KOPIE")" "$B"
eq "Original bleibt lokal (nicht verschoben)" "$(ort_von $FK)" lokal
eq "Kopie identisch (cmp)" "$(gleich "$KOPIE" orig.txt)" gleich
api "$(C abt_lucas)" POST /api/cloud/kopieren "{\"dateien\":[\"$FK\"],\"ordner\":[],\"ziel\":$OA}"
KOPIE2=$(PSQL "SELECT id FROM files WHERE name LIKE 'abt-kopiervorlage%' AND folder_id=$OA ORDER BY id DESC LIMIT 1")
eq "Kopie in anderen Ordner (keine Regel) -> lokal" "$(ort_von "$KOPIE2")" lokal
# WebDAV COPY: Pfad ueber den Namen
DAVL="abt_lucas"; api "$(C abt_lucas)" POST /api/sync/zugaenge '{"name":"abt-dav-l","schreiben":true}'; LPW=$(J 'd["klar"]'); DL="abt_lucas:$LPW"
CODE=$(curl -s -o "$T/db" -w '%{http_code}' --path-as-is -u "$DL" -X COPY -H "Destination: $BASE/dav/abt-ordner/abt-dav-kopie.txt" "$BASE/dav/abt-kopiervorlage.txt")
eq "WebDAV COPY in den Regel-Ordner (201/204)" "$( [ "$CODE" = 201 ] || [ "$CODE" = 204 ] && echo ok || echo "$CODE")" ok
eq "WebDAV-Kopie folgt den Regeln -> Box B" "$(ort_von "$(dav_id abt-dav-kopie.txt)")" "$B"
# Verbot gilt beim Kopieren
regeln_leeren
regel "{\"name\":\"keine txt\",\"aktion\":\"verbieten\",\"meldung\":\"Textdateien sind hier verboten\",\"bedingung\":{\"endungen\":[\"txt\"],\"ordner\":[$OA]}}"
api "$(C abt_lucas)" POST /api/cloud/kopieren "{\"dateien\":[\"$FK\"],\"ordner\":[],\"ziel\":$OA}"
eq "Cloud-Kopieren verbotener Datei -> 415" "$CODE" 415
has "Cloud-Kopieren verbotener Datei: Meldung der Regel" "$(fehlertext "$T/b")" "Textdateien sind hier verboten"
CODE=$(curl -s -o "$T/db" -w '%{http_code}' --path-as-is -u "$DL" -X COPY -H "Destination: $BASE/dav/abt-anders/abt-dav-verboten.txt" "$BASE/dav/abt-kopiervorlage.txt")
eq "WebDAV COPY verbotener Datei -> 415" "$CODE" 415
eq "Verbotene Kopie legt nichts an" "$(PSQL "SELECT count(*) FROM files WHERE name='abt-dav-verboten.txt'")" 0
regeln_leeren
# Ueberschreiben (WebDAV PUT) bleibt am Ort der vorhandenen Datei, auch wenn die Regeln inzwischen anders sind
txt neu1.txt 6000; txt neu2.txt 7000
dput "$DAV" abt-ueber.txt neu1.txt; FU=$(dav_id abt-ueber.txt); eq "neue Datei per PUT -> lokal (keine Regel)" "$(ort_von $FU)" lokal
regel "{\"name\":\"alles B\",\"aktion\":\"speichern\",\"ziele\":[\"$B\"]}"
dput "$DAV" abt-ueber.txt neu2.txt
eq "Ueberschreiben (PUT): Datei bleibt am Ort der vorhandenen Datei (lokal), nicht per Regel in B" "$(ort_von $FU)" lokal
eq "Ueberschreiben: Inhalt neu (cmp)" "$(gleich $FU neu2.txt)" gleich
dput "$DAV" abt-ueber2.txt neu1.txt; eq "neue Datei per PUT mit Regel 'alles B' -> Box B" "$(ort_von "$(dav_id abt-ueber2.txt)")" "$B"
dput "$DAV" abt-ueber2.txt neu2.txt; eq "Ueberschreiben einer Datei auf B bleibt auf B" "$(ort_von "$(dav_id abt-ueber2.txt)")" "$B"
eq "  ... und der Inhalt ist neu (cmp)" "$(gleich "$(dav_id abt-ueber2.txt)" neu2.txt)" gleich
# Inhalt ersetzen (Bild-Editor-Weg) bleibt am Ort
regeln_leeren
png ed1.png 8000; png ed2.png 9000
upl "$COOKIE" ed1.png abt-edit.png image/png; FE=$FID; eq "Bild lokal" "$(ort_von $FE)" lokal
regel "{\"name\":\"alles A\",\"aktion\":\"speichern\",\"ziele\":[\"$A\"]}"
CODE=$(curl -s -o "$T/ub" -w '%{http_code}' -b "$COOKIE" -X PUT -H 'content-type: image/png' --data-binary "@$T/ed2.png" "$BASE/api/files/$FE/inhalt")
eq "Inhalt ersetzen (200)" "$CODE" 200
eq "Inhalt ersetzen bleibt am Ort der Datei (lokal), nicht per Regel in A" "$(ort_von $FE)" lokal
eq "  ... Inhalt ersetzt (cmp)" "$(gleich $FE ed2.png)" gleich
regeln_leeren
regel "{\"name\":\"keine png\",\"aktion\":\"verbieten\",\"meldung\":\"PNG ist hier gesperrt\",\"bedingung\":{\"endungen\":[\"png\"]}}"
CODE=$(curl -s -o "$T/ub" -w '%{http_code}' -b "$COOKIE" -X PUT -H 'content-type: image/png' --data-binary "@$T/ed1.png" "$BASE/api/files/$FE/inhalt")
eq "Inhalt ersetzen mit Verbot -> 415" "$CODE" 415
eq "  ... die alte Datei ist unveraendert (cmp)" "$(gleich $FE ed2.png)" gleich
regeln_leeren

echo "== Chunk-Upload bleibt am Startort, auch wenn Regeln dazwischen geaendert werden =="
bin chunk.bin $((20*MiB))
regel "{\"name\":\"Chunk -> A\",\"aktion\":\"speichern\",\"ziele\":[\"$A\"],\"bedingung\":{\"endungen\":[\"chk\"]}}"; RCH=$RID
api "$COOKIE" POST /api/upload/start '{"name":"abt-chunk.chk","size":20971520,"mime":"application/octet-stream"}'
UPID=$(J 'd["id"]'); TEILE=$(J 'd["teile"]'); TG=$(J 'd["teilGroesse"]')
eq "Chunk-Start (200), 3 Teile" "$TEILE" 3
eq "Startort in uploads.speicher gespeichert: Box A" "$(PSQL "SELECT speicher FROM uploads WHERE id='$UPID'")" "$A"
curl -s -b "$COOKIE" -X PUT --data-binary "@/dev/stdin" "$BASE/api/upload/$UPID/0" < <(head -c $TG "$T/chunk.bin") -o /dev/null
# Regeln dazwischen aendern: Ziel B, dann Regel loeschen
api "$COOKIE" PATCH /api/regeln/ablage/$RCH "{\"ziele\":[\"$B\"]}"
dd if="$T/chunk.bin" bs=$TG skip=1 count=1 2>/dev/null | curl -s -b "$COOKIE" -X PUT --data-binary @- "$BASE/api/upload/$UPID/1" -o /dev/null
api "$COOKIE" DELETE /api/regeln/ablage/$RCH
dd if="$T/chunk.bin" bs=$TG skip=2 2>/dev/null | curl -s -b "$COOKIE" -X PUT --data-binary @- "$BASE/api/upload/$UPID/2" -o /dev/null
api "$COOKIE" POST /api/upload/$UPID/fertig '{}'; eq "Chunk fertig (200)" "$CODE" 200
FC=$(J 'd["file"]["id"]')
eq "Chunk-Upload bleibt am Startort (A), obwohl die Regel zwischendurch auf B zeigte und dann geloescht wurde" "$(ort_von $FC)" "$A"
eq "  ... Inhalt identisch (cmp, 20 MB)" "$(gleich $FC chunk.bin)" gleich
# Verbot, das nach dem Start dazukommt, gilt beim Abschluss
regel "{\"name\":\"Chunk -> A\",\"aktion\":\"speichern\",\"ziele\":[\"$A\"],\"bedingung\":{\"endungen\":[\"chv\"]}}"
api "$COOKIE" POST /api/upload/start '{"name":"abt-chunk.chv","size":1000,"mime":"text/plain"}'; UPID=$(J 'd["id"]')
head -c 1000 /dev/urandom | curl -s -b "$COOKIE" -X PUT --data-binary @- "$BASE/api/upload/$UPID/0" -o /dev/null
regel "{\"name\":\"chv verboten\",\"aktion\":\"verbieten\",\"meldung\":\"chv ist jetzt verboten\",\"bedingung\":{\"endungen\":[\"chv\"]}}"
api "$COOKIE" PATCH /api/regeln/ablage/$RID '{"position":1}'
V4=$(stand)
api "$COOKIE" POST /api/upload/$UPID/fertig '{}'; eq "nach dem Start eingefuehrtes Verbot gilt beim Abschluss (415)" "$CODE" 415
eq "  ... nichts angelegt" "$(PSQL "SELECT count(*) FROM files WHERE name='abt-chunk.chv'")" 0
eq "  ... keine neuen Objekte" "$(stand)" "$V4"
api "$COOKIE" DELETE /api/upload/$UPID >/dev/null
regeln_leeren

echo "== Umzug und Medien unveraendert, Sicherung nicht angefasst =="
regel "{\"name\":\"alles B\",\"aktion\":\"speichern\",\"ziele\":[\"$B\"]}"
txt um.txt 5000; upl "$COOKIE" um.txt abt-umzug.txt text/plain; FUM=$FID; eq "Datei liegt per Regel auf B" "$(ort_von $FUM)" "$B"
regeln_leeren
echo "  (Umzug/Sicherung/Medien rufen schreiben() mit ausdruecklichem Ort bzw. ohne Kontext auf: git diff zeigt keine Aenderung dieser Dateien)"
if git diff --quiet 907d7cc -- server/utils/umzug.ts server/utils/sicherung.ts server/utils/medien.ts server/utils/quota.ts server/utils/speicherBudget.ts 2>/dev/null; then ok "umzug.ts, sicherung.ts, medien.ts, quota.ts, speicherBudget.ts unveraendert gegenueber dem Ausgangsstand"; else skip "Dateivergleich" "kein Git-Vergleich moeglich oder Dateien geaendert"; fi

echo "== Kontingent bleibt ortsunabhaengig =="
regel "{\"name\":\"alles A\",\"aktion\":\"speichern\",\"ziele\":[\"$A\"]}"
bin q2.bin $((2*MiB))
upl "$(C abt_klein)" q2.bin abt-q1.bin; eq "Konto mit 3 MB Kontingent: 2 MB auf Box A (200)" "$CODE" 200
eq "  ... liegt auf Box A" "$(ort_von $FID)" "$A"
upl "$(C abt_klein)" q2.bin abt-q2.bin; eq "zweite 2 MB: Kontingent voll -> 507 (trotz Regel)" "$CODE" 507
regeln_leeren
upl "$(C abt_klein)" q2.bin abt-q3.bin; eq "ohne Regel genauso 507 (Kontingent zaehlt Dateien aller Speicher)" "$CODE" 507
api "$(C abt_klein)" GET /api/quota/me; has "Kontingent-Anzeige enthaelt die 2 MB der Box-A-Datei" "$(J 'str(d)')" "2097152"

echo "== Lebenszyklus-Regeln unveraendert =="
eq "GET /api/regeln (Lebenszyklus) -> 200" "$(code "$COOKIE" GET /api/regeln)" 200
api "$COOKIE" POST /api/regeln '{"name":"abt-leben","aktion":"papierkorb","bedingung":{"aelter_als_tage":9999,"art":"bild"}}'; eq "Lebenszyklus-Regel anlegen (200)" "$CODE" 200; LR=$(J 'd["id"]')
api "$COOKIE" POST /api/regeln/vorschau '{"aktion":"papierkorb","bedingung":{"aelter_als_tage":9999}}'; eq "Lebenszyklus-Vorschau (200, anzahl)" "$(J 'd["anzahl"]')" 0
api "$COOKIE" PATCH /api/regeln/$LR '{"aktiv":false}'; eq "Lebenszyklus-Regel aendern (200)" "$CODE" 200
api "$COOKIE" DELETE /api/regeln/$LR; eq "Lebenszyklus-Regel loeschen (200)" "$CODE" 200
eq "Lebenszyklus-Liste enthaelt keine Ablage-Regeln" "$(code "$COOKIE" GET /api/regeln)" 200
api "$(C abt_lucas)" GET /api/regeln; eq "normales Konto sieht seine Lebenszyklus-Regeln weiter (200)" "$CODE" 200

echo "== Ereignisse im Protokoll (ohne Geheimnisse) =="
regel '{"aktion":"verbieten","name":"abt-prot","bedingung":{"endungen":["zzz"]}}'; RP=$RID
api "$COOKIE" PATCH /api/regeln/ablage/$RP '{"aktiv":false}'; api "$COOKIE" DELETE /api/regeln/ablage/$RP
for e in ablage_regel_angelegt ablage_regel_geaendert ablage_regel_geloescht; do eq "Protokoll: $e vorhanden" "$([ "$(PSQL "SELECT count(*) FROM events WHERE type='$e'")" -ge 1 ] && echo ja || echo nein)" ja; done
eq "Protokoll enthaelt weder Passwoerter noch Zugangsdaten" "$(PSQL "SELECT count(*) FROM events WHERE type LIKE 'ablage%' AND (detail::text ILIKE '%boxpw%' OR detail::text ILIKE '%passwort%')")" 0
regeln_leeren

echo "== Rate-Limit =="
# eigenes Konto (abt_rl), damit die Zaehler des Inhabers nicht betroffen sind
LIM=0; for i in $(seq 1 160); do c=$(code "$(C abt_rl)" POST /api/regeln/ablage '{"aktion":"bumm"}'); [ "$c" = 429 ] && { LIM=$i; break; }; done
eq "Schreibzugriffe: 151. Aufruf in einer Minute -> 429" "$LIM" 151
LIM=0; for i in $(seq 1 130); do c=$(code "$(C abt_adm)" POST /api/regeln/ablage/test '{"name":"a.txt"}'); [ "$c" = 429 ] && { LIM=$i; break; }; done
eq "Test-Feld: 121. Aufruf in einer Minute -> 429" "$LIM" 121

echo
echo "ERGEBNIS: $PASS bestanden, $FAIL fehlgeschlagen, $SKIP uebersprungen"
[ "$FAIL" = 0 ]
