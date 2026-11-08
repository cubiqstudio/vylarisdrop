#!/usr/bin/env bash
# API-Tests fuer "Selbstbedienung im Rahmen des Kontingents": Storage-Boxen und S3-Buckets duerfen nie mehr einplanen,
# als dem Konto noch frei ist (server/utils/speicherBudget.ts). curl-, python3- und psql-basiert, PASS/FAIL je Fall.
#
# Aufruf:  scripts/test-speicher-budget.sh [Basis-URL] [Cookie-Datei des Inhabers] [DB-Name]
#   Standard: http://127.0.0.1:3322  /tmp/vdt-vd_sq/cookie.txt  vd_sq   (PostgreSQL: 127.0.0.1:$PGPORT_, Standard 54322, Trust)
# Voraussetzung: Die App laeuft mit dem Stub fuer SFTPGo/Garage (scripts/stub-speicherdienste.mjs, Steuerung unter
#   $STUB, Standard http://127.0.0.1:33221/__stub). Start der App dafuer:
#     node scripts/stub-speicherdienste.mjs 33221 33222 33223 &
#     VD_SFTPGO_URL=http://127.0.0.1:33221 VD_SFTPGO_WEBDAV=http://127.0.0.1:33221 VD_GARAGE_URL=http://127.0.0.1:33222 \
#     VD_GARAGE_S3=http://127.0.0.1:33223 VD_SFTPGO_ADMIN_PW=sftpgo-test-pw VD_GARAGE_ADMIN_TOKEN=garage-test-token \
#     VD_SPEICHER_DIR=<Datenordner>/speicher VD_SPEICHER_SFTPGO_DIR=<Datenordner>/sftpgo  (App starten wie sonst)
# Das Skript legt Testkonten (sbt_*) an, setzt die Speicher-Einstellungen und raeumt am Ende alles wieder auf.
set -u
BASE="${1:-http://127.0.0.1:3322}"
COOKIE="${2:-/tmp/vdt-vd_sq/cookie.txt}"
DB="${3:-vd_sq}"
PGPORT_="${PGPORT_:-54322}"
STUB="${STUB:-http://127.0.0.1:33221/__stub}"
DATEN="${DATEN:-/tmp/vdt-$DB}"
SFTPGO_PW="${SFTPGO_PW:-sftpgo-test-pw}"
GARAGE_TOKEN="${GARAGE_TOKEN:-garage-test-token}"
SUF='Sbt-Test-Passwort-2026!'
MiB=1048576
T="$(mktemp -d)"
PASS=0; FAIL=0
PSQL() { psql -h 127.0.0.1 -p "$PGPORT_" -U postgres -tA "$DB" -c "$1" 2>&1; }

ok()   { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf 'FAIL  %s  -- %s\n' "$1" "${2:-}"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1" "ist '$2', erwartet '$3'"; fi; }
has()  { if printf '%s' "$2" | grep -qF -- "$3"; then ok "$1"; else fail "$1" "'$3' fehlt in: $(printf '%s' "$2" | head -c 200)"; fi; }
hasnt(){ if printf '%s' "$2" | grep -qF -- "$3"; then fail "$1" "'$3' ist enthalten"; else ok "$1"; fi; }
# api <Cookie|-> <Methode> <Pfad> [JSON-Body]   ->  CODE, $T/b (Antwort); jede Antwort wird zusaetzlich in $T/alle gesammelt
api() {
  local c="$1" m="$2" p="$3" body="${4:-}"
  local args=(-s -o "$T/b" -w '%{http_code}' -X "$m")
  [ "$c" != "-" ] && args+=(-b "$c")
  [ -n "$body" ] && args+=(-H 'content-type: application/json' -d "$body")
  CODE=$(curl "${args[@]}" "$BASE$p")
  cat "$T/b" >> "$T/alle"; echo >> "$T/alle"
}
# J <python-Ausdruck mit d = Antwort>
J() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))' "$T/b" "$1" 2>/dev/null; }
# SJ <python-Ausdruck mit d = Zustand des Stubs>
SJ() { curl -s "$STUB/state" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))' "$1" 2>/dev/null; }
stub() { curl -s -X POST -H 'content-type: application/json' -d "${2:-{\}}" "$STUB/$1" >/dev/null; }
code() { api "$@"; echo "$CODE"; }
mk_user() { # <name> <quota_bytes|null> [rolle]
  api "$COOKIE" POST /api/users "{\"username\":\"$1\",\"email\":\"$1@example.com\",\"password\":\"$SUF\",\"role\":\"${3:-user}\",\"quota_bytes\":$2}"
  UID_[$1]=$(J 'd["user"]["id"]')
  curl -s -c "$T/c-$1" -H 'content-type: application/json' -d "{\"username\":\"$1\",\"password\":\"$SUF\"}" "$BASE/api/auth/login" >/dev/null
}
declare -A UID_
C() { echo "$T/c-$1"; }
einst() { api "$COOKIE" PUT /api/speicher/einstellungen "{\"wer\":\"$1\",\"grenzeGb\":$2,\"maxAnzahl\":$3}"; }
box() { api "$(C $1)" POST /api/speicher/boxen "{\"name\":\"$2\",\"kontingentBytes\":$3}"; }
bucket() { api "$(C $1)" POST /api/speicher/buckets "{\"name\":\"$2\",\"kontingentBytes\":$3}"; }
datei() { head -c "$2" /dev/zero > "$T/$1"; }
upl() { # <user> <Datei> -> HTTP-Code
  curl -s -o "$T/ub" -w '%{http_code}' -b "$(C $1)" -F "file=@$T/$2" "$BASE/api/upload"
}
eingeplant_db() { PSQL "SELECT (SELECT coalesce(sum(kontingent),0) FROM speicher_boxen WHERE user_id=$1) + (SELECT coalesce(sum(kontingent),0) FROM speicher_buckets WHERE user_id=$1)"; }
anzahl_db() { PSQL "SELECT (SELECT count(*) FROM speicher_boxen WHERE user_id=$1) + (SELECT count(*) FROM speicher_buckets WHERE user_id=$1)"; }

cleanup() {
  PSQL "DELETE FROM users WHERE username LIKE 'sbt\_%'" >/dev/null
  PSQL "DELETE FROM settings WHERE key = 'speicherdienst'" >/dev/null
  curl -s -X POST "$STUB/ausfall" -d '{"an":false}' -H 'content-type: application/json' >/dev/null
  stub reset
  rm -rf "$T"
}
trap cleanup EXIT

echo "== Vorbereitung =="
curl -sf "$BASE/api/public/health" >/dev/null || { echo "Instanz unter $BASE nicht erreichbar"; exit 2; }
curl -sf "$STUB/state" >/dev/null || { echo "Stub unter $STUB nicht erreichbar (scripts/stub-speicherdienste.mjs)"; exit 2; }
PSQL "DELETE FROM users WHERE username LIKE 'sbt\_%'" >/dev/null
stub reset
: > "$T/alle"
einst alle 0 0
eq "Einstellung wer=alle, keine Zusatzgrenzen" "$CODE" 200
Q=$((100*MiB))
for n in alice bob carol dave eve frank grace; do mk_user sbt_$n $Q; done

# ============================================================================
echo "== 1. Anlegen bis genau zur Grenze, ein Byte mehr nicht =="
A=sbt_alice
api "$(C $A)" GET /api/speicher
eq "Budget vorher: Kontingent 100 MiB" "$(J 'd["budget"]["limit"]')" "$Q"
eq "Budget vorher: frei 100 MiB" "$(J 'd["budget"]["frei"]')" "$Q"
eq "darfAnlegen (wer=alle)" "$(J 'd["darfAnlegen"]')" "True"
box $A "Box A" $((60*MiB)); eq "Box 60 MiB angelegt" "$CODE" 200
BOXA=$(J 'd["box"]["id"]'); KENN=$(J 'd["box"]["kennung"]'); PWA=$(J 'd["passwort"]')
eq "Kennung: vd + 10 zufaellige Zeichen" "$(printf '%s' "$KENN" | grep -cE '^vd[a-z0-9]{10}$')" 1
api "$(C $A)" GET /api/speicher
eq "frei nach Box: 40 MiB" "$(J 'd["budget"]["frei"]')" $((40*MiB))
eq "reserviert nach Box: 60 MiB" "$(J 'd["budget"]["eingeplant"]')" $((60*MiB))
bucket $A "sbt-bucket-a" $((40*MiB+1)); eq "Bucket mit einem Byte zu viel -> 507" "$CODE" 507
has "Meldung nennt das freie Budget" "$(cat $T/b)" "frei zum Einplanen"
eq "Datenbank unveraendert (nur 60 MiB eingeplant)" "$(eingeplant_db ${UID_[$A]})" $((60*MiB))
eq "Garage hat keinen Bucket angelegt" "$(SJ 'len(d["buckets"])')" 0
bucket $A "sbt-bucket-a" $((40*MiB)); eq "Bucket genau mit dem Rest (40 MiB) -> 200" "$CODE" 200
BKTA=$(J 'd["bucket"]["id"]')
api "$(C $A)" GET /api/speicher
eq "frei danach: 0" "$(J 'd["budget"]["frei"]')" 0
box $A "Box B" $MiB; eq "weitere Box (1 MiB) bei 0 frei -> 507" "$CODE" 507
api "$(C $A)" GET /api/quota/me
eq "Kontingent-Karte: eingeplant = 100 MiB" "$(J 'd["eingeplant"]')" $Q
eq "Kontingent-Karte: belegt (used) = 100 MiB" "$(J 'd["used"]')" $Q
eq "Kontingent-Karte: frei = 0" "$(J 'd["free"]')" 0
eq "SFTPGo: Box-Login mit Kontingent 60 MiB im Dienst gesetzt" "$(SJ "d['users']['$KENN']['virtual_folders'][0]['quota_size']")" $((60*MiB))
eq "Garage: Bucket-Kontingent 40 MiB im Dienst gesetzt" "$(SJ 'list(d["buckets"].values())[0]["quotas"]["maxSize"]')" $((40*MiB))
eq "SFTPGo erhaelt nur den Hash, nie das Klartext-Passwort" "$(SJ "d['users']['$KENN']['password'].startswith('\$2a\$')")" True
eq "SFTPGo-Passwort != angezeigtes Passwort" "$(SJ "d['users']['$KENN']['password'] != '$PWA'")" True

echo "== 2. Loeschen gibt sofort frei =="
api "$(C $A)" DELETE /api/speicher/buckets/$BKTA; eq "Bucket loeschen" "$CODE" 200
api "$(C $A)" GET /api/speicher
eq "frei nach Bucket-Loeschen: 40 MiB" "$(J 'd["budget"]["frei"]')" $((40*MiB))
eq "Garage: Bucket weg" "$(SJ 'len(d["buckets"])')" 0
api "$(C $A)" DELETE /api/speicher/boxen/$BOXA; eq "Box loeschen" "$CODE" 200
api "$(C $A)" GET /api/speicher
eq "frei nach Box-Loeschen: 100 MiB" "$(J 'd["budget"]["frei"]')" $Q
eq "SFTPGo: Login und Ordner der Box weg" "$(SJ "len(d['users'])+len(d['folders'])")" 0
eq "Box-Ordner im App-Speicher weg" "$([ -d $DATEN/speicher/boxen/$BOXA ] && echo da || echo weg)" weg

# ============================================================================
echo "== 3. Parallele Anfragen ueberziehen das Budget nicht =="
par() { # <user> <Anzahl> <Typ box|bucket|mix> <Bytes>
  rm -rf "$T/p"; mkdir -p "$T/p"
  local i
  for i in $(seq 1 $2); do
    ( local typ=$3; [ "$3" = mix ] && { [ $((i%2)) -eq 0 ] && typ=box || typ=bucket; }
      if [ "$typ" = box ]; then pfad=boxen; body="{\"name\":\"par $i\",\"kontingentBytes\":$4}"
      else pfad=buckets; body="{\"name\":\"sbt-par-${1#sbt_}-$i\",\"kontingentBytes\":$4}"; fi
      curl -s -o "$T/p/$i.b" -w '%{http_code}\n' -b "$(C $1)" -H 'content-type: application/json' -d "$body" "$BASE/api/speicher/$pfad" > "$T/p/$i.c" ) &
  done
  wait
  PAR_OK=$(cat $T/p/*.c | grep -c '^200$'); PAR_507=$(cat $T/p/*.c | grep -c '^507$')
}
par sbt_bob 10 box $((30*MiB))
eq "10 gleichzeitige Boxen a 30 MiB bei 100 MiB: genau 3 klappen" "$PAR_OK" 3
eq "... die anderen 7 bekommen 507" "$PAR_507" 7
eq "... eingeplant in der Datenbank = 90 MiB (nie ueber 100)" "$(eingeplant_db ${UID_[sbt_bob]})" $((90*MiB))
eq "... SFTPGo kennt genau 3 Logins" "$(SJ 'len(d["users"])')" 3
par sbt_carol 10 mix $((25*MiB))
eq "10 gleichzeitige Boxen/Buckets a 25 MiB bei 100 MiB: genau 4 klappen" "$PAR_OK" 4
eq "... eingeplant = 100 MiB" "$(eingeplant_db ${UID_[sbt_carol]})" $Q
eq "... Garage-Buckets und SFTPGo-Ordner passen zur Datenbank" "$(SJ 'len(d["buckets"])')/$(SJ 'len(d["folders"])')" "$(PSQL "SELECT (SELECT count(*) FROM speicher_buckets WHERE user_id=${UID_[sbt_carol]}) || '/' || (SELECT count(*) FROM speicher_boxen WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'sbt\_%'))")"

echo "== 4. Cloud-Upload nach der Reservierung passt nur noch in den Rest =="
D=sbt_dave
box $D "Reserve" $((90*MiB)); eq "Box 90 MiB" "$CODE" 200; BOXD=$(J 'd["box"]["id"]')
datei f11 $((10*MiB+1)); datei f10 $((10*MiB)); datei f5 $((5*MiB)); datei f1 1
eq "Upload mit 10 MiB + 1 Byte -> 507" "$(upl $D f11)" 507
has "Upload-Meldung nennt die Reservierung" "$(cat $T/ub)" "reserviert"
eq "Upload 5 MiB passt (Rest 10 MiB)" "$(upl $D f5)" 200
eq "Upload mit 5 MiB + 1 Byte zu viel (nur 1 Byte ueber Rest)" "$(datei f5b $((5*MiB+1)); upl $D f5b)" 507
eq "Upload genau der Rest (5 MiB) passt" "$(upl $D f5)" 200
eq "danach ein einziges Byte -> 507" "$(upl $D f1)" 507
api "$(C $D)" GET /api/quota/me; eq "belegt = 100 MiB (10 Dateien + 90 Box)" "$(J 'd["used"]')" $Q
api "$(C $D)" POST /api/speicher/boxen "{\"name\":\"x\",\"kontingentBytes\":$MiB}"; eq "Box nach Upload voll -> 507" "$CODE" 507
api "$(C $D)" DELETE /api/speicher/boxen/$BOXD; eq "Box loeschen" "$CODE" 200
eq "danach passt ein 20-MiB-Upload wieder" "$(datei f20 $((20*MiB)); upl $D f20)" 200
# WebDAV-PUT sieht die Reservierung ebenfalls
api "$(C $D)" POST /api/sync/zugaenge '{"name":"sbt","schreiben":true}'
DAVPW=$(J 'd["klar"]')
box $D "Reserve 2" $((60*MiB)); BOXD2=$(J 'd["box"]["id"]')
# belegt: 30 Dateien (5+5+20=30 MiB) + 60 = 90; frei 10
CODEPUT=$(curl -s -o /dev/null -w '%{http_code}' -u "$D:$DAVPW" -X PUT --data-binary @"$T/f11" "$BASE/dav/sbt-zu-gross.bin")
eq "WebDAV-PUT mit 10 MiB + 1 Byte -> 507" "$CODEPUT" 507
CODEPUT=$(curl -s -o /dev/null -w '%{http_code}' -u "$D:$DAVPW" -X PUT --data-binary @"$T/f10" "$BASE/dav/sbt-passt.bin")
eq "WebDAV-PUT genau der Rest (10 MiB) -> 201" "$CODEPUT" 201

echo "== 5. Anlegen und Hochladen gleichzeitig (Wettlauf um den letzten Platz) =="
RUNDEN_OK=0
for r in 1 2 3 4; do
  PSQL "DELETE FROM users WHERE username = 'sbt_wett$r'" >/dev/null
  mk_user sbt_wett$r $Q
  datei v20 $((20*MiB)); upl sbt_wett$r v20 >/dev/null
  datei v50 $((50*MiB))
  ( curl -s -o /dev/null -w '%{http_code}\n' -b "$(C sbt_wett$r)" -F "file=@$T/v50" "$BASE/api/upload" > "$T/w1" ) &
  ( curl -s -o /dev/null -w '%{http_code}\n' -b "$(C sbt_wett$r)" -H 'content-type: application/json' -d "{\"name\":\"w\",\"kontingentBytes\":$((50*MiB))}" "$BASE/api/speicher/boxen" > "$T/w2" ) &
  wait
  GES=$(PSQL "SELECT (SELECT coalesce(sum(size),0) FROM files WHERE user_id=${UID_[sbt_wett$r]}) + $(eingeplant_db ${UID_[sbt_wett$r]})")
  O=$(cat $T/w1 $T/w2 | grep -c '^\(200\|201\)$')
  [ "$O" = 1 ] && [ "$GES" -le "$Q" ] && RUNDEN_OK=$((RUNDEN_OK+1)) || echo "  Runde $r: Erfolge=$O (Upload $(cat $T/w1), Box $(cat $T/w2)), belegt+eingeplant=$GES"
done
eq "4 Wettlauf-Runden: jedes Mal genau einer gewinnt, nie ueber 100 MiB" "$RUNDEN_OK" 4

# ============================================================================
echo "== 6. Verkleinern: nicht unter die Belegung; Vergroessern nur im Budget =="
F=sbt_frank
box $F "Verkleinern" $((50*MiB)); BOXF=$(J 'd["box"]["id"]'); KF=$(J 'd["box"]["kennung"]')
stub folder-belegt "{\"name\":\"box-$BOXF\",\"bytes\":$((30*MiB))}"
api "$(C $F)" PATCH /api/speicher/boxen/$BOXF "{\"kontingentBytes\":$((20*MiB))}"; eq "Box unter Belegung (20 < 30 MiB) -> 400" "$CODE" 400
api "$(C $F)" PATCH /api/speicher/boxen/$BOXF "{\"kontingentBytes\":$((30*MiB-1))}"; eq "Box ein Byte unter Belegung -> 400" "$CODE" 400
eq "... Kontingent in der Datenbank unveraendert" "$(PSQL "SELECT kontingent FROM speicher_boxen WHERE id=$BOXF")" $((50*MiB))
api "$(C $F)" PATCH /api/speicher/boxen/$BOXF "{\"kontingentBytes\":$((30*MiB))}"; eq "Box genau auf die Belegung (30 MiB) -> 200" "$CODE" 200
eq "... im Dienst gesetzt (30 MiB)" "$(SJ "d['users']['$KF']['virtual_folders'][0]['quota_size']")" $((30*MiB))
api "$(C $F)" GET /api/speicher; eq "... frei = 70 MiB" "$(J 'd["budget"]["frei"]')" $((70*MiB))
api "$(C $F)" PATCH /api/speicher/boxen/$BOXF "{\"kontingentBytes\":$((100*MiB+1))}"; eq "Box vergroessern um 1 Byte ueber das Budget -> 507" "$CODE" 507
api "$(C $F)" PATCH /api/speicher/boxen/$BOXF "{\"kontingentBytes\":$((100*MiB))}"; eq "Box vergroessern bis genau 100 MiB -> 200" "$CODE" 200
eq "... im Dienst gesetzt (100 MiB)" "$(SJ "d['users']['$KF']['virtual_folders'][0]['quota_size']")" $((100*MiB))
bucket $F "sbt-bucket-f" $MiB; eq "Bucket bei vollem Budget -> 507" "$CODE" 507
api "$(C $F)" PATCH /api/speicher/boxen/$BOXF "{\"kontingentBytes\":$((50*MiB))}"; eq "Box wieder verkleinern -> 200" "$CODE" 200
bucket $F "sbt-bucket-f" $((40*MiB)); BKF=$(J 'd["bucket"]["id"]')
stub bucket-belegt "{\"alias\":\"sbt-bucket-f\",\"bytes\":$((25*MiB))}"
api "$(C $F)" PATCH /api/speicher/buckets/$BKF "{\"kontingentBytes\":$((10*MiB))}"; eq "Bucket unter Belegung (10 < 25 MiB) -> 400" "$CODE" 400
api "$(C $F)" PATCH /api/speicher/buckets/$BKF "{\"kontingentBytes\":$((25*MiB))}"; eq "Bucket genau auf die Belegung -> 200" "$CODE" 200
eq "... Garage-Kontingent 25 MiB" "$(SJ 'list(d["buckets"].values())[0]["quotas"]["maxSize"]')" $((25*MiB))
api "$(C $F)" PATCH /api/speicher/buckets/$BKF "{\"kontingentBytes\":$((50*MiB+1))}"; eq "Bucket vergroessern ueber das Budget (frei 25 MiB + 25) -> 507" "$CODE" 507
api "$(C $F)" PATCH /api/speicher/buckets/$BKF "{\"kontingentBytes\":$((50*MiB))}"; eq "Bucket vergroessern bis genau zur Grenze -> 200" "$CODE" 200
api "$(C $F)" PATCH /api/speicher/buckets/$BKF "{\"kontingentBytes\":$((40*MiB))}"; eq "Bucket auf 40 MiB verkleinern (Platz frei machen)" "$CODE" 200
stub ausfall '{"an":true}'
api "$(C $F)" PATCH /api/speicher/buckets/$BKF "{\"kontingentBytes\":$((30*MiB))}"; eq "Verkleinern bei Dienstausfall (Belegung unpruefbar) -> 503" "$CODE" 503
api "$(C $F)" PATCH /api/speicher/buckets/$BKF "{\"kontingentBytes\":$((45*MiB))}"; eq "Vergroessern bei Dienstausfall -> 503 (nicht 500)" "$CODE" 503
eq "... Datenbank zurueckgerollt (Kontingent bleibt 40 MiB)" "$(PSQL "SELECT kontingent FROM speicher_buckets WHERE id=$BKF")" $((40*MiB))
api "$(C $F)" GET /api/speicher; eq "... Budget unveraendert (frei = 10 MiB)" "$(J 'd["budget"]["frei"]')" $((10*MiB))
stub ausfall '{"an":false}'

# ============================================================================
echo "== 7. Admin senkt das Kontingent: Konto ist ueberplant, nichts wird geloescht =="
G=sbt_grace
box $G "Ueber" $((60*MiB)); BOXG=$(J 'd["box"]["id"]')
datei g10 $((10*MiB)); eq "Upload 10 MiB" "$(upl $G g10)" 200
api "$COOKIE" PATCH /api/users/${UID_[$G]} "{\"quota_bytes\":$((50*MiB))}"; eq "Admin senkt auf 50 MiB" "$CODE" 200
api "$(C $G)" GET /api/speicher
eq "ueberplant = True" "$(J 'd["budget"]["ueberplant"]')" True
eq "frei = 0 (nicht negativ)" "$(J 'd["budget"]["frei"]')" 0
eq "ueberBytes = 20 MiB" "$(J 'd["budget"]["ueberBytes"]')" $((20*MiB))
eq "Grund: ueberplant" "$(J 'd["budget"]["gesperrt"]')" ueberplant
eq "Box und Datei sind noch da" "$(PSQL "SELECT (SELECT count(*) FROM speicher_boxen WHERE user_id=${UID_[$G]}) || '/' || (SELECT count(*) FROM files WHERE user_id=${UID_[$G]})")" "1/1"
api "$(C $G)" GET /api/quota/me
eq "quota/me: ueberplant" "$(J 'd["ueberplant"]')" True
eq "quota/me: frei nie negativ" "$(J 'd["free"]')" 0
eq "quota/me: Stufe voll" "$(J 'd["stufe"]')" voll
box $G "Neu" $MiB; eq "neue Box im ueberplanten Konto -> 507" "$CODE" 507
has "... Meldung sagt 'ueberplant'" "$(cat $T/b)" "überplant"
bucket $G "sbt-bucket-g" $MiB; eq "neuer Bucket im ueberplanten Konto -> 507" "$CODE" 507
api "$(C $G)" PATCH /api/speicher/boxen/$BOXG "{\"kontingentBytes\":$((61*MiB))}"; eq "Vergroessern im ueberplanten Konto -> 507" "$CODE" 507
datei g1 1; eq "Cloud-Upload im ueberplanten Konto -> 507" "$(upl $G g1)" 507
api "$(C $G)" PATCH /api/speicher/boxen/$BOXG "{\"kontingentBytes\":$((40*MiB))}"; eq "Verkleinern 60 -> 40 MiB bleibt erlaubt" "$CODE" 200
api "$(C $G)" GET /api/speicher; eq "danach nicht mehr ueberplant (10 + 40 = 50)" "$(J 'd["budget"]["ueberplant"]')" False
eq "... und alle Zahlen im Budget >= 0" "$(J 'all(v>=0 for v in [d["budget"]["frei"],d["budget"]["eingeplant"],d["budget"]["belegt"],d["budget"]["ueberBytes"]])')" True

# ============================================================================
echo "== 8. Konten ohne Limit: nur im Rahmen von grenzeGb; Anzahl-Grenze =="
mk_user sbt_hank -1
H=sbt_hank
einst alle 0 0
box $H "Unbegrenzt" $MiB; eq "unbegrenztes Konto, grenzeGb = 0 -> 403" "$CODE" 403
has "... klare Meldung" "$(cat $T/b)" "kein Speicher"
api "$(C $H)" GET /api/speicher; eq "Budget zeigt 'keinBudget'" "$(J 'd["budget"]["gesperrt"]')" keinBudget
einst alle 1 0
box $H "Unbegrenzt" $((1024*MiB)); eq "grenzeGb = 1: Box genau 1 GiB -> 200" "$CODE" 200
box $H "Mehr" $MiB; eq "... weitere 1 MiB -> 507" "$CODE" 507
has "... Meldung nennt die Obergrenze" "$(cat $T/b)" "höchstens"
api "$(C $H)" GET /api/speicher; eq "Budget: Quelle 'grenze'" "$(J 'd["budget"]["quelle"]')" grenze
mk_user sbt_ida $((10*1024*MiB))
box sbt_ida "Kappe" $((1024*MiB)); eq "begrenztes Konto (10 GiB) mit grenzeGb = 1: 1 GiB -> 200" "$CODE" 200
box sbt_ida "Kappe 2" $MiB; eq "... Obergrenze gilt zusaetzlich zum Kontingent -> 507" "$CODE" 507
einst alle 0 2
mk_user sbt_jan $((10*1024*MiB))
box sbt_jan "1" $MiB; box sbt_jan "2" $MiB; bucket sbt_jan "sbt-jan-3" $MiB; eq "maxAnzahl = 2: dritte Box/Bucket -> 400" "$CODE" 400
api "$COOKIE" POST /api/speicher/boxen "{\"name\":\"Admin-Box\",\"kontingentBytes\":$((2048*MiB))}"; eq "Inhaber ohne Limit bleibt unbegrenzt (2 GiB)" "$CODE" 200
ADMBOX=$(J 'd["box"]["id"]')
api "$COOKIE" GET /api/quota/me; eq "... aber sein Eingeplantes steht in der Anzeige" "$(J 'd["eingeplant"]')" $((2048*MiB))
api "$COOKIE" DELETE /api/speicher/boxen/$ADMBOX >/dev/null
einst alle 0 0

# ============================================================================
echo "== 9. Mandantentrennung: fremde Boxen, Buckets, Unterkonten, Schluessel =="
box sbt_alice "Fremd" $((10*MiB)); FB=$(J 'd["box"]["id"]')
api "$(C sbt_alice)" POST /api/speicher/boxen/$FB/unterkonten '{"ordner":"daten","schreiben":true,"notiz":""}'; FU=$(J 'd["konto"]["id"]')
bucket sbt_alice "sbt-fremd" $((10*MiB)); FK=$(J 'd["bucket"]["id"]')
api "$(C sbt_alice)" POST /api/speicher/buckets/$FK/schluessel '{"name":"k","schreiben":true}'; FS=$(J 'd["schluessel"]["id"]')
X=sbt_bob
for r in "GET /api/speicher/boxen/$FB" "PATCH /api/speicher/boxen/$FB" "DELETE /api/speicher/boxen/$FB" "POST /api/speicher/boxen/$FB/passwort" \
  "POST /api/speicher/boxen/$FB/unterkonten" "PATCH /api/speicher/boxen/$FB/unterkonten/$FU" "DELETE /api/speicher/boxen/$FB/unterkonten/$FU" \
  "GET /api/speicher/buckets/$FK" "PATCH /api/speicher/buckets/$FK" "DELETE /api/speicher/buckets/$FK" \
  "POST /api/speicher/buckets/$FK/schluessel" "DELETE /api/speicher/buckets/$FK/schluessel/$FS"; do
  set -- $r
  body='{"name":"x","kontingentBytes":2097152,"ordner":"x","schreiben":true,"notiz":"","sshKeys":[],"passwort":true}'
  eq "fremd: $1 $2 -> 404" "$(code "$(C $X)" $1 $2 "$body")" 404
done
eq "fremde Box ist unveraendert" "$(PSQL "SELECT kontingent || '/' || name FROM speicher_boxen WHERE id=$FB")" "$((10*MiB))/Fremd"
eq "fremder Bucket und Schluessel sind unveraendert" "$(PSQL "SELECT (SELECT count(*) FROM speicher_buckets WHERE id=$FK) || '/' || (SELECT count(*) FROM speicher_schluessel WHERE id=$FS)")" "1/1"
box sbt_bob "Bobs Box" $((5*MiB)); BB=$(J 'd["box"]["id"]')
api "$(C sbt_bob)" GET /api/speicher/boxen/$BB; eq "eigene Box ist lesbar" "$CODE" 200
eq "Unterkonto einer anderen Box ueber die eigene Box -> 404" "$(code "$(C sbt_bob)" PATCH /api/speicher/boxen/$BB/unterkonten/$FU '{"notiz":"x"}')" 404
for id in 999999 0 -1 1.5 1e3 abc 99999999999 99999999999999999999 "1%20OR%201=1" "%00" "0x10"; do
  eq "ID '$id' -> 404 statt 500" "$(code "$(C sbt_bob)" GET "/api/speicher/boxen/$id")" 404
done
eq "Bucket-ID 1.5 -> 404" "$(code "$(C sbt_bob)" GET /api/speicher/buckets/1.5)" 404
api "$(C sbt_bob)" GET /api/speicher
eq "Liste enthaelt keine Box von Alice" "$(J 'sum(1 for b in d["boxen"] if b["name"]=="Fremd")')" 0
eq "Ohne Anmeldung: Liste -> 401" "$(code - GET /api/speicher)" 401
eq "Ohne Anmeldung: Box anlegen -> 401" "$(code - POST /api/speicher/boxen '{"name":"x","kontingentBytes":2097152}')" 401
eq "Nutzer darf Einstellungen nicht aendern -> 403" "$(code "$(C sbt_bob)" PUT /api/speicher/einstellungen '{"wer":"alle","grenzeGb":0,"maxAnzahl":0}')" 403
eq "Nutzer darf den Dienst nicht schalten -> 403" "$(code "$(C sbt_bob)" POST /api/speicher/dienst '{"an":false,"port":2222}')" 403
echo "-- Admin handelt im Namen eines Nutzers --"
EV0=$(PSQL "SELECT count(*) FROM events WHERE type='box_geaendert' AND detail ? 'besitzer'")
api "$COOKIE" GET /api/speicher/boxen/$FB; eq "Inhaber darf fremde Box lesen" "$CODE" 200
api "$COOKIE" PATCH /api/speicher/boxen/$FB "{\"kontingentBytes\":$((90*MiB+1))}"; eq "Inhaber vergroessert Alices Box ueber Alices Budget -> 507 (gilt das Budget des Besitzers)" "$CODE" 507
api "$COOKIE" PATCH /api/speicher/boxen/$FB "{\"kontingentBytes\":$((10*MiB))}"; eq "Inhaber aendert Alices Box im Rahmen -> 200" "$CODE" 200
eq "... Protokoll nennt den Besitzer" "$(( $(PSQL "SELECT count(*) FROM events WHERE type='box_geaendert' AND detail ? 'besitzer'") - EV0 ))" 1

# ============================================================================
echo "== 10. Eingabe-Missbrauch =="
M=sbt_eve
BADN=0; BADU=""
bad() { # <Beschreibung> <roher JSON-Body> [Pfad]   (rotiert die Nutzer, damit das Rate-Limit nicht dazwischenfunkt)
  local pfad="${3:-boxen}"
  if [ $((BADN % 12)) -eq 0 ]; then BADU="sbt_mis$((BADN/12))"; mk_user $BADU $((500*MiB)); fi
  BADN=$((BADN+1))
  CODE=$(curl -s -o "$T/b" -w '%{http_code}' -b "$(C $BADU)" -H 'content-type: application/json' --data-binary "$2" "$BASE/api/speicher/$pfad"); cat "$T/b" >> "$T/alle"
  eq "$1 -> 400" "$CODE" 400
}
bad "Bytes negativ" '{"name":"x","kontingentBytes":-1}'
bad "Bytes 0" '{"name":"x","kontingentBytes":0}'
bad "Bytes unter 1 MiB" '{"name":"x","kontingentBytes":1048575}'
bad "Bytes als Text" '{"name":"x","kontingentBytes":"104857600"}'
bad "Bytes Kommazahl" '{"name":"x","kontingentBytes":2097152.5}'
bad "Bytes null" '{"name":"x","kontingentBytes":null}'
bad "Bytes 1e999 (Infinity)" '{"name":"x","kontingentBytes":1e999}'
bad "Bytes NaN (kein gueltiges JSON)" '{"name":"x","kontingentBytes":NaN}'
bad "Bytes 2^53+1" '{"name":"x","kontingentBytes":9007199254740993}'
bad "Bytes 2e15 (ueber der Obergrenze)" '{"name":"x","kontingentBytes":2000000000000000}'
bad "Bytes Liste" '{"name":"x","kontingentBytes":[1048576]}'
bad "GB negativ" '{"name":"x","kontingentGb":-1}'
bad "GB 0" '{"name":"x","kontingentGb":0}'
bad "GB Text" '{"name":"x","kontingentGb":"abc"}'
bad "GB 1e999" '{"name":"x","kontingentGb":1e999}'
bad "GB 0.0001 (unter 1 MiB)" '{"name":"x","kontingentGb":0.0001}'
bad "GB riesig (2e6)" '{"name":"x","kontingentGb":2000000}'
bad "Bytes und GB gleichzeitig" '{"name":"x","kontingentBytes":2097152,"kontingentGb":1}'
bad "weder Bytes noch GB" '{"name":"x"}'
bad "Name leer" '{"name":"","kontingentBytes":2097152}'
bad "Name nur Leerzeichen" '{"name":"   ","kontingentBytes":2097152}'
bad "Name 61 Zeichen" "{\"name\":\"$(printf 'a%.0s' $(seq 1 61))\",\"kontingentBytes\":2097152}"
bad "Name mit Steuerzeichen (Zeilenumbruch)" '{"name":"a\nb","kontingentBytes":2097152}'
bad "Name mit NUL" '{"name":"a\u0000b","kontingentBytes":2097152}'
bad "Name als Zahl" '{"name":5,"kontingentBytes":2097152}'
bad "Body kein JSON" 'name=x'
bad "Body Liste" '[]'
bad "Bucket-Name zu kurz" '{"name":"ab","kontingentBytes":2097152}' buckets
bad "Bucket-Name mit Grossbuchstaben und Unterstrich" '{"name":"A_b","kontingentBytes":2097152}' buckets
bad "Bucket-Name beginnt mit Bindestrich" '{"name":"-abc","kontingentBytes":2097152}' buckets
bad "Bucket-Name wie eine IP-Adresse" '{"name":"192.168.0.1","kontingentBytes":2097152}' buckets
bad "Bucket-Name mit Punkt" '{"name":"a.b.c","kontingentBytes":2097152}' buckets
bad "Bucket-Name 64 Zeichen" "{\"name\":\"$(printf 'a%.0s' $(seq 1 64))\",\"kontingentBytes\":2097152}" buckets
bad "Schluesselname mit Steuerzeichen" '{"name":"sbt-ok-name","kontingentBytes":2097152,"schluessel":{"name":"a\u0007b"}}' buckets
eq "Missbrauchsversuche haben nichts angelegt (Datenbank)" "$(PSQL "SELECT (SELECT count(*) FROM speicher_boxen WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'sbt\_mis%')) + (SELECT count(*) FROM speicher_buckets WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'sbt\_mis%'))")" 0
box $M "Gross" 1000000000000000; eq "gueltig, aber ueber dem Budget (1e15 Bytes) -> 507 (nicht 500)" "$CODE" 507
box $M "Genau" $Q; eq "gueltig und genau das Budget -> 200" "$CODE" 200; BE=$(J 'd["box"]["id"]')
api "$(C $M)" PATCH /api/speicher/boxen/$BE '{"kontingentBytes":-5}'; eq "PATCH Bytes negativ -> 400" "$CODE" 400
api "$(C $M)" PATCH /api/speicher/boxen/$BE '{"kontingentBytes":2097152.7}'; eq "PATCH Kommazahl -> 400" "$CODE" 400
api "$(C $M)" PATCH /api/speicher/boxen/$BE '{"kontingentBytes":2097152,"kontingentGb":1}'; eq "PATCH Bytes und GB -> 400" "$CODE" 400
api "$(C $M)" PATCH /api/speicher/boxen/$BE '{"kontingentGb":1e999}'; eq "PATCH GB Infinity -> 400" "$CODE" 400
api "$(C $M)" PATCH /api/speicher/boxen/$BE '{"kontingentBytes":9007199254740993}'; eq "PATCH 2^53+1 -> 400" "$CODE" 400
api "$(C $M)" PATCH /api/speicher/boxen/$BE '{"user_id":1,"kontingentBytes":2097152}'; eq "PATCH mit fremdem Feld user_id: 200 aber ignoriert" "$CODE" 200
eq "... Besitzer unveraendert" "$(PSQL "SELECT user_id FROM speicher_boxen WHERE id=$BE")" "${UID_[$M]}"
api "$(C $M)" DELETE /api/speicher/boxen/$BE >/dev/null
echo "-- GB-Eingabe wird abgerundet, nie aufgerundet --"
api "$(C $M)" POST /api/speicher/boxen '{"name":"GB-Test","kontingentGb":0.05}'; eq "kontingentGb 0.05 -> 200" "$CODE" 200
eq "... gespeichert als 53687091 Bytes (abgerundet)" "$(J 'd["box"]["kontingent"]')" 53687091
api "$(C $M)" DELETE /api/speicher/boxen/$(J 'd["box"]["id"]') >/dev/null

# ============================================================================
echo "== 11. Unterkonten: Ordnernamen, Pfad-Traversal, Symlinks, Grenzen =="
mk_user sbt_sub $((50*MiB)); U=sbt_sub
box $U "Unter" $((5*MiB)); BU=$(J 'd["box"]["id"]')
sub() { CODE=$(curl -s -o "$T/b" -w '%{http_code}' -b "$(C $U)" -H 'content-type: application/json' --data-binary "$1" "$BASE/api/speicher/boxen/$BU/unterkonten"); cat "$T/b" >> "$T/alle"; }
for n in '..' '../x' '../../etc' 'a/b' '/abs' '.' '.hidden' 'a..b' 'a\\b' '%2e%2e' '..%2f' 'x\u0000y' 'a:b' '*' 'a;b' "$(printf 'a%.0s' $(seq 1 64))" 'ende.' ''; do
  sub "{\"ordner\":\"$n\",\"schreiben\":true,\"notiz\":\"\"}"
  eq "Ordnername '$n' abgelehnt -> 400" "$CODE" 400
done
eq "... kein Unterkonto angelegt, kein Ordner ausserhalb" "$(PSQL "SELECT count(*) FROM speicher_unterkonten WHERE box_id=$BU")" 0
sub '{"ordner":"daten","schreiben":true,"notiz":"ok"}'; eq "gueltiger Ordner 'daten' -> 200" "$CODE" 200
eq "... Ordner liegt unter dem Box-Ordner" "$([ -d $DATEN/speicher/boxen/$BU/daten ] && echo ja || echo nein)" ja
eq "... Login = <kennung>-sub1" "$(J 'd["konto"]["login"].endswith("-sub1")')" True
SUBLOGIN=$(J 'd["konto"]["login"]')
eq "... Unterkonto teilt das Kontingent der Box (virtual_folder-Kontingent)" "$(SJ "d['users']['$SUBLOGIN']['virtual_folders'][0]['quota_size']")" "$(PSQL "SELECT kontingent FROM speicher_boxen WHERE id=$BU")"
eq "... Unterkonto darf nur in den eigenen Ordner schreiben (Dateimuster)" "$(SJ "d['users']['$SUBLOGIN']['filters']['file_patterns'][0]['allowed_patterns']")" "['daten']"
ln -s /tmp "$DATEN/speicher/boxen/$BU/boese" 2>/dev/null
sub '{"ordner":"boese","schreiben":true,"notiz":""}'; eq "Ordner ist ein Symlink -> 400, nicht gefolgt" "$CODE" 400
rm -f "$DATEN/speicher/boxen/$BU/boese"
touch "$DATEN/speicher/boxen/$BU/datei.txt"
sub '{"ordner":"datei.txt","schreiben":true,"notiz":""}'; eq "Ordnername ist eine vorhandene Datei -> 400" "$CODE" 400
rm -f "$DATEN/speicher/boxen/$BU/datei.txt"
# parallel bis ueber die Grenze (20)
rm -rf "$T/p"; mkdir -p "$T/p"
for i in $(seq 1 24); do
  ( curl -s -o /dev/null -w '%{http_code}\n' -b "$(C $U)" -H 'content-type: application/json' -d "{\"ordner\":\"o$i\",\"schreiben\":false,\"notiz\":\"\"}" "$BASE/api/speicher/boxen/$BU/unterkonten" > "$T/p/$i.c" ) &
done; wait
eq "24 parallele Unterkonten: insgesamt genau 20 (1 + 19)" "$(PSQL "SELECT count(*) FROM speicher_unterkonten WHERE box_id=$BU")" 20
eq "... Nummern eindeutig" "$(PSQL "SELECT count(DISTINCT nr) FROM speicher_unterkonten WHERE box_id=$BU")" 20
eq "... alle uebrigen 400 oder 429 (Rate-Limit), kein 500" "$(cat $T/p/*.c | grep -vc '^\(200\|400\|429\)$')" 0
echo "   Codes: $(cat $T/p/*.c | sort | uniq -c | tr '\n' ' ')"

echo "== 12. SSH-Schluessel, Passwoerter und Geheimnisse =="
mk_user sbt_sec $((300*MiB)); V=sbt_sec
box $V "Geheim" $((40*MiB)); BOXG=$(J 'd["box"]["id"]')
api "$(C $V)" PATCH /api/speicher/boxen/$BOXG '{"sshKeys":["ssh-rsa AAAA"]}'; eq "ungueltiger SSH-Schluessel -> 400" "$CODE" 400
api "$(C $V)" PATCH /api/speicher/boxen/$BOXG '{"sshKeys":["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl test@host"]}'; eq "gueltiger ed25519-Schluessel -> 200" "$CODE" 200
api "$(C $V)" PATCH /api/speicher/boxen/$BOXG '{"sshKeys":["command=\"rm -rf /\" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl x"]}'; eq "Schluessel mit Optionen (command=) -> 400" "$CODE" 400
api "$(C $V)" POST /api/speicher/boxen/$BOXG/passwort; eq "Passwort neu setzen" "$CODE" 200
NEUPW=$(J 'd["passwort"]')
eq "neues Passwort hat 16 Zeichen in 4er-Gruppen" "$(printf '%s' "$NEUPW" | grep -cE '^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$')" 1
eq "Datenbank speichert nur den bcrypt-Hash" "$(PSQL "SELECT passwort_hash LIKE '\$2%' AND passwort_hash <> '$NEUPW' FROM speicher_boxen WHERE id=$BOXG")" t
api "$(C $V)" GET /api/speicher/boxen/$BOXG
hasnt "Box-Ansicht enthaelt kein Passwort" "$(cat $T/b)" "passwort"
hasnt "Box-Ansicht enthaelt keinen Hash" "$(cat $T/b)" '$2'
bucket $V "sbt-secret" $((2*MiB)) >/dev/null
api "$(C $V)" POST /api/speicher/buckets '{"name":"sbt-secret2","kontingentBytes":2097152,"schluessel":{"name":"s","schreiben":true}}'
SECRET=$(J 'd["schluessel"]["secret"]'); BS=$(J 'd["bucket"]["id"]')
eq "Bucket-Secret wird beim Anlegen gezeigt" "$([ -n "$SECRET" ] && echo ja)" ja
api "$(C $V)" GET /api/speicher/buckets/$BS
hasnt "Bucket-Ansicht zeigt das Secret nicht mehr" "$(cat $T/b)" "$SECRET"
eq "Secret steht nicht in der Datenbank" "$(PSQL "SELECT count(*) FROM speicher_schluessel WHERE to_jsonb(speicher_schluessel)::text LIKE '%$SECRET%'")" 0
eq "SFTPGo-Admin-Passwort kommt in keiner Antwort vor" "$(grep -cF "$SFTPGO_PW" "$T/alle")" 0
eq "Garage-Admin-Token kommt in keiner Antwort vor" "$(grep -cF "$GARAGE_TOKEN" "$T/alle")" 0
eq "Zugangsdaten stehen nicht im App-Log" "$(grep -cF -e "$SFTPGO_PW" -e "$GARAGE_TOKEN" "$DATEN/app.log")" 0
eq "Protokoll ohne Geheimnisse" "$(PSQL "SELECT count(*) FROM events WHERE detail::text LIKE '%$NEUPW%' OR detail::text LIKE '%$SECRET%' OR detail::text LIKE '%$SFTPGO_PW%'")" 0

echo "== 13. Kontingent wird beim Abgleich im Dienst wieder durchgesetzt =="
KENN_G=$(PSQL "SELECT kennung FROM speicher_boxen WHERE id=$BOXG")
stub user-quota "{\"name\":\"$KENN_G\",\"quota_size\":999}"
eq "Vorbedingung: im Dienst steht ein falscher Wert" "$(SJ "d['users']['$KENN_G']['virtual_folders'][0]['quota_size']")" 999
api "$(C $V)" GET /api/speicher/boxen/$BOXG
eq "nach dem Messen (Box-Seite) wieder = Datenbank (40 MiB)" "$(SJ "d['users']['$KENN_G']['virtual_folders'][0]['quota_size']")" $((40*MiB))
stub bucket-quota '{"alias":"sbt-secret2","maxSize":999999999999}'
api "$(C $V)" GET /api/speicher/buckets/$BS
eq "Bucket-Kontingent in Garage wieder = Datenbank (2 MiB)" "$(SJ '[b for b in d["buckets"].values() if b["alias"]=="sbt-secret2"][0]["quotas"]["maxSize"]')" $((2*MiB))

# ============================================================================
echo "== 14. Geloeschte Konten raeumen Boxen und Buckets im Dienst auf =="
mk_user sbt_zed $((200*MiB)); Z=sbt_zed
box $Z "Zed-Box" $((10*MiB)); ZB=$(J 'd["box"]["id"]'); ZK=$(J 'd["box"]["kennung"]')
api "$(C $Z)" POST /api/speicher/boxen/$ZB/unterkonten '{"ordner":"x","schreiben":true,"notiz":""}'
api "$(C $Z)" POST /api/speicher/buckets '{"name":"sbt-zed","kontingentBytes":10485760,"schluessel":{"name":"k","schreiben":true}}'
ZBK=$(J 'd["bucket"]["id"]')
VORUSERS=$(SJ 'len(d["users"])'); VORFOLD=$(SJ 'len(d["folders"])'); VORKEYS=$(SJ 'len(d["keys"])')
stub ausfall '{"an":true}'
api "$COOKIE" DELETE /api/users/${UID_[$Z]}; eq "Dienst ausgefallen: Konto-Loeschen -> 503" "$CODE" 503
eq "... Konto und Boxen bleiben bestehen (kein Waisen-Speicher)" "$(PSQL "SELECT (SELECT count(*) FROM users WHERE id=${UID_[$Z]}) || '/' || (SELECT count(*) FROM speicher_boxen WHERE user_id=${UID_[$Z]})")" "1/1"
stub ausfall '{"an":false}'
api "$COOKIE" DELETE /api/users/${UID_[$Z]}; eq "Dienst wieder da: Konto-Loeschen -> 200" "$CODE" 200
eq "... Datenbank: keine Boxen/Buckets/Schluessel/Unterkonten mehr" "$(PSQL "SELECT (SELECT count(*) FROM speicher_boxen WHERE id=$ZB) + (SELECT count(*) FROM speicher_buckets WHERE id=$ZBK) + (SELECT count(*) FROM speicher_unterkonten WHERE box_id=$ZB) + (SELECT count(*) FROM speicher_schluessel WHERE bucket_id=$ZBK)")" 0
eq "... SFTPGo: Box-Login, Unterkonto-Login und Ordner weg" "$(SJ "('$ZK' in d['users']) or ('$ZK-sub1' in d['users']) or ('box-$ZB' in d['folders'])")" False
eq "... Garage: Bucket und Schluessel weg" "$(SJ 'len([b for b in d["buckets"].values() if b["alias"]=="sbt-zed"])')/$(SJ 'len(d["keys"])')" "0/$((VORKEYS-1))"
eq "... Box-Ordner im App-Speicher weg" "$([ -d $DATEN/speicher/boxen/$ZB ] && echo da || echo weg)" weg
mk_user sbt_zed2 $((200*MiB)); box sbt_zed2 "Z2" $((10*MiB)); Z2B=$(J 'd["box"]["id"]')
stub ausfall '{"an":true}'
api "$COOKIE" DELETE "/api/users/${UID_[sbt_zed2]}?ohneSpeicher=1"; eq "Inhaber mit ?ohneSpeicher=1 loescht trotz Ausfall -> 200 (bewusste Ausnahme)" "$CODE" 200
stub ausfall '{"an":false}'
api "$COOKIE" PUT /api/speicher/einstellungen '{"wer":"alle","grenzeGb":0,"maxAnzahl":0}' >/dev/null

# ============================================================================
echo "== 15. wer=admins: Nutzer duerfen nichts anlegen oder vergroessern =="
einst alle 0 0
mk_user sbt_ken $((200*MiB)); K=sbt_ken
box $K "Vorher" $((10*MiB)); KB=$(J 'd["box"]["id"]') ; eq "(wer=alle) Box angelegt" "$CODE" 200
einst admins 0 0
box $K "Nein" $MiB; eq "Box anlegen als Nutzer -> 403" "$CODE" 403
bucket $K "sbt-ken" $MiB; eq "Bucket anlegen als Nutzer -> 403" "$CODE" 403
api "$(C $K)" PATCH /api/speicher/boxen/$KB "{\"kontingentBytes\":$((20*MiB))}"; eq "Box vergroessern als Nutzer -> 403" "$CODE" 403
api "$(C $K)" PATCH /api/speicher/boxen/$KB "{\"kontingentBytes\":$((5*MiB))}"; eq "Box verkleinern bleibt erlaubt -> 200" "$CODE" 200
api "$(C $K)" GET /api/speicher; eq "darfAnlegen = False" "$(J 'd["darfAnlegen"]')" False
eq "Budget-Grund 'admins'" "$(J 'd["budget"]["gesperrt"]')" admins
api "$(C $K)" GET /api/files/stats; eq "Navigation: Nutzer mit eigener Box sieht 'Speicher'" "$(J 'd["speicherSichtbar"]')" True
mk_user sbt_leer $((200*MiB))
api "$(C sbt_leer)" GET /api/files/stats; eq "Navigation: Nutzer ohne Box bei wer=admins sieht 'Speicher' nicht" "$(J 'd["speicherSichtbar"]')" False
einst alle 0 0
api "$(C sbt_leer)" GET /api/files/stats; eq "Navigation: bei wer=alle sichtbar" "$(J 'd["speicherSichtbar"]')" True
api "$COOKIE" GET /api/files/stats; eq "Navigation: Inhaber immer sichtbar" "$(J 'd["speicherSichtbar"]')" True
einst admins 0 0
api "$COOKIE" POST /api/speicher/boxen '{"name":"Admin darf","kontingentBytes":2097152}'; eq "Inhaber darf bei wer=admins weiter anlegen" "$CODE" 200
api "$COOKIE" DELETE /api/speicher/boxen/$(J 'd["box"]["id"]') >/dev/null
einst alle 0 0

# ============================================================================
echo "== 16. Rate-Limits (je Nutzer) =="
mk_user sbt_rate $((1024*MiB)); R=sbt_rate
rm -rf "$T/p"; mkdir -p "$T/p"; i=0
for i in $(seq 1 22); do
  curl -s -o /dev/null -w '%{http_code}\n' -b "$(C $R)" -H 'content-type: application/json' -d '{"name":""}' "$BASE/api/speicher/boxen" >> "$T/p/anl"
done
eq "Anlegen: die ersten 20 Versuche werden bearbeitet (400)" "$(head -20 $T/p/anl | grep -c '^400$')" 20
eq "Anlegen: Versuch 21 und 22 -> 429" "$(tail -2 $T/p/anl | grep -c '^429$')" 2
eq "ein anderer Nutzer ist davon nicht betroffen" "$(code "$(C sbt_bob)" GET /api/speicher)" 200
box sbt_ken "RL" $MiB; BRL=$(J 'd["box"]["id"]'); RL=sbt_ken
for i in $(seq 1 62); do
  curl -s -o /dev/null -w '%{http_code}\n' -b "$(C $RL)" -X PATCH -H 'content-type: application/json' -d '{"name":"n"}' "$BASE/api/speicher/boxen/$BRL" >> "$T/p/aen"
done
ZB_=$(grep -c '^429$' $T/p/aen)
[ "$ZB_" -ge 1 ] && ok "Aendern: nach 60 Aktionen je 10 Minuten -> 429 ($ZB_ von 62 abgelehnt)" || fail "Aendern: kein 429" "$ZB_"

# ============================================================================
echo "== Zusammenfassung =="
echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -eq 0 ]
