# VylarisCloud

<p align="center"><img src="public/brand/logo-wordmark-light.svg" alt="VylarisCloud" height="64"></p>

Selbst gehostete Cloud der **VylarisGroupEurope** ([vylaris.eu](https://vylaris.eu)): Dateien verwalten, per WebDAV synchronisieren, mit Kontingenten pro Konto und Team begrenzen und als Link teilen – optional Ende-zu-Ende-verschlüsselt, mit Teams, Speicher-Boxen, S3, SFTP-Speichererweiterungen und Backups.

Technik: Nuxt 4 (Vue 3, Nitro) · PostgreSQL · Poppins (selbst gehostet, keine externen Schriftdienste).

## Bereiche

VylarisCloud hat zwei Bereiche, die sich dieselben Dateien, Ordner und Konten teilen:

| Bereich | Adresse | Wofür |
|---|---|---|
| **Cloud** | `/` (Meine Dateien), `/sync`, `/speicher`, `/statistik`, `/papierkorb` | Dateimanager mit Ordnern, Favoriten und Team-Ordnern; Sync per WebDAV; Papierkorb |
| **Drop** | `/drop`, `/ordner`, `/paste`, `/anfragen`, `/werkzeuge`, `/embed` | Hochladen und Teilen per Link: Uploads, Galerien, Text & Code, Datei-Anfragen, Upload-Werkzeuge (ShareX, Flameshot, curl), Embed-Designer |

Was früher die Startseite war (Dateiliste mit Links, Filtern und Sammelaktionen), liegt jetzt unter **`/drop`**. Alle Links, Upload-Token und die API (`/api/v1`) funktionieren unverändert. Der Cloud-Dateimanager nutzt dieselben Dateien: „Link kopieren“ und „Teilen …“ verwenden den vorhandenen Link der Datei; Passwort, Ablauf und Aufruf-Grenzen stellst du weiter unter **Drop** ein.

## Cloud-Dateimanager

„Meine Dateien“ (`/`) zeigt die Ordner und Dateien deines Kontos.

- **Ansichten:** *Alle Dateien* (Ordner mit Pfadleiste; der Ordner steht in der Adresse als `/?ordner=<id>`, die Zurück-Taste des Browsers führt zum vorherigen Ordner), *Zuletzt*, *Favoriten* (Dateien und Ordner) und *Team-Ordner* (nur mit Pro, siehe unten).
- **Darstellung:** Liste oder Raster (die Wahl merkt sich der Browser), Sortierung nach Name, Größe oder Änderungsdatum, auf- oder absteigend. Ordner stehen immer zuerst, Namen werden natürlich sortiert (`datei2` vor `datei10`).
- **Suche:** das Suchfeld oben (`Strg K` / `⌘ K`) durchsucht Namen; die Treffer erscheinen im Dateimanager (`/?suche=…`). Auf der Drop-Seite sucht dasselbe Feld in der Drop-Liste.
- **Hochladen:** Button *Neu*, Dateien oder ganze Ordner ins Fenster ziehen (Unterordner werden angelegt). Es gelten dieselben Grenzen wie überall: größte Datei, Rollen-Grenzen und das [Kontingent](deploy/README.md#speicherplatz-und-kontingente). Hochgeladen wird immer in den gerade geöffneten Ordner; in Suchergebnisse und in die Ansichten *Zuletzt* und *Favoriten* lässt sich nichts ablegen.
- **Auswählen:** Klick, `Strg`/`⌘` + Klick (einzeln dazu oder weg), `Shift` + Klick (Bereich), `Strg A` (alles). Auf dem Handy erscheint die Aktionsleiste unten, das Kontextmenü öffnet langes Drücken.
- **Aktionen** (Auswahlleiste und Kontextmenü): Öffnen bzw. Vorschau, Herunterladen (mehrere Einträge oder ein Ordner kommen als ZIP, Ordnerstruktur bleibt erhalten), Link kopieren, Teilen, Umbenennen, Verschieben nach …, Kopieren nach …, Favorit, Löschen.
- **Verschieben per Ziehen:** Einträge auf einen Ordner oder auf die Pfadleiste ziehen. Ordner lassen sich nicht in sich selbst oder in ihre Unterordner verschieben.
- **Namen:** Dateien und Ordner teilen sich pro Ordner einen Namensraum, ohne Beachtung der Groß-/Kleinschreibung. Gibt es den Namen schon, hängt VylarisCloud ` (2)` an (`bericht (2).pdf`).
- **Löschen** verschiebt in den Papierkorb (30 Tage); ein Hinweis unten bietet *Rückgängig* an. Ein gelöschter Ordner nimmt seinen Inhalt mit. Der Papierkorb zählt zum belegten Speicher (siehe [Kontingente](deploy/README.md#speicherplatz-und-kontingente)).
- **Grenzen:** Ordner legt der Dateimanager bis zu 10.000 je Konto an (der Drop-Bereich und WebDAV nur bis 1.000, siehe [WebDAV](deploy/README.md#sync-per-webdav)). Auf einmal lassen sich höchstens 5.000 Dateien kopieren, 20.000 löschen und 100.000 Einträge als ZIP laden.

### Tastenkürzel

Gelten, solange der Fokus nicht in einem Eingabefeld oder Dialog liegt. Auf dem Mac steht `⌘` für `Strg`.

| Taste | Aktion |
|---|---|
| `↑` `↓` (im Raster auch `←` `→`), `Pos1`, `Ende` | Auswahl bewegen; mit `Shift` den Bereich erweitern |
| `Enter` | Ordner öffnen bzw. Vorschau der Datei |
| `Leertaste` | Eintrag in die Auswahl aufnehmen oder herausnehmen |
| `Strg A` | alles auswählen |
| `Esc` | Auswahl aufheben (danach: Zwischenablage verwerfen) |
| `F2` | Umbenennen (bei genau einem Eintrag) |
| `Entf` oder `Strg Rücktaste` | in den Papierkorb (mit Rückfrage bei Ordnern) |
| `Strg C` / `Strg X` / `Strg V` | kopieren / ausschneiden / im geöffneten Ordner einfügen |
| `Strg Shift N` | neuer Ordner |
| `Alt ↑` oder `Rücktaste` (ohne Auswahl) | eine Ebene höher |
| `Strg K` | Suchfeld |

## Sync, Speicherplatz, Speicher-Erweiterungen

Die Anleitungen für Admins und Konten stehen in [`deploy/README.md`](deploy/README.md):

- [Sync per WebDAV](deploy/README.md#sync-per-webdav): App-Passwörter, Einbinden in Windows, macOS, Linux, iOS und Android, Grenzen. Die Seite **Sync & WebDAV** (`/sync`) in der Cloud zeigt die Adresse deiner Installation mit kopierfertigen Beispielen.
- [Speicherplatz und Kontingente](deploy/README.md#speicherplatz-und-kontingente): Kontingent pro Konto, Rolle, Standard und Team, Rangfolge, Warnungen.
- [Speicher-Erweiterungen (SFTP)](deploy/README.md#speicher-erweiterungen-sftp): externe SFTP-Speicher (Hetzner Storage Box, NAS, eigener Server) für Admins unter `/speicher/ziele`.

## Entwicklung

Voraussetzungen: Node.js ≥ 22, pnpm 10, PostgreSQL.

```bash
pnpm install
NUXT_DB_URL=postgres://user:pass@localhost:5432/vylariscloud NUXT_DATA_DIR=./data pnpm dev
```

```bash
pnpm build        # Produktions-Build nach .output
pnpm typecheck    # Typprüfung
```

Beim ersten Start schreibt der Server einen **Setup-Code** ins Log; damit wird im Browser die Einrichtung abgeschlossen.

Werkzeuge für Tests gegen eine laufende Instanz (nur Entwicklung, nicht für den Betrieb):

- `scripts/test-dav.sh [Basis-URL] [Cookie-Datei] [Datenbank]` prüft den WebDAV-Server mit curl (Ausgabe `PASS`/`FAIL` je Fall). Die Standardwerte passen zur Testumgebung des Projekts; es braucht `curl`, `python3` und `psql`. Das Skript legt Testkonten (`davt_*`) an und entfernt sie wieder.
- `node scripts/test-sftp-server.mjs --root <Ordner> --host <Adresse> --port <Port> --user <Name> --password <Passwort>` startet einen kleinen SFTP-Server, mit dem sich die Speicher-Erweiterungen ohne OpenSSH testen lassen (Kopfzeilen der Datei: Optionen und Fehler-Simulation). Loopback (`127.0.0.1`) lehnt VylarisCloud als Ziel ab, eine andere lokale Adresse des Rechners verwenden.

## Installation auf einem Server

Anleitung, Installer, Compose-Dateien, Update und Sicherung stehen in [`deploy/README.md`](deploy/README.md). Kurzfassung:

```bash
curl -fsSL https://raw.githubusercontent.com/cubiqstudio/vylarisdrop/main/deploy/install.sh | sudo bash
```

Das Docker-Image heißt **`ghcr.io/cubiqstudio/vylariscloud`** (Tag `latest` und je ein Tag mit dem Commit-Hash). Der Workflow [`docker.yml`](.github/workflows/docker.yml) baut es bei jedem Push auf `main`. Die Compose-Dateien in `deploy/` ziehen `latest`; aktualisiert wird im Panel (Seitenleiste unten → Version) oder auf dem Server mit `update.sh` bzw. `docker compose pull && docker compose up -d` (siehe [Update](deploy/README.md#update)).

## Pro-Funktionen und Lizenzierung

Pro-Funktionen (Teams, SSO, Multi-Server, S3, White-Label, Sicherung, Monitoring, Traffic) werden über Lizenzschlüssel freigeschaltet. VylarisCloud hat dafür einen **eigenen Lizenzaussteller** eingebaut: Der Inhaber erstellt unter **Verwaltung → Lizenzen** Schlüssel (`VD-XXXX-XXXX-XXXX`) ohne E-Mail oder Namen und legt fest, wie lange sie gelten (ab der ersten Aktivierung, oder unbegrenzt), auf wie vielen Installationen sie laufen und welche Funktionen sie freischalten. Den Schlüssel trägt man unter **Pro** ein. Diese Installation prüft ihre eigenen Schlüssel lokal, ohne Netzwerk und ohne weitere Einstellung.

Andere VylarisCloud-Installationen können Schlüssel von hier nutzen. Dazu trägst du dort zwei Werte in die `.env` ein, die auf der Lizenzen-Seite stehen:

| Variable | Bedeutung |
|---|---|
| `VD_LIZENZ_SERVER` | Adresse des Ausstellers, `https://<deine-cloud>/lizenz` |
| `VD_LIZENZ_KEY` | Öffentlicher Ed25519-Schlüssel (PEM, Zeilenumbrüche als `\n`) |

Ohne diese Variablen gilt der eigene Aussteller der Installation. Die mitgelieferten Compose-Dateien reichen die Variablen an den Container weiter, siehe [Umgebungsvariablen](deploy/README.md#umgebungsvariablen).

Nicht hinter Pro liegen der Cloud-Dateimanager, der WebDAV-Sync, Konto-Kontingente, das Standard-Kontingent und die SFTP-Speicher-Erweiterungen. Pro brauchen **Team-Ordner**, **Rollen-** und **Team-Kontingente** (Funktion „Teams“) sowie S3.

## Design

Farben und Schrift folgen dem Auftritt der VylarisGroup (Markenblau `#1e73be`, Poppins, helles und dunkles Farbschema). Logo, Wortlogo und Favicon liegen in `public/brand/` und `public/icon.svg`.
