# VylarisCloud

<p align="center"><img src="public/brand/logo-wordmark-light.svg" alt="VylarisCloud" height="64"></p>

Selbst gehostete Cloud der **VylarisGroupEurope** ([vylaris.eu](https://vylaris.eu)): Dateien, Medien und Code hochladen, verwalten und als Link teilen – optional Ende-zu-Ende-verschlüsselt, mit Teams, Speicher-Boxen, S3 und Backups.

Technik: Nuxt 4 (Vue 3, Nitro) · PostgreSQL · Poppins (selbst gehostet, keine externen Schriftdienste).

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

## Installation auf einem Server

Anleitung, Installer, Compose-Dateien und alle Umgebungsvariablen (`VD_*`) stehen in [`deploy/README.md`](deploy/README.md).
Das Docker-Image `ghcr.io/cubiqstudio/vylariscloud` baut der Workflow [`docker.yml`](.github/workflows/docker.yml) bei jedem Push auf `main`.

## Pro-Funktionen und Lizenzierung

Pro-Funktionen (Teams, SSO, Multi-Server, S3, White-Label, Sicherung, Monitoring, Traffic) werden über einen Lizenzserver freigeschaltet. Server und Prüfschlüssel kommen aus der Umgebung:

| Variable | Bedeutung |
|---|---|
| `VD_LIZENZ_SERVER` | Basis-URL des Lizenzservers |
| `VD_LIZENZ_KEY` | Öffentlicher Ed25519-Schlüssel (PEM, Zeilenumbrüche als `\n`) |

Ohne diese Variablen findet keine Lizenzprüfung statt und die Pro-Funktionen bleiben gesperrt.

## Design

Farben und Schrift folgen dem Auftritt der VylarisGroup (Markenblau `#1e73be`, Poppins, helles und dunkles Farbschema). Logo, Wortlogo und Favicon liegen in `public/brand/` und `public/icon.svg`.
