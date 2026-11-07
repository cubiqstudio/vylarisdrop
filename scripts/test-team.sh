#!/usr/bin/env bash
# Tests der Team-Ansicht "Mein Team" (/api/team/...) der VylarisCloud (curl + python3 + psql). Laeuft gegen eine laufende Instanz
# und gibt PASS/FAIL je Fall aus.
#
# Aufruf:  scripts/test-team.sh [Basis-URL] [Cookie-Datei des Inhabers] [DB-Name]
#   Standard: http://127.0.0.1:3341  /tmp/vdt-vd_tm/cookie.txt  vd_tm      (PostgreSQL: 127.0.0.1:$PGPORT_, Standard 54341, Trust)
# Voraussetzungen: curl, python3, psql. Der Inhaber (admin) ist angemeldet. Das Skript legt Testkonten (tmt_*, zzpre_*), Teams (TT-*)
# und Dateien an, aktiviert Pro (Lizenz ueber /api/lizenzen + /api/pro/lizenz) und raeumt am Ende alles wieder auf.
# Pro frischem Serverstart (oder 1 Stunde Abstand) einmal ausfuehren: die Rate-Limits liegen im Speicher des Servers.
# Abgedeckt: Pro aus, Zugriff ohne Anmeldung, Mandantentrennung (404 fuer Nicht-Mitglieder), Speicher/Mitglieder stimmen mit der
# Admin-Sicht ueberein, keine E-Mail/Rollen-IDs, Hinzufuegen/Entfernen/Rolle nur durch die Leitung, Duplikate, 200er-Grenze (auch
# parallel), letzte Leitung, Team verlassen, Admin-Konten, Eingabemissbrauch, Rate-Limits, Vorschlaege, Speicher nach Upload,
# Live-Meldung 'teams' per /api/live, Protokoll.
set -u
BASE="${1:-http://127.0.0.1:3341}"
COOKIE="${2:-/tmp/vdt-vd_tm/cookie.txt}"
DB="${3:-vd_tm}"
PGPORT_="${PGPORT_:-54341}"
PW='Team-Test-2026!x'
T="$(mktemp -d)"
PASS=0; FAIL=0
PSQL() { psql -h 127.0.0.1 -p "$PGPORT_" -U postgres -tA "$DB" -c "$1" 2>&1; }
LIVE_PIDS=""
cleanup() {
  for p in $LIVE_PIDS; do kill "$p" 2>/dev/null; done
  PSQL "DELETE FROM teams WHERE name LIKE 'TT-%'" >/dev/null
  PSQL "DELETE FROM users WHERE username LIKE 'tmt\_%' OR username LIKE 'zzpre\_%'" >/dev/null
  rm -rf "$T"
}
trap cleanup EXIT

ok()   { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf 'FAIL  %s  -- %s\n' "$1" "${2:-}"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1" "ist '$2', erwartet '$3'"; fi; }
has()  { if printf '%s' "$2" | grep -qF -- "$3"; then ok "$1"; else fail "$1" "'$3' fehlt in: $(printf '%s' "$2" | head -c 300)"; fi; }
hasnt(){ if printf '%s' "$2" | grep -qF -- "$3"; then fail "$1" "'$3' ist enthalten"; else ok "$1"; fi; }
j()    { python3 -c "import sys,json
try:
  d=json.load(sys.stdin)
  for k in sys.argv[1].split('.'):
    d=d[int(k)] if isinstance(d,list) else d[k]
  print(json.dumps(d) if isinstance(d,(dict,list,bool)) or d is None else d)
except Exception: print('')" "$1"; }
# py <Ausdruck mit d = Antwort>  -> Ergebnis als Text
py()   { python3 -c "import sys,json
d=json.load(sys.stdin)
print($1)" 2>/dev/null; }

echo $((RANDOM % 500)) >"$T/ipn"
nip() { local n; n=$(( $(cat "$T/ipn") + 1 )); echo "$n" >"$T/ipn"; echo "10.88.$((n / 250)).$((n % 250 + 1))"; }
# api <Cookie|-> <METHODE> <Pfad> [JSON-Text]  ->  CODE, $T/b
api() {
  local c="$1" m="$2" p="$3" body="${4:-}"
  local args=(-s -o "$T/b" -w '%{http_code}' -X "$m" -H "X-Forwarded-For: $(nip)")
  [ "$c" != "-" ] && args+=(-b "$c")
  [ -n "$body" ] && args+=(-H 'content-type: application/json' -d "$body")
  CODE=$(curl "${args[@]}" "$BASE$p")
}
body() { cat "$T/b"; }
msg() { j message <"$T/b"; }
jn() { python3 -c 'import json,sys;print(json.dumps({"name":sys.argv[1]}))' "$1"; }
login() { curl -s -c "$T/c-$1" -H "X-Forwarded-For: $(nip)" -H 'content-type: application/json' -d "{\"username\":\"$1\",\"password\":\"$PW\"}" "$BASE/api/auth/login" >/dev/null; }
mk_user() { curl -s -b "$COOKIE" -H 'content-type: application/json' -d "{\"username\":\"$1\",\"email\":\"$1@example.com\",\"password\":\"$PW\",\"role\":\"${2:-user}\"}" "$BASE/api/users" >/dev/null; }
uid_of() { PSQL "SELECT id FROM users WHERE username='$1'"; }
admin_team() { api "$COOKIE" POST /api/pro/teams "$1"; }
mitglied_admin() { admin_team "{\"aktion\":\"mitglied\",\"id\":$1,\"user_id\":$2,\"rolle\":${3:-\"mitglied\"}}"; }
# team_sicht <Cookie> <Team-ID>: Team-Objekt aus GET /api/team  ->  $T/t.json
team_sicht() { api "$1" GET /api/team; python3 -c "
import sys,json
d=json.load(open('$T/b'))
t=[x for x in d.get('teams',[]) if x['id']==$2]
json.dump(t[0] if t else None, open('$T/t.json','w'))"; }
tj() { j "$1" <"$T/t.json"; }
rolle_in() { PSQL "SELECT rolle FROM team_mitglieder WHERE team_id=$1 AND user_id=$2"; }
zahl_mitglieder() { PSQL "SELECT count(*) FROM team_mitglieder WHERE team_id=$1"; }

echo "== Vorbereitung =="
curl -sf "$BASE/api/public/health" >/dev/null || { echo "Instanz unter $BASE nicht erreichbar"; exit 2; }
PSQL "DELETE FROM teams WHERE name LIKE 'TT-%'" >/dev/null
PSQL "DELETE FROM users WHERE username LIKE 'tmt\_%' OR username LIKE 'zzpre\_%'" >/dev/null
for n in lead m1 m2 m3 out lead2 rl lead4 neu lead5 lead6; do mk_user "tmt_$n"; login "tmt_$n"; done
mk_user tmt_adm admin
for n in $(seq 1 12); do mk_user "tmt_zq$n"; done
mk_user zzpre_x; mk_user tmt_zzpre
LEAD="$T/c-tmt_lead"; M1="$T/c-tmt_m1"; M2="$T/c-tmt_m2"; M3="$T/c-tmt_m3"; OUT="$T/c-tmt_out"; LEAD2="$T/c-tmt_lead2"; RL="$T/c-tmt_rl"; LEAD4="$T/c-tmt_lead4"; NEU="$T/c-tmt_neu"; LEAD5="$T/c-tmt_lead5"; LEAD6="$T/c-tmt_lead6"
ULEAD=$(uid_of tmt_lead); UM1=$(uid_of tmt_m1); UM2=$(uid_of tmt_m2); UM3=$(uid_of tmt_m3); UOUT=$(uid_of tmt_out); ULEAD2=$(uid_of tmt_lead2)
URL=$(uid_of tmt_rl); ULEAD4=$(uid_of tmt_lead4); UNEU=$(uid_of tmt_neu); ULEAD5=$(uid_of tmt_lead5); ULEAD6=$(uid_of tmt_lead6); UADM=$(uid_of tmt_adm); UADMIN=$(uid_of admin)
[ -n "$ULEAD" ] && [ -n "$UADM" ] && [ -n "$UNEU" ] || { echo "Konten konnten nicht angelegt werden"; exit 2; }

echo "== Ohne Anmeldung =="
api - GET /api/team;                                            eq "GET /api/team ohne Anmeldung -> 401" "$CODE" 401
api - POST /api/team/1/mitglieder '{"name":"x"}';               eq "hinzufuegen ohne Anmeldung -> 401" "$CODE" 401
api - GET "/api/team/1/kandidaten?q=ab";                        eq "kandidaten ohne Anmeldung -> 401" "$CODE" 401
api - PATCH /api/team/1/mitglieder/1 '{"rolle":"leitung"}';     eq "Rolle aendern ohne Anmeldung -> 401" "$CODE" 401
api - DELETE /api/team/1/mitglieder/1;                          eq "entfernen ohne Anmeldung -> 401" "$CODE" 401

echo "== Pro aus =="
api "$COOKIE" POST /api/pro/lizenz '{"aktion":"entfernen"}'
api "$LEAD" GET /api/team;                                      eq "Pro aus: 200 (kein Fehler)" "$CODE" 200
eq "Pro aus: pro=false" "$(j pro <"$T/b")" "false"
eq "Pro aus: teams leer" "$(j teams <"$T/b")" "[]"
api "$COOKIE" GET /api/team;                                    eq "Pro aus (Inhaber): 200" "$CODE" 200
eq "Pro aus (Inhaber): admin=true" "$(j admin <"$T/b")" "true"
api "$LEAD" POST /api/team/1/mitglieder '{"name":"tmt_m1"}';    eq "Pro aus: hinzufuegen als Nutzer -> 404" "$CODE" 404
api "$LEAD" GET "/api/team/1/kandidaten?q=tmt";                 eq "Pro aus: kandidaten als Nutzer -> 404" "$CODE" 404
api "$COOKIE" POST /api/team/1/mitglieder '{"name":"tmt_m1"}';  eq "Pro aus: hinzufuegen als Inhaber -> 402" "$CODE" 402

echo "== Pro an (echte Lizenz) =="
curl -s -b "$COOKIE" -H 'content-type: application/json' -d '{"tage":30,"maxGeraete":1,"features":[],"anzahl":1}' "$BASE/api/lizenzen" >"$T/lz"
KEY=$(j schluessel.0 <"$T/lz")
[ -n "$KEY" ] || { echo "Lizenz konnte nicht ausgestellt werden: $(cat "$T/lz")"; exit 2; }
api "$COOKIE" POST /api/pro/lizenz "{\"aktion\":\"aktivieren\",\"schluessel\":\"$KEY\"}"
eq "Pro aktiviert" "$CODE" 200
api "$LEAD" GET /api/team;                                      eq "Pro an, ohne Team: pro=true" "$(j pro <"$T/b")" "true"
eq "Pro an, ohne Team: teams leer" "$(j teams <"$T/b")" "[]"

echo "== Teams anlegen =="
admin_team '{"aktion":"anlegen","name":"TT-Alpha","quota_bytes":10485760,"beschreibung":"Test-Team A"}'; TA=$(j id <"$T/b"); eq "Team Alpha angelegt" "$CODE" 200
admin_team '{"aktion":"anlegen","name":"TT-Beta"}'; TB=$(j id <"$T/b")
admin_team '{"aktion":"anlegen","name":"TT-Gamma"}'; TC=$(j id <"$T/b")
admin_team '{"aktion":"anlegen","name":"TT-Delta"}'; TD=$(j id <"$T/b")
mitglied_admin "$TA" "$ULEAD" '"leitung"'; mitglied_admin "$TA" "$UM1"; mitglied_admin "$TB" "$ULEAD2" '"leitung"'; mitglied_admin "$TB" "$UM1"
mitglied_admin "$TC" "$URL" '"leitung"'; mitglied_admin "$TD" "$ULEAD4" '"leitung"'; mitglied_admin "$TC" "$ULEAD5" '"leitung"'; mitglied_admin "$TC" "$ULEAD6" '"leitung"'
eq "Alpha: 2 Mitglieder" "$(zahl_mitglieder "$TA")" 2

echo "== Mitglied sieht Speicher und Mitglieder =="
api "$M1" GET /api/team; eq "Mitglied: 200" "$CODE" 200
python3 - "$T/b" >"$T/m1.txt" <<'EOF'
import sys,json
d=json.load(open(sys.argv[1]))
print(len(d['teams']), [t['name'] for t in d['teams']])
EOF
eq "Mitglied in zwei Teams sieht beide (nach Name sortiert)" "$(cat "$T/m1.txt")" "2 ['TT-Alpha', 'TT-Beta']"
team_sicht "$M1" "$TA"
eq "Alpha: Name" "$(tj name)" "TT-Alpha"
eq "Alpha: Beschreibung" "$(tj beschreibung)" "Test-Team A"
eq "Alpha: meineRolle (m1)" "$(tj meineRolle)" "mitglied"
eq "Alpha: darfVerwalten (m1) false" "$(tj darfVerwalten)" "false"
eq "Alpha: Limit 10 MB" "$(tj speicher.limit)" 10485760
eq "Alpha: belegt 0" "$(tj speicher.belegt)" 0
eq "Alpha: frei = Limit" "$(tj speicher.frei)" 10485760
eq "Alpha: stufe ok" "$(tj speicher.stufe)" ok
eq "Alpha: nicht ausgeschoepft" "$(tj speicher.ausgeschoepft)" "false"
eq "Alpha: mitgliederZahl 2" "$(tj mitgliederZahl)" 2
eq "Alpha: Leitung zuerst" "$(py "[m['name'] for m in json.load(open('$T/t.json'))['mitglieder']]" <"$T/t.json")" "['tmt_lead', 'tmt_m1']"
eq "Alpha: Rolle Leitung/Mitglied" "$(py "[m['rolle'] for m in d['mitglieder']]" <"$T/t.json")" "['leitung', 'mitglied']"
eq "Alpha: eigene Zeile hat ich=true" "$(py "[m['ich'] for m in d['mitglieder']]" <"$T/t.json")" "[False, True]"
eq "Alpha: IDs fremder Konten fehlen fuer Mitglieder" "$(py "[('id' in m) for m in d['mitglieder']]" <"$T/t.json")" "[False, True]"
hasnt "Alpha: keine E-Mail-Adresse (Mitglied)" "$(cat "$T/t.json")" "@"
hasnt "Alpha: keine Rollen-ID/E-Mail-Schluessel" "$(cat "$T/t.json")" "rolle_id"
hasnt "Alpha: kein email-Feld" "$(cat "$T/t.json")" "email"
eq "Alpha: Felder je Mitglied" "$(py "sorted(d['mitglieder'][0].keys())" <"$T/t.json")" "['beigetreten', 'belegt', 'ich', 'name', 'rolle']"
api "$M1" GET "/api/team?kurz=1"; eq "kurz: anzahl 2" "$(j anzahl <"$T/b")" 2
api "$OUT" GET "/api/team?kurz=1"; eq "kurz: Nicht-Mitglied anzahl 0" "$(j anzahl <"$T/b")" 0
api "$OUT" GET /api/team;     eq "Nicht-Mitglied: teams leer" "$(j teams <"$T/b")" "[]"

echo "== Leitung sieht IDs, geschuetzt-Markierung =="
team_sicht "$LEAD" "$TA"
eq "Leitung: darfVerwalten" "$(tj darfVerwalten)" "true"
eq "Leitung: IDs aller Mitglieder" "$(py "[('id' in m) for m in d['mitglieder']]" <"$T/t.json")" "[True, True]"
hasnt "Leitung: keine E-Mail" "$(cat "$T/t.json")" "@example"

echo "== Mandantentrennung =="
api "$OUT" POST "/api/team/$TA/mitglieder" '{"name":"tmt_m2"}';  eq "Nicht-Mitglied: hinzufuegen -> 404" "$CODE" 404; MSG_FREMD=$(msg)
api "$OUT" GET "/api/team/$TA/kandidaten?q=tmt";                 eq "Nicht-Mitglied: kandidaten -> 404" "$CODE" 404
api "$OUT" PATCH "/api/team/$TA/mitglieder/$UM1" '{"rolle":"leitung"}'; eq "Nicht-Mitglied: Rolle aendern -> 404" "$CODE" 404
api "$OUT" DELETE "/api/team/$TA/mitglieder/$UM1";               eq "Nicht-Mitglied: entfernen -> 404" "$CODE" 404
api "$OUT" DELETE "/api/team/$TA/mitglieder/$UOUT";              eq "Nicht-Mitglied: sich selbst 'entfernen' -> 404" "$CODE" 404
api "$OUT" POST "/api/team/987654/mitglieder" '{"name":"tmt_m2"}'; eq "Team gibt es nicht -> 404" "$CODE" 404
eq "gleiche Meldung fuer fremdes und fehlendes Team" "$(msg)" "$MSG_FREMD"
api "$LEAD2" POST "/api/team/$TA/mitglieder" '{"name":"tmt_m2"}'; eq "Leitung von Beta darf nicht in Alpha hinzufuegen -> 404" "$CODE" 404
api "$LEAD2" PATCH "/api/team/$TA/mitglieder/$UM1" '{"rolle":"leitung"}'; eq "Leitung von Beta: Rolle in Alpha -> 404" "$CODE" 404
api "$LEAD2" DELETE "/api/team/$TA/mitglieder/$UM1";             eq "Leitung von Beta: entfernen in Alpha -> 404" "$CODE" 404
eq "Alpha unveraendert (2 Mitglieder)" "$(zahl_mitglieder "$TA")" 2
team_sicht "$LEAD2" "$TA"; eq "Leitung von Beta sieht Alpha nicht in /api/team" "$(cat "$T/t.json")" "null"
api "$LEAD2" GET /api/team; hasnt "Beta-Leitung: keine Alpha-Mitglieder in der Antwort" "$(body)" "tmt_lead\""
# Client-Angaben zaehlen nicht: team_id/ID im Body/Query/Header wird ignoriert
api "$OUT" POST "/api/team/$TB/mitglieder" "{\"name\":\"tmt_m2\",\"team_id\":$TA,\"teamId\":$TA}"; eq "Body-team_id ueberstimmt Pfad nicht -> 404" "$CODE" 404

echo "== Mitglied darf nicht verwalten (403) =="
api "$M1" POST "/api/team/$TA/mitglieder" '{"name":"tmt_m2"}';   eq "Mitglied: hinzufuegen -> 403" "$CODE" 403
api "$M1" GET "/api/team/$TA/kandidaten?q=tmt";                  eq "Mitglied: kandidaten -> 403" "$CODE" 403
api "$M1" PATCH "/api/team/$TA/mitglieder/$ULEAD" '{"rolle":"mitglied"}'; eq "Mitglied: Rolle aendern -> 403" "$CODE" 403
api "$M1" PATCH "/api/team/$TA/mitglieder/$UM1" '{"rolle":"leitung"}';    eq "Mitglied: sich selbst befoerdern -> 403" "$CODE" 403
api "$M1" DELETE "/api/team/$TA/mitglieder/$ULEAD";              eq "Mitglied: anderen entfernen -> 403" "$CODE" 403
eq "Alpha unveraendert" "$(zahl_mitglieder "$TA")" 2
eq "m1 ist weiter Mitglied (nicht Leitung)" "$(rolle_in "$TA" "$UM1")" mitglied

echo "== Leitung fuegt hinzu =="
api "$LEAD" POST "/api/team/$TA/mitglieder" '{"name":"tmt_m2"}';  eq "Leitung: hinzufuegen -> 200" "$CODE" 200
eq "m2 ist Mitglied" "$(rolle_in "$TA" "$UM2")" mitglied
team_sicht "$M2" "$TA"; eq "m2 sieht Alpha jetzt" "$(tj name)" "TT-Alpha"
eq "Alpha: 3 Mitglieder" "$(tj mitgliederZahl)" 3
api "$LEAD" POST "/api/team/$TA/mitglieder" '{"name":"tmt_m2"}';  eq "Duplikat -> 409" "$CODE" 409
api "$LEAD" POST "/api/team/$TA/mitglieder" '{"name":"TMT_M2"}';  eq "Duplikat in anderer Schreibweise -> 409" "$CODE" 409
api "$LEAD" POST "/api/team/$TA/mitglieder" '{"name":"tmt_lead"}'; eq "Leitung sich selbst hinzufuegen -> 409" "$CODE" 409
eq "Alpha weiter 3 Mitglieder" "$(zahl_mitglieder "$TA")" 3
api "$LEAD" POST "/api/team/$TA/mitglieder" '{"name":"tmt_gibtesnicht"}'; eq "unbekanntes Konto -> 404" "$CODE" 404; MSG_UNBEKANNT=$(msg)
api "$LEAD" POST "/api/team/$TA/mitglieder" '{"name":"tmt_adm"}'; eq "Admin-Konto durch Leitung -> 404" "$CODE" 404
eq "gleiche Meldung: 'gibt es nicht' und 'nicht hinzufuegbar'" "$(msg)" "$MSG_UNBEKANNT"
eq "Admin nicht in Alpha" "$(PSQL "SELECT count(*) FROM team_mitglieder WHERE team_id=$TA AND user_id=$UADM")" 0
api "$COOKIE" POST "/api/team/$TA/mitglieder" '{"name":"tmt_adm"}'; eq "Inhaber (Nicht-Mitglied) darf Admin-Konto hinzufuegen -> 200" "$CODE" 200
api "$COOKIE" POST "/api/team/$TA/mitglieder" '{"name":"tmt_m3"}'; eq "Inhaber darf in jedes Team hinzufuegen -> 200" "$CODE" 200
eq "Alpha: 5 Mitglieder" "$(zahl_mitglieder "$TA")" 5
team_sicht "$LEAD" "$TA"
eq "Leitung sieht Admin-Mitglied als geschuetzt" "$(py "[m['geschuetzt'] for m in d['mitglieder'] if m['name']=='tmt_adm'][0]" <"$T/t.json")" "True"
eq "Leitung: normale Mitglieder nicht geschuetzt" "$(py "[m['geschuetzt'] for m in d['mitglieder'] if m['name']=='tmt_m2'][0]" <"$T/t.json")" "False"
team_sicht "$M1" "$TA"
eq "Mitglied sieht keine geschuetzt-Markierung" "$(py "[('geschuetzt' in m) for m in d['mitglieder']]" <"$T/t.json")" "[False, False, False, False, False]"

echo "== Admin-Konten bleiben unberuehrt =="
api "$LEAD" PATCH "/api/team/$TA/mitglieder/$UADM" '{"rolle":"leitung"}'; eq "Leitung: Admin befoerdern -> 403" "$CODE" 403
api "$LEAD" DELETE "/api/team/$TA/mitglieder/$UADM";              eq "Leitung: Admin entfernen -> 403" "$CODE" 403
eq "Admin weiter Mitglied" "$(rolle_in "$TA" "$UADM")" mitglied
api "$LEAD" PATCH "/api/team/$TA/mitglieder/$UM3" '{"rolle":"mitglied","role":"admin","rolle_id":1}'; eq "Zusatzfelder (role: admin) werden ignoriert -> 200" "$CODE" 200
eq "Konto-Rolle von m3 bleibt 'user'" "$(PSQL "SELECT role FROM users WHERE id=$UM3")" user
eq "Konto-Rolle des Inhabers bleibt 'owner'" "$(PSQL "SELECT role FROM users WHERE id=$UADMIN")" owner
eq "Konto-Rolle von tmt_adm bleibt 'admin'" "$(PSQL "SELECT role FROM users WHERE id=$UADM")" admin
api "$COOKIE" PATCH "/api/team/$TA/mitglieder/$UADM" '{"rolle":"leitung"}'; eq "Inhaber darf Admin-Mitglied befoerdern -> 200" "$CODE" 200
api "$COOKIE" DELETE "/api/team/$TA/mitglieder/$UADM"; eq "Inhaber darf Admin-Mitglied entfernen -> 200" "$CODE" 200
eq "Konto-Rolle von tmt_adm weiterhin 'admin'" "$(PSQL "SELECT role FROM users WHERE id=$UADM")" admin
api "$COOKIE" DELETE "/api/team/$TA/mitglieder/$UM3"; eq "Inhaber entfernt m3 -> 200" "$CODE" 200

echo "== Rolle aendern, letzte Leitung =="
api "$LEAD" PATCH "/api/team/$TA/mitglieder/$ULEAD" '{"rolle":"mitglied"}'; eq "einzige Leitung herabstufen -> 409" "$CODE" 409
has "Meldung zur letzten Leitung verstaendlich" "$(msg)" "einzige Leitung"
eq "lead bleibt Leitung" "$(rolle_in "$TA" "$ULEAD")" leitung
api "$LEAD" DELETE "/api/team/$TA/mitglieder/$ULEAD"; eq "einzige Leitung verlaesst Team -> 409" "$CODE" 409
has "Meldung beim Verlassen" "$(msg)" "einzige Leitung"
eq "lead noch im Team" "$(rolle_in "$TA" "$ULEAD")" leitung
api "$COOKIE" DELETE "/api/team/$TA/mitglieder/$ULEAD"; eq "auch der Inhaber kann die letzte Leitung nicht entfernen -> 409" "$CODE" 409
api "$LEAD" PATCH "/api/team/$TA/mitglieder/$UM2" '{"rolle":"leitung"}'; eq "Leitung befoerdert m2 -> 200" "$CODE" 200
eq "m2 ist Leitung" "$(rolle_in "$TA" "$UM2")" leitung
api "$LEAD" PATCH "/api/team/$TA/mitglieder/$UM2" '{"rolle":"leitung"}'; eq "gleiche Rolle nochmal -> 200 (keine Aenderung)" "$CODE" 200
api "$M2" GET /api/team; eq "m2: darfVerwalten nach Befoerderung" "$(py "[t['darfVerwalten'] for t in d['teams']][0]" <"$T/b")" "True"
api "$LEAD" PATCH "/api/team/$TA/mitglieder/$ULEAD" '{"rolle":"mitglied"}'; eq "lead stuft sich herab (m2 ist Leitung) -> 200" "$CODE" 200
eq "lead ist Mitglied" "$(rolle_in "$TA" "$ULEAD")" mitglied
api "$LEAD" POST "/api/team/$TA/mitglieder" '{"name":"tmt_out"}'; eq "herabgestufter lead darf nicht mehr hinzufuegen -> 403" "$CODE" 403
api "$M2" PATCH "/api/team/$TA/mitglieder/$UM2" '{"rolle":"mitglied"}'; eq "m2 ist jetzt letzte Leitung, Herabstufen -> 409" "$CODE" 409
api "$M2" PATCH "/api/team/$TA/mitglieder/$ULEAD" '{"rolle":"leitung"}'; eq "m2 gibt lead die Leitung zurueck -> 200" "$CODE" 200
api "$M2" PATCH "/api/team/$TA/mitglieder/$UM2" '{"rolle":"mitglied"}'; eq "m2 stuft sich herab -> 200" "$CODE" 200
api "$M2" PATCH "/api/team/$TA/mitglieder/$UM1" '{"rolle":"leitung"}'; eq "m2 (jetzt Mitglied) kann nicht befoerdern -> 403" "$CODE" 403
api "$LEAD" PATCH "/api/team/$TA/mitglieder/$UOUT" '{"rolle":"leitung"}'; eq "Rolle eines Nicht-Mitglieds -> 404" "$CODE" 404
api "$LEAD" PATCH "/api/team/$TA/mitglieder/$UM1" '{"rolle":"admin"}'; eq "ungueltige Rolle 'admin' -> 400" "$CODE" 400
api "$LEAD" PATCH "/api/team/$TA/mitglieder/$UM1" '{"rolle":["leitung"]}'; eq "Rolle als Array -> 400" "$CODE" 400
api "$LEAD" PATCH "/api/team/$TA/mitglieder/$UM1" '{"rolle":{"a":1}}'; eq "Rolle als Objekt -> 400" "$CODE" 400
api "$LEAD" PATCH "/api/team/$TA/mitglieder/$UM1" '{}'; eq "Rolle fehlt -> 400" "$CODE" 400
api "$LEAD" PATCH "/api/team/$TA/mitglieder/$UM1" '[]'; eq "Body als Array -> 400" "$CODE" 400
eq "m1 unveraendert Mitglied" "$(rolle_in "$TA" "$UM1")" mitglied

echo "== Team verlassen, Dateien bleiben =="
head -c 700000 /dev/urandom >"$T/f1.bin"; head -c 300000 /dev/urandom >"$T/f2.bin"
api "$LEAD" POST /api/cloud/ordner "{\"name\":\"TT-Ordner\",\"team\":$TA}"; TOR=$(py "d['ordner']['id']" <"$T/b")
[ -n "$TOR" ] || { echo "Team-Ordner nicht angelegt: $(body)"; exit 2; }
up() { curl -s -b "$1" -F "file=@$2" -F "ordner=$3" "$BASE/api/upload" | python3 -c "import sys,json;print(json.load(sys.stdin)['files'][0]['id'])"; }
team_sicht "$M1" "$TA"; VORHER=$(tj speicher.belegt); eq "Speicher vor Upload 0" "$VORHER" 0
F1=$(up "$M1" "$T/f1.bin" "$TOR")
[ -n "$F1" ] || { echo "Upload fehlgeschlagen"; exit 2; }
sleep 0.3
team_sicht "$LEAD" "$TA"
eq "Speicher nach Upload (m1, 700000 B) = 700000" "$(tj speicher.belegt)" 700000
eq "Speicher: frei = Limit - belegt" "$(tj speicher.frei)" $((10485760 - 700000))
eq "Speicher: Prozent 6.7" "$(tj speicher.prozent)" 6.7
eq "Anteil m1 = 700000" "$(py "[m['belegt'] for m in d['mitglieder'] if m['name']=='tmt_m1'][0]" <"$T/t.json")" 700000
eq "Anteil lead = 0" "$(py "[m['belegt'] for m in d['mitglieder'] if m['name']=='tmt_lead'][0]" <"$T/t.json")" 0
eq "Ordneranzahl Alpha = 1" "$(tj ordner)" 1
F2=$(up "$LEAD" "$T/f2.bin" "$TOR")
team_sicht "$M2" "$TA"
eq "Speicher nach zweitem Upload = 1000000" "$(tj speicher.belegt)" 1000000
eq "Summe der Mitglieder-Anteile = belegt" "$(py "sum(m['belegt'] for m in d['mitglieder'])" <"$T/t.json")" 1000000
# Papierkorb zaehlt mit
api "$LEAD" POST /api/cloud/loeschen "{\"dateien\":[\"$F2\"]}"
team_sicht "$M2" "$TA"; eq "Datei im Papierkorb zaehlt weiter mit" "$(tj speicher.belegt)" 1000000
api "$M2" GET /api/pro/teams; eq "Mitglied darf Admin-Sicht nicht lesen -> 403" "$CODE" 403
echo "-- Zahlen stimmen mit der Admin-Sicht ueberein --"
api "$COOKIE" GET /api/pro/teams; cp "$T/b" "$T/admin.json"
team_sicht "$LEAD" "$TA"
ADM=$(python3 - "$T/admin.json" "$T/t.json" <<'EOF'
import sys,json
a=json.load(open(sys.argv[1])); t=json.load(open(sys.argv[2]))
x=[x for x in a['teams'] if x['id']==t['id']][0]
ok=[x['belegt']==t['speicher']['belegt'], x['quota_bytes']==t['speicher']['limit'], x['quota_stufe']==t['speicher']['stufe'],
    x['ordner']==t['ordner'], sorted(m['username'] for m in x['mitglieder'])==sorted(m['name'] for m in t['mitglieder']),
    sorted((m['username'],m['rolle']) for m in x['mitglieder'])==sorted((m['name'],m['rolle']) for m in t['mitglieder'])]
print(''.join('1' if o else '0' for o in ok))
EOF
)
eq "Admin-Sicht: belegt, Limit, Stufe, Ordner, Mitglieder, Rollen identisch" "$ADM" "111111"
# Unterordner zaehlt mit
api "$LEAD" POST /api/cloud/ordner "{\"name\":\"Unter\",\"ordner\":$TOR}"; UNT=$(py "d['ordner']['id']" <"$T/b")
head -c 123456 /dev/urandom >"$T/f3.bin"; F3=$(up "$M1" "$T/f3.bin" "$UNT")
team_sicht "$LEAD" "$TA"; eq "Datei im Unterordner zaehlt mit (1123456)" "$(tj speicher.belegt)" 1123456
api "$COOKIE" GET /api/pro/teams; eq "Admin-Sicht gleich nach Unterordner-Upload" "$(py "[x['belegt'] for x in d['teams'] if x['id']==$TA][0]" <"$T/b")" 1123456
# Warnstufen
admin_team "{\"aktion\":\"aendern\",\"id\":$TA,\"quota_bytes\":1300000}"
team_sicht "$M1" "$TA"; eq "86,5 % -> Stufe warn" "$(tj speicher.stufe)" warn
admin_team "{\"aktion\":\"aendern\",\"id\":$TA,\"quota_bytes\":1150000}"
team_sicht "$M1" "$TA"; eq "97,7 % -> Stufe kritisch" "$(tj speicher.stufe)" kritisch
admin_team "{\"aktion\":\"aendern\",\"id\":$TA,\"quota_bytes\":1123456}"
team_sicht "$M1" "$TA"; eq "100 % -> Stufe voll" "$(tj speicher.stufe)" voll
eq "voll: ausgeschoepft" "$(tj speicher.ausgeschoepft)" "true"
eq "voll: frei 0" "$(tj speicher.frei)" 0
admin_team "{\"aktion\":\"aendern\",\"id\":$TA,\"quota_bytes\":null}"
team_sicht "$M1" "$TA"; eq "ohne Limit: limit null" "$(tj speicher.limit)" "null"
eq "ohne Limit: frei null" "$(tj speicher.frei)" "null"
eq "ohne Limit: prozent null" "$(tj speicher.prozent)" "null"
eq "ohne Limit: belegt bleibt" "$(tj speicher.belegt)" 1123456
eq "ohne Limit: nie ausgeschoepft" "$(tj speicher.ausgeschoepft)" "false"
admin_team "{\"aktion\":\"aendern\",\"id\":$TA,\"quota_bytes\":10485760}"
# Team verlassen
api "$M1" DELETE "/api/team/$TA/mitglieder/$UM1"; eq "m1 verlaesst Team -> 200" "$CODE" 200
eq "m1 nicht mehr in Alpha" "$(PSQL "SELECT count(*) FROM team_mitglieder WHERE team_id=$TA AND user_id=$UM1")" 0
eq "m1 weiter in Beta" "$(rolle_in "$TB" "$UM1")" mitglied
team_sicht "$M1" "$TA"; eq "m1 sieht Alpha nicht mehr" "$(cat "$T/t.json")" "null"
api "$M1" POST "/api/team/$TA/mitglieder" '{"name":"tmt_m1"}'; eq "m1 kann sich nicht selbst wieder hinzufuegen -> 404" "$CODE" 404
api "$M1" DELETE "/api/team/$TA/mitglieder/$UM1"; eq "nochmal verlassen -> 404" "$CODE" 404
eq "Datei von m1 bleibt im Team-Ordner" "$(PSQL "SELECT count(*) FROM files WHERE id=$F1 AND folder_id=$TOR")" 1
team_sicht "$LEAD" "$TA"
eq "Team-Speicher unveraendert nach Austritt" "$(tj speicher.belegt)" 1123456
eq "sonstige = Dateien des Ausgetretenen (823456)" "$(tj speicher.sonstige)" 823456
api "$M1" GET "/api/cloud/liste?ordner=$TOR"; eq "m1 hat keinen Zugriff mehr auf den Team-Ordner (Liste)" "$([ "$CODE" = 200 ] && echo offen || echo zu)" zu
api "$COOKIE" GET /api/pro/teams; eq "Admin-Sicht nach Austritt gleich" "$(py "[x['belegt'] for x in d['teams'] if x['id']==$TA][0]" <"$T/b")" 1123456
api "$LEAD" POST "/api/team/$TA/mitglieder" '{"name":"tmt_m1"}'; eq "Leitung nimmt m1 wieder auf -> 200" "$CODE" 200
team_sicht "$LEAD" "$TA"; eq "m1 hat wieder seinen Anteil (823456)" "$(py "[m['belegt'] for m in d['mitglieder'] if m['name']=='tmt_m1'][0]" <"$T/t.json")" 823456
api "$LEAD" DELETE "/api/team/$TA/mitglieder/$UM1"; eq "Leitung entfernt m1 -> 200" "$CODE" 200
eq "m1 weg" "$(PSQL "SELECT count(*) FROM team_mitglieder WHERE team_id=$TA AND user_id=$UM1")" 0
api "$LEAD" DELETE "/api/team/$TA/mitglieder/$UM1"; eq "m1 nochmal entfernen -> 404" "$CODE" 404

echo "== Eingabemissbrauch: IDs =="
for id in abc 0 -1 99999999999 2147483648 1.5 1e3 %20 01 0x10 "1%20OR%201=1"; do
  api "$LEAD" POST "/api/team/$id/mitglieder" '{"name":"tmt_m3"}'; eq "Team-ID '$id' (hinzufuegen) -> 400" "$CODE" 400
done
for id in abc 0 -1 99999999999 2147483648 1.5; do
  api "$LEAD" PATCH "/api/team/$TA/mitglieder/$id" '{"rolle":"leitung"}'; eq "Nutzer-ID '$id' (Rolle) -> 400" "$CODE" 400
  api "$LEAD" DELETE "/api/team/$TA/mitglieder/$id"; eq "Nutzer-ID '$id' (entfernen) -> 400" "$CODE" 400
done
api "$LEAD" GET "/api/team/abc/kandidaten?q=tmt"; eq "Team-ID 'abc' (kandidaten) -> 400" "$CODE" 400
api "$LEAD" DELETE "/api/team/$TA/mitglieder/2147483647"; eq "groesste gueltige ID, kein Mitglied -> 404" "$CODE" 404

echo "== Eingabemissbrauch: Namen =="
BEFORE_USERS=$(PSQL "SELECT count(*) FROM users")
N64=$(python3 -c "print('a'*64)"); N65=$(python3 -c "print('a'*65)"); N5000=$(python3 -c "print('a'*5000)")
for n in "' OR 1=1 --" "x'; DROP TABLE users; --" '%' '_' '%%' '\' "tmt_m3\\" 'Ünï😀' '日本語' "$N64" '<script>alert(1)</script>' '../../etc/passwd' ' tmt_gibtnicht'; do
  api "$LEAD5" POST "/api/team/$TC/mitglieder" "$(jn "$n")"
  case "$CODE" in 404) ok "Name '${n:0:24}' -> 404 (kein Treffer, kein Fehler)";; *) fail "Name '${n:0:24}'" "Status $CODE: $(body | head -c 200)";; esac
done
api "$LEAD5" POST "/api/team/$TC/mitglieder" "$(jn "$N65")"; eq "Name mit 65 Zeichen -> 400" "$CODE" 400
api "$LEAD5" POST "/api/team/$TC/mitglieder" "$(jn "$N5000")"; eq "Name mit 5000 Zeichen -> 400" "$CODE" 400
api "$LEAD5" POST "/api/team/$TC/mitglieder" '{"name":""}'; eq "leerer Name -> 400" "$CODE" 400
api "$LEAD5" POST "/api/team/$TC/mitglieder" '{"name":"   "}'; eq "Name nur Leerzeichen -> 400" "$CODE" 400
api "$LEAD5" POST "/api/team/$TC/mitglieder" '{"name":"a\u0000b"}'; eq "Name mit NUL -> 400" "$CODE" 400
api "$LEAD5" POST "/api/team/$TC/mitglieder" '{"name":"a\nb"}'; eq "Name mit Zeilenumbruch -> 400" "$CODE" 400
api "$LEAD6" POST "/api/team/$TC/mitglieder" '{"name":["tmt_m3"]}'; eq "Name als Array -> 400" "$CODE" 400
api "$LEAD6" POST "/api/team/$TC/mitglieder" '{"name":{"$ne":"x"}}'; eq "Name als Objekt -> 400" "$CODE" 400
api "$LEAD6" POST "/api/team/$TC/mitglieder" '{"name":123}'; eq "Name als Zahl -> 400" "$CODE" 400
api "$LEAD6" POST "/api/team/$TC/mitglieder" '{"name":null}'; eq "Name null -> 400" "$CODE" 400
api "$LEAD6" POST "/api/team/$TC/mitglieder" '{"name":true}'; eq "Name boolesch -> 400" "$CODE" 400
api "$LEAD6" POST "/api/team/$TC/mitglieder" '{}'; eq "Body ohne Name -> 400" "$CODE" 400
api "$LEAD6" POST "/api/team/$TC/mitglieder" '[]'; eq "Body als Array -> 400" "$CODE" 400
api "$LEAD6" POST "/api/team/$TC/mitglieder" '"tmt_m3"'; eq "Body als Text -> 400" "$CODE" 400
api "$LEAD6" POST "/api/team/$TC/mitglieder" 'kein json{'; eq "kaputtes JSON -> 400" "$CODE" 400
api "$LEAD6" POST "/api/team/$TC/mitglieder"; eq "ohne Body -> 400" "$CODE" 400
eq "Konten-Tabelle unveraendert (kein SQL-Effekt)" "$(PSQL "SELECT count(*) FROM users")" "$BEFORE_USERS"
eq "Gamma unveraendert (rl, lead5, lead6)" "$(zahl_mitglieder "$TC")" 3

echo "== Vorschlaege (kandidaten) =="
api "$LEAD" GET "/api/team/$TA/kandidaten?q=t";            eq "1 Zeichen -> 400" "$CODE" 400
api "$LEAD" GET "/api/team/$TA/kandidaten";                eq "ohne q -> 400" "$CODE" 400
api "$LEAD" GET "/api/team/$TA/kandidaten?q=";             eq "leeres q -> 400" "$CODE" 400
api "$LEAD" GET "/api/team/$TA/kandidaten?q=%20%20";       eq "q nur Leerzeichen -> 400" "$CODE" 400
api "$LEAD" GET "/api/team/$TA/kandidaten?q=ab&q=cd";      eq "q als Array -> 400" "$CODE" 400
api "$LEAD" GET "/api/team/$TA/kandidaten?q%5Ba%5D=bc";        eq "q als Objekt -> 400" "$CODE" 400
api "$LEAD" GET "/api/team/$TA/kandidaten?q=$N65";         eq "q mit 65 Zeichen -> 400" "$CODE" 400
api "$LEAD" GET "/api/team/$TA/kandidaten?q=tmt_zq";       eq "q='tmt_zq' -> 200" "$CODE" 200
eq "hoechstens 8 Treffer (12 passende Konten)" "$(py "len(d['kandidaten'])" <"$T/b")" 8
eq "nur das Feld 'name'" "$(py "sorted({k for x in d['kandidaten'] for k in x})" <"$T/b")" "['name']"
hasnt "keine E-Mail im Ergebnis" "$(body)" "@"
api "$LEAD" GET "/api/team/$TA/kandidaten?q=TMT_ZQ1";      eq "Gross-/Kleinschreibung egal; Treffer tmt_zq1, tmt_zq10..12" "$(py "sorted(x['name'] for x in d['kandidaten'])" <"$T/b")" "['tmt_zq1', 'tmt_zq10', 'tmt_zq11', 'tmt_zq12']"
api "$LEAD" GET "/api/team/$TA/kandidaten?q=zq1";          eq "Teilstring (nicht nur Praefix) trifft" "$(py "len(d['kandidaten'])" <"$T/b")" 4
api "$LEAD" GET "/api/team/$TA/kandidaten?q=zzpre";        eq "Praefix-Treffer zuerst" "$(py "[x['name'] for x in d['kandidaten']]" <"$T/b")" "['zzpre_x', 'tmt_zzpre']"
api "$LEAD" GET "/api/team/$TA/kandidaten?q=%25%25";       eq "'%%' ist kein Platzhalter -> 0 Treffer" "$(py "len(d['kandidaten'])" <"$T/b")" 0
api "$LEAD" GET "/api/team/$TA/kandidaten?q=__";           eq "'__' ist kein Platzhalter -> 0 Treffer" "$(py "len(d['kandidaten'])" <"$T/b")" 0
api "$LEAD" GET "/api/team/$TA/kandidaten?q=%27%20OR%201%3D1%20--"; eq "SQL im q -> 200, 0 Treffer" "$CODE/$(py "len(d['kandidaten'])" <"$T/b")" "200/0"
api "$LEAD" GET "/api/team/$TA/kandidaten?q=tmt_m2";       eq "schliesst Mitglieder aus (m2)" "$(py "len(d['kandidaten'])" <"$T/b")" 0
api "$LEAD" GET "/api/team/$TA/kandidaten?q=tmt_adm";      eq "Leitung sieht keine Admin-Konten" "$(py "len(d['kandidaten'])" <"$T/b")" 0
api "$COOKIE" GET "/api/team/$TA/kandidaten?q=tmt_adm";    eq "Inhaber sieht Admin-Konten" "$(py "[x['name'] for x in d['kandidaten']]" <"$T/b")" "['tmt_adm']"
api "$LEAD" POST "/api/team/$TA/mitglieder" '{"name":"tmt_zq1"}'; eq "zq1 hinzugefuegt" "$CODE" 200
api "$LEAD" GET "/api/team/$TA/kandidaten?q=tmt_zq1";      eq "zq1 jetzt Mitglied -> nicht mehr vorgeschlagen (nur zq10..12)" "$(py "sorted(x['name'] for x in d['kandidaten'])" <"$T/b")" "['tmt_zq10', 'tmt_zq11', 'tmt_zq12']"
api "$LEAD2" GET "/api/team/$TA/kandidaten?q=tmt_zq";      eq "Leitung eines anderen Teams -> 404" "$CODE" 404
api "$OUT" GET "/api/team/$TA/kandidaten?q=tmt_zq";        eq "Nicht-Mitglied -> 404 (kein Konten-Orakel)" "$CODE" 404

echo "== Ereignisprotokoll =="
EV=$(PSQL "SELECT detail::text FROM events WHERE type='team_mitglied_hinzugefuegt' ORDER BY id DESC LIMIT 1")
has "Ereignis team_mitglied_hinzugefuegt vorhanden" "$EV" "konto"
hasnt "Ereignis ohne Passwort" "$EV" "passw"
hasnt "Ereignis ohne Token/Cookie" "$EV" "token"
eq "Ereignisse fuer hinzufuegen/entfernen/Rolle/verlassen vorhanden" "$(PSQL "SELECT count(DISTINCT type) FROM events WHERE type IN ('team_mitglied_hinzugefuegt','team_mitglied_entfernt','team_rolle_geaendert','team_verlassen')")" 4

echo "== 200er-Grenze =="
PSQL "INSERT INTO users(username,password,email) SELECT 'tmt_bulk'||g, 'x', '' FROM generate_series(1,205) g" >/dev/null
PSQL "INSERT INTO team_mitglieder(team_id,user_id) SELECT $TD, id FROM users WHERE username LIKE 'tmt\_bulk%' ORDER BY id LIMIT 199" >/dev/null
eq "Delta: 200 Mitglieder (Leitung + 199)" "$(zahl_mitglieder "$TD")" 200
api "$LEAD4" POST "/api/team/$TD/mitglieder" '{"name":"tmt_bulk205"}'; eq "201. Mitglied -> 409" "$CODE" 409
has "Meldung nennt die Grenze" "$(msg)" "200"
eq "Delta bleibt bei 200" "$(zahl_mitglieder "$TD")" 200
api "$LEAD4" GET /api/team; eq "GET /api/team mit 200 Mitgliedern -> 200" "$CODE" 200
eq "200 Mitglieder in der Antwort" "$(py "len(d['teams'][0]['mitglieder'])" <"$T/b")" 200
eq "mitgliederZahl 200" "$(py "d['teams'][0]['mitgliederZahl']" <"$T/b")" 200
UB1=$(uid_of tmt_bulk1)
api "$LEAD4" DELETE "/api/team/$TD/mitglieder/$UB1"; eq "eines entfernen -> 200" "$CODE" 200
api "$LEAD4" POST "/api/team/$TD/mitglieder" '{"name":"tmt_bulk205"}'; eq "wieder 200 -> 200" "$CODE" 200
api "$LEAD4" POST "/api/team/$TD/mitglieder" '{"name":"tmt_bulk204"}'; eq "danach wieder voll -> 409" "$CODE" 409
# parallel: 198 Mitglieder, 5 gleichzeitig hinzufuegen -> genau 2 klappen
PSQL "DELETE FROM team_mitglieder WHERE team_id=$TD AND user_id IN (SELECT id FROM users WHERE username IN ('tmt_bulk205','tmt_bulk199'))" >/dev/null
eq "Delta fuer Rennen-Test auf 198" "$(zahl_mitglieder "$TD")" 198
AKT=$(zahl_mitglieder "$TD")
for n in 201 202 203 204 205; do
  ( c=$(curl -s -o /dev/null -w '%{http_code}' -b "$LEAD4" -H 'content-type: application/json' -d "{\"name\":\"tmt_bulk$n\"}" "$BASE/api/team/$TD/mitglieder"); echo "$c" >"$T/par$n" ) &
done
wait
ERFOLG=$(cat "$T"/par20? 2>/dev/null | grep -c '^200$'); KONFLIKT=$(cat "$T"/par20? 2>/dev/null | grep -c '^409$')
eq "parallel: Platz fuer $((200 - AKT)), erfolgreich $ERFOLG (Rest 409: $KONFLIKT)" "$ERFOLG/$KONFLIKT" "$((200 - AKT))/$((5 - (200 - AKT)))"
eq "parallel: nie ueber 200" "$(zahl_mitglieder "$TD")" 200

echo "== Rate-Limits =="
# Hinzufuegen: 30 je Stunde und Nutzer (Fehlversuche zaehlen mit)
SC=""
for i in $(seq 1 33); do api "$RL" POST "/api/team/$TC/mitglieder" '{"name":"tmt_gibtesnicht"}'; SC="$SC $CODE"; done
eq "hinzufuegen: die ersten 30 Antworten sind 404" "$(echo $SC | tr ' ' '\n' | head -30 | sort -u | tr '\n' ' ')" "404 "
eq "hinzufuegen: ab dem 31. Versuch 429" "$(echo $SC | tr ' ' '\n' | tail -3 | sort -u | tr '\n' ' ')" "429 "
eq "gesperrte Anfrage legt nichts an (Gamma: rl, lead5, lead6)" "$(zahl_mitglieder "$TC")" 3
# Vorschlaege: 60 je Minute und Nutzer
SC=""
for i in $(seq 1 64); do api "$LEAD2" GET "/api/team/$TB/kandidaten?q=tmt_zq"; SC="$SC $CODE"; done
eq "kandidaten: die ersten 60 Antworten sind 200" "$(echo $SC | tr ' ' '\n' | head -60 | sort -u | tr '\n' ' ')" "200 "
eq "kandidaten: danach 429" "$(echo $SC | tr ' ' '\n' | tail -3 | sort -u | tr '\n' ' ')" "429 "
api "$LEAD" GET "/api/team/$TA/kandidaten?q=tmt_zq";  eq "Limit gilt je Nutzer: andere Leitung unberuehrt" "$CODE" 200

echo "== Live-Meldung 'teams' (/api/live) =="
live() { curl -sN -b "$1" "$BASE/api/live" >"$T/live-$2" 2>/dev/null & LIVE_PIDS="$LIVE_PIDS $!"; }
live "$LEAD" lead; live "$M2" m2; live "$OUT" out; live "$NEU" neu; live "$M3" m3
sleep 1.5
n_teams() { grep -c '"t":"teams"' "$T/live-$1" 2>/dev/null || true; }
n_dat() { grep -c '"t":"dateien"' "$T/live-$1" 2>/dev/null || true; }
B_LEAD=$(n_teams lead); B_M2=$(n_teams m2); B_OUT=$(n_teams out); B_NEU=$(n_teams neu)
api "$LEAD" POST "/api/team/$TA/mitglieder" '{"name":"tmt_neu"}'; eq "Live-Vorbereitung: neu hinzugefuegt" "$CODE" 200
sleep 1.2
[ "$(n_teams lead)" -gt "$B_LEAD" ] && ok "Hinzufuegen: Leitung bekommt 'teams'" || fail "Hinzufuegen: Leitung bekommt 'teams'"
[ "$(n_teams m2)" -gt "$B_M2" ] && ok "Hinzufuegen: anderes Mitglied bekommt 'teams'" || fail "Hinzufuegen: anderes Mitglied bekommt 'teams'"
[ "$(n_teams neu)" -gt "$B_NEU" ] && ok "Hinzufuegen: das neue Mitglied bekommt 'teams'" || fail "Hinzufuegen: das neue Mitglied bekommt 'teams'"
eq "Hinzufuegen: Nicht-Mitglied bekommt nichts" "$(n_teams out)" "$B_OUT"
B_LEAD=$(n_teams lead); B_M2=$(n_teams m2); B_NEU=$(n_teams neu)
api "$LEAD" PATCH "/api/team/$TA/mitglieder/$UM2" '{"rolle":"leitung"}'; sleep 1.2
[ "$(n_teams m2)" -gt "$B_M2" ] && ok "Rolle: betroffenes Mitglied bekommt 'teams'" || fail "Rolle: betroffenes Mitglied bekommt 'teams'"
[ "$(n_teams neu)" -gt "$B_NEU" ] && ok "Rolle: unbeteiligtes Mitglied bekommt 'teams'" || fail "Rolle: unbeteiligtes Mitglied bekommt 'teams'"
B_LEAD=$(n_teams lead); B_NEU=$(n_teams neu); B_M3=$(n_teams m3)
api "$LEAD" DELETE "/api/team/$TA/mitglieder/$UNEU"; sleep 1.2
[ "$(n_teams neu)" -gt "$B_NEU" ] && ok "Entfernen: der Entfernte bekommt 'teams'" || fail "Entfernen: der Entfernte bekommt 'teams'"
[ "$(n_teams lead)" -gt "$B_LEAD" ] && ok "Entfernen: Leitung bekommt 'teams'" || fail "Entfernen: Leitung bekommt 'teams'"
eq "Entfernen: Nicht-Mitglied bekommt nichts" "$(n_teams out)" "$B_OUT"
eq "Entfernen: Mitglied eines anderen Teams bekommt nichts" "$(n_teams m3)" "$B_M3"
B_M2=$(n_teams m2)
admin_team "{\"aktion\":\"aendern\",\"id\":$TA,\"quota_bytes\":20971520}"; sleep 1.2
[ "$(n_teams m2)" -gt "$B_M2" ] && ok "Team-Kontingent geaendert: Mitglied bekommt 'teams'" || fail "Team-Kontingent geaendert: Mitglied bekommt 'teams'"
B_M2=$(n_teams m2); B_OUT=$(n_teams out)
admin_team "{\"aktion\":\"aendern\",\"id\":$TA,\"quota_bytes\":20971520}"; sleep 1
eq "unveraenderter Team-Datensatz meldet nichts" "$(n_teams m2)" "$B_M2"
admin_team "{\"aktion\":\"aendern\",\"id\":$TA,\"farbe\":\"#22c55e\"}"; sleep 1.2
[ "$(n_teams m2)" -gt "$B_M2" ] && ok "Team-Farbe geaendert: Mitglied bekommt 'teams'" || fail "Team-Farbe geaendert: Mitglied bekommt 'teams'"
eq "Team-Aenderung: Nicht-Mitglied bekommt nichts" "$(n_teams out)" "$B_OUT"
B_D=$(n_dat m2)
head -c 5000 /dev/urandom >"$T/f4.bin"; up "$LEAD" "$T/f4.bin" "$TOR" >/dev/null; sleep 1.2
[ "$(n_dat m2)" -gt "$B_D" ] && ok "Upload in Team-Ordner: Mitglied bekommt 'dateien' (Speicheranzeige)" || fail "Upload in Team-Ordner: Mitglied bekommt 'dateien'"
B_D=$(n_dat out)
eq "Upload in Team-Ordner: Nicht-Mitglied bekommt kein 'dateien'" "$(n_dat out)" "$B_D"
B_M2=$(n_teams m2)
admin_team "{\"aktion\":\"mitglied\",\"id\":$TA,\"user_id\":$UM3,\"rolle\":\"mitglied\"}"; sleep 1.2
[ "$(n_teams m2)" -gt "$B_M2" ] && ok "Admin-Seite fuegt hinzu: Mitglieder bekommen 'teams'" || fail "Admin-Seite fuegt hinzu: Mitglieder bekommen 'teams'"
B_M2=$(n_teams m2); B_M3=$(n_teams m3)
admin_team "{\"aktion\":\"loeschen\",\"id\":$TA}"; sleep 1.2
[ "$(n_teams m3)" -gt "$B_M3" ] && ok "Team geloescht: ehemaliges Mitglied bekommt 'teams'" || fail "Team geloescht: ehemaliges Mitglied bekommt 'teams'"

echo "== Pro wieder aus =="
api "$COOKIE" POST /api/pro/lizenz '{"aktion":"entfernen"}'
api "$LEAD2" GET /api/team; eq "Pro aus: Leitung bekommt pro=false" "$(j pro <"$T/b")" "false"
api "$LEAD2" POST "/api/team/$TB/mitglieder" '{"name":"tmt_m2"}'; eq "Pro aus: Leitung hinzufuegen -> 404" "$CODE" 404

echo
echo "Ergebnis: $PASS bestanden, $FAIL fehlgeschlagen"
[ "$FAIL" = 0 ]
