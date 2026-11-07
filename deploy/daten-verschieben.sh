#!/usr/bin/env bash
# VylarisCloud: Daten auf eine andere Platte legen (z. B. eine große HDD).
#
#   sudo bash daten-verschieben.sh [--trocken] [--dir <Installationsordner>] [Schalter] <Zielordner>
#   Beispiel:  sudo bash daten-verschieben.sh --trocken /mnt/hdd/vylariscloud
#              sudo bash daten-verschieben.sh /mnt/hdd/vylariscloud
#
# Was das Skript tut (und nur das):
#   1. prüft root, Docker, Zielordner (eingehängt? genug Platz?)
#   2. stoppt die betroffenen Container (app, bei Bedarf sftpgo, garage, db)
#   3. kopiert die Inhalte der benannten Docker-Volumes (dateien, speicher, sftpgo, garage-daten,
#      optional garage-meta und db) per "docker run alpine cp -a" in Unterordner des Zielordners
#      und vergleicht danach Dateiliste, Größen und Anzahl mit einer Prüfsumme
#   4. setzt die Besitzer (app/SFTPGo = 1000:1000, Garage = root, Postgres = 70:70; zur Laufzeit ermittelt)
#   5. erzeugt bzw. erweitert <Installationsordner>/compose.hdd.yml (Bind-Mounts) und trägt sie in COMPOSE_FILE der .env ein
#   6. startet neu und prüft im Container per df, dass die Ordner auf der Ziel-Platte liegen
# Die alten Volumes werden NICHT gelöscht (Rückweg möglich). Mehrfaches Ausführen ist unschädlich.
set -uo pipefail

DIR="${VD_DIR:-/opt/vylariscloud}"
SPR_GEWAEHLT=0; ZIEL=""; TROCKEN=0; MIT_DB=0; META=0; WEITER=0; JA=0; REPARIEREN=0; NEU=0; SPEICHER_FLAG=0
KOPIER_IMAGE="${VD_KOPIER_IMAGE:-alpine:3}"
SPR="${VD_SKRIPT_SPRACHE:-de}"

s() { if [ "$SPR" = "de" ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != "dumb" ]; then
  R=$'\033[38;2;232;48;48m'; G=$'\033[38;2;74;222;128m'; Y=$'\033[38;2;251;191;36m'; D=$'\033[2m'; B=$'\033[1m'; N=$'\033[0m'
else R=""; G=""; Y=""; D=""; B=""; N=""; fi
kopf() { echo "${R}${B}>${N} ${B}$(s "$1" "$2")${N}"; }
info() { echo "  ${D}|${N} $(s "$1" "$2")"; }
gut() { echo "  ${G}OK${N} $(s "$1" "$2")"; }
warnung() { echo "  ${Y}! $(s "$1" "$2")${N}" >&2; }

hilfe() {
  cat <<'HILFE'
Aufruf:  sudo bash daten-verschieben.sh [Schalter] <Zielordner>

  <Zielordner>     Absoluter Pfad auf der Ziel-Platte, z. B. /mnt/hdd/vylariscloud
  --dir <Ordner>   Installationsordner mit docker-compose.yml und .env (Standard /opt/vylariscloud)
  --trocken        Nur prüfen und anzeigen, was passieren würde. Ändert nichts.
  --meta-auch      Auch die Garage-Metadaten (garage-meta) verschieben. Standard: bleiben auf der
                   Systemplatte (SSD) — die Metadaten-Datenbank braucht schnelle, kleine Zugriffe.
  --mit-db         Auch die Datenbank (Volume db) verschieben. Nur wenn die Ziel-Platte schnell und
                   zuverlässig ist; auf einer HDD wird alles spürbar langsamer.
  --speicher       Bind-Mounts für das Speicher-Modul (SFTPGo, Garage) auch dann anlegen, wenn es
                   noch nicht eingeschaltet ist (sonst nur, wenn es läuft/Daten hat).
  --weiter         Einen nicht leeren Zielunterordner trotzdem verwenden (z. B. nach einem
                   abgebrochenen Lauf). Vorhandene Dateien dort werden überschrieben.
  --reparieren     Besitzer auch in schon eingebundenen Ordnern setzen (chown -R).
  --ja             Rückfragen mit "ja" beantworten (für Skripte).
  --neu            Erstinstallation (von install.sh --daten-pfad benutzt): nichts kopieren, nichts
                   stoppen, nur Ordner anlegen und compose.hdd.yml schreiben.
  --lang de|en     Sprache der Meldungen (Standard: VD_LANG aus der .env, sonst de)
HILFE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) [ $# -ge 2 ] || { echo "Wert fehlt / Missing value: --dir"; exit 1; }; DIR="${2%/}"; shift 2 ;;
    --lang) [ $# -ge 2 ] || { echo "Wert fehlt / Missing value: --lang"; exit 1; }; SPR="${2,,}"; SPR_GEWAEHLT=1; shift 2 ;;
    --trocken|--dry-run) TROCKEN=1; shift ;;
    --mit-db) MIT_DB=1; shift ;;
    --meta-auch) META=1; shift ;;
    --speicher) SPEICHER_FLAG=1; shift ;;
    --weiter) WEITER=1; shift ;;
    --reparieren) REPARIEREN=1; shift ;;
    --ja|--yes|-y) JA=1; shift ;;
    --neu) NEU=1; shift ;;
    -h|--hilfe|--help) hilfe; exit 0 ;;
    -*) echo "Unbekannter Schalter / Unknown option: $1"; exit 1 ;;
    *) [ -z "$ZIEL" ] || { echo "Nur ein Zielordner erlaubt / Only one target folder allowed"; exit 1; }; ZIEL="${1%/}"; shift ;;
  esac
done
[ "$SPR" = "en" ] || SPR="de"

# ---------- Zustand für den Notfall-Rückweg ----------
PHASE=""            # "gestoppt" = Container sind angehalten, "geschrieben" = .env/compose.hdd.yml sind geändert
GESTOPPT=()         # IDs der von uns gestoppten Container
SICH=""             # Sicherungsordner (.sicherung/hdd-<Zeit>)
HDD_VORHER=0        # 1 = compose.hdd.yml gab es vor dem Lauf
notfall() {
  if [ "$PHASE" = "geschrieben" ] && [ -n "$SICH" ]; then
    if [ "$HDD_VORHER" = 1 ] && [ -f "$SICH/compose.hdd.yml" ]; then cp -p "$SICH/compose.hdd.yml" "$DIR/compose.hdd.yml"; else rm -f "$DIR/compose.hdd.yml"; fi
    [ -f "$SICH/.env" ] && cp -p "$SICH/.env" "$DIR/.env"
    warnung "compose.hdd.yml und .env wurden auf den Stand vor dem Lauf zurückgesetzt." "compose.hdd.yml and .env were restored to their state before the run."
  fi
  if [ "${#GESTOPPT[@]}" -gt 0 ]; then
    warnung "Die gestoppten Container werden mit dem alten Stand wieder gestartet …" "Starting the stopped containers again with the old setup …"
    ( cd "$DIR" && docker compose up -d >/dev/null 2>&1 ) || warnung "Neustart nicht gelungen — bitte per Hand: cd $DIR && docker compose up -d" "Restart failed — please run by hand: cd $DIR && docker compose up -d"
  fi
}
abbruch() {
  echo "${R}${B}X $(s "$1" "$2")${N}" >&2
  [ -n "$PHASE" ] && notfall
  exit 1
}
trap 'echo >&2; abbruch "Abgebrochen." "Cancelled."' INT TERM

fragen_ja() { # fragen_ja "de" "en" -> 0 bei Ja
  [ "$JA" = 1 ] && return 0
  [ -t 0 ] || return 1
  local a; read -r -p "  $(s "$1" "$2") [j/N] " a || return 1
  case "${a,,}" in j|ja|y|yes) return 0 ;; *) return 1 ;; esac
}
groesse() { # KiB -> lesbar
  awk -v k="$1" 'BEGIN { u="KB"; v=k; if (v>=1024) { v/=1024; u="MB" } if (v>=1024) { v/=1024; u="GB" } if (v>=1024) { v/=1024; u="TB" } printf (v>=100 ? "%.0f %s" : "%.1f %s"), v, u }'
}

# ---------- 1. Voraussetzungen ----------
kopf "Voraussetzungen prüfen" "Checking prerequisites"
[ "$(id -u)" -eq 0 ] || abbruch "Bitte als root starten: sudo bash $0 ${ZIEL:-<Zielordner>}" "Please run as root: sudo bash $0 ${ZIEL:-<target folder>}"
[ -n "$ZIEL" ] || { hilfe; abbruch "Zielordner fehlt (z. B. /mnt/hdd/vylariscloud)." "Target folder missing (e.g. /mnt/hdd/vylariscloud)."; }
command -v docker >/dev/null 2>&1 || abbruch "Docker ist nicht installiert." "Docker is not installed."
docker compose version >/dev/null 2>&1 || abbruch "„docker compose“ fehlt (Docker aktualisieren)." "“docker compose” is missing (update Docker)."
[ -f "$DIR/docker-compose.yml" ] && [ -f "$DIR/.env" ] || abbruch "Keine VylarisCloud-Installation in $DIR (docker-compose.yml oder .env fehlt). Mit --dir <Ordner> angeben." "No VylarisCloud installation in $DIR (docker-compose.yml or .env missing). Use --dir <folder>."
cd "$DIR" || abbruch "Ordner $DIR nicht lesbar." "Cannot open $DIR."
DIR="$(pwd -P)"
if [ -z "${VD_SKRIPT_SPRACHE:-}" ] && [ "$SPR_GEWAEHLT" = 0 ]; then
  l=$(sed -n 's/^VD_LANG=//p' .env | tail -1 | tr -d '"'"'"'\r'); [ "$l" = "en" ] && SPR="en"
fi
gut "Docker, Installation in $DIR" "Docker, installation in $DIR"

# Zielordner
case "$ZIEL" in /*) ;; *) abbruch "Der Zielordner muss ein absoluter Pfad sein (mit / beginnen): $ZIEL" "The target folder must be an absolute path (start with /): $ZIEL" ;; esac
[[ "$ZIEL" =~ ^/[A-Za-z0-9._/@+-]+$ ]] || abbruch "Im Zielordner sind nur Buchstaben, Ziffern und . _ - / @ + erlaubt: $ZIEL" "Only letters, digits and . _ - / @ + are allowed in the target folder: $ZIEL"
case "$ZIEL/" in */../*|*/./*|*//*) abbruch "Der Zielordner darf kein „..“, „.“ oder „//“ enthalten: $ZIEL" "The target folder must not contain “..”, “.” or “//”: $ZIEL" ;; esac
case "$ZIEL" in
  /bin*|/boot*|/dev*|/etc*|/lib*|/proc*|/run*|/sbin*|/sys*|/usr*|/var/lib/docker*|"$DIR"|"$DIR"/*)
    abbruch "Dieser Zielordner ist nicht geeignet (System- oder Installationsordner): $ZIEL" "This target folder is not suitable (system or installation folder): $ZIEL" ;;
esac
ORT="$ZIEL"
if [ ! -d "$ZIEL" ]; then
  [ -d "$(dirname "$ZIEL")" ] || abbruch "Zielordner $ZIEL gibt es nicht, und der übergeordnete Ordner auch nicht. Ist die Platte eingehängt (mount)?" "Target folder $ZIEL does not exist, and neither does its parent. Is the disk mounted?"
  ORT="$(dirname "$ZIEL")"
  if [ "$TROCKEN" = 1 ]; then info "Zielordner $ZIEL würde angelegt." "Target folder $ZIEL would be created."
  else mkdir -p "$ZIEL" && gut "Zielordner $ZIEL angelegt" "Target folder $ZIEL created" || abbruch "Zielordner $ZIEL nicht anlegbar." "Cannot create target folder $ZIEL."; ORT="$ZIEL"; fi
fi
[ "$TROCKEN" = 1 ] || [ -w "$ORT" ] || abbruch "Zielordner $ZIEL ist nicht beschreibbar." "Target folder $ZIEL is not writable."

einhaengepunkt() { local m; m=$(findmnt -n -o TARGET -T "$1" 2>/dev/null | head -1); [ -n "$m" ] || m=$(df -P "$1" 2>/dev/null | awk 'NR==2 {print $NF}'); printf '%s' "$m"; }
MNT=$(einhaengepunkt "$ORT")
DEV_ZIEL=$(stat -c %d "$ORT" 2>/dev/null || echo z)
DEV_WURZEL=$(stat -c %d / 2>/dev/null || echo w)
DOCKER_WURZEL=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null); [ -d "${DOCKER_WURZEL:-}" ] || DOCKER_WURZEL=/var/lib/docker
DEV_DOCKER=$(stat -c %d "$DOCKER_WURZEL" 2>/dev/null || echo d)
SYSTEMPLATTE=0
if [ "$MNT" = "/" ] || [ "$DEV_ZIEL" = "$DEV_WURZEL" ] || [ "$DEV_ZIEL" = "$DEV_DOCKER" ]; then SYSTEMPLATTE=1; fi
if [ "$SYSTEMPLATTE" = 1 ]; then
  warnung "$ZIEL liegt auf demselben Dateisystem wie das Betriebssystem bzw. Docker ($DOCKER_WURZEL) — kein eigener Datenträger eingehängt. Dann gewinnt man keinen Platz. Ist die HDD wirklich unter $ZIEL eingehängt (mount, df -h)?" \
          "$ZIEL is on the same filesystem as the operating system or Docker ($DOCKER_WURZEL) — no separate disk is mounted there. That gains no space. Is the HDD really mounted at $ZIEL (mount, df -h)?"
  if [ "$NEU" = 1 ] || [ "$TROCKEN" = 1 ]; then :
  else fragen_ja "Trotzdem fortfahren?" "Continue anyway?" || abbruch "Abgebrochen — nichts wurde geändert." "Cancelled — nothing was changed."; fi
else
  gut "Zielordner liegt auf einem eigenen Datenträger (eingehängt unter $MNT, $(df -P "$ORT" | awk 'NR==2 {print $1}'))" "Target folder is on its own disk (mounted at $MNT, $(df -P "$ORT" | awk 'NR==2 {print $1}'))"
  if command -v findmnt >/dev/null 2>&1 && ! findmnt --fstab -n -o TARGET 2>/dev/null | grep -qx "$MNT"; then
    warnung "$MNT steht nicht in /etc/fstab — nach einem Neustart könnte die Platte fehlen, und Docker schreibt dann stillschweigend auf die Systemplatte. Eintrag in /etc/fstab ergänzen (siehe deploy/README.md)." \
            "$MNT is not in /etc/fstab — after a reboot the disk may be missing and Docker would silently write to the system disk. Add an /etc/fstab entry (see deploy/README.md)."
  fi
fi
FREI_KB=$(df -Pk "$ORT" 2>/dev/null | awk 'NR==2 {print $4}'); FREI_KB=${FREI_KB:-0}
info "Frei auf der Ziel-Platte: $(groesse "$FREI_KB")" "Free on the target disk: $(groesse "$FREI_KB")"

# ---------- Hilfen: Compose, Projekt, Volumes ----------
env_wert() { sed -n "s/^$1=//p" .env | tail -1 | tr -d '"'"'"'\r'; }
base_hat_dienst() { grep -q "^  $1:[[:space:]]*\$" docker-compose.yml; }
bild_von() { awk -v s="$1" '$0 ~ "^  " s ":[[:space:]]*$" {drin=1; next} drin && /^  [^ ]/ {drin=0} drin && /^    image:/ {sub(/^    image:[[:space:]]*/, ""); gsub(/["\047]/, ""); print; exit}' docker-compose.yml; }
PROJEKT=$(env_wert COMPOSE_PROJECT_NAME)
if [ -z "$PROJEKT" ]; then
  c=$(docker ps -aq --filter label=com.docker.compose.service=app --filter "label=com.docker.compose.project.working_dir=$DIR" 2>/dev/null | head -1)
  [ -n "$c" ] && PROJEKT=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$c" 2>/dev/null)
fi
[ -n "$PROJEKT" ] || PROJEKT=$(basename "$DIR" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')
vol_finden() {
  local v
  v=$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJEKT" --filter "label=com.docker.compose.volume=$1" 2>/dev/null | head -1)
  if [ -z "$v" ] && docker volume inspect "${PROJEKT}_$1" >/dev/null 2>&1; then v="${PROJEKT}_$1"; fi
  printf '%s' "$v"
}
dienst_container() { docker ps -aq --filter "label=com.docker.compose.project=$PROJEKT" --filter "label=com.docker.compose.service=$1" 2>/dev/null; }

# ---------- compose.hdd.yml lesen (wird erweitert, nie blind überschrieben) ----------
EIN=()       # Zeilen "dienst|quelle:ziel[:opt]"
HDD_FREMD="" # Zeilen, die dieses Skript nicht versteht
lese_hdd() {
  local z
  [ -f compose.hdd.yml ] || return 0
  HDD_VORHER=1
  while IFS= read -r z; do
    case "$z" in
      UNBEKANNT\|*) HDD_FREMD="$HDD_FREMD${z#UNBEKANNT|}"$'\n' ;;
      *) EIN+=("$z") ;;
    esac
  done < <(awk '
    /^[[:space:]]*(#.*)?$/ { next }
    /^services:[[:space:]]*$/ { ins = 1; next }
    ins && /^  [A-Za-z0-9_.-]+:[[:space:]]*$/ { svc = $1; sub(/:$/, "", svc); inv = 0; next }
    ins && svc != "" && /^    volumes:[[:space:]]*$/ { inv = 1; next }
    ins && inv && /^      - [^ ]/ { it = $0; sub(/^      - /, "", it); sub(/[[:space:]]+#.*$/, "", it); gsub(/^["\047]|["\047]$/, "", it); if (it ~ /^[^ ]+$/) { print svc "|" it; next } }
    { print "UNBEKANNT|" $0 }
  ' compose.hdd.yml)
}
lese_hdd
if [ -n "$HDD_FREMD" ]; then
  echo "${R}${B}X $(s "compose.hdd.yml enthält mehr als einfache Bind-Mounts unter services/<dienst>/volumes — das Skript will sie nicht überschreiben." "compose.hdd.yml contains more than plain bind mounts under services/<service>/volumes — the script will not overwrite it.")${N}" >&2
  printf '%s' "$HDD_FREMD" | head -8 | sed 's/^/      /' >&2
  abbruch "Bitte Zeilen von Hand ergänzen (siehe deploy/README.md „Daten auf eine andere Platte“) oder die Datei zur Seite legen." "Please add the lines by hand (see deploy/README.md “Moving data to another disk”) or move the file aside."
fi
ein_quelle() { # ein_quelle <dienst> <ziel> -> Quelle des vorhandenen Eintrags, Ausgabe leer wenn keiner
  local e svc rest q z
  for e in ${EIN[@]+"${EIN[@]}"}; do
    svc=${e%%|*}; rest=${e#*|}; [ "$svc" = "$1" ] || continue
    IFS=: read -r q z _ <<<"$rest"
    [ "$z" = "$2" ] && { printf '%s' "$q"; return 0; }
  done
  return 1
}
[ "$HDD_VORHER" = 1 ] && info "Vorhandene compose.hdd.yml wird erweitert (${#EIN[@]} Einträge übernommen, Kopie in .sicherung/)." "Existing compose.hdd.yml will be extended (${#EIN[@]} entries kept, copy goes to .sicherung/)."

# Wohin die Daten des Speicher-Moduls kommen
BASIS="$ZIEL"
DATEN_QUELLE=$(ein_quelle app /data || true)
if [ -n "$DATEN_QUELLE" ] && [ "${DATEN_QUELLE%/}" = "$ZIEL" ]; then
  BASIS="$ZIEL-speicher"
  info "Die Cloud-Dateien (/data) liegen schon direkt in $ZIEL — die Ordner für Boxen/Buckets kommen deshalb nach $BASIS." "The cloud files (/data) already live directly in $ZIEL — the folders for boxes/buckets therefore go to $BASIS."
fi

# ---------- 2. Plan ----------
kopf "Plan" "Plan"
profile=$(env_wert COMPOSE_PROFILES)
SPEICHER_AN=0
if [ "$NEU" = 1 ] || [ "$SPEICHER_FLAG" = 1 ]; then SPEICHER_AN=1
elif printf ',%s,' "${profile// /,}" | grep -q ',speicher,'; then SPEICHER_AN=1
elif [ -n "$(vol_finden speicher)$(vol_finden sftpgo)$(vol_finden garage-daten)" ]; then SPEICHER_AN=1
elif ein_quelle sftpgo /srv/sftpgo/data >/dev/null || ein_quelle garage /var/lib/garage/data >/dev/null; then SPEICHER_AN=1; fi
# dienst|volume|unterordner|ziel-im-container|besitzer
WUNSCH=("app|dateien|dateien|/data|app")
if [ "$SPEICHER_AN" = 1 ]; then
  WUNSCH+=("app|speicher|speicher|/speicher|app" "sftpgo|speicher|speicher|/srv/sftpgo/data|sftpgo" "sftpgo|sftpgo|sftpgo|/var/lib/sftpgo|sftpgo" "garage|garage-daten|garage-daten|/var/lib/garage/data|garage")
  [ "$META" = 1 ] && WUNSCH+=("garage|garage-meta|garage-meta|/var/lib/garage/meta|garage")
else
  info "Das Speicher-Modul (SFTPGo/Garage) ist nicht eingeschaltet — nur die Cloud-Dateien werden berücksichtigt (mit --speicher trotzdem vorbereiten)." "The storage module (SFTPGo/Garage) is not switched on — only the cloud files are handled (use --speicher to prepare it anyway)."
fi
[ "$MIT_DB" = 1 ] && WUNSCH+=("db|db|db|/var/lib/postgresql/data|db")
if [ "$META" = 0 ] && [ "$SPEICHER_AN" = 1 ]; then info "garage-meta (Metadaten) bleibt auf der Systemplatte — das ist Absicht (schnell). Mit --meta-auch ändern." "garage-meta (metadata) stays on the system disk — on purpose (fast). Change with --meta-auch."; fi
[ "$MIT_DB" = 0 ] && info "Die Datenbank (Volume db) bleibt auf der Systemplatte. Mit --mit-db auch verschieben (nicht empfohlen auf einer HDD)." "The database (volume db) stays on the system disk. Use --mit-db to move it too (not recommended on an HDD)."

P_DIENST=(); P_VOLUME=(); P_ORDNER=(); P_ZIEL=(); P_BESITZER=(); P_STATUS=(); P_QUELLE=()
for w in "${WUNSCH[@]}"; do
  IFS='|' read -r d v u zz b <<<"$w"
  if ! base_hat_dienst "$d"; then warnung "Dienst „$d“ steht nicht in docker-compose.yml — übersprungen (erst update.sh ausführen)." "Service “$d” is not in docker-compose.yml — skipped (run update.sh first)."; continue; fi
  hostdir="$BASIS/$u"; [ "$v" = "dateien" ] && hostdir="$ZIEL/dateien"
  st="neu"; vorh=$(ein_quelle "$d" "$zz" || true)
  if [ -n "$vorh" ]; then
    if [ "${vorh%/}" = "$hostdir" ]; then st="schon"; else st="fremd"; hostdir="$vorh"; fi
  fi
  P_DIENST+=("$d"); P_VOLUME+=("$v"); P_ORDNER+=("$u"); P_ZIEL+=("$zz"); P_BESITZER+=("$b"); P_STATUS+=("$st"); P_QUELLE+=("$hostdir")
  case "$st" in
    schon) info "$d:$zz  ->  $hostdir  (schon eingebunden)" "$d:$zz  ->  $hostdir  (already bound)" ;;
    fremd) info "$d:$zz  ->  $vorh  (steht schon so in compose.hdd.yml, bleibt unverändert, nichts wird kopiert)" "$d:$zz  ->  $vorh  (already like this in compose.hdd.yml, left unchanged, nothing is copied)" ;;
    *) info "$d:$zz  ->  $hostdir" "$d:$zz  ->  $hostdir" ;;
  esac
done

# Kopieraufträge: je Volume einmal (speicher wird von app UND sftpgo gebunden → derselbe Ordner)
K_VOLUME=(); K_ORDNER=(); K_NAME=(); K_KB=()
BRAUCHT_KB=0
for i in "${!P_VOLUME[@]}"; do
  [ "${P_STATUS[$i]}" = "neu" ] || continue
  v="${P_VOLUME[$i]}"; vorhanden=0
  for k in ${K_NAME[@]+"${K_NAME[@]}"}; do [ "$k" = "$v" ] && vorhanden=1; done
  [ "$vorhanden" = 1 ] && continue
  K_NAME+=("$v")
  if [ "$NEU" = 1 ]; then K_VOLUME+=(""); K_ORDNER+=("${P_QUELLE[$i]}"); K_KB+=(0); continue; fi
  dv=$(vol_finden "$v")
  if [ -z "$dv" ]; then
    K_VOLUME+=(""); K_ORDNER+=("${P_QUELLE[$i]}"); K_KB+=(0)
    info "Volume „$v“ gibt es (noch) nicht — Ordner wird leer angelegt." "Volume “$v” does not exist (yet) — the folder is created empty."
    continue
  fi
  kb=$(docker run --rm --network none -v "$dv":/pruef:ro "$KOPIER_IMAGE" du -sk /pruef 2>/dev/null | awk '{print $1}')
  case "$kb" in ''|*[!0-9]*) abbruch "Größe von Volume $dv nicht ermittelbar (Kopier-Image $KOPIER_IMAGE nicht verfügbar? Offline: VD_KOPIER_IMAGE=<lokales alpine-Image> setzen)." "Cannot determine the size of volume $dv (copy image $KOPIER_IMAGE unavailable? Offline: set VD_KOPIER_IMAGE=<local alpine image>)." ;; esac
  K_VOLUME+=("$dv"); K_ORDNER+=("${P_QUELLE[$i]}"); K_KB+=("$kb")
  BRAUCHT_KB=$((BRAUCHT_KB + kb))
  info "Kopieren: Volume $dv ($(groesse "$kb"))  ->  ${P_QUELLE[$i]}" "Copy: volume $dv ($(groesse "$kb"))  ->  ${P_QUELLE[$i]}"
done

if [ "$NEU" = 1 ]; then
  for v in ${K_NAME[@]+"${K_NAME[@]}"}; do
    if [ -n "$(vol_finden "$v")" ]; then
      abbruch "Es gibt schon ein Docker-Volume „$v“ dieser Installation — dann bitte nicht --daten-pfad, sondern daten-verschieben.sh benutzen (kopiert die vorhandenen Daten mit)." \
              "This installation already has a Docker volume “$v” — please do not use --daten-pfad, use daten-verschieben.sh instead (it copies the existing data)."
    fi
  done
fi
if [ "${#P_DIENST[@]}" -eq 0 ]; then abbruch "Nichts zu tun (keine passenden Dienste in docker-compose.yml)." "Nothing to do (no matching services in docker-compose.yml)."; fi

NEU_ANZAHL=0; for st in ${P_STATUS[@]+"${P_STATUS[@]}"}; do [ "$st" = "neu" ] && NEU_ANZAHL=$((NEU_ANZAHL + 1)); done
if [ "$BRAUCHT_KB" -gt 0 ]; then
  RESERVE_KB=$((BRAUCHT_KB / 20 + 20480))
  info "Platzbedarf: $(groesse "$BRAUCHT_KB") + Reserve $(groesse "$RESERVE_KB"), frei: $(groesse "$FREI_KB")" "Space needed: $(groesse "$BRAUCHT_KB") + reserve $(groesse "$RESERVE_KB"), free: $(groesse "$FREI_KB")"
  if [ $((BRAUCHT_KB + RESERVE_KB)) -gt "$FREI_KB" ]; then
    abbruch "Zu wenig Platz auf der Ziel-Platte: gebraucht $(groesse $((BRAUCHT_KB + RESERVE_KB))), frei $(groesse "$FREI_KB"). Nichts wurde geändert." "Not enough space on the target disk: need $(groesse $((BRAUCHT_KB + RESERVE_KB))), free $(groesse "$FREI_KB"). Nothing was changed."
  fi
fi
# Zielunterordner dürfen nicht belegt sein (außer --weiter)
for i in "${!K_NAME[@]}"; do
  if [ -d "${K_ORDNER[$i]}" ] && [ -n "$(ls -A "${K_ORDNER[$i]}" 2>/dev/null)" ] && [ "$WEITER" = 0 ] && [ -n "${K_VOLUME[$i]}" ]; then
    abbruch "Zielordner ${K_ORDNER[$i]} ist nicht leer. Falls das ein abgebrochener Lauf war: leeren — oder mit --weiter erneut kopieren (Dateien dort werden überschrieben)." \
            "Target folder ${K_ORDNER[$i]} is not empty. If this was an interrupted run: empty it — or copy again with --weiter (files there get overwritten)."
  fi
done

if [ "$NEU_ANZAHL" -eq 0 ] && [ "$NEU" = 0 ]; then
  info "Alles ist schon eingebunden — nichts zu kopieren. Es werden nur Besitzer, COMPOSE_FILE und Einbindung geprüft." "Everything is already bound — nothing to copy. Only owners, COMPOSE_FILE and the mounts are checked."
fi

if [ "$TROCKEN" = 1 ]; then
  echo ""
  echo "${Y}${B}$(s "Trockenlauf: es wurde nichts geändert." "Dry run: nothing was changed.")${N}"
  if [ "$NEU_ANZAHL" -gt 0 ] || [ "$NEU" = 1 ]; then
    info "Ohne --trocken würde das Skript: Container stoppen, kopieren + prüfen, Besitzer setzen, compose.hdd.yml schreiben, COMPOSE_FILE in .env ergänzen, neu starten, df im Container prüfen." "Without --trocken the script would: stop containers, copy + verify, set owners, write compose.hdd.yml, extend COMPOSE_FILE in .env, restart, check df in the container."
  fi
  exit 0
fi

# ---------- Besitzer ermitteln ----------
besitzer_von() { # <schluessel app|sftpgo|garage|db> -> "uid:gid"
  local dienst="$1" bild name def out u g
  case "$dienst" in app) name=node; def=1000:1000 ;; sftpgo) name=sftpgo; def=1000:1000 ;; garage) name=""; def=0:0 ;; db) name=postgres; def=70:70 ;; esac
  bild=$(bild_von "$dienst")
  if [ "$NEU" = 1 ] || [ -z "$bild" ] || ! docker image inspect "$bild" >/dev/null 2>&1; then printf '%s' "$def"; return 0; fi
  if [ -n "$name" ]; then
    out=$(docker run --rm --network none --entrypoint sh "$bild" -c "id -u $name; id -g $name" 2>/dev/null | tr '\n' ' ')
    read -r u g _ <<<"$out"
    case "$u$g" in ''|*[!0-9]*) printf '%s' "$def"; return 0 ;; esac
    printf '%s:%s' "$u" "$g"; return 0
  fi
  out=$(docker image inspect -f '{{.Config.User}}' "$bild" 2>/dev/null)
  case "$out" in ''|root|0|0:0|root:root) printf '0:0' ;; [0-9]*:[0-9]*) printf '%s' "$out" ;; [0-9]*) printf '%s:%s' "$out" "$out" ;; *) printf '%s' "$def" ;; esac
}
declare -A BESITZER=()
for b in app sftpgo garage db; do BESITZER[$b]=$(besitzer_von "$b"); done
info "Besitzer: app ${BESITZER[app]}, SFTPGo ${BESITZER[sftpgo]}, Garage ${BESITZER[garage]}$([ "$MIT_DB" = 1 ] && echo ", Datenbank ${BESITZER[db]}")" "Owners: app ${BESITZER[app]}, SFTPGo ${BESITZER[sftpgo]}, Garage ${BESITZER[garage]}$([ "$MIT_DB" = 1 ] && echo ", database ${BESITZER[db]}")"

if [ "$NEU" = 0 ] && [ "$NEU_ANZAHL" -gt 0 ]; then
  echo ""
  warnung "Gleich werden die betroffenen Container angehalten (kurze Downtime, je nach Datenmenge Minuten bis Stunden)." "The affected containers will be stopped shortly (downtime — minutes to hours depending on the amount of data)."
  [ "$MIT_DB" = 1 ] && warnung "--mit-db: auch die Datenbank wird verschoben. Eine HDD ist dafür deutlich langsamer als eine SSD." "--mit-db: the database is moved too. An HDD is much slower than an SSD for this."
  if [ -t 0 ] && [ "$JA" = 0 ]; then fragen_ja "Jetzt starten?" "Start now?" || abbruch "Abgebrochen — nichts wurde geändert." "Cancelled — nothing was changed."; fi
fi

# ---------- 3. Stoppen, kopieren, prüfen ----------
if [ "$NEU" = 0 ] && [ "${#K_NAME[@]}" -gt 0 ]; then
  kopf "Dienste anhalten" "Stopping services"
  zu_stoppen=""; for i in "${!P_DIENST[@]}"; do [ "${P_STATUS[$i]}" = "neu" ] && zu_stoppen="$zu_stoppen ${P_DIENST[$i]}"; done
  # "speicher" gehört app UND sftpgo: beide anhalten, sonst schreibt der eine ins alte Volume
  case " ${K_NAME[*]} " in *" speicher "*) zu_stoppen="$zu_stoppen app sftpgo" ;; esac
  for d in $(printf '%s\n' $zu_stoppen | awk '!s[$0]++'); do
    for c in $(dienst_container "$d"); do
      if [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = "true" ]; then
        docker stop "$c" >/dev/null 2>&1 && { GESTOPPT+=("$c"); PHASE="gestoppt"; info "gestoppt: $d" "stopped: $d"; } || abbruch "Container $d ließ sich nicht anhalten." "Container $d could not be stopped."
      fi
    done
  done
  [ "${#GESTOPPT[@]}" -gt 0 ] || PHASE=""

  kopf "Daten kopieren und prüfen" "Copying and verifying data"
  pruef_befehl='cd /pruef && export LC_ALL=C && n=$(find . | wc -l) && b=$(find . -type f -exec stat -c "%s" {} + | awk "{s+=\$1} END {print s+0}") && h=$({ find . -type d | sort; find . -type f -exec stat -c "%s %n" {} + | sort -k2; find . -type l | sort; } | sha256sum | cut -c1-64) && echo "$n $b $h"'
  for i in "${!K_NAME[@]}"; do
    ordner="${K_ORDNER[$i]}"; dv="${K_VOLUME[$i]}"; v="${K_NAME[$i]}"
    mkdir -p "$ordner" || abbruch "Ordner $ordner nicht anlegbar." "Cannot create folder $ordner."
    [ -n "$dv" ] || continue
    info "kopiere $dv -> $ordner …" "copying $dv -> $ordner …"
    docker run --rm --network none -v "$dv":/von:ro -v "$ordner":/nach "$KOPIER_IMAGE" sh -c 'cp -a /von/. /nach/' || abbruch "Kopieren von $dv nach $ordner ist fehlgeschlagen. Die alten Daten sind unverändert." "Copying $dv to $ordner failed. The old data is untouched."
    a=$(docker run --rm --network none -v "$dv":/pruef:ro "$KOPIER_IMAGE" sh -c "$pruef_befehl" 2>&1 | tail -1)
    z=$(docker run --rm --network none -v "$ordner":/pruef:ro "$KOPIER_IMAGE" sh -c "$pruef_befehl" 2>&1 | tail -1)
    if [ -z "$a" ] || [ "$a" != "$z" ]; then
      abbruch "Prüfung nach dem Kopieren von $v fehlgeschlagen — Quelle: [$a], Ziel: [$z]. Die alten Daten sind unverändert, es wird nichts umgestellt. (Bei --weiter: enthielt der Zielordner schon fremde Dateien? Dann leeren.)" "Verification after copying $v failed — source: [$a], target: [$z]. The old data is untouched, nothing is switched. (With --weiter: did the target folder already contain foreign files? Then empty it.)"
    fi
    read -r n_ b_ h_ <<<"$a"
    gut "$v: $n_ Einträge, $b_ Bytes, Prüfsumme ${h_:0:12} — Quelle und Kopie sind gleich" "$v: $n_ entries, $b_ bytes, checksum ${h_:0:12} — source and copy match"
  done
else
  for i in "${!K_NAME[@]}"; do mkdir -p "${K_ORDNER[$i]}" || abbruch "Ordner ${K_ORDNER[$i]} nicht anlegbar." "Cannot create folder ${K_ORDNER[$i]}."; done
fi

# ---------- 4. Besitzer ----------
kopf "Besitzer setzen" "Setting owners"
GESEHEN=" "
for i in "${!P_DIENST[@]}"; do
  dir="${P_QUELLE[$i]}"; b="${BESITZER[${P_BESITZER[$i]}]}"
  case "$GESEHEN" in *" $dir "*) continue ;; esac; GESEHEN="$GESEHEN$dir "
  mkdir -p "$dir" 2>/dev/null
  aktuell=$(stat -c '%u:%g' "$dir" 2>/dev/null)
  if [ "${P_STATUS[$i]}" = "neu" ] || [ "$REPARIEREN" = 1 ]; then
    chown -R "$b" "$dir" && info "$dir -> $b" "$dir -> $b" || warnung "chown für $dir gescheitert." "chown failed for $dir."
  elif [ "$aktuell" != "$b" ]; then
    warnung "$dir gehört $aktuell, der Container ${P_DIENST[$i]} läuft als $b — „Permission denied“ möglich. Beheben: chown -R $b $dir (oder --reparieren)." "$dir is owned by $aktuell, the container ${P_DIENST[$i]} runs as $b — “Permission denied” possible. Fix: chown -R $b $dir (or --reparieren)."
  else info "$dir gehört schon $b" "$dir is already owned by $b"; fi
done

# ---------- 5. compose.hdd.yml und .env ----------
AENDERUNG=1
cf=$(env_wert COMPOSE_FILE)
if [ "$NEU_ANZAHL" -eq 0 ] && [ -f compose.hdd.yml ] && printf ':%s:' "$cf" | grep -q ':compose.hdd.yml:'; then AENDERUNG=0; fi
if [ "$AENDERUNG" = 0 ]; then
  kopf "compose.hdd.yml und .env" "compose.hdd.yml and .env"
  gut "Nichts zu ändern — compose.hdd.yml und COMPOSE_FILE passen schon." "Nothing to change — compose.hdd.yml and COMPOSE_FILE are already right."
else
kopf "compose.hdd.yml und .env schreiben" "Writing compose.hdd.yml and .env"
SICH=".sicherung/hdd-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$SICH" && chmod 700 .sicherung "$SICH" || abbruch "Sicherungsordner nicht anlegbar." "Cannot create backup folder."
SICH="$DIR/$SICH"
cp -p .env "$SICH/.env" && chmod 600 "$SICH/.env"
[ -f compose.hdd.yml ] && cp -p compose.hdd.yml "$SICH/compose.hdd.yml"
# neue Einträge zu den vorhandenen
for i in "${!P_DIENST[@]}"; do
  [ "${P_STATUS[$i]}" = "neu" ] || continue
  EIN+=("${P_DIENST[$i]}|${P_QUELLE[$i]}:${P_ZIEL[$i]}")
done
dienste_reihe=$(for e in ${EIN[@]+"${EIN[@]}"}; do echo "${e%%|*}"; done | awk '!s[$0]++')
neu_datei=$(mktemp "$DIR/.compose.hdd.XXXXXX") || abbruch "Temporäre Datei nicht anlegbar." "Cannot create temporary file."
{
  echo "# VylarisCloud: Daten auf einer anderen Platte (Bind-Mounts). Erzeugt/erweitert von daten-verschieben.sh am $(date '+%Y-%m-%d %H:%M')."
  echo "# update.sh fasst diese Datei nicht an. Sie steht in COMPOSE_FILE der .env und überschreibt die Volumes aus docker-compose.yml."
  echo "# Rückweg: Zeile entfernen/COMPOSE_FILE zurücksetzen — die alten Volumes sind noch da (siehe deploy/README.md)."
  echo "services:"
  for d in $dienste_reihe; do
    echo "  $d:"; echo "    volumes:"
    for e in "${EIN[@]}"; do [ "${e%%|*}" = "$d" ] && echo "      - ${e#*|}"; done
  done
} > "$neu_datei"
chmod 644 "$neu_datei"
mv -f "$neu_datei" compose.hdd.yml || abbruch "compose.hdd.yml nicht schreibbar." "Cannot write compose.hdd.yml."
PHASE="geschrieben"
if [ -z "$cf" ]; then neu_cf="docker-compose.yml:compose.hdd.yml"
elif printf ':%s:' "$cf" | grep -q ':compose.hdd.yml:'; then neu_cf="$cf"
else neu_cf="$cf:compose.hdd.yml"; fi
if [ "$neu_cf" != "$cf" ]; then
  sed -i '/^COMPOSE_FILE=/d' .env && echo "COMPOSE_FILE=$neu_cf" >> .env || abbruch ".env nicht schreibbar." ".env not writable."
  gut "COMPOSE_FILE=$neu_cf" "COMPOSE_FILE=$neu_cf"
else info "COMPOSE_FILE enthält compose.hdd.yml schon" "COMPOSE_FILE already contains compose.hdd.yml"; fi
docker compose config -q >/dev/null 2>"$SICH/config-fehler.txt" || abbruch "„docker compose config“ meldet einen Fehler: $(tail -2 "$SICH/config-fehler.txt" | tr '\n' ' ')" "“docker compose config” reports an error: $(tail -2 "$SICH/config-fehler.txt" | tr '\n' ' ')"
rm -f "$SICH/config-fehler.txt"
gut "Compose-Konfiguration ist gültig" "Compose configuration is valid"
fi

if [ "$NEU" = 1 ]; then
  PHASE=""
  echo ""
  gut "Fertig: Die Daten dieser Installation liegen künftig unter $ZIEL." "Done: this installation's data will live under $ZIEL."
  exit 0
fi

# ---------- 6. Neu starten und prüfen ----------
if [ "$AENDERUNG" = 1 ]; then
kopf "Neu starten" "Restarting"
out=$(docker compose up -d 2>&1); rc=$?
printf '%s\n' "$out" | tail -5 | sed 's/^/    /'
[ "$rc" -eq 0 ] || abbruch "„docker compose up -d“ ist fehlgeschlagen." "“docker compose up -d” failed."
PHASE=""; GESTOPPT=()
app_c=$(docker ps -q --filter "label=com.docker.compose.project=$PROJEKT" --filter "label=com.docker.compose.service=app" 2>/dev/null | head -1)
zustand=""
for i in $(seq 1 60); do
  zustand=$( [ -n "$app_c" ] && docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$app_c" 2>/dev/null )
  case "$zustand" in healthy|unhealthy|exited|dead) break ;; running) [ "$i" -ge 10 ] && break ;; esac
  sleep 2
done
case "$zustand" in
  healthy|running) gut "App läuft ($zustand)" "App is running ($zustand)" ;;
  *) warnung "Die App meldet sich nicht gesund (${zustand:-kein Container}). Prüfen: cd $DIR && docker compose logs --tail 50 app. Rückweg siehe unten." "The app does not report healthy (${zustand:-no container}). Check: cd $DIR && docker compose logs --tail 50 app. Rollback below." ;;
esac
fi

kopf "Prüfen: liegen die Ordner auf der Ziel-Platte?" "Checking: are the folders on the target disk?"
FEHLER=0
for i in "${!P_DIENST[@]}"; do
  d="${P_DIENST[$i]}"; zz="${P_ZIEL[$i]}"; quelle="${P_QUELLE[$i]}"
  c=$(docker ps -q --filter "label=com.docker.compose.project=$PROJEKT" --filter "label=com.docker.compose.service=$d" 2>/dev/null | head -1)
  if [ -z "$c" ]; then info "$d läuft nicht (Profil nicht aktiv?) — $zz nicht geprüft; Einbindung steht in compose.hdd.yml." "$d is not running (profile not active?) — $zz not checked; the mount is in compose.hdd.yml."; continue; fi
  src=$(docker inspect -f '{{range .Mounts}}{{.Destination}}={{.Source}}{{"\n"}}{{end}}' "$c" 2>/dev/null | sed -n "s#^$zz=##p" | head -1)
  if [ -n "$src" ] && [ "$(readlink -f "$src" 2>/dev/null)" = "$(readlink -f "$quelle")" ]; then
    host_dev=$(df -P "$quelle" 2>/dev/null | awk 'NR==2 {print $1}')
    cont_dev=$(docker exec "$c" df -P "$zz" 2>/dev/null | awk 'NR==2 {print $1}')
    if [ -n "$cont_dev" ] && [ "$cont_dev" = "$host_dev" ]; then gut "$d:$zz liegt auf $host_dev (df im Container bestätigt)" "$d:$zz is on $host_dev (confirmed by df in the container)"
    elif [ -z "$cont_dev" ]; then gut "$d:$zz ist auf $quelle gebunden (kein df im Container verfügbar)" "$d:$zz is bound to $quelle (no df available in the container)"
    else warnung "$d:$zz: df im Container zeigt $cont_dev, auf dem Server liegt $quelle auf $host_dev." "$d:$zz: df in the container shows $cont_dev, but on the server $quelle is on $host_dev."; FEHLER=1; fi
  else
    warnung "$d:$zz ist NICHT auf $quelle gebunden (Quelle im Container: ${src:-keine}). compose.hdd.yml/COMPOSE_FILE prüfen: docker compose config" "$d:$zz is NOT bound to $quelle (source in the container: ${src:-none}). Check compose.hdd.yml/COMPOSE_FILE: docker compose config"; FEHLER=1
  fi
done

# ---------- Abschluss ----------
echo ""
if [ "$FEHLER" = 0 ]; then echo "${G}${B}$(s "Fertig." "Done.")${N}"; else echo "${Y}${B}$(s "Fertig, aber mit Warnungen oben." "Done, but with warnings above.")${N}"; fi
altvol=""; for i in "${!K_VOLUME[@]}"; do [ -n "${K_VOLUME[$i]}" ] && altvol="$altvol ${K_VOLUME[$i]}"; done
if [ -n "$altvol" ]; then
  info "Die alten Volumes sind noch da (Rückweg möglich):$altvol" "The old volumes are still there (rollback possible):$altvol"
  info "Erst wenn alles ein paar Tage sauber läuft und gesichert ist, Platz freigeben mit: docker volume rm$altvol" "Only once everything has run cleanly for a few days and is backed up, free the space with: docker volume rm$altvol"
fi
if [ "$AENDERUNG" = 1 ]; then info "Rückweg: cd $DIR && cp -p $SICH/.env .env && $( [ "$HDD_VORHER" = 1 ] && echo "cp -p $SICH/compose.hdd.yml compose.hdd.yml" || echo "rm compose.hdd.yml" ) && docker compose up -d" "Rollback: cd $DIR && cp -p $SICH/.env .env && $( [ "$HDD_VORHER" = 1 ] && echo "cp -p $SICH/compose.hdd.yml compose.hdd.yml" || echo "rm compose.hdd.yml" ) && docker compose up -d"; fi
[ "$AENDERUNG" = 1 ] && info "Achtung: Was nach dem Umstellen neu geschrieben wurde, liegt nur auf der neuen Platte — nach einem Rückweg fehlt es in den alten Volumes." "Note: anything written after the switch exists only on the new disk — after a rollback it is missing from the old volumes."
[ "$SPEICHER_AN" = 1 ] && info "SFTP (Port 2222) geht nicht durch den Cloudflare Tunnel — Port in der Firewall/Router freigeben. WebDAV und S3 laufen über den Tunnel." "SFTP (port 2222) does not go through the Cloudflare Tunnel — open the port in the firewall/router. WebDAV and S3 use the tunnel."
[ "$FEHLER" = 0 ]
exit $?
