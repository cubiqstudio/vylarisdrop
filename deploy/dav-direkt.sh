#!/usr/bin/env bash
# VylarisCloud: direkter Hostname NUR fuer WebDAV ("Adresse fuer grosse Dateien", ohne Cloudflare davor).
# Hinter einem Cloudflare-Tunnel/-Proxy (Free/Pro) nimmt Cloudflare hoechstens 100 MB je Anfrage an; ein WebDAV-Upload ist
# eine einzige Anfrage. Dieses Skript richtet einen zweiten Hostnamen ein, der direkt auf den Server zeigt: Caddy holt dafuer
# ein eigenes Zertifikat und reicht NUR /dav und /webdav an die App weiter. Die Weboberflaeche bleibt hinter Cloudflare.
#
# ACHTUNG, Sicherheitsfolge: Dieser Hostname zeigt per DNS ("DNS only", graue Wolke) auf die IP deines Servers. Damit wird die
# Server-IP oeffentlich sichtbar, und Port 443 (80 zum Zertifikatsabruf) muss aus dem Internet erreichbar sein. Der Schutz von
# Cloudflare (DDoS-Filter, WAF, versteckte IP) gilt fuer diesen Namen NICHT. Lies den Abschnitt "Grosse Dateien hinter Cloudflare"
# in README.md, bevor du das einschaltest.
#
# Aufruf (im Installationsordner, z. B. /opt/vylariscloud):
#   sudo bash dav-direkt.sh --host dav.deinefirma.de [--erlaubt "203.0.113.7 198.51.100.0/24"] [--fail2ban] [--trocken]
#   sudo bash dav-direkt.sh --status
#   sudo bash dav-direkt.sh --entfernen [--fail2ban]
#
# --trocken zeigt nur, was passieren wuerde, und aendert nichts.
set -euo pipefail

QUELLE="${VD_QUELLE:-https://raw.githubusercontent.com/cubiqstudio/vylarisdrop/main/deploy}"
SKRIPT_ORDNER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST=""; ERLAUBT=""; DIR="${VD_DIR:-}"; TROCKEN=""; AKTION="einrichten"; F2B=""; JA=""; MODUS=""

if [ -t 1 ]; then R=$'\e[31m'; Y=$'\e[33m'; N=$'\e[0m'; else R=""; Y=""; N=""; fi
case "${VD_SKRIPT_SPRACHE:-${LC_ALL:-${LANG:-de}}}" in en*|EN*) SPR=en ;; *) SPR=de ;; esac
s() { if [ "$SPR" = en ]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }
say() { printf '%s\n' "$(s "$1" "$2")"; }
warn() { printf '%s%s%s\n' "$Y" "$(s "$1" "$2")" "$N"; }
fail() { printf '%sFEHLER/ERROR: %s%s\n' "$R" "$(s "$1" "$2")" "$N" >&2; exit 1; }
# Schreibende Schritte laufen nur ohne --trocken
tu() { if [ -n "$TROCKEN" ]; then printf '  [trocken/dry] %s\n' "$*"; else "$@"; fi; }

nutzung() {
  cat <<EOF
$(s "Aufruf" "Usage"): bash dav-direkt.sh --host dav.example.com [--erlaubt "IP/CIDR ..."] [--fail2ban] [--trocken] [--verzeichnis DIR] [--ja]
       bash dav-direkt.sh --status
       bash dav-direkt.sh --entfernen [--fail2ban]
  --host NAME       $(s "direkter Hostname (DNS only auf die Server-IP), NICHT der Name des Cloudflare-Tunnels" "direct hostname (DNS only to the server IP), NOT the name of the Cloudflare tunnel")
  --erlaubt LISTE   $(s "nur diese Adressen duerfen verbinden (Leerzeichen getrennt, IPv4/IPv6, mit /Netz); sonst alle" "only these addresses may connect (space separated, IPv4/IPv6, with /prefix); default all")
  --modus MODUS     $(s "nur-dav: Caddy bedient NUR den DAV-Namen (Standard, wenn ein Cloudflare Tunnel laeuft); zusaetzlich: die normale Caddyfile bleibt" "nur-dav: Caddy serves ONLY the DAV name (default when a Cloudflare tunnel runs); zusaetzlich: the normal Caddyfile stays")
  --fail2ban        $(s "fail2ban-Filter und -Jail fuer das Zugriffsprotokoll installieren (oder mit --entfernen wieder loeschen)" "install the fail2ban filter and jail for the access log (or remove them with --entfernen)")
  --trocken         $(s "nur anzeigen, nichts aendern" "show only, change nothing")
  --verzeichnis DIR $(s "Installationsordner (Standard: aktueller Ordner oder /opt/vylariscloud)" "install folder (default: current folder or /opt/vylariscloud)")
  --ja              $(s "keine Rueckfrage" "no confirmation prompt")
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --host) [ $# -ge 2 ] || fail "Wert fehlt: --host" "Missing value: --host"; HOST="$(printf '%s' "$2" | tr 'A-Z' 'a-z')"; shift 2 ;;
    --erlaubt) [ $# -ge 2 ] || fail "Wert fehlt: --erlaubt" "Missing value: --erlaubt"; ERLAUBT="$2"; shift 2 ;;
    --verzeichnis|--dir) [ $# -ge 2 ] || fail "Wert fehlt: --verzeichnis" "Missing value: --verzeichnis"; DIR="${2%/}"; shift 2 ;;
    --trocken|--dry-run) TROCKEN="ja"; shift ;;
    --modus) [ $# -ge 2 ] || fail "Wert fehlt: --modus" "Missing value: --modus"; MODUS="$2"; shift 2 ;;
    --fail2ban) F2B="ja"; shift ;;
    --ja|--yes|-y) JA="ja"; shift ;;
    --status) AKTION="status"; shift ;;
    --entfernen|--remove) AKTION="entfernen"; shift ;;
    -h|--help|--hilfe) nutzung; exit 0 ;;
    *) nutzung >&2; fail "Unbekannte Option: $1" "Unknown option: $1" ;;
  esac
done

# --- Installationsordner finden ---
if [ -z "$DIR" ]; then
  if [ -f "$PWD/docker-compose.yml" ] && [ -f "$PWD/.env" ]; then DIR="$PWD"
  elif [ -f /opt/vylariscloud/docker-compose.yml ]; then DIR="/opt/vylariscloud"
  else DIR="$PWD"; fi
fi
[ -f "$DIR/docker-compose.yml" ] && [ -f "$DIR/.env" ] || fail "Im Ordner $DIR liegt keine VylarisCloud-Installation (docker-compose.yml und .env fehlen). Mit --verzeichnis angeben." "There is no VylarisCloud installation in $DIR (docker-compose.yml and .env are missing). Pass --verzeichnis."
cd "$DIR"
[ "$(id -u)" -eq 0 ] || [ -n "$TROCKEN" ] || [ "$AKTION" = status ] || fail "Bitte als root ausfuehren (sudo bash dav-direkt.sh ...)." "Please run as root (sudo bash dav-direkt.sh ...)."

# --- .env lesen und schreiben ---
env_lesen() { sed -n "s/^$1=//p" .env 2>/dev/null | tail -1 | tr -d '"'"'"'\r'; }
env_setzen() { # Name Wert (in doppelten Anfuehrungszeichen)
  [ -n "$TROCKEN" ] && { printf '  [trocken/dry] .env: %s="%s"\n' "$1" "$2"; return 0; }
  local zeile="$1=$2"
  case "$2" in *" "*) zeile="$1=\"$2\"" ;; esac   # nur Werte mit Leerzeichen in Anfuehrungszeichen
  if grep -q "^$1=" .env; then
    # Zeile ersetzen, ohne Sonderzeichen des Werts als sed-Syntax zu deuten
    awk -v n="$1" -v z="$zeile" 'BEGIN{FS="="} $1==n {print z; next} {print}' .env > .env.neu && cat .env.neu > .env && rm -f .env.neu
  else
    [ -z "$(tail -c1 .env)" ] || printf '\n' >> .env
    printf '%s\n' "$zeile" >> .env
  fi
}
env_entfernen() { [ -n "$TROCKEN" ] && { printf '  [trocken/dry] .env: %s entfernen/remove\n' "$1"; return 0; }; sed -i "/^$1=/d" .env; }

host_gueltig() { printf '%s' "$1" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' && [ "${#1}" -le 253 ]; }
erlaubt_gueltig() {
  local x
  for x in $1; do printf '%s' "$x" | grep -Eq '^([0-9]{1,3}(\.[0-9]{1,3}){3}|[0-9a-fA-F:]{2,39})(/[0-9]{1,3})?$' || return 1; done
}
compose_dateien() { env_lesen COMPOSE_FILE; }

# Zeigt, ob eine Datei der Compose-Liste angehoert
in_liste() { printf '%s' "$1" | tr ':' '\n' | grep -qx "$2"; }

# --- Status ---
if [ "$AKTION" = status ]; then
  h="$(env_lesen VD_DAV_HOST)"
  if [ -z "$h" ]; then say "Kein direkter WebDAV-Hostname eingerichtet (VD_DAV_HOST fehlt in .env)." "No direct WebDAV hostname is set up (VD_DAV_HOST is missing in .env)."; exit 0; fi
  say "Direkter WebDAV-Hostname: $h" "Direct WebDAV hostname: $h"
  say "Erlaubte Adressen: $(env_lesen VD_DAV_ERLAUBT)" "Allowed addresses: $(env_lesen VD_DAV_ERLAUBT)"
  say "Modus: $([ -n "$(env_lesen VD_DAV_CADDYFILE)" ] && echo nur-dav || echo zusaetzlich)" "Mode: $([ -n "$(env_lesen VD_DAV_CADDYFILE)" ] && echo nur-dav || echo zusaetzlich)"
  say "COMPOSE_FILE: $(compose_dateien)" "COMPOSE_FILE: $(compose_dateien)"
  if command -v curl >/dev/null 2>&1; then
    c1=$(curl -s -o /dev/null -m 15 -w '%{http_code}' -X PROPFIND -H 'Depth: 0' "https://$h/dav/" 2>&1 || true)
    c2=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "https://$h/" 2>&1 || true)
    say "https://$h/dav/ ohne Anmeldung -> $c1 (erwartet 401)" "https://$h/dav/ without sign-in -> $c1 (expected 401)"
    say "https://$h/ -> $c2 (erwartet 404)" "https://$h/ -> $c2 (expected 404)"
  fi
  command -v fail2ban-client >/dev/null 2>&1 && fail2ban-client status vylariscloud-dav 2>/dev/null | sed 's/^/  /' || true
  exit 0
fi

# --- Entfernen ---
if [ "$AKTION" = entfernen ]; then
  cf="$(compose_dateien)"
  say "Entferne den direkten WebDAV-Hostnamen aus $DIR ..." "Removing the direct WebDAV hostname from $DIR ..."
  if in_liste "$cf" compose.dav-direkt.yml; then
    neu="$(printf '%s' "$cf" | tr ':' '\n' | grep -vx 'compose.dav-direkt.yml' | paste -sd: -)"
    env_setzen COMPOSE_FILE "$neu"
  fi
  env_entfernen VD_DAV_HOST; env_entfernen VD_DAV_ERLAUBT; env_entfernen VD_DAV_CADDYFILE
  if [ -n "$F2B" ]; then
    tu rm -f /etc/fail2ban/jail.d/vylariscloud-dav.local /etc/fail2ban/filter.d/vylariscloud-dav.conf
    command -v systemctl >/dev/null 2>&1 && tu systemctl restart fail2ban || true
  fi
  tu docker compose up -d
  say "Fertig. Den DNS-Eintrag des Hostnamens bitte selbst loeschen. Das Zugriffsprotokoll bleibt in $DIR/caddy-logs." "Done. Please delete the DNS record of the hostname yourself. The access log stays in $DIR/caddy-logs."
  exit 0
fi

# --- Einrichten: Pruefungen ---
[ -n "$HOST" ] || { nutzung >&2; fail "--host fehlt." "--host is missing."; }
host_gueltig "$HOST" || fail "Das ist kein gueltiger Hostname: $HOST" "This is not a valid hostname: $HOST"
[ -z "$ERLAUBT" ] || erlaubt_gueltig "$ERLAUBT" || fail "--erlaubt: nur IP-Adressen oder Netze (z. B. 203.0.113.7 198.51.100.0/24 2001:db8::/32), Leerzeichen getrennt." "--erlaubt: only IP addresses or networks (e.g. 203.0.113.7 198.51.100.0/24 2001:db8::/32), space separated."
CF="$(compose_dateien)"
in_liste "$CF" compose.caddy.yml || fail "Dieser Weg braucht den mitgelieferten Caddy (compose.caddy.yml in COMPOSE_FILE der .env, jetzt: '${CF:-leer}'). Bei einem eigenen Webserver (nginx, Apache) lege den zweiten Hostnamen dort an - siehe README.md, Abschnitt 'Grosse Dateien hinter Cloudflare'." "This needs the bundled Caddy (compose.caddy.yml in COMPOSE_FILE of the .env, now: '${CF:-empty}'). With your own web server (nginx, Apache) create the second hostname there - see README.md, section 'Grosse Dateien hinter Cloudflare'."
if [ -f ".env" ] && [ -n "$(env_lesen VD_PROXY_DOMAIN)" ]; then warn "Hinweis: VD_PROXY_DOMAIN ist gesetzt (App hinter eigenem Webserver). Pruefe, dass dein Webserver den neuen Namen ebenfalls bedient." "Note: VD_PROXY_DOMAIN is set (app behind your own web server). Make sure your web server also serves the new name."; fi

# Modus: laeuft die Weboberflaeche ueber einen Cloudflare Tunnel, bedient Caddy nur den DAV-Namen; sonst bleibt die normale Caddyfile
TUNNEL=""; if grep -q '^COMPOSE_PROFILES=.*tunnel' .env 2>/dev/null || [ -n "$(env_lesen VD_TUNNEL_TOKEN)" ]; then TUNNEL="ja"; fi
if [ -z "$MODUS" ]; then if [ -n "$TUNNEL" ]; then MODUS="nur-dav"; else MODUS="zusaetzlich"; fi; fi
case "$MODUS" in nur-dav|zusaetzlich) ;; *) fail "--modus: nur-dav oder zusaetzlich." "--modus: nur-dav or zusaetzlich." ;; esac
if [ "$MODUS" = "nur-dav" ] && [ -z "$TUNNEL" ] && [ -z "$JA" ] && [ -z "$TROCKEN" ]; then
  warn "Modus nur-dav ohne erkannten Cloudflare Tunnel: Caddy beantwortet dann KEINE andere Adresse mehr, die Weboberflaeche waere ueber Caddy nicht mehr erreichbar. Mit --modus zusaetzlich bleibt sie erreichbar; bestaetige nur-dav mit --ja." "Mode nur-dav without a detected Cloudflare tunnel: Caddy would then answer NO other address, the web interface would no longer be reachable through Caddy. --modus zusaetzlich keeps it reachable; confirm nur-dav with --ja."
  fail "Abgebrochen." "Cancelled."
fi

say "==> Direkter WebDAV-Hostname $HOST (Installation: $DIR)" "==> Direct WebDAV hostname $HOST (installation: $DIR)"

# DNS pruefen (nur Hinweis): zeigt der Name auf diesen Server und nicht auf Cloudflare?
meine_ip=""; command -v curl >/dev/null 2>&1 && meine_ip=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
aufgeloest=$(getent ahostsv4 "$HOST" 2>/dev/null | awk '{print $1}' | sort -u | paste -sd' ' - || true)
if [ -z "$aufgeloest" ]; then
  warn "DNS: $HOST hat noch keinen A-Eintrag. Lege ihn an: Typ A, Name $HOST, Ziel ${meine_ip:-<Server-IP>}, bei Cloudflare 'Nur DNS' (graue Wolke). Das Zertifikat gibt es erst, wenn der Eintrag stimmt." "DNS: $HOST has no A record yet. Create it: type A, name $HOST, target ${meine_ip:-<server IP>}, at Cloudflare 'DNS only' (grey cloud). The certificate only works once the record is correct."
elif [ -n "$meine_ip" ] && ! printf '%s' " $aufgeloest " | grep -q " $meine_ip "; then
  warn "DNS: $HOST zeigt auf $aufgeloest, dieser Server hat aber ${meine_ip}. Bei Cloudflare muss die Wolke grau sein (nur DNS), sonst laeuft es wieder durch Cloudflare und das 100-MB-Limit gilt weiter." "DNS: $HOST points to $aufgeloest but this server is $meine_ip. At Cloudflare the cloud must be grey (DNS only), otherwise traffic goes through Cloudflare again and the 100 MB limit still applies."
else
  say "DNS: $HOST -> $aufgeloest (stimmt mit dieser Server-IP ueberein)" "DNS: $HOST -> $aufgeloest (matches this server's IP)"
fi

if [ "$MODUS" = "nur-dav" ]; then
  say "Modus nur-dav: Caddy bedient nur $HOST (alles andere auf 80/443 ist 404 bzw. ohne Antwort). Die Weboberflaeche laeuft weiter NUR ueber den Tunnel (cloudflared erreicht die App direkt, nicht ueber Caddy); die normale Caddyfile wird nicht mehr benutzt." "Mode nur-dav: Caddy serves only $HOST (everything else on 80/443 is 404 or unanswered). The web interface keeps running ONLY through the tunnel (cloudflared reaches the app directly, not through Caddy); the normal Caddyfile is no longer used."
else
  say "Modus zusaetzlich: die normale Caddyfile bleibt; ist die Server-IP bekannt, antwortet Caddy auf 80/443 weiter mit der Weboberflaeche (nicht nur mit WebDAV)." "Mode zusaetzlich: the normal Caddyfile stays; if the server IP is known, Caddy keeps answering on 80/443 with the web interface (not only WebDAV)."
fi
echo
warn "SICHERHEITSFOLGE: Nach dem Einschalten ist die IP dieses Servers ueber $HOST oeffentlich sichtbar, und Port 443 (80 zum Zertifikatsabruf) muss aus dem Internet erreichbar sein. Cloudflare schuetzt diesen Namen nicht (kein DDoS-Filter, keine WAF)." "SECURITY CONSEQUENCE: Once enabled, this server's IP is publicly visible via $HOST, and port 443 (80 for the certificate) must be reachable from the internet. Cloudflare does not protect this name (no DDoS filter, no WAF)."
say "Erreichbar ist ueber den Namen nur /dav und /webdav (alles andere ist 404), nur per HTTPS, mit Anmeldung per App-Passwort; die App sperrt Fehlversuche je IP und Benutzer." "Only /dav and /webdav are reachable through that name (everything else is 404), HTTPS only, with app-password sign-in; the app locks out failed attempts per IP and user."
echo
if [ -z "$TROCKEN" ] && [ -z "$JA" ]; then
  if [ -t 0 ]; then
    printf '%s' "$(s "Jetzt einrichten? [j/N] " "Set up now? [y/N] ")"; read -r antwort
    case "$antwort" in j|J|ja|Ja|y|Y|yes) ;; *) say "Abgebrochen." "Cancelled."; exit 2 ;; esac
  else
    fail "Keine Rueckfrage moeglich (kein Terminal). Mit --ja bestaetigen oder --trocken zum Ansehen." "Cannot ask (no terminal). Confirm with --ja or use --trocken to preview."
  fi
fi

# --- Dateien bereitstellen ---
hole() { # Dateiname: neben dem Skript, sonst aus der Quelle
  if [ -f "$SKRIPT_ORDNER/$1" ] && [ "$SKRIPT_ORDNER" != "$DIR" ]; then tu cp "$SKRIPT_ORDNER/$1" "$DIR/$1"
  elif [ -f "$DIR/$1" ]; then :
  else tu curl -fsSL --max-time 30 -o "$DIR/$1" "$QUELLE/$1" || fail "$1 fehlt und liess sich nicht laden." "$1 is missing and could not be downloaded."; fi
}
hole Caddyfile.dav; hole compose.dav-direkt.yml
[ "$MODUS" != "nur-dav" ] || hole Caddyfile.dav-nur
mkdir_log() { mkdir -p "$DIR/caddy-logs"; }
tu mkdir_log

# Die Haupt-Caddyfile muss den Ordner conf.d einlesen (nur im Modus "zusaetzlich"; "nur-dav" bringt eine eigene Caddyfile mit)
if [ "$MODUS" = "zusaetzlich" ] && ! grep -q 'caddy/conf.d' Caddyfile 2>/dev/null; then
  say "Caddyfile: Zeile 'import /etc/caddy/conf.d/*' ergaenzen (Sicherung: Caddyfile.vor-dav)" "Caddyfile: adding the line 'import /etc/caddy/conf.d/*' (backup: Caddyfile.vor-dav)"
  tu cp -p Caddyfile Caddyfile.vor-dav
  if [ -z "$TROCKEN" ]; then printf '\n# Optionale Zusatz-Sites (direkter WebDAV-Hostname, dav-direkt.sh)\nimport /etc/caddy/conf.d/*\n' >> Caddyfile; else echo "  [trocken/dry] Caddyfile += import /etc/caddy/conf.d/*"; fi
fi

# --- .env ---
[ -n "$TROCKEN" ] || cp -p .env .env.vor-dav-direkt
env_setzen VD_DAV_HOST "$HOST"
[ -z "$ERLAUBT" ] || env_setzen VD_DAV_ERLAUBT "$ERLAUBT"
if [ "$MODUS" = "nur-dav" ]; then env_setzen VD_DAV_CADDYFILE "Caddyfile.dav-nur"; else env_entfernen VD_DAV_CADDYFILE; fi
in_liste "$CF" compose.dav-direkt.yml || env_setzen COMPOSE_FILE "$CF:compose.dav-direkt.yml"

# --- fail2ban ---
if [ -n "$F2B" ]; then
  if ! command -v fail2ban-client >/dev/null 2>&1 && [ -z "$TROCKEN" ]; then
    warn "fail2ban ist nicht installiert (Debian/Ubuntu: apt install fail2ban). Dateien liegen in $DIR/fail2ban/ bereit." "fail2ban is not installed (Debian/Ubuntu: apt install fail2ban). Files are ready in $DIR/fail2ban/."
  else
    quelle_f="$SKRIPT_ORDNER/fail2ban"; [ -d "$quelle_f" ] || quelle_f="$DIR/fail2ban"
    if [ ! -d "$quelle_f" ]; then
      quelle_f="$DIR/fail2ban"; tu mkdir -p "$quelle_f"
      for f in vylariscloud-dav.conf vylariscloud-dav.local; do tu curl -fsSL --max-time 30 -o "$quelle_f/$f" "$QUELLE/fail2ban/$f" || true; done
    fi
    if [ -f "$quelle_f/vylariscloud-dav.conf" ] && [ -f "$quelle_f/vylariscloud-dav.local" ]; then
      tu install -m 0644 "$quelle_f/vylariscloud-dav.conf" /etc/fail2ban/filter.d/vylariscloud-dav.conf
      if [ -z "$TROCKEN" ]; then
        sed "s#^logpath .*#logpath   = $DIR/caddy-logs/dav-zugriff.log#" "$quelle_f/vylariscloud-dav.local" > /etc/fail2ban/jail.d/vylariscloud-dav.local
        chmod 0644 /etc/fail2ban/jail.d/vylariscloud-dav.local
      else echo "  [trocken/dry] /etc/fail2ban/jail.d/vylariscloud-dav.local (logpath $DIR/caddy-logs/dav-zugriff.log)"; fi
      command -v systemctl >/dev/null 2>&1 && tu systemctl restart fail2ban || true
    else
      warn "fail2ban-Dateien nicht gefunden ($quelle_f). Aus dem Repository deploy/fail2ban/ nach /etc/fail2ban/ kopieren." "fail2ban files not found ($quelle_f). Copy deploy/fail2ban/ from the repository to /etc/fail2ban/."
    fi
  fi
fi

# --- starten ---
if [ -z "$TROCKEN" ]; then
  docker compose config -q || { cp -p .env.vor-dav-direkt .env; fail "Die Compose-Dateien passen nicht zusammen - .env wurde zurueckgesetzt." "The compose files do not fit together - .env was restored."; }
fi
tu docker compose up -d

echo
if [ -n "$TROCKEN" ]; then say "==> Trockenlauf beendet - es wurde nichts geaendert." "==> Dry run finished - nothing was changed."; else say "==> Fertig" "==> Done"; fi
say "WebDAV fuer grosse Dateien: https://$HOST/dav/   (Storage-Boxen: https://$HOST/webdav/)" "WebDAV for large files: https://$HOST/dav/   (storage boxes: https://$HOST/webdav/)"
say "Die Seite 'Sync & WebDAV' zeigt jetzt beide Adressen. Pruefen: bash dav-direkt.sh --status" "The 'Sync & WebDAV' page now shows both addresses. Check: bash dav-direkt.sh --status"
say "Der erste Aufruf holt das Zertifikat (einige Sekunden, DNS muss stimmen): docker compose logs -f caddy" "The first request fetches the certificate (a few seconds, DNS must be correct): docker compose logs -f caddy"
echo
say "Firewall (ufw): 443/tcp, 443/udp und 80/tcp erlauben, SSH nicht vergessen:" "Firewall (ufw): allow 443/tcp, 443/udp and 80/tcp, do not forget SSH:"
echo "  ufw allow OpenSSH && ufw allow 443/tcp && ufw allow 443/udp && ufw allow 80/tcp && ufw enable"
warn "Wichtig: Von Docker veroeffentlichte Ports umgehen ufw. 'ufw deny' schliesst sie NICHT. Wer Ports einschraenken will, nutzt die Kette DOCKER-USER (so macht es auch die fail2ban-Jail) oder bindet Ports in den Compose-Dateien an 127.0.0.1." "Important: ports published by Docker bypass ufw. 'ufw deny' does NOT close them. To restrict ports use the DOCKER-USER chain (as the fail2ban jail does) or bind ports to 127.0.0.1 in the compose files."
