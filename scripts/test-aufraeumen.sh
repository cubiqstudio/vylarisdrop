#!/usr/bin/env bash
# API-Tests fuer "Speicher-Analyse & Aufraeumen" (/api/aufraeumen/*). curl- und jq-basiert, gibt PASS/FAIL je Fall und Messzeiten aus.
#
# Aufruf:  scripts/test-aufraeumen.sh [Basis-URL] [Cookie-Datei des Inhabers] [DB-Name]
#   Standard: http://127.0.0.1:3282  /tmp/vdt-vd_au/cookie.txt  vd_au      (PostgreSQL: 127.0.0.1:$PGPORT_, Standard 54282, Trust)
# Voraussetzungen: curl, jq, psql. Der Inhaber (admin) ist angemeldet. Das Skript legt Testkonten (auft_*), ein Team und
# Dateien an, schaltet fuer den Test Pro "Teams" ueber die Einstellungstabelle ein und raeumt am Ende alles wieder auf.
# Abgedeckt: Zugriff ohne Anmeldung, fremde Dateien (nie sichtbar/loeschbar), Team-Dateien nach Rolle, Duplikat-Gruppen
# (auch ueber Ordner hinweg), Freigabe-Kennzeichen, Papierkorb statt hartem Loeschen, Wiederherstellen, Kontingent- und
# Papierkorb-Summen vorher/nachher, Schutz der letzten Kopie, Lange-nicht-genutzt, groesste Dateien/Ordner (rekursiv),
# Eingabepruefung und Antwortzeiten mit 100.000 Dateien.
set -u
BASE="${1:-http://127.0.0.1:3282}"
COOKIE="${2:-/tmp/vdt-vd_au/cookie.txt}"
DB="${3:-vd_au}"
PGPORT_="${PGPORT_:-54282}"
PW='Test-Passwort-2026!'
T="$(mktemp -d)"
PASS=0; FAIL=0
PSQL() { psql -h 127.0.0.1 -p "$PGPORT_" -U postgres -tA "$DB" -c "$1" 2>&1; }

ok()   { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf 'FAIL  %s  -- %s\n' "$1" "${2:-}"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1" "ist '$2', erwartet '$3'"; fi; }
# Aufruf der API: CODE = HTTP-Status, $T/b = Antwort. api <Cookie|-> <Methode> <Pfad> [JSON-Body]
api() {
  local c="$1" m="$2" p="$3" body="${4:-}"
  local args=(-s -o "$T/b" -w '%{http_code}' -X "$m")
  [ "$c" != "-" ] && args+=(-b "$c")
  [ -n "$body" ] && args+=(-H 'content-type: application/json' -d "$body")
  CODE=$(curl "${args[@]}" "$BASE$p")
}
J() { jq -r "$1" "$T/b"; }
# Datei hochladen: up <Cookie> <Datei> [Ordner-ID] [Passwort]  ->  gibt die Datei-ID aus
up() {
  local c="$1" f="$2" ord="${3:-}" pw="${4:-}"
  local args=(-s -b "$c" -F "file=@$f")
  [ -n "$ord" ] && args+=(-F "ordner=$ord")
  [ -n "$pw" ] && args+=(-F "passwort=$pw")
  curl "${args[@]}" "$BASE/api/upload" | jq -r '.files[0].id'
}
# gesamt-Antwortzeit (Sekunden) von drei Abrufen, der groesste Wert zaehlt
zeit() {
  local c="$1" p="$2" max=0 z i
  for i in 1 2 3; do
    z=$(curl -s -o /dev/null -w '%{time_total}' -b "$c" "$BASE$p")
    max=$(awk -v a="$max" -v b="$z" 'BEGIN{print (b>a)?b:a}')
  done
  echo "$max"
}
unter1s() { awk -v z="$2" 'BEGIN{exit !(z<1.0)}' && ok "$1: ${2}s (< 1 s)" || fail "$1" "${2}s (>= 1 s)"; }

cleanup() {
  PSQL "DELETE FROM users WHERE username LIKE 'auft\_%'" >/dev/null
  PSQL "DELETE FROM teams WHERE name = 'Auft-Team'" >/dev/null
  PSQL "DELETE FROM settings WHERE key = 'lizenz'" >/dev/null
  PSQL "SELECT pg_notify('vd_settings', 'x|lizenz')" >/dev/null
  rm -rf "$T"
}
trap cleanup EXIT
PSQL "DELETE FROM users WHERE username LIKE 'auft\_%'" >/dev/null

echo "== Vorbereitung: Konten, Team, Dateien =="
for n in alice bob carol perf; do
  api "$COOKIE" POST /api/users "{\"username\":\"auft_$n\",\"password\":\"$PW\",\"role\":\"user\"}"
  [ "$CODE" = 200 ] || { echo "Konto auft_$n nicht angelegt ($CODE): $(cat "$T/b")"; exit 2; }
  curl -s -c "$T/c_$n" -H 'content-type: application/json' -d "{\"username\":\"auft_$n\",\"password\":\"$PW\"}" "$BASE/api/auth/login" >/dev/null
done
CA="$T/c_alice"; CB="$T/c_bob"; CC="$T/c_carol"; CP="$T/c_perf"
UA=$(PSQL "SELECT id FROM users WHERE username='auft_alice'"); UB=$(PSQL "SELECT id FROM users WHERE username='auft_bob'")
UC=$(PSQL "SELECT id FROM users WHERE username='auft_carol'"); UP=$(PSQL "SELECT id FROM users WHERE username='auft_perf'")

# Pro "Teams" einschalten (Einstellung + Cache-Meldung an die Instanz)
PSQL "INSERT INTO settings(key,value) VALUES('lizenz','{\"schluessel\":\"TEST\",\"art\":\"online\",\"status\":\"aktiv\",\"code\":\"\",\"plan\":\"Pro\",\"trial\":false,\"ablauf\":null,\"features\":[],\"maxGeraete\":1,\"geraete\":1,\"zuletztOk\":$(date +%s)000,\"zuletztVersuch\":0,\"meldung\":\"\"}') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value" >/dev/null
PSQL "SELECT pg_notify('vd_settings', 'x|lizenz')" >/dev/null
sleep 1
api "$COOKIE" POST /api/pro/teams '{"aktion":"anlegen","name":"Auft-Team"}'
TEAM=$(J '.id'); eq "Team angelegt (Pro an)" "$CODE" 200
api "$COOKIE" POST /api/pro/teams "{\"aktion\":\"mitglied\",\"id\":$TEAM,\"user_id\":$UA,\"rolle\":\"leitung\"}"
api "$COOKIE" POST /api/pro/teams "{\"aktion\":\"mitglied\",\"id\":$TEAM,\"user_id\":$UB,\"rolle\":\"mitglied\"}"
api "$CA" POST /api/cloud/ordner "{\"name\":\"TeamRoot\",\"team\":$TEAM}"; TROOT=$(J '.ordner.id')
api "$CA" POST /api/cloud/ordner '{"name":"Fotos"}'; FOTOS=$(J '.ordner.id')
api "$CA" POST /api/cloud/ordner "{\"name\":\"Alt\",\"ordner\":$FOTOS}"; ALT=$(J '.ordner.id')

head -c 2000 /dev/urandom > "$T/X.bin"; head -c 3000 /dev/urandom > "$T/Y.bin"; head -c 4000 /dev/urandom > "$T/Z.bin"
head -c 50000 /dev/urandom > "$T/gross.bin"; head -c 7000 /dev/urandom > "$T/alt.bin"; head -c 9000 /dev/urandom > "$T/altgesehen.bin"
A_X1=$(up "$CA" "$T/X.bin")                  # Wurzel, nicht geteilt
A_X2=$(up "$CA" "$T/X.bin" "$FOTOS")         # im Ordner
A_X3=$(up "$CA" "$T/X.bin" "$ALT" "geheim123")  # Passwort-Link (geteilt), Unterordner
A_Y=$(up "$CA" "$T/Y.bin" "$TROOT")          # Team-Ordner
A_BIG=$(up "$CA" "$T/gross.bin")
A_OLD=$(up "$CA" "$T/alt.bin" "$ALT")
A_OLDV=$(up "$CA" "$T/altgesehen.bin")
B_X=$(up "$CB" "$T/X.bin")                   # Bobs eigene Kopie von X (darf bei Alice nie auftauchen)
B_Y=$(up "$CB" "$T/Y.bin" "$TROOT")          # Team-Ordner, von Bob
B_Z=$(up "$CB" "$T/Z.bin" "$TROOT")
C_X=$(up "$CC" "$T/X.bin")
for v in A_X1 A_X2 A_X3 A_Y A_BIG A_OLD A_OLDV B_X B_Y B_Z C_X; do [ -n "${!v}" ] && [ "${!v}" != null ] || { echo "Upload $v fehlgeschlagen"; exit 2; }; done
PSQL "UPDATE files SET created_at = now() - interval '400 days', geaendert_at = now() - interval '400 days', last_view_at = NULL WHERE id = $A_OLD" >/dev/null
PSQL "UPDATE files SET created_at = now() - interval '400 days', geaendert_at = now() - interval '400 days', last_view_at = now() - interval '10 days' WHERE id = $A_OLDV" >/dev/null
PSQL "UPDATE files SET views = 3, last_view_at = now() WHERE id = $A_X2" >/dev/null
ok "Testdaten angelegt (Alice 7 Dateien, Bob 3, Carol 1)"

echo "== Zugriff =="
for p in uebersicht groesste ordner alt duplikate; do
  api - GET "/api/aufraeumen/$p"; eq "ohne Anmeldung: $p -> 401" "$CODE" 401
done
api - POST /api/aufraeumen/loeschen "{\"dateien\":[\"$A_X1\"]}"; eq "ohne Anmeldung: loeschen -> 401" "$CODE" 401
api - POST /api/aufraeumen/rueckgaengig '{"papierkorb":["1"]}'; eq "ohne Anmeldung: rueckgaengig -> 401" "$CODE" 401

echo "== Eingabepruefung =="
api "$CA" GET '/api/aufraeumen/alt?tage=7'; eq "tage=7 -> 400" "$CODE" 400
api "$CA" GET '/api/aufraeumen/duplikate?seite=0'; eq "seite=0 -> 400" "$CODE" 400
api "$CA" POST /api/aufraeumen/loeschen '{"dateien":[]}'; eq "leere Auswahl -> 400" "$CODE" 400
api "$CA" POST /api/aufraeumen/loeschen '{"dateien":["abc"]}'; eq "ungueltige ID -> 400" "$CODE" 400
api "$CA" POST /api/aufraeumen/loeschen '{"dateien":["1"],"modus":"hart"}'; eq "unbekannter Modus -> 400" "$CODE" 400
jq -nc '{dateien: [range(1;5002)|tostring]}' > "$T/gross.json"
CODE=$(curl -s -o "$T/b" -w '%{http_code}' -b "$CA" -H 'content-type: application/json' -d @"$T/gross.json" "$BASE/api/aufraeumen/loeschen"); eq "5001 IDs -> 400" "$CODE" 400

echo "== Uebersicht und Kontingent =="
api "$CA" GET /api/quota/me; Q_USED=$(J '.used'); Q_KORB=$(J '.papierkorb')
api "$CA" GET /api/aufraeumen/uebersicht; U_GES=$(J '.belegt.gesamt')
eq "belegt gesamt = Kontingent-Belegung (quota/me)" "$U_GES" "$Q_USED"
SUMME_SQL=$(PSQL "SELECT coalesce(sum(size),0) FROM files WHERE user_id=$UA")
eq "belegt gesamt = Summe files.size (Papierkorb leer)" "$U_GES" "$SUMME_SQL"
eq "Verteilung: Summe der Arten = Dateisumme" "$(J '[.proArt[].bytes]|add')" "$SUMME_SQL"
eq "Dateizahl = 7" "$(J '.dateien')" 7
eq "Duplikat-Gruppen (Alice, mit Team) = 2 (X und Y)" "$(J '.duplikate.gruppen')" 2
eq "ueberzaehlige Kopien = 3 (X: 2, Y: 1)" "$(J '.duplikate.ueberzaehlig')" 3
eq "sparbare Bytes = 2*2000 + 1*3000" "$(J '.duplikate.bytes')" 7000
eq "lange nicht genutzt (180 Tage): 1 Datei (die angesehene zaehlt nicht)" "$(J '.alt.anzahl')" 1
api "$CA" GET '/api/aufraeumen/uebersicht?team=0'
eq "ohne Team-Dateien: Gruppen = 1 (nur X)" "$(J '.duplikate.gruppen')" 1
eq "ohne Team-Dateien: sparbar = 4000" "$(J '.duplikate.bytes')" 4000

echo "== Duplikate: Gruppen, Ordner, Freigabe, Sichtbarkeit =="
api "$CA" GET /api/aufraeumen/duplikate
GX=$(jq -c '.gruppen[] | select(.size==2000)' "$T/b"); GY=$(jq -c '.gruppen[] | select(.size==3000)' "$T/b")
eq "Gruppe X hat 3 Kopien (Wurzel + 2 Ordner), Kopien von Bob/Carol fehlen" "$(echo "$GX" | jq '.kopien|length')" 3
eq "Gruppe X: keine fremde Datei (Bob/Carol) enthalten" "$(echo "$GX" | jq -r "[.kopien[].id] | map(select(. == \"$B_X\" or . == \"$C_X\")) | length")" 0
eq "Gruppe X: Kopien aus verschiedenen Ordnern ('' , Fotos, Fotos / Alt)" "$(echo "$GX" | jq -r '[.kopien[].pfad]|sort|join("|")')" "|Fotos|Fotos / Alt"
eq "Gruppe X: Passwort-Kopie ist als geteilt (passwort) gekennzeichnet" "$(echo "$GX" | jq -r ".kopien[] | select(.id==\"$A_X3\") | .geteilt.passwort")" true
eq "Gruppe X: Kopie mit aufgerufenem Link ist als geteilt gekennzeichnet" "$(echo "$GX" | jq -r ".kopien[] | select(.id==\"$A_X2\") | .geteilt.link")" true
eq "Gruppe X: Kopie in Ordner mit Passwort: Empfehlung 'geschuetzt' oder 'behalten'" "$(echo "$GX" | jq -r ".kopien[] | select(.id==\"$A_X3\") | .empfehlung" | grep -cE 'geschuetzt|behalten')" 1
eq "Gruppe X: genau eine Kopie wird behalten" "$(echo "$GX" | jq '[.kopien[]|select(.empfehlung=="behalten")]|length')" 1
eq "Gruppe X: ungeteilte Wurzel-Kopie ist loeschbare Empfehlung" "$(echo "$GX" | jq -r ".kopien[] | select(.id==\"$A_X1\") | .empfehlung")" loeschen
eq "Gruppe X: Ersparnis = 2 * 2000" "$(echo "$GX" | jq .ersparnis)" 4000
eq "Gruppe Y (Team): 2 Kopien, eine von Bob im Team-Ordner" "$(echo "$GY" | jq '.kopien|length')" 2
eq "Gruppe Y: Bobs Kopie ist als Team-Datei gekennzeichnet" "$(echo "$GY" | jq -r ".kopien[] | select(.id==\"$B_Y\") | .team.name")" "Auft-Team"
eq "Gruppe Y: Alice (Leitung) darf beide Kopien loeschen" "$(echo "$GY" | jq '[.kopien[]|select(.darfLoeschen)]|length')" 2
# Bob (Mitglied): sieht Y mit Alices Kopie, darf aber nur die eigene loeschen
api "$CB" GET /api/aufraeumen/duplikate; GYB=$(jq -c '.gruppen[] | select(.size==3000)' "$T/b")
eq "Bob sieht Gruppe Y (2 Kopien)" "$(echo "$GYB" | jq '.kopien|length')" 2
eq "Bob darf in Gruppe Y nur 1 Kopie loeschen (seine)" "$(echo "$GYB" | jq '[.kopien[]|select(.darfLoeschen)]|length')" 1
eq "Bob: Alices Team-Datei ist 'fremd'/behalten, nicht loeschbar" "$(echo "$GYB" | jq -r ".kopien[] | select(.id==\"$A_Y\") | .darfLoeschen")" false
eq "Bob sieht Alices X-Dateien nicht (eigene X-Kopie ohne Duplikat)" "$(jq '[.gruppen[]|select(.size==2000)]|length' "$T/b")" 0
api "$CC" GET /api/aufraeumen/duplikate; eq "Carol (keine Duplikate): keine Gruppen" "$(J '.gruppen|length')" 0
api "$CB" GET '/api/aufraeumen/duplikate?team=0'; eq "Bob ohne Team: keine Gruppen" "$(J '.gruppen|length')" 0

echo "== Groesste Dateien und Ordner =="
api "$CA" GET /api/aufraeumen/groesste
eq "groesste: groesste Datei zuerst" "$(J '.dateien[0].id')" "$A_BIG"
eq "groesste: absteigend sortiert" "$(jq '[.dateien[].size] as $s | ($s == ($s|sort|reverse))' "$T/b")" true
eq "groesste: keine fremden Dateien (Bob/Carol)" "$(jq -r "[.dateien[].id] | map(select(. == \"$B_X\" or . == \"$C_X\")) | length" "$T/b")" 0
eq "groesste: Ordnerpfad der Datei in Fotos/Alt" "$(jq -r ".dateien[] | select(.id==\"$A_OLD\") | .pfad" "$T/b")" "Fotos / Alt"
api "$CA" GET /api/aufraeumen/ordner
FOTOS_BYTES=$(PSQL "SELECT coalesce(sum(size),0) FROM files WHERE folder_id IN ($FOTOS,$ALT)")
eq "Ordner Fotos rekursiv (inkl. Unterordner Alt)" "$(jq -r ".ordner[] | select(.id==$FOTOS) | .bytes" "$T/b")" "$FOTOS_BYTES"
eq "Ordner Alt einzeln" "$(jq -r ".ordner[] | select(.id==$ALT) | .bytes" "$T/b")" "$(PSQL "SELECT coalesce(sum(size),0) FROM files WHERE folder_id=$ALT")"
eq "Ordner: absteigend sortiert" "$(jq '[.ordner[].bytes] as $s | ($s == ($s|sort|reverse))' "$T/b")" true

echo "== Lange nicht genutzt =="
api "$CA" GET '/api/aufraeumen/alt?tage=90'
eq "alt 90: enthaelt die 400 Tage alte Datei" "$(jq -r "[.dateien[].id] | index(\"$A_OLD\") != null" "$T/b")" true
eq "alt 90: angesehene Datei (vor 10 Tagen) fehlt" "$(jq -r "[.dateien[].id] | index(\"$A_OLDV\") != null" "$T/b")" false
api "$CA" GET '/api/aufraeumen/alt?tage=365'; eq "alt 365: enthaelt die 400 Tage alte Datei" "$(jq -r "[.dateien[].id] | index(\"$A_OLD\") != null" "$T/b")" true
PSQL "UPDATE files SET created_at = now() - interval '200 days', geaendert_at = now() - interval '200 days' WHERE id = $A_OLD" >/dev/null
api "$CA" GET '/api/aufraeumen/alt?tage=365'; eq "alt 365: 200 Tage alte Datei fehlt" "$(jq -r "[.dateien[].id] | index(\"$A_OLD\") != null" "$T/b")" false
api "$CA" GET '/api/aufraeumen/alt?tage=180'; eq "alt 180: 200 Tage alte Datei dabei" "$(jq -r "[.dateien[].id] | index(\"$A_OLD\") != null" "$T/b")" true

echo "== Loeschen: Rechte =="
api "$CA" POST /api/aufraeumen/loeschen "{\"dateien\":[\"$B_X\"]}"; eq "fremde (Bobs eigene) Datei loeschen -> 404" "$CODE" 404
eq "Bobs Datei steht noch" "$(PSQL "SELECT count(*) FROM files WHERE id=$B_X")" 1
api "$CA" POST /api/aufraeumen/loeschen "{\"dateien\":[\"$A_BIG\",\"$C_X\"]}"; eq "Mischauswahl mit fremder Datei -> 404, nichts geloescht" "$CODE" 404
eq "eigene Datei der Mischauswahl steht noch" "$(PSQL "SELECT count(*) FROM files WHERE id=$A_BIG")" 1
api "$CC" POST /api/aufraeumen/loeschen "{\"dateien\":[\"$A_X1\"]}"; eq "Carol loescht Alices Datei -> 404" "$CODE" 404
api "$CB" POST /api/aufraeumen/loeschen "{\"dateien\":[\"$A_Y\"]}"; eq "Bob (Mitglied) loescht Alices Team-Datei -> 404" "$CODE" 404
eq "Alices Team-Datei steht noch" "$(PSQL "SELECT count(*) FROM files WHERE id=$A_Y")" 1
api "$CB" POST /api/aufraeumen/loeschen "{\"dateien\":[\"$A_X1\"]}"; eq "Bob loescht Alices private Datei -> 404" "$CODE" 404

echo "== Loeschen: Papierkorb, Summen, Wiederherstellen =="
api "$CA" GET /api/quota/me; V_USED=$(J '.used'); V_KORB=$(J '.papierkorb')
V_DATEIEN=$(PSQL "SELECT count(*) FROM files WHERE user_id=$UA")
api "$CA" POST /api/aufraeumen/loeschen "{\"dateien\":[\"$A_X1\",\"$A_X2\"],\"modus\":\"duplikate\"}"
eq "2 von 3 Kopien (Modus duplikate) loeschen -> 200" "$CODE" 200
eq "geloescht = 2" "$(J '.geloescht')" 2
eq "bytes = 4000" "$(J '.bytes')" 4000
eq "Antwort liefert 2 Papierkorb-IDs" "$(J '.papierkorb|length')" 2
PK_IDS=$(J '[.papierkorb[].id]|map(tostring)|map(@json)|join(",")')
eq "Belegung gesamt unveraendert (Papierkorb zaehlt mit)" "$(J '.belegt.gesamt')" "$V_USED"
eq "Papierkorb-Summe +4000" "$(J '.belegt.papierkorb')" "$((V_KORB + 4000))"
eq "Dateien in der Datenbank: -2" "$(PSQL "SELECT count(*) FROM files WHERE user_id=$UA")" "$((V_DATEIEN - 2))"
eq "Papierkorb-Zeilen: 2 (Besitzer Alice)" "$(PSQL "SELECT count(*) FROM papierkorb WHERE user_id=$UA")" 2
eq "kein hartes Loeschen: Speicherobjekt-Verweise noch in papierkorb" "$(PSQL "SELECT count(*) FROM papierkorb WHERE user_id=$UA AND datei->>'ablage' <> ''")" 2
api "$CA" GET /api/quota/me; eq "quota/me: used nachher = vorher" "$(J '.used')" "$V_USED"
eq "quota/me: Papierkorb nachher = vorher + 4000" "$(J '.papierkorb')" "$((V_KORB + 4000))"
api "$CA" GET /api/papierkorb; eq "Papierkorb-Seite zeigt beide Dateien" "$(jq "[.dateien[].name] | length >= 2" "$T/b")" true
api "$CA" GET /api/aufraeumen/uebersicht; eq "Uebersicht: Papierkorb-Summe +4000" "$(J '.belegt.papierkorb')" "$((V_KORB + 4000))"
eq "Uebersicht: nur noch die Y-Gruppe + keine X-Gruppe" "$(J '.duplikate.gruppen')" 1
# letzte Kopie schuetzen
api "$CA" POST /api/aufraeumen/loeschen "{\"dateien\":[\"$A_X3\"],\"modus\":\"duplikate\"}"
eq "letzte X-Kopie im Modus duplikate -> 200" "$CODE" 200
eq "letzte Kopie wird uebersprungen" "$(J '.uebersprungen[0].grund')" "letzte-kopie"
eq "letzte Kopie: nichts geloescht" "$(J '.geloescht')" 0
eq "letzte Kopie steht noch" "$(PSQL "SELECT count(*) FROM files WHERE id=$A_X3")" 1
# Wiederherstellen
api "$CA" POST /api/aufraeumen/rueckgaengig "{\"papierkorb\":[$PK_IDS]}"
eq "Rueckgaengig -> 200" "$CODE" 200
eq "wiederhergestellt = 2" "$(J '.wiederhergestellt')" 2
eq "Belegung gesamt nach Rueckgaengig unveraendert" "$(J '.belegt.gesamt')" "$V_USED"
eq "Papierkorb-Summe wieder wie vorher" "$(J '.belegt.papierkorb')" "$V_KORB"
eq "Dateien in der Datenbank wieder wie vorher" "$(PSQL "SELECT count(*) FROM files WHERE user_id=$UA")" "$V_DATEIEN"
api "$CA" GET /api/aufraeumen/duplikate; eq "Gruppe X wieder mit 3 Kopien" "$(jq '[.gruppen[]|select(.size==2000)|.kopien|length]|first' "$T/b")" 3
api "$CA" POST /api/aufraeumen/rueckgaengig "{\"papierkorb\":[$PK_IDS]}"; eq "zweites Rueckgaengig: nichts mehr da (0 wiederhergestellt)" "$(J '.wiederhergestellt')" 0
api "$CC" POST /api/aufraeumen/rueckgaengig "{\"papierkorb\":[$PK_IDS]}"; eq "Carol kann nichts wiederherstellen" "$(J '.wiederhergestellt')" 0

echo "== Team-Rechte beim Loeschen =="
api "$CB" POST /api/aufraeumen/loeschen "{\"dateien\":[\"$B_Y\"],\"modus\":\"duplikate\"}"
eq "Bob loescht seine eigene Team-Kopie (Y) -> 200" "$CODE" 200; eq "geloescht = 1" "$(J '.geloescht')" 1
PK_B=$(J '.papierkorb[0].id')
api "$CB" POST /api/aufraeumen/rueckgaengig "{\"papierkorb\":[\"$PK_B\"]}"; eq "Bob stellt sie wieder her" "$(J '.wiederhergestellt')" 1
B_Y=$(PSQL "SELECT id FROM files WHERE user_id=$UB AND folder_id=$TROOT AND size=3000")  # Wiederherstellen legt die Zeile neu an (neue ID)
api "$CA" POST /api/aufraeumen/loeschen "{\"dateien\":[\"$B_Y\"],\"modus\":\"duplikate\"}"
eq "Alice (Leitung) loescht Bobs Team-Kopie -> 200" "$CODE" 200; eq "geloescht = 1" "$(J '.geloescht')" 1
eq "Bobs Datei liegt im Papierkorb von Bob (Besitzer)" "$(PSQL "SELECT count(*) FROM papierkorb WHERE user_id=$UB")" 1
PK_A=$(J '.papierkorb[0].id')
api "$CA" POST /api/aufraeumen/rueckgaengig "{\"papierkorb\":[\"$PK_A\"]}"; eq "Alice (hat geloescht) stellt Bobs Datei wieder her" "$(J '.wiederhergestellt')" 1
B_Y=$(PSQL "SELECT id FROM files WHERE user_id=$UB AND folder_id=$TROOT AND size=3000")
api "$CA" POST /api/aufraeumen/loeschen "{\"dateien\":[\"$A_Y\",\"$B_Y\"],\"modus\":\"duplikate\"}"
eq "beide Y-Kopien auf einmal: letzte Kopie bleibt (beide uebersprungen)" "$(J '[.uebersprungen[]|select(.grund=="letzte-kopie")]|length')" 2
eq "beide Y-Kopien auf einmal: nichts geloescht" "$(J '.geloescht')" 0
api "$CA" POST /api/aufraeumen/loeschen "{\"dateien\":[\"$A_BIG\"],\"modus\":\"duplikate\"}"
eq "Modus duplikate mit Nicht-Duplikat: uebersprungen (keine zweite Kopie)" "$(J '.uebersprungen[0].grund')" "letzte-kopie"
api "$CA" POST /api/aufraeumen/loeschen "{\"dateien\":[\"$A_BIG\"],\"modus\":\"frei\"}"
eq "Modus frei: grosse Einzeldatei -> Papierkorb" "$(J '.geloescht')" 1
api "$CA" POST /api/aufraeumen/rueckgaengig "{\"papierkorb\":[\"$(J '.papierkorb[0].id')\"]}"; eq "…und wieder da" "$(J '.wiederhergestellt')" 1

echo "== 100.000 Dateien: Antwortzeiten =="
PSQL "INSERT INTO folders (user_id, parent_id, name) SELECT $UP, NULL, 'Top ' || g FROM generate_series(1,20) g" >/dev/null
PSQL "INSERT INTO folders (user_id, parent_id, name) SELECT $UP, f.id, 'Sub ' || g FROM folders f, generate_series(1,5) g WHERE f.parent_id IS NULL AND f.user_id = $UP" >/dev/null
PSQL "INSERT INTO folders (user_id, parent_id, name) SELECT $UP, f.id, 'Tief ' || g FROM folders f, generate_series(1,3) g WHERE f.name LIKE 'Sub %' AND f.user_id = $UP" >/dev/null
PSQL "INSERT INTO files (user_id, folder_id, slug, name, mime, art, size, ablage, sha256, created_at, geaendert_at, last_view_at, views)
SELECT $UP, CASE WHEN g % 7 = 0 THEN NULL ELSE (SELECT id FROM folders WHERE user_id = $UP ORDER BY id OFFSET (g % 420) LIMIT 1) END,
  'perf' || g, 'datei-' || g || CASE g % 6 WHEN 0 THEN '.jpg' WHEN 1 THEN '.mp4' WHEN 2 THEN '.mp3' WHEN 3 THEN '.pdf' WHEN 4 THEN '.zip' ELSE '.bin' END,
  CASE g % 6 WHEN 0 THEN 'image/jpeg' WHEN 1 THEN 'video/mp4' WHEN 2 THEN 'audio/mpeg' WHEN 3 THEN 'application/pdf' WHEN 4 THEN 'application/zip' ELSE 'application/octet-stream' END,
  CASE g % 6 WHEN 0 THEN 'bild' WHEN 1 THEN 'video' WHEN 2 THEN 'audio' ELSE 'datei' END,
  CASE WHEN g % 10 < 3 THEN 1000 + ((g % 9000) * 7919) % 5000000 ELSE 1000 + (g * 7919) % 5000000 END,
  'perf/' || g,
  CASE WHEN g % 10 < 3 THEN md5((g % 9000)::text) || md5(((g % 9000) + 1)::text) ELSE md5(g::text) || md5((g+1)::text) END,
  now() - ((g % 800) || ' days')::interval, now() - ((g % 800) || ' days')::interval, CASE WHEN g % 5 = 0 THEN now() - ((g % 300) || ' days')::interval END, (g % 3)
FROM generate_series(1, 100000) g" >/dev/null
PSQL "ANALYZE files" >/dev/null; PSQL "ANALYZE folders" >/dev/null
eq "100.000 Dateien angelegt" "$(PSQL "SELECT count(*) FROM files WHERE user_id=$UP")" 100000
for p in uebersicht groesste ordner alt duplikate; do
  z=$(zeit "$CP" "/api/aufraeumen/$p"); unter1s "100k: GET $p" "$z"
  printf '      Zeit %-12s %ss\n' "$p" "$z"
done
z=$(zeit "$CP" '/api/aufraeumen/alt?tage=365'); unter1s "100k: GET alt (365 Tage)" "$z"
z=$(zeit "$CP" '/api/aufraeumen/duplikate?seite=4'); unter1s "100k: GET duplikate Seite 4" "$z"
api "$CP" GET /api/aufraeumen/uebersicht; PERF_GES=$(J '.belegt.gesamt')
eq "100k: belegt gesamt = Summe files.size" "$PERF_GES" "$(PSQL "SELECT sum(size) FROM files WHERE user_id=$UP")"
api "$CP" GET /api/aufraeumen/duplikate
SQL_GRUPPEN=$(PSQL "SELECT count(*) FROM (SELECT 1 FROM files WHERE user_id=$UP AND sha256<>'' AND size>0 GROUP BY sha256,size HAVING count(*)>1) x")
eq "100k: Zahl der Duplikat-Gruppen stimmt mit SQL-Gegenprobe" "$(J '.summe.gruppen')" "$SQL_GRUPPEN"
eq "100k: erste Seite hat 25 Gruppen" "$(J '.gruppen|length')" 25
eq "100k: jede Gruppe hat mind. 2 Kopien (nur eigene)" "$(jq '[.gruppen[].kopien|length]|min >= 2' "$T/b")" true
# Plan der Kopien-Suche: Teilindex statt Tabellendurchlauf je Gruppe
PLAN=$(PSQL "EXPLAIN SELECT f.id FROM files f WHERE f.sha256 <> '' AND f.size > 0 AND f.sha256 = 'abc' AND f.size = 5 AND f.user_id = $UP")
echo "$PLAN" | grep -q files_sha256_idx && ok "EXPLAIN: Kopien-Suche nutzt files_sha256_idx" || fail "EXPLAIN: Kopien-Suche nutzt den Index nicht" "$PLAN"
# Loeschen von 500 Duplikaten (mit Gruppenpruefung) und Wiederherstellen
for s in 1 2 3 4 5 6 7 8 9 10; do api "$CP" GET "/api/aufraeumen/duplikate?seite=$s"; jq -c "[.gruppen[].kopien[] | select(.empfehlung==\"loeschen\") | .id]" "$T/b"; done | jq -sc "add | .[:500]" > "$T/ids.json"; IDS=$(cat "$T/ids.json")
N_IDS=$(echo "$IDS" | jq length)
t0=$(date +%s.%N)
api "$CP" POST /api/aufraeumen/loeschen "{\"dateien\":$IDS,\"modus\":\"duplikate\"}"
t1=$(date +%s.%N); LZ=$(awk -v a="$t0" -v b="$t1" 'BEGIN{printf "%.2f", b-a}')
eq "100k: $N_IDS Duplikate loeschen -> 200" "$CODE" 200
eq "100k: alle $N_IDS im Papierkorb" "$(J '.geloescht')" "$N_IDS"
printf '      Zeit Loeschen von %s Dateien: %ss\n' "$N_IDS" "$LZ"
PK_ALL=$(jq -c '[.papierkorb[].id]' "$T/b")
api "$CP" GET /api/aufraeumen/uebersicht
eq "100k: belegt gesamt nach dem Loeschen unveraendert (Papierkorb zaehlt)" "$(J '.belegt.gesamt')" "$PERF_GES"
t0=$(date +%s.%N)
api "$CP" POST /api/aufraeumen/rueckgaengig "{\"papierkorb\":$PK_ALL}"
t1=$(date +%s.%N); RZ=$(awk -v a="$t0" -v b="$t1" 'BEGIN{printf "%.2f", b-a}')
eq "100k: Rueckgaengig stellt alle wieder her" "$(J '.wiederhergestellt')" "$N_IDS"
printf '      Zeit Wiederherstellen von %s Dateien: %ss\n' "$N_IDS" "$RZ"
eq "100k: Dateizahl wie vorher" "$(PSQL "SELECT count(*) FROM files WHERE user_id=$UP")" 100000

echo
echo "Ergebnis: $PASS bestanden, $FAIL fehlgeschlagen"
[ "$FAIL" = 0 ]
