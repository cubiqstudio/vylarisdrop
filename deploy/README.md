# VylarisCloud

**Selbst gehostete Cloud**: Dateien in Ordnern verwalten, als Netzlaufwerk einbinden und synchronisieren, mit Speicher-Kontingenten begrenzen und als Link teilen. Dazu das Datei- und Medien-Hosting für Screenshots, Videos, Musik, Dokumente und Code (Bereich **Drop**). VylarisCloud läuft als Docker-Paket auf deinem eigenen Server und holt das HTTPS-Zertifikat selbst.

Ein Produkt der [VylarisGroupEurope](https://vylaris.eu) · kostenlos nutzbar, **Pro** für Teams und Firmen

> **English:** Self-hosted cloud: a file manager with folders (`/`), WebDAV sync (`/dav`, app passwords), per-account/role/team storage quotas and admin-managed SFTP storage add-ons — plus the original file-hosting area, now called Drop (`/drop`). Details are in German below. Self-hosted file and media hosting. Upload screenshots, videos, music, documents and code and share them as links — optionally end-to-end encrypted, as a gallery or as a paste with syntax highlighting. Passkeys, statistics, Discord/e-mail notifications, optional ClamAV virus scan, REST API with webhooks, automatic storage rules, CDN features (image resizing via URL, hotlink protection). Works with ShareX and Flameshot. HEIC photos and Live Photos from the iPhone just work. Move over from Zipline, XBackBone, Chibisafe, ShareX, Imgur, Google Photos, iCloud (data export, shared links or Apple ID sign-in) or Tiny File Manager. One `docker compose up`, automatic HTTPS via Let's Encrypt. German and English. Jump to [Quick start](#schnellstart).

---

## Was es kann

### Cloud

- **Dateimanager** (`/`): Ordner, Pfadleiste, Liste und Raster, Favoriten, „Zuletzt“, Suche, Auswahl mit Tastatur und Maus, Verschieben per Ziehen, ZIP-Download, Papierkorb. Bedienung und Tastenkürzel: [README im Projekt](../README.md#cloud-dateimanager).
- **[Sync per WebDAV](#sync-per-webdav)** (`/dav`): Netzlaufwerk oder Abgleich mit App-Passwörtern, auch nur lesend.
- **[Speicherplatz und Kontingente](#speicherplatz-und-kontingente):** Limit pro Konto, Rolle, Installation und Team (Rolle und Team mit Pro), Warnung bei 80 % und 100 %.
- **[Speicher-Erweiterungen (SFTP)](#speicher-erweiterungen-sftp):** Admins binden externe SFTP-Speicher im Panel ein und legen neue Dateien dort ab.

### Drop und Verwaltung

Der Bereich **Drop** (`/drop`, früher die Startseite) mit Links, Galerien, Pastes und Anfragen sowie die übrigen Funktionen. Alles davon funktioniert unverändert:

- **Hochladen, wie es passt:** Dateien ins Fenster ziehen, mit Strg + V einfügen oder über ShareX, Flameshot und curl senden. Große Dateien gehen in Stücken und setzen nach einem Abbruch fort.
- **Jede Datei hat eine eigene Seite** mit Vorschau für Bilder, Videos, Audio, Text und Code. Dazu gibt es einen Direktlink (nur die Datei, wie bei einem Bild-Hoster), einen Download-Link und einen Raw-Link.
- **Teilen mit Grenzen:** Ablaufdatum, Passwort, Höchstzahl an Aufrufen, eigener Linkname. Linknamen gibt es in sechs Stilen: Zufall, Wörter, Datum, Dateiname, UUID oder unsichtbar.
- **Ende-zu-Ende-Verschlüsselung:** ein Schalter beim Hochladen. Verschlüsselt wird im Browser, der Schlüssel steckt nur im Link — der Server sieht nie den Inhalt.
- **Text & Code:** einfügen, Sprache wählen oder erkennen lassen, mit Syntax-Hervorhebung teilen — auch mit Ablauf und „nach dem Lesen löschen“.
- **Galerien:** ein Ordner als öffentliche Seite mit Großansicht, Diashow und „Alles als ZIP“.
- **Embed-Designer:** So sieht dein Link in Discord, Telegram und WhatsApp aus (Titel, Text, Farbe, Bild).
- **Medien:**
  - Video-Player mit Vorschau-Streifen beim Spulen und Audio-Player mit Wellenform
  - Vorschaubilder für alle Bilder und Videos
  - Bilder im Browser bearbeiten
  - **iPhone-Fotos:** HEIC bleibt im Original, Vorschau, Direktlink und Galerie zeigen ein JPEG. **Live Photos** sind ein Eintrag — das kurze Video spielt beim Drüberfahren.
- **Datenschutz:** Standort- und Kameradaten werden verlustfrei entfernt. Bilder lassen sich optional nach WebP oder AVIF umwandeln.
- **Ordner und Tags**, auch verschachtelt. Dazu Favoriten, Suche, Sammelaktionen und ein **Papierkorb** (30 Tage).
- **Statistik:** Aufrufe pro Tag, Herkunft (Discord, Reddit …) und Länder — gezählt ohne IP-Adressen.
- **Benachrichtigungen** per Discord-Webhook oder E-Mail: Datei-Anfragen, Speicher fast voll, Virenfund.
- **Virenscan** (optional): ClamAV prüft jede Datei, Funde kommen in Quarantäne.
- **Protokoll:** wer wann was gemacht hat — für jedes Konto, Admins sehen alles.
- **API und Webhooks:** eine dokumentierte REST-API (`/api/v1`, OpenAPI unter `/api/v1/openapi.json`) mit Token-Rechten (Hochladen, Lesen, Verwalten) und signierte Webhooks mit Wiederholung — für n8n, Zapier, Make oder eigene Skripte.
- **Als CDN (beides standardmäßig aus):**
  - **Bilder per URL anpassen:** `…/r/bild.png?w=800&h=600&fit=cover&format=webp&q=80` — Größe, Zuschnitt, Format (WebP, AVIF, JPEG, PNG oder `auto` = bestes, das der Browser kann) und Qualität. Jede Variante entsteht einmal und wird zwischengespeichert.
  - **Hotlink-Schutz:** Direktlinks und Vorschaubilder nur auf erlaubten Websites einbinden; die eigene Domain ist immer erlaubt, Downloads bleiben offen.
- **Speicher-Regeln:** alte oder lange nicht angesehene Dateien räumen sich von selbst auf — in den Papierkorb, endgültig oder (mit S3) ausgelagert. Mit Vorschau, wie viele Dateien eine Regel trifft.
- **Datei-Anfragen:** Andere laden über einen Link Dateien zu dir hoch, auch ohne Konto, und nehmen auf Wunsch Sprachnachrichten oder Videobotschaften direkt im Browser auf (nur über HTTPS).
- **Speicher-Anbieter** (optional, kostenlos): **Storage-Boxen** mit Zugang per SFTP, SCP und WebDAV — samt Unterkonten mit eigenem Ordner — und **S3-kompatible Buckets** mit Zugangsschlüsseln für rclone, restic, aws-cli und eigene Apps. Feste Kontingente, Belegung mit Verlauf, Warnung bei 80 %.
- **Umzug aus anderen Diensten:** Zipline v3/v4, XBackBone, Chibisafe, ShareX-Verlauf, Imgur, Google Fotos (Takeout), iCloud (Fotos und Drive) und Tiny File Manager (Webordner samt Konten aus der `config.php`). Mit dabei sind:
  - Konten samt Passwörtern, Ordner und Tags
  - alte Linknamen; alte Pfade wie `/u/abc.png` leiten auf die neue Datei weiter
- **Mehrere Konten** mit Speicher-Kontingent, Zwei-Faktor-Anmeldung mit Notfall-Codes und **Passkeys** (Fingerabdruck, Face ID, Sicherheitsschlüssel).
- **Hell und dunkel, Deutsch und Englisch.** Dazu ein Einrichtungs-Assistent mit Domain-Prüfung und automatischem HTTPS.

### Pro

Pro wird mit einem Lizenzschlüssel freigeschaltet. Alles oben bleibt ohne Lizenz voll nutzbar.

- **Mehrere Server:** Weitere VylarisCloud-Container teilen sich eine Datenbank. Vorschaubilder, Importe und Aufräumen verteilen sich von selbst, nichts läuft doppelt. Fällt ein Server aus, übernimmt ein anderer.
- **S3-Speicher:** AWS, Cloudflare R2, Backblaze B2, Wasabi, Hetzner, MinIO oder Garage. Der Umzug aller Dateien geht per Klick und in beide Richtungen; Links bleiben gleich und Videos spulen weiter direkt.
- **Teams und Rollen:**
  - Team-Ordner, in denen alle Mitglieder die Dateien sehen und hochladen; die Team-Leitung verwaltet alles darin.
  - Eigene Rollen mit Rechten (Hochladen, Anfragen, Import) und Grenzen (Dateigröße, Speicher, automatisches Löschen).
  - Team-Ordner erscheinen im Dateimanager (Ansicht „Team-Ordner“) und im WebDAV-Baum (`Team-Ordner/<Teamname>`). Dazu ein Kontingent je Team, siehe [Speicherplatz und Kontingente](#speicherplatz-und-kontingente).
- **Anmeldung über SSO:** OpenID Connect (Authentik, Keycloak, Authelia, Zitadel, Okta …), Google, Microsoft, GitHub und Discord.
  - Neue Konten auf Wunsch automatisch, mit Rolle und Team.
  - Nur bestimmte E-Mail-Domains zulassen, Gruppe → Admin.
  - Passwort-Anmeldung abschaltbar.
- **Eigene Marke:** eigenes Logo und Browser-Symbol, eigener Text auf der Anmeldeseite, eigene Fußzeile und kein „Mit VylarisCloud geteilt“.
- **Sicherung per Knopf:** die ganze Installation als eine ZIP-Datei — Datenbank und jede Datei, lokal wie aus S3. Auf jedem VylarisCloud-Server wieder einspielbar, Links bleiben gleich.
- **Traffic & Grenzen:** ausgelieferte Datenmenge pro Tag und Datei (bei Teil-Abrufen nur das übertragene Stück), Übersicht für alle Konten, monatliche Grenze pro Konto oder Rolle mit Warnung bei 80 % und 100 %.
- **Monitoring:** Systemseite mit Verläufen (Anfragen, Fehler, Antwortzeit, CPU, Arbeitsspeicher), Prometheus-Endpunkt `/metrics`, fertiges Grafana-Dashboard und Warnungen bei voller Platte, vielen Fehlern oder ausgefallenem Server.

Die Lizenz wird gegen den Lizenzaussteller geprüft (der eigenen Installation oder eines anderen Servers über `VD_LIZENZ_SERVER`). Ist ein externer Lizenzserver einmal nicht erreichbar, läuft Pro 7 Tage weiter. Alle Server einer Installation zählen als **eine** Installation.

## Voraussetzungen

| | Minimum | Empfohlen |
|---|---|---|
| CPU | 1 vCPU | 2 vCPU (Videos) |
| RAM | 1 GB | 2 GB (mit Virenscan 3 GB) |
| Speicher | 5 GB + deine Dateien | je nach Bedarf — oder S3 (Pro) |

- Ein Linux-Server (Debian oder Ubuntu) mit Root-Zugriff.
- Port **80** und **443** von außen erreichbar, ein schon laufender nginx/Apache, hinter den sich VylarisCloud hängt — oder ein [Cloudflare Tunnel](#cloudflare-tunnel-ohne-offene-ports), dann muss gar kein Port offen sein.
- Für HTTPS eine (Sub-)Domain, deren DNS-A-Eintrag auf den Server zeigt.

## Schnellstart

```bash
curl -fsSL https://raw.githubusercontent.com/cubiqstudio/vylarisdrop/main/deploy/install.sh | sudo bash
```

Das Skript erledigt Folgendes:
- legt alles nach **`/opt/vylariscloud`** (anderer Ordner: `curl … | sudo VD_DIR=/srv/vylariscloud bash`)
- installiert Docker, falls nötig
- erzeugt ein Datenbank-Passwort und startet alles
- zeigt am Ende die Adresse und den **Setup-Code**

Öffne die Adresse im Browser und folge dem Assistenten.

<details>
<summary>Lieber von Hand?</summary>

```bash
mkdir vylariscloud && cd vylariscloud
for f in docker-compose.yml compose.caddy.yml compose.port.yml Caddyfile .env.example; do curl -fsSLO "https://raw.githubusercontent.com/cubiqstudio/vylarisdrop/main/deploy/$f"; done
cp .env.example .env
nano .env                # DB_PASSWORD setzen (lang und zufällig)
mkdir -p import
docker compose up -d
docker compose logs app | grep Setup-Code
```

Danach `http://<IP-deines-Servers>` im Browser öffnen.
</details>

### Domain und HTTPS

Im Assistenten gibst du deine Domain ein. Er zeigt die erkannte Server-IP und den nötigen DNS-Eintrag, prüft ihn und holt das Zertifikat.

- Lege einen **A-Eintrag** auf die IP deines Servers an.
- Bei **Cloudflare** den Proxy ausschalten (graue Wolke), sonst kann das Zertifikat nicht ausgestellt werden.

### Hinter deinem eigenen Webserver

Läuft auf dem Server schon nginx, Apache oder ein Panel wie Plesk auf Port 80/443, merkt `install.sh` das und richtet VylarisCloud **ohne eigenen Caddy** ein:
- Die App bekommt einen freien Port auf `127.0.0.1`.
- Auf Nachfrage legt das Skript für deine Domain den Virtual Host an und holt per `certbot` das Zertifikat.
- Noch keine Domain? Dann ist VylarisCloud **nur für die Einrichtung** unter `http://<Server-IP>` erreichbar: ein eigener Eintrag nur für die IP, geschützt durch den Setup-Code. Nach dem Assistenten entfernt das Skript ihn wieder und richtet für die Domain aus dem Assistenten Virtual Host und Zertifikat ein.

Wichtig für große Uploads: im Webserver keine Größengrenze setzen (nginx: `client_max_body_size 0;`).

Ohne Nachfragen geht es mit Schaltern:

```bash
sudo bash install.sh --port 8080 --domain cloud.deinefirma.de --email du@deinefirma.de
```

`--no-vhost` lässt den Webserver unangetastet, `--caddy` erzwingt den eigenen Caddy, `--virenscan` / `--no-virenscan` beantwortet die Frage nach ClamAV.

### Cloudflare Tunnel (ohne offene Ports)

Für Heimserver oder Server hinter einer Firewall: VylarisCloud baut über einen eigenen `cloudflared`-Container die Verbindung zu Cloudflare auf, Cloudflare liefert deine Domain samt HTTPS aus — Port 80/443 müssen nicht offen sein. Einrichten gleich im **Einrichtungs-Assistenten** (Schritt „Adresse & HTTPS“ → „Cloudflare Tunnel“) oder später im Panel unter **Einstellungen → Installation → Cloudflare Tunnel**, auf zwei Wegen:

- **Tunnel-Token:** Tunnel im Cloudflare-Dashboard anlegen (Zero Trust → Networks → Tunnels), als Public Hostname deine Domain mit Service `HTTP` → `app:3000`, dann den Token im Panel einfügen.
- **Automatisch:** ein Cloudflare-API-Token mit den Rechten „Account → Cloudflare Tunnel → Edit“ und „Zone → DNS → Edit“ einfügen — VylarisCloud legt Tunnel, Weiterleitung und DNS-Eintrag selbst an und räumt sie auf Wunsch wieder ab.

Der Schalter braucht den Update-Dienst auf dem Server (einmal `sudo bash install.sh` bei älteren Installationen).

### Speicher (Storage-Boxen und S3-Buckets)

Dieser Abschnitt betrifft das Modul **Speicher** (`/speicher`). Externe SFTP-Speicher, in denen die Cloud ihre eigenen Dateien ablegt, richtest du unter [Speicher-Erweiterungen](#speicher-erweiterungen-sftp) ein.

VylarisCloud kann selbst Speicher anbieten — wie eine Storage-Box bzw. ein Object Storage bei einem Hoster, nur auf deinem Server. Eingeschaltet wird das im Panel unter **Speicher** (nur der Inhaber): VylarisCloud startet dafür zwei kleine Zusatz-Container, [SFTPGo](https://github.com/drakkan/sftpgo) für SFTP/SCP/WebDAV und [Garage](https://git.deuxfleurs.fr/Deuxfleurs/garage) für S3 (zusammen rund 30 MB Arbeitsspeicher). Beide laufen unverändert unter ihrer eigenen Lizenz (AGPL-3.0).

- **Storage-Box:** eigener Login (z. B. `vd482913`), Passwort oder SSH-Schlüssel, festes Kontingent. Zugang per **SFTP/SCP** über einen eigenen Port (Standard `2222`, beim Einschalten wählbar; ufw/firewalld öffnet VylarisCloud selbst) und per **WebDAV** unter `https://deine-domain/webdav/` (Netzlaufwerk in Windows und macOS).
- **Unterkonten:** eigener Login nur für einen Unterordner der Box, nur lesen oder lesen und schreiben. Sie teilen sich das Kontingent der Box.
- **Bucket:** S3-kompatibel unter der Adresse von VylarisCloud (`https://deine-domain`, Region `garage`, **Path-Style**). Zugangsschlüssel je Bucket, lesend oder schreibend; das Secret wird nur beim Anlegen gezeigt.
- **Kontingente** setzen SFTPGo und Garage hart durch. VylarisCloud misst die Belegung stündlich (Verlauf 7/30/90 Tage) und warnt bei 80 % und bei vollem Kontingent.
- **Wer darf?** Standardmäßig legen nur Admins Speicher an. Der Inhaber kann es für alle Konten freigeben, mit Grenzen für Größe und Anzahl.

Beim Ausschalten bleiben alle Boxen, Buckets und Dateien erhalten (Volumes `speicher`, `sftpgo`, `garage-meta`, `garage-daten`). Hinweise: SFTP geht nicht über einen Cloudflare Tunnel (der leitet nur HTTP weiter) — WebDAV und S3 schon. Garage hält auf einem einzelnen Server keine zweite Kopie: für wichtige Daten eigene Backups machen. Der Schalter braucht den Update-Dienst auf dem Server (bei älteren Installationen einmal `update.sh` ausführen).

### Virenscan

Der Installer fragt einmal, ob ClamAV mitlaufen soll (eigener Container, etwa 1,5 GB Arbeitsspeicher). Später schaltest du ihn unter **Einstellungen → Installation** an und aus; der Update-Dienst auf dem Server startet bzw. stoppt den Container dann selbst. Geprüft wird jede Datei bis 100 MB, beim Einschalten auch alle vorhandenen. Ende-zu-Ende-verschlüsselte Dateien kann kein Virenscanner lesen, sie werden übersprungen.

Von Hand: `COMPOSE_PROFILES=virenscan` in die `.env` schreiben und `docker compose up -d`.

## Sync per WebDAV

Die Cloud lässt sich als Netzlaufwerk einbinden oder mit Sync-Programmen abgleichen. Der WebDAV-Server liegt unter **`https://<deine-domain>/dav/`** und zeigt dieselben Ordner und Dateien wie „Meine Dateien“:

- Deine Ordner und Dateien liegen direkt unter der Adresse.
- Mit Pro und Team-Mitgliedschaft kommt der Ordner `Team-Ordner/<Teamname>/…` dazu, mit deinen Team-Rechten. Ein Team-Ordner lässt sich nicht aus dem Team herausschieben.
- Das ist nicht der Pfad `/webdav/` der Speicher-Boxen (siehe [Speicher](#speicher-storage-boxen-und-s3-buckets)); der gehört SFTPGo.

### App-Passwörter

WebDAV meldet sich **nicht** mit dem Konto-Passwort an, sondern mit einem App-Passwort:

1. In der Cloud **Sync & WebDAV** (`/sync`) öffnen, unter „App-Passwörter“ einen Namen vergeben (z. B. „Laptop“) und auf Wunsch **Nur lesen** wählen.
2. Das Passwort (`vd_dav_` plus 32 Zeichen) erscheint **einmal**; gespeichert wird nur ein Hash. Kopieren und im Programm eintragen.
3. Benutzername ist dein Kontoname, Passwort das App-Passwort.

Je Konto gibt es bis zu 25 App-Passwörter; die Liste zeigt, wann sie zuletzt benutzt wurden, und jedes lässt sich einzeln widerrufen. Mit dem Konto verschwinden auch seine App-Passwörter. Ein App-Passwort umgeht die Zwei-Faktor-Abfrage: nur Geräten geben, denen du traust, und bei Verlust widerrufen. Nach mehreren Fehlversuchen von derselben Adresse sperrt der Server die Anmeldung für etwa zehn Minuten (Antwort 429).

Die Seite `/sync` zeigt Adresse und Benutzername deiner Installation und füllt die folgenden Beispiele damit aus.

### Einbinden

Ersetze `cloud.deinefirma.de` durch deine Domain, `anna` durch den Kontonamen.

**Windows (Netzlaufwerk):** Explorer → Rechtsklick auf „Dieser PC“ → „Netzwerklaufwerk verbinden“, Ordner `https://cloud.deinefirma.de/dav/`, „Verbindung mit anderen Anmeldeinformationen herstellen“ anhaken. Oder in der Eingabeaufforderung:

```bat
net use Z: https://cloud.deinefirma.de/dav/ /user:anna vd_dav_… /persistent:yes
```

- Windows lehnt Basic-Anmeldung über `http://` ab. Richte HTTPS ein; ohne HTTPS hilft nur ein Registry-Eintrag (Administrator-Eingabeaufforderung): `reg add HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters /v BasicAuthLevel /t REG_DWORD /d 2 /f`, danach `net stop webclient && net start webclient`.
- Windows begrenzt Dateien auf WebDAV-Laufwerken standardmäßig auf 50 MB. Anheben auf 4 GB: `reg add HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters /v FileSizeLimitInBytes /t REG_DWORD /d 4294967295 /f`.

**macOS (Finder):** „Gehe zu“ → „Mit Server verbinden …“ (`⌘K`), Adresse `https://cloud.deinefirma.de/dav/`, als „Registrierter Benutzer“ mit Kontoname und App-Passwort anmelden. Im Terminal: `open https://cloud.deinefirma.de/dav/` oder `mkdir -p ~/Cloud && mount_webdav -i https://cloud.deinefirma.de/dav/ ~/Cloud`. Der Finder sperrt Dateien beim Bearbeiten (LOCK); das unterstützt der Server. Nur-lesen-Passwörter bindet der Finder schreibgeschützt ein.

**Linux:**

```bash
# GNOME Dateien (GVfs); in KDE Dolphin: webdavs://cloud.deinefirma.de/dav/ in die Adressleiste
gio mount davs://anna@cloud.deinefirma.de/dav/

# davfs2
sudo apt install davfs2
sudo mkdir -p /mnt/cloud
echo 'https://cloud.deinefirma.de/dav/ anna vd_dav_…' | sudo tee -a /etc/davfs2/secrets
sudo chmod 600 /etc/davfs2/secrets
sudo mount -t davfs https://cloud.deinefirma.de/dav/ /mnt/cloud

# rclone: einmal einrichten, dann kopieren, abgleichen, vergleichen oder als Laufwerk einbinden
rclone config create vylaris webdav url https://cloud.deinefirma.de/dav/ vendor other user anna pass "$(rclone obscure 'vd_dav_…')"
rclone lsd vylaris:
rclone copy ~/Fotos vylaris:Fotos --progress
rclone sync ~/Dokumente vylaris:Dokumente --progress   # Spiegel: löscht im Ziel, was lokal fehlt
rclone check ~/Dokumente vylaris:Dokumente
rclone mount vylaris: ~/Cloud --vfs-cache-mode writes
```

davfs2 puffert Uploads zuerst lokal; bei großen Dateien `cache_size` in `/etc/davfs2/davfs2.conf` prüfen.

**iOS / iPadOS:** App „Dateien“ → „···“ → „Mit Server verbinden“, Server `https://cloud.deinefirma.de/dav/`, „Registrierter Benutzer“ mit Kontoname und App-Passwort.

**Android:** Android bringt keinen WebDAV-Client mit. Bewährte Apps sind Solid Explorer, Material Files oder FolderSync (für den Abgleich ganzer Ordner, z. B. Kamera-Ordner). Eintragen: Protokoll WebDAV mit HTTPS, Host `cloud.deinefirma.de`, Port 443, Pfad `/dav/`, Kontoname und App-Passwort.

**curl** (zum Testen und für Skripte):

```bash
curl -u anna:vd_dav_… -X PROPFIND -H 'Depth: 1' https://cloud.deinefirma.de/dav/        # auflisten
curl -u anna:vd_dav_… -T bericht.pdf https://cloud.deinefirma.de/dav/Dokumente/bericht.pdf  # hochladen
curl -u anna:vd_dav_… -O https://cloud.deinefirma.de/dav/Dokumente/bericht.pdf              # herunterladen
curl -u anna:vd_dav_… -X MKCOL https://cloud.deinefirma.de/dav/Neu/
curl -u anna:vd_dav_… -X MOVE -H 'Destination: https://cloud.deinefirma.de/dav/Neu/b.pdf' https://cloud.deinefirma.de/dav/Dokumente/bericht.pdf
curl -u anna:vd_dav_… -X DELETE https://cloud.deinefirma.de/dav/Neu/b.pdf               # Papierkorb
```

### Was getestet ist

**Getestet** wurde der Server mit curl (`scripts/test-dav.sh`), mit dem Python-Client `webdavclient3` und gegen den Text von RFC 4918 (PROPFIND, PROPPATCH, GET/HEAD mit Range und ETag, PUT, DELETE, MKCOL, COPY, MOVE, LOCK, UNLOCK). **Nicht live geprüft** sind der Windows-Netzlaufwerk-Client, der macOS-Finder, die Dateien-App von iOS, Android-Apps, davfs2, GVfs, Cyberduck und rclone. Die Anleitungen oben folgen deren Dokumentation; die Windows-Registry-Werte sind die bekannten WebClient-Einstellungen, hier nicht ausprobiert. Wenn ein Client sich seltsam verhält, hilft ein Blick ins Log (`docker compose logs -f app`) und ein Vergleich mit curl.

### Verhalten und Grenzen

- **Ordner:** höchstens **1.000 Ordner je Konto**. Das zählt alle Ordner des Kontos, auch die aus dem Dateimanager; wer schon mehr hat, kann per WebDAV keine neuen anlegen (Antwort 507).
- **Namen:** höchstens 200 Zeichen, kein `/` oder `\`, keine Steuerzeichen, keine Namen nur aus Punkten, kein Leerzeichen am Rand. Groß-/Kleinschreibung unterscheidet WebDAV nicht (Konflikt: 409). Gibt es in der Cloud zwei gleiche Namen im selben Ordner, zeigt WebDAV den zweiten als `name (2).ext`; die Datei selbst behält ihren Namen.
- **PROPFIND:** Tiefe 0 und 1. `Depth: infinity` beantwortet der Server mit 403.
- **Sperren (LOCK):** exklusive Schreibsperren, damit Finder und Office speichern können; sie laufen nach spätestens einer Stunde ab, Clients verlängern sie selbst.
- **Hochladen (PUT):** wird gestreamt, auch große Dateien. Ein abgebrochener Upload hinterlässt nichts. Überschreiben behält den Link der Datei. Danach läuft dieselbe Nachbearbeitung wie bei jedem Upload (Vorschaubilder, Prüfsumme, Webhooks). Zu große Dateien (Grenze „Größte Datei“, Rollen-Grenze) beantwortet der Server mit 413, ein volles [Kontingent](#speicherplatz-und-kontingente) mit 507.
- **Löschen:** Dateien landen im Papierkorb (30 Tage), auch wenn ein Sync-Programm sie löscht.
- **Kopieren:** `COPY` legt eine echte zweite Datei an und belegt Speicher.
- **Nur lesen:** Mit einem Nur-lesen-App-Passwort antwortet jede ändernde Anfrage mit 403.
- **Reverse-Proxy:** Große Uploads brauchen im Webserver keine Größengrenze (nginx: `client_max_body_size 0;`, bei `install.sh` schon gesetzt). Der mitgelieferte Caddy reicht alle WebDAV-Methoden durch. Hinter einem Cloudflare-Proxy oder -Tunnel gilt das Anfrage-Limit deines Tarifs (bei Free/Pro 100 MB je Anfrage); ein WebDAV-PUT ist eine einzige Anfrage, größere Dateien dann besser über die Weboberfläche hochladen.

## Speicherplatz und Kontingente

Jedes Konto kann ein Speicher-Kontingent haben. Das **wirksame Kontingent** eines Kontos ergibt sich in dieser Reihenfolge, der erste Treffer gewinnt:

| Rang | Quelle | Wo einstellen |
|---|---|---|
| 1 | **Konto-Kontingent** (Wert in GB/TB oder ausdrücklich **Unbegrenzt**) | **Nutzer** → Konto bearbeiten (Admins) |
| 2 | **Rollen-Kontingent** (nur mit Pro; gilt nur für normale Konten) | **Teams & Rollen** → Rolle → „Speicher (GB)“ |
| 3 | **Standard-Kontingent** der Installation (gilt nur für normale Konten) | **Einstellungen** → Installation → Uploads → „Standard-Kontingent pro Konto“ |
| 4 | sonst unbegrenzt | |

- „Standard (erben)“ am Konto bedeutet: weiter mit Rang 2 bzw. 3. Bereits gesetzte Werte aus älteren Versionen bleiben gültig.
- **Admin- und Inhaber-Konten** unterliegen weder Rollen- noch Standard-Kontingent, nur einem Limit, das ausdrücklich am Konto steht.
- **Team-Kontingent** (nur mit Pro): **Teams & Rollen** → Team → „Team-Kontingent“. Es begrenzt die Gesamtgröße aller Dateien in den Ordnern des Teams samt Unterordnern, egal wer sie hochgeladen hat. Ein Upload in einen Team-Ordner muss **beide** Grenzen einhalten: Die Datei zählt zum Konto des Hochladenden und zum Team.
- Auf der Seite **Nutzer** sehen Admins die Belegung je Konto (Balken, Filter „über 80 %“, „voll“, „ohne Limit“) und eine Übersicht; **Teams & Rollen** zeigt den Balken je Team. Jedes Konto sieht seinen Balken unten in der Seitenleiste.

### Was zählt

**Belegt** ist die Summe der Dateigrößen des Kontos **plus der Papierkorb**. Gelöschte Dateien belegen weiter Platz, bis der Papierkorb geleert wird oder die 30 Tage um sind; Wiederherstellen ändert nichts an der Summe. Nicht mitgezählt werden Storage-Boxen und Buckets des Moduls „Speicher“ (eigene Kontingente), Vorschaubilder und andere Nebendateien. Kopien zählen je Kopie.

### Durchsetzung und Warnungen

- Geprüft wird beim Start eines Uploads anhand der angekündigten Größe und noch einmal endgültig vor dem Anlegen der Datei, unter einer Sperre je Konto (und je Team). Parallele Uploads, auch von mehreren Servern, können das Limit deshalb nicht überschreiten.
- Das gilt für alle Wege, auf denen Dateien entstehen: Upload im Browser, Upload in Stücken, Datei-Anfragen, Upload-Werkzeuge und API, Import, Inhalt ersetzen, Kopieren im Dateimanager und WebDAV.
- Ist das Kontingent erreicht, lehnt der Server mit **HTTP 507** und einer Meldung mit Zahlen ab („Dein Speicher ist voll: 4,8 von 5 GB belegt, die Datei braucht 600 MB.“). Eine einzelne Datei über der Grenze „Größte Datei“ bleibt ein 413.
- **Warnungen** gibt es einmal bei **80 %** und einmal bei **100 %** des Konto-Kontingents, per Discord-Webhook oder E-Mail wie unter **Einstellungen → Benachrichtigungen** („Dein Speicher wird knapp“, dort abschaltbar). Sinkt die Belegung wieder unter 80 %, beginnt es von vorn. Zusätzlich färbt sich der Balken in der Seitenleiste ab 80 % gelb und ab 95 % rot, und ein Hinweis-Banner erscheint. Für Team-Kontingente gibt es keine Benachrichtigung, nur den Balken auf der Teams-Seite.

## Speicher-Erweiterungen (SFTP)

Admins können externe **SFTP-Speicher** (Hetzner Storage Box, NAS, eigener Server) im Panel einbinden: ohne Serverzugriff, ohne Neustart, ohne `.env`-Änderung, ohne Pro. Neue Dateien lassen sich dort ablegen, vorhandene umziehen. Das ist etwas anderes als das Modul **Speicher** (Storage-Boxen und Buckets, die VylarisCloud selbst anbietet): Eine Erweiterung ist ein Ablageort für die Dateien der Cloud.

Die Seite heißt **Speicher-Erweiterungen** (`/speicher/ziele`, Verwaltung, nur Admins und Inhaber). Nicht enthalten: **WebDAV und SMB als Speicherziele** gibt es nicht; ein WebDAV-Add-on ist erst für später geplant. Eine Erweiterung ist immer SFTP.

### Hinzufügen

1. **SFTP-Speicher hinzufügen** wählen. Die Hilfe auf der Seite zeigt, wie man bei Hetzner, auf einem NAS (Synology, QNAP) oder auf einem eigenen Linux-Server einen Zugang anlegt.
2. Name, Host (Name oder IP, ohne `sftp://` und ohne Pfad), Port, Benutzer und **Zielordner** eintragen. Der Zielordner ist ein absoluter Pfad; VylarisCloud legt darin den Ordner `dateien` an. Anmeldung per **Passwort** oder **privatem SSH-Schlüssel** (einfügen oder Datei wählen, mit Passphrase, falls der Schlüssel eine hat). Ohne Haken bei „Schreiben erlauben“ bleibt die Erweiterung ein reines Lese-Archiv.
3. **Verbindung testen:** Zuerst holt VylarisCloud nur den **Fingerabdruck des Servers** (ohne Zugangsdaten zu senden). Vergleiche ihn mit dem echten Wert und bestätige ihn; auf dem Server z. B. `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`. Danach folgen Anmeldung, ein Schreib-/Lese-/Lösch-Test mit einer Temp-Datei, die Antwortzeit, das Server-Banner und, wenn der Server es kann, der freie Platz.
4. **Hinzufügen** speichert. Ohne bestätigten Fingerabdruck geht das nicht.

Ein Schlüsselpaar legst du so an (der private Teil kommt in das Feld „Privater Schlüssel“, der öffentliche auf den Server):

```bash
ssh-keygen -t ed25519 -N "" -C vylariscloud -f vylariscloud_key
ssh-copy-id -i vylariscloud_key.pub vylariscloud@speicher.example.org
```

Bei Hetzner: Storage Box mit SSH-Unterstützung und externer Erreichbarkeit, **Port 23**; am besten ein Unterkonto mit eigenem Verzeichnis.

### Sicherheit

- **Host-Schlüssel-Bestätigung:** Der bestätigte Fingerabdruck wird festgehalten und bei jeder Verbindung geprüft. Weicht der Server ab, verweigert VylarisCloud die Verbindung und zeigt die Warnung „Host-Schlüssel hat sich geändert“. Erst nach **Bearbeiten → Neuen Fingerabdruck prüfen** und erneutem Bestätigen geht es weiter.
- **Zugangsdaten** (Passwort oder Schlüssel samt Passphrase) liegen **verschlüsselt** (AES-256-GCM) in der Datenbank, erscheinen nie in API-Antworten oder Logs, und die Oberfläche zeigt nur „gespeichert“. Der Schlüssel entsteht aus dem Geheimnis der Installation. Wer will, dass eine Datenbank-Kopie allein nicht reicht, setzt zusätzlich **`VD_SFTP_SCHLUESSEL`** (ein langer Zufallswert, siehe [Umgebungsvariablen](#umgebungsvariablen)). Den Wert **vor dem ersten Anlegen** setzen und danach **nicht mehr ändern**; sonst lassen sich die gespeicherten Zugangsdaten nicht mehr entschlüsseln („… lassen sich nicht entschlüsseln“) und müssen unter „Bearbeiten“ neu eingegeben werden. Bei einer Wiederherstellung auf einem anderen Server denselben Wert setzen.
- **Zieladressen:** Loopback (`127.0.0.1`), Link-Local (`169.254.x.x`, `fe80::`) und Cloud-Metadaten-Adressen werden abgelehnt, damit die Funktion nicht als Sprungbrett ins Innere dient. Adressen im eigenen Netz (z. B. `192.168.1.20` für ein NAS) sind erlaubt. Bei Namen prüft der Server jede aufgelöste Adresse.
- Verbindungstests sind ratenbegrenzt; anlegen, ändern, entfernen und testen stehen im Protokoll.

### Betrieb

- **Status:** Die Liste zeigt online/offline, „Host-Schlüssel geändert“, letzte Prüfung, Antwortzeit, belegten und freien Platz (falls vom Server gemeldet) sowie Dateianzahl und Größe aus der Datenbank. Der Status wird etwa alle zwei Minuten aufgefrischt; „Status prüfen“ stößt es sofort an.
- **Wohin mit neuen Dateien?** Auf der Seite wählst du den Speicherort für **neue** Uploads: *Dieser Server*, *S3* (Pro) oder eine aktive Erweiterung. Vorhandene Dateien bleiben liegen. Ist der Speicher per `VD_S3_*` festgelegt, lässt sich die Wahl hier nicht ändern. Wird die gewählte Erweiterung später deaktiviert, schreibgeschützt oder entfernt, landen neue Dateien wieder auf dem Server.
- **Dateien umziehen:** *Dieser Server* ↔ *S3* ↔ Erweiterung, jeweils für alle Dateien, mit Fortschritt und **Pausieren**, **Fortsetzen**, **Abbrechen**. Es läuft immer nur ein Umzug. Die Datei wird kopiert, Größe und Prüfsumme werden gegen die gespeicherten Werte geprüft, bei einer Erweiterung als Ziel liest VylarisCloud die Kopie zurück und vergleicht erneut, **erst dann** wird die Quelle gelöscht. Links bleiben gleich. Fällt Quelle oder Ziel aus, hält der Umzug an (Status „Fehler“) und lässt sich fortsetzen.
- **Ablage auf dem Server:** `<Zielordner>/dateien/<xx>/<32 Hex-Zeichen>` samt Nebendateien (z. B. `.vorschau.webp`). Die Namen sind Zufallsschlüssel, die Dateien lassen sich dort nicht von Hand zuordnen. Ordnerstruktur, Namen und Links stehen in der Datenbank; sichere sie mit.
- **Ausfall:** Ist eine Erweiterung nicht erreichbar oder deaktiviert, melden Dateien dort eine klare Fehlermeldung (503 bzw. 502); alles andere läuft weiter. Ein toter Server blockiert Anfragen nicht unbegrenzt (Verbinden nach 15 s, Stillstand im Datenstrom nach 45 s Abbruch). Gelöschte Dateien, die der Server gerade nicht annimmt, merkt sich VylarisCloud und löscht sie später nach.
- **Entfernen:** nur, solange keine Dateien dort liegen (auch nicht im Papierkorb); vorher umziehen. Aus demselben Grund lässt sich der Zielordner nicht ändern, solange Dateien dort liegen.
- **Sicherung (Pro):** Die Sicherung im Panel packt auch Dateien auf Erweiterungen in die ZIP-Datei; die Erweiterung muss dafür erreichbar sein.

### Grenzen

- Nur SFTP (kein WebDAV, kein SMB, kein FTP). Höchstens 20 Erweiterungen.
- Alle Zugriffe laufen über VylarisCloud; es gibt keine Direktlinks zum Speicher wie bei S3. Die Geschwindigkeit hängt an der Verbindung zum SFTP-Server.
- Je Erweiterung laufen höchstens 8 Vorgänge gleichzeitig über höchstens 3 Verbindungen.
- Angefangene Uploads in Stücken liegen vorübergehend im Datenordner des Servers und werden beim Abschluss auf den Zielspeicher geschrieben.
- Geprüft wurde gegen einen ssh2-basierten Testserver (`scripts/test-sftp-server.mjs`). Live gegen eine Hetzner Storage Box, Synology oder QNAP wurde nicht getestet; die Hilfetexte im Assistenten folgen deren Dokumentation.

## Umgebungsvariablen

Die mitgelieferte `docker-compose.yml` (und `compose.node.yml`) reicht diese Variablen aus der `.env` an den Container weiter:

| Variable | Bedeutung |
|---|---|
| `VD_LIZENZ_SERVER` | Basis-URL des Lizenzservers (Pro) |
| `VD_LIZENZ_KEY` | Öffentlicher Ed25519-Schlüssel des Lizenzservers (PEM, Zeilenumbrüche als `\n` oder echte Zeilen) |
| `VD_SFTP_SCHLUESSEL` | Optional: zusätzliches Geheimnis für die Verschlüsselung der SFTP-Zugangsdaten, siehe [Speicher-Erweiterungen](#speicher-erweiterungen-sftp) |

**Ohne `VD_LIZENZ_SERVER` und `VD_LIZENZ_KEY` prüft die Installation ihre Schlüssel selbst** (eigener Aussteller, Seite **Verwaltung → Lizenzen**, nur für den Inhaber). Beide Variablen brauchst du nur, wenn diese Installation Schlüssel von einer *anderen* VylarisCloud nutzen soll; die Werte dafür stehen auf deren Lizenzen-Seite. Sie werden beim Start gelesen (nach dem Ändern `docker compose up -d`).

Beispiel für die `.env`:

```bash
VD_LIZENZ_SERVER=https://lizenz.example.org
VD_LIZENZ_KEY="-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----"
VD_SFTP_SCHLUESSEL=ein-langer-zufaelliger-wert
```

Danach `docker compose up -d`. Mit `docker compose config | grep VD_` siehst du, was ankommt.

### Speicher-Pool (mehrere Speicher zusammenlegen)

Auf der Seite **Speicher-Erweiterungen** wählst du statt „Nur ein Speicher“ den **Speicher-Pool**: Du hakst an, welche Speicher dazugehören (dieser Server und beliebig viele SFTP-Speicher) und wählst die Verteilung:

- **Größter freier Platz** (Standard): Neue Dateien gehen an das Mitglied mit dem meisten freien Platz. Mitglieder ohne bekannte Platzangabe (manche SFTP-Server liefern keine) kommen nur dran, wenn kein Mitglied eine Angabe hat, dann reihum.
- **Abwechselnd:** Neue Dateien wechseln reihum zwischen den Mitgliedern.

Ausgefallene, deaktivierte oder schreibgeschützte Mitglieder werden übersprungen; fällt alles aus, bleibt es der lokale Speicher. Vorhandene Dateien bleiben, wo sie sind, und werden von dort geliefert. Die Seite zeigt den **Gesamtplatz** (gesamt, belegt, frei) je Mitglied und als Summe; Mitglieder ohne Platzangabe stehen als „unbekannt“ daneben und sind nicht in der Summe. Der freie Platz der SFTP-Mitglieder wird alle 2 Minuten aktualisiert, der lokale alle 30 Sekunden. Ein SFTP-Speicher, der Pool-Mitglied ist, wird beim Entfernen aus dem Pool genommen; Entfernen geht weiter nur, solange dort keine Dateien liegen.

Nicht Teil des Pools: Monitoring und Alarm auf der System-Seite zeigen weiter den lokalen Plattenplatz, und die Sicherung nutzt im Pool-Modus ein einzelnes Mitglied. Der Pool wurde mit zwei Test-SFTP-Servern geprüft (12 Uploads gleichmäßig verteilt, Download von allen Orten, Ausfall eines Mitglieds); echte Platzangaben per `statvfs` habe ich gegen keinen realen SFTP-Server gesehen.

## Upload-Werkzeuge

Im Panel unter **Upload-Werkzeuge** gibt es fertige Konfigurationen für **ShareX** (`.sxcu`), **Flameshot** (Skript) und **curl**. Hochgeladen wird über `POST /api/upload` mit einem Upload-Token. Optionen lassen sich als Header mitgeben:

| Header | Bedeutung |
|---|---|
| `x-vd-expires` | Ablauf, z. B. `7d`, `12h` oder ein Datum |
| `x-vd-max-views` | höchstens so viele Aufrufe |
| `x-vd-password` | Passwort für die Datei |
| `x-vd-name-style` | `zufall`, `woerter`, `datum`, `original`, `uuid`, `unsichtbar` |
| `x-vd-folder` | Ordner-ID |

## API und Webhooks

- **Token:** Panel → **Upload-Werkzeuge** → Token mit den Rechten anlegen, die das Skript braucht (Hochladen, Lesen, Verwalten).
- **Doku:** Panel → **API-Doku** — jeder Endpunkt mit curl-Beispiel für deine Adresse. Für Postman, Insomnia oder Code-Generatoren: `https://<deine-domain>/api/v1/openapi.json`.
- **Webhooks:** Panel → **Webhooks**. Jede Zustellung trägt `X-VylarisCloud-Signature: t=<zeit>,v1=<HMAC-SHA256>`; Prüf-Code für Node.js, Python und PHP steht in der API-Doku. Ziele im eigenen Netz (192.168.x.x …) sind gesperrt, bis der Inhaber sie freigibt.

```bash
curl -H "Authorization: Bearer vd_…" https://cloud.deinefirma.de/api/v1/files?per_page=10
```

## Monitoring (Pro)

Panel → **System** → **Zugang einrichten** erzeugt ein Token für Prometheus:

```yaml
scrape_configs:
  - job_name: vylariscloud
    scheme: https
    metrics_path: /metrics
    authorization:
      credentials: rdm_…
    static_configs:
      - targets: ['cloud.deinefirma.de']
```

Laufen mehrere Server, jeden einzeln abfragen (jeder zählt seine eigenen Anfragen). Das Grafana-Dashboard gibt es auf derselben Seite zum Herunterladen.

## Umzug aus einem anderen Dienst

Seite **Import** im Panel. Es gibt drei Wege:
- **Verbindung:** Adresse und API-Schlüssel der alten Instanz.
- **Datei hochladen:** Export oder ZIP.
- **Server-Ordner:** den alten Upload-Ordner nach `./import` kopieren (im Container `/import`, nur lesend).

**iCloud** hat vier Wege:
- **Apple-Export:** auf [privacy.apple.com](https://privacy.apple.com/) eine Kopie der Daten anfordern („iCloud Fotos“ und/oder „iCloud Drive“) und alle ZIP-Teile hochladen. Datum, Favoriten, Alben, ausgeblendete Fotos und Live Photos kommen mit.
- **Link:** geteilte Alben (`icloud.com/sharedalbum/…`) und Freigaben einzelner Drive-Dateien. Ältere geteilte Alben enthalten bei Apple nur verkleinerte Fassungen.
- **Apple-ID:** anmelden und den Code vom iPhone eingeben — dann kommt die ganze Fotos-Mediathek im Original (samt geteilter Mediathek und Alben) und auf Wunsch iCloud Drive. Das Passwort geht nur an Apple und wird nicht gespeichert; die Anmeldung gilt nur für diesen Import. Mit „Erweitertem Datenschutz“ muss am iPhone „Zugriff auf iCloud-Daten im Web“ eingeschaltet sein.
- **Server-Ordner:** die Export-ZIPs nach `./import` legen.

## Pro einrichten

1. **Lizenz:** Panel → **Verwaltung → Lizenzen** → Schlüssel erstellen (Laufzeit, Installationen, Funktionen) → unter **Pro & Lizenz** eintragen. Für eine zweite Installation dort `VD_LIZENZ_SERVER` und `VD_LIZENZ_KEY` setzen ([Umgebungsvariablen](#umgebungsvariablen)).
2. **S3:** Panel → **Speicher & Server** → S3 wählen, Zugang eintragen, **Verbindung testen**, speichern. Neue Dateien landen dann in S3; vorhandene ziehen per **Umzug** um. Den Speicherort für neue Dateien (Server, S3 oder eine SFTP-Erweiterung) wählst du auch unter **Speicher-Erweiterungen**.

   Der S3-Zugang lässt sich auch fest in der `.env` vorgeben (`VD_S3_ENDPOINT`, `VD_S3_REGION`, `VD_S3_BUCKET`, `VD_S3_ACCESS_KEY`, `VD_S3_SECRET_KEY`, `VD_S3_PATH_STYLE`, `VD_S3_PREFIX`). Er ist dann im Panel nur lesbar.

   Der Schlüssel braucht die Rechte Lesen, Schreiben, Löschen und Auflisten für den Bucket.
3. **Weitere Server:** siehe `compose.node.yml`. Die Server teilen sich die Datenbank des ersten Servers. Dateien liegen in S3 oder auf einem gemeinsamen Laufwerk (NFS). Im Lastverteiler die Sitzungsbindung einschalten.
4. **SSO:** Panel → **Anmeldung (SSO)** → Anbieter hinzufügen. Die angezeigte **Rücksprung-Adresse** beim Anbieter eintragen.
5. **Eigene Marke:** Panel → **Eigene Marke**. Name und Akzentfarbe stehen unter Einstellungen → Installation.

## Update

Am einfachsten im Panel: unten links in der Seitenleiste steht die Version — ein roter Punkt heißt „neue Version da“, Klick → **Jetzt aktualisieren**. Das holt das neue Image, die aktuellen Compose-Dateien und bringt auch den Update-Dienst selbst auf den neuesten Stand.

Auf dem Server geht dasselbe mit einem Befehl — er richtet **nichts neu ein**, fragt nichts und lässt `.env`, Daten und Domain, wie sie sind (alte Dateien landen in `.sicherung/`):

```bash
curl -fsSL https://raw.githubusercontent.com/cubiqstudio/vylarisdrop/main/deploy/update.sh | sudo bash
```

Installationen von vor diesem Befehl brauchen ihn **einmal** — danach aktualisiert der Knopf im Panel auch den Dienst. Ganz von Hand, nur das Image:

```bash
cd /opt/vylariscloud
docker compose pull && docker compose up -d
```

Das Image heißt `ghcr.io/cubiqstudio/vylariscloud`; `docker-compose.yml` zieht den Tag `latest`. Wer eine feste Version will, trägt dort statt `latest` einen Commit-Tag ein (jeder Build wird zusätzlich mit seinem Commit-Hash getaggt, siehe `.github/workflows/docker.yml`); `update.sh` überschreibt die Datei dann beim nächsten Lauf (Kopie in `.sicherung/`).

Die Datenbank wird beim Start automatisch nachgezogen. Ein zweiter Aufruf von `sudo bash install.sh` macht dasselbe und bringt auch den Update-Dienst auf den neuesten Stand (nötig, damit der Virenscan-Schalter im Panel den Container steuern kann).

## Entfernen

```bash
sudo bash /opt/vylariscloud/install.sh --deinstallieren
```

Stoppt und entfernt die Container und die Webserver-Einträge von VylarisCloud (gesichert nach `/root/vylariscloud-backup`). Dateien, Datenbank und Ordner werden nur nach einer Rückfrage und dem Eintippen von `loeschen` gelöscht; sonst bleiben sie für einen Neustart erhalten.

## Sicherung

**Mit Pro:** Panel → **Sicherung** → **Jetzt sichern** lädt eine ZIP-Datei mit allem herunter. Einspielen geht auf derselben Seite (hochladen oder, bei sehr großen Sicherungen, die ZIP in den Ordner `import/` legen). Das ersetzt alles auf dem Server; schlägt etwas fehl, bleibt der alte Stand.

**Ohne Pro, von Hand:**
- **Datenbank:** `docker compose exec db pg_dump -U vylariscloud vylariscloud > vylariscloud.sql`
- **Dateien:** das Volume `dateien` (im Container `/data`), bei S3 der Bucket, bei einer SFTP-Erweiterung der Ordner `<Zielordner>/dateien` auf dem SFTP-Server (die Dateinamen dort sind Zufallsschlüssel, ohne die Datenbank nicht zuzuordnen).
- **Speicher (Boxen/Buckets):** die Volumes `speicher` (Box-Dateien), `garage-meta` und `garage-daten` (Buckets) — sie sind nicht Teil der Sicherung im Panel.

## Hilfe

- **Zwei-Faktor-Gerät verloren und keine Notfall-Codes:** den Container einmal mit `VD_RESET_2FA=<benutzername>` in der `.env` starten (`docker compose up -d`), danach die Zeile wieder entfernen.
- **Setup-Code nicht mehr da:** `docker compose logs app | grep Setup-Code`
- **Logs:** `docker compose logs -f app`
- **WebDAV meldet 401:** Benutzername und **App-Passwort** (`vd_dav_…`) verwenden, nicht das Konto-Passwort; unter Windows HTTPS nutzen ([Sync per WebDAV](#sync-per-webdav)). Nach vielen Fehlversuchen sperrt der Server die Anmeldung kurz (429).
- **„Dein Speicher ist voll“ (507):** Kontingent erreicht; der Papierkorb zählt mit ([Speicherplatz und Kontingente](#speicherplatz-und-kontingente)).
- **„Host-Schlüssel hat sich geändert“:** Server einer SFTP-Erweiterung zeigt einen anderen Schlüssel. Nach einer Neuinstallation des Servers normal; sonst nicht bestätigen, bevor du die Ursache kennst ([Speicher-Erweiterungen](#speicher-erweiterungen-sftp)).
- **Pro bleibt gesperrt:** Schlüssel unter **Verwaltung → Lizenzen** erstellt, abgelaufen oder gesperrt? Bei Nutzung eines anderen Servers: kommen `VD_LIZENZ_SERVER`/`VD_LIZENZ_KEY` im Container an? Prüfung: `docker compose exec app printenv | grep VD_LIZENZ`.

---

VylarisCloud ist ein Produkt der [VylarisGroupEurope](https://vylaris.eu). Dieses Verzeichnis enthält die Installationsdateien für das Docker-Image `ghcr.io/cubiqstudio/vylariscloud`.
