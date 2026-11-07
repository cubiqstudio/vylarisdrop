#!/usr/bin/env bash
# Tests fuer "Grosse Dateien hinter Cloudflare": direkter DAV-Hostname, Windows-Skript, Streaming grosser Uploads.
#
# Aufruf:  scripts/test-gross.sh [Basis-URL] [Cookie-Datei] [DAV-Hostname] [Groesse-MB]
#   Standard: http://127.0.0.1:3323  /tmp/vdt-vd_sg/cookie.txt  dav.test.local  300
# Die Instanz muss mit VD_DAV_HOST=<DAV-Hostname> laufen. Optional im PATH: pwsh, caddy, fail2ban-regex, shellcheck (sonst SKIP).
# PID_FILE (Node-Prozess) fuer die Speichermessung, Standard /tmp/vdt-vd_sg/pid.
set -u
BASE="${1:-http://127.0.0.1:3323}"; COOKIE="${2:-/tmp/vdt-vd_sg/cookie.txt}"; DAVH="${3:-dav.test.local}"; MB="${4:-300}"
PID_FILE="${PID_FILE:-/tmp/vdt-vd_sg/pid}"
HIER="$(cd "$(dirname "$0")/.." && pwd)"; T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAIL=0; SKIP=0
ok()   { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf 'FAIL  %s  -- %s\n' "$1" "${2:-}"; }
skip() { SKIP=$((SKIP+1)); printf 'SKIP  %s  -- %s\n' "$1" "${2:-}"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1" "ist '$2', erwartet '$3'"; fi; }
code() { curl -s --noproxy '*' -o "$T/b" -w '%{http_code}' "$@"; }

# --- Skripte und Konfiguration (statisch) ---
bash -n "$HIER/deploy/dav-direkt.sh" && ok "dav-direkt.sh: bash -n" || fail "dav-direkt.sh: bash -n"
if command -v shellcheck >/dev/null; then shellcheck -S warning "$HIER/deploy/dav-direkt.sh" >/dev/null && ok "dav-direkt.sh: shellcheck" || fail "dav-direkt.sh: shellcheck"; else skip "shellcheck" "nicht installiert"; fi
if LC_ALL=C grep -qP '[^\x00-\x7F]' "$HIER/deploy/windows-webdav.ps1"; then fail "windows-webdav.ps1 ist nicht reines ASCII (PowerShell 5.1 liest sonst falsch)"; else ok "windows-webdav.ps1: reines ASCII"; fi
if command -v pwsh >/dev/null; then
  F=$(PSDATEI="$HIER/deploy/windows-webdav.ps1" pwsh -NoProfile -Command '$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($env:PSDATEI,[ref]$null,[ref]$e); $e.Count')
  eq "windows-webdav.ps1: PowerShell-Syntax" "$F" "0"
else skip "PowerShell-Syntax" "pwsh nicht installiert"; fi
if command -v caddy >/dev/null; then
  mkdir -p "$T/conf.d"; cp "$HIER/deploy/Caddyfile.dav" "$T/conf.d/dav.caddy"
  for datei in Caddyfile Caddyfile.dav-nur; do
    sed "s#/etc/caddy/conf.d/#$T/conf.d/#" "$HIER/deploy/$datei" > "$T/c"
    VD_DAV_HOST=dav.beispiel.de caddy validate --config "$T/c" --adapter caddyfile >/dev/null 2>&1 && ok "caddy validate: $datei + Caddyfile.dav" || fail "caddy validate: $datei"
  done
  VD_DAV_HOST=dav.beispiel.de VD_DAV_ERLAUBT="203.0.113.7 198.51.100.0/24 2001:db8::/32" caddy validate --config "$T/c" --adapter caddyfile >/dev/null 2>&1 && ok "caddy validate: mit Freigabeliste" || fail "caddy validate: Freigabeliste"
else skip "caddy validate" "caddy nicht installiert"; fi
if command -v fail2ban-regex >/dev/null; then
  cat > "$T/log" <<'LOG'
{"level":"info","logger":"http.log.access.log0","msg":"handled request","request":{"remote_ip":"203.0.113.9","client_ip":"203.0.113.9","method":"PROPFIND","uri":"/dav/","headers":{"Depth":["0"],"Authorization":["REDACTED"]}},"status":401,"resp_headers":{}}
{"level":"info","logger":"http.log.access.log0","msg":"handled request","request":{"remote_ip":"203.0.113.9","client_ip":"203.0.113.9","method":"PROPFIND","uri":"/dav/","headers":{"Depth":["0"]}},"status":401,"resp_headers":{}}
{"level":"info","logger":"http.log.access.log0","msg":"handled request","request":{"remote_ip":"203.0.113.9","client_ip":"203.0.113.9","method":"PROPFIND","uri":"/dav/","headers":{"Authorization":["REDACTED"]}},"status":207,"resp_headers":{}}
LOG
  N=$(fail2ban-regex "$T/log" "$HIER/deploy/fail2ban/vylariscloud-dav.conf" 2>&1 | sed -n 's/^Lines: .* \([0-9]*\) matched.*/\1/p')
  eq "fail2ban-Filter: nur 401 MIT Anmeldekopf zaehlt" "$N" "1"
else skip "fail2ban-Filter" "fail2ban-regex nicht installiert"; fi

# --- laufende Instanz ---
if ! curl -fs --noproxy '*' "$BASE/api/public/health" >/dev/null; then skip "Instanz" "$BASE nicht erreichbar"; echo "PASS=$PASS FAIL=$FAIL SKIP=$SKIP"; exit $((FAIL>0)); fi
SHA=$(sha256sum "$HIER/deploy/windows-webdav.ps1" | cut -d' ' -f1)
eq "Skript-Route liefert die Datei aus deploy/ (SHA-256)" "$(curl -s --noproxy '*' "$BASE/app/windows-webdav.ps1" | sha256sum | cut -d' ' -f1)" "$SHA"
eq "Skript-Route ?ansehen=1 ist inline" "$(curl -s -D - -o /dev/null --noproxy '*' "$BASE/app/windows-webdav.ps1?ansehen=1" | tr -d '\r' | sed -n 's/^[Cc]ontent-[Dd]isposition: //p')" "inline"
INFO=$(curl -s --noproxy '*' -b "$COOKIE" "$BASE/api/sync/info")
eq "/api/sync/info: grossAdresse" "$(printf '%s' "$INFO" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("grossAdresse"))')" "https://$DAVH/dav/"
eq "/api/sync/info: windowsSkript.sha256" "$(printf '%s' "$INFO" | python3 -c 'import sys,json;print(json.load(sys.stdin)["windowsSkript"]["sha256"])')" "$SHA"
eq "/api/sync/info: ueberCloudflare ohne cf-ray" "$(printf '%s' "$INFO" | python3 -c 'import sys,json;print(json.load(sys.stdin)["ueberCloudflare"])')" "False"
CF=$(curl -s --noproxy '*' -b "$COOKIE" -H 'cf-ray: abc-FRA' "$BASE/api/sync/info" | python3 -c 'import sys,json;print(json.load(sys.stdin)["ueberCloudflare"])')
eq "/api/sync/info: ueberCloudflare mit cf-ray" "$CF" "True"
# DAV-Host: nur /dav und /webdav, nur HTTPS (X-Forwarded-Proto)
H=(-H "Host: $DAVH")
eq "DAV-Host: / ist 404" "$(code "${H[@]}" -H 'X-Forwarded-Proto: https' "$BASE/")" "404"
eq "DAV-Host: /api/sync/info ist 404" "$(code "${H[@]}" -H 'X-Forwarded-Proto: https' "$BASE/api/sync/info")" "404"
eq "DAV-Host: /api/internal/caddy-ask ist 404" "$(code "${H[@]}" -H 'X-Forwarded-Proto: https' "$BASE/api/internal/caddy-ask?domain=$DAVH")" "404"
eq "DAV-Host: /davx ist 404" "$(code "${H[@]}" -H 'X-Forwarded-Proto: https' "$BASE/davx")" "404"
eq "DAV-Host: /dav/ ohne https ist 403" "$(code "${H[@]}" -X PROPFIND -H 'Depth: 0' "$BASE/dav/")" "403"
eq "DAV-Host: /dav/ ohne Anmeldung ist 401" "$(code "${H[@]}" -H 'X-Forwarded-Proto: https' -X PROPFIND -H 'Depth: 0' "$BASE/dav/")" "401"
eq "normaler Host: /api/sync/info weiter erreichbar" "$(code -b "$COOKIE" "$BASE/api/sync/info")" "200"
eq "Fremder Host wird nicht eingeschraenkt (Host: x.example.org, /api/public/health)" "$(code -H 'Host: x.example.org' "$BASE/api/public/health")" "200"

# --- grosser Upload: Speicher bleibt flach, Pruefsumme stimmt ---
PW=$(curl -s --noproxy '*' -b "$COOKIE" -H 'content-type: application/json' -d '{"name":"test-gross","schreiben":true}' "$BASE/api/sync/zugaenge" | python3 -c 'import sys,json;print(json.load(sys.stdin)["klar"])')
if [ -n "$PW" ] && [ -r "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE"); rss() { awk '/VmRSS/{print $2}' "/proc/$PID/status"; }
  head -c $((MB*1024*1024)) /dev/urandom > "$T/gross.bin"; S1=$(sha256sum "$T/gross.bin" | cut -d' ' -f1)
  ( while kill -0 $$ 2>/dev/null; do rss; sleep 0.2; done > "$T/rss" ) & MON=$!
  R0=$(rss)
  C=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -u "admin:$PW" -T "$T/gross.bin" "$BASE/dav/test-gross.bin")
  kill $MON 2>/dev/null; wait $MON 2>/dev/null
  eq "Upload ${MB} MB (Content-Length, Expect: 100-continue): 201" "$C" "201"
  MAXR=$(sort -n "$T/rss" | tail -1)
  if [ "${MAXR:-0}" -lt $((R0 + 150000)) ]; then ok "Speicher flach: vorher ${R0} kB, Spitze ${MAXR} kB (< +150 MB)"; else fail "Speicher steigt" "vorher $R0, Spitze $MAXR"; fi
  S2=$(curl -s --noproxy '*' -u "admin:$PW" "$BASE/dav/test-gross.bin" | sha256sum | cut -d' ' -f1); eq "Download: gleiche Pruefsumme" "$S2" "$S1"
  C2=$(head -c $((MB*1024*1024)) /dev/zero | curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -u "admin:$PW" -T - -H 'Transfer-Encoding: chunked' "$BASE/dav/test-gross-chunked.bin"); eq "Upload ohne Content-Length (chunked): 201" "$C2" "201"
  timeout 2 curl -s --noproxy '*' -u "admin:$PW" --limit-rate 20m -T "$T/gross.bin" "$BASE/dav/test-abbruch.bin" >/dev/null 2>&1; sleep 2
  eq "Abgebrochener Upload hinterlaesst keine Datei" "$(code -u "admin:$PW" -X PROPFIND -H 'Depth: 0' "$BASE/dav/test-abbruch.bin")" "404"
  for n in test-gross.bin test-gross-chunked.bin; do curl -s --noproxy '*' -o /dev/null -u "admin:$PW" -X DELETE "$BASE/dav/$n"; done
else skip "Upload-Test" "kein App-Passwort oder PID_FILE ($PID_FILE) fehlt"; fi
echo "PASS=$PASS FAIL=$FAIL SKIP=$SKIP"
exit $((FAIL>0))
