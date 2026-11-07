import pg from 'pg'

let pool: pg.Pool | null = null

export function db(): pg.Pool {
  if (!pool) {
    const url = useRuntimeConfig().dbUrl || process.env.DATABASE_URL
    if (!url) throw new Error('Keine Datenbank konfiguriert (NUXT_DB_URL fehlt).')
    pool = new pg.Pool({ connectionString: url, max: 20, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 20_000 })
    pool.on('error', (e) => console.error('[db] Verbindungsfehler:', e.message))
  }
  return pool
}

export async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db().query(sql, params as any[])).rows as T[]
}
export async function q1<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
  return (await q<T>(sql, params))[0] ?? null
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY, username text NOT NULL UNIQUE, email text NOT NULL DEFAULT '',
  password text NOT NULL, role text NOT NULL DEFAULT 'user', quota_bytes bigint,
  totp_secret text NOT NULL DEFAULT '', totp_pending text NOT NULL DEFAULT '', totp_enabled boolean NOT NULL DEFAULT false,
  backup_codes jsonb NOT NULL DEFAULT '[]', prefs jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), ip text, ua text);
CREATE TABLE IF NOT EXISTS upload_tokens (
  id serial PRIMARY KEY, user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE, name text NOT NULL,
  prefix text NOT NULL, key_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz);
CREATE TABLE IF NOT EXISTS folders (
  id serial PRIMARY KEY, user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id int REFERENCES folders(id) ON DELETE CASCADE, name text NOT NULL,
  public boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS folders_user_idx ON folders(user_id);
CREATE TABLE IF NOT EXISTS files (
  id bigserial PRIMARY KEY, user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id int REFERENCES folders(id) ON DELETE SET NULL, slug text NOT NULL UNIQUE, name text NOT NULL,
  original_name text NOT NULL DEFAULT '', mime text NOT NULL DEFAULT 'application/octet-stream', art text NOT NULL DEFAULT 'datei',
  size bigint NOT NULL DEFAULT 0, ablage text NOT NULL, sha256 text NOT NULL DEFAULT '',
  expires_at timestamptz, max_views int, views int NOT NULL DEFAULT 0, password_hash text NOT NULL DEFAULT '',
  favorite boolean NOT NULL DEFAULT false, width int, height int, duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS files_user_idx ON files(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS files_expires_idx ON files(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS files_folder_idx ON files(folder_id);
CREATE TABLE IF NOT EXISTS tags (
  id serial PRIMARY KEY, user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE, name text NOT NULL,
  color text NOT NULL DEFAULT '#1e73be', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, name));
CREATE TABLE IF NOT EXISTS file_tags (
  file_id bigint NOT NULL REFERENCES files(id) ON DELETE CASCADE, tag_id int NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (file_id, tag_id));
CREATE TABLE IF NOT EXISTS uploads (
  id text PRIMARY KEY, user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE, name text NOT NULL,
  size bigint NOT NULL, mime text NOT NULL DEFAULT '', teile int NOT NULL, teil_groesse int NOT NULL,
  erhalten jsonb NOT NULL DEFAULT '[]', optionen jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY, type text NOT NULL, user_id int REFERENCES users(id) ON DELETE SET NULL,
  detail jsonb NOT NULL DEFAULT '{}', ip text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS events_created_idx ON events(created_at);
ALTER TABLE files ADD COLUMN IF NOT EXISTS last_view_at timestamptz;

-- Etappe 2: Medien-Verarbeitung (Vorschaubild, Vorschau-Streifen fuer Videos, Wellenform) und Datei-Anfragen
-- verarbeitung: offen | laeuft | fertig | fehler | aus  ·  vorschau/streifen: Endung der Nebendatei im Speicher
ALTER TABLE files ADD COLUMN IF NOT EXISTS verarbeitung text NOT NULL DEFAULT 'offen';
ALTER TABLE files ADD COLUMN IF NOT EXISTS vorschau boolean NOT NULL DEFAULT false;
ALTER TABLE files ADD COLUMN IF NOT EXISTS streifen int NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN IF NOT EXISTS wellen jsonb;
ALTER TABLE files ADD COLUMN IF NOT EXISTS exif_entfernt boolean NOT NULL DEFAULT false;
ALTER TABLE files ADD COLUMN IF NOT EXISTS anfrage_id int;
ALTER TABLE files ADD COLUMN IF NOT EXISTS von_gast text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS files_verarbeitung_idx ON files(verarbeitung) WHERE verarbeitung IN ('offen', 'laeuft');
CREATE TABLE IF NOT EXISTS anfragen (
  id serial PRIMARY KEY, user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE, token text NOT NULL UNIQUE,
  titel text NOT NULL, nachricht text NOT NULL DEFAULT '', folder_id int REFERENCES folders(id) ON DELETE SET NULL,
  max_bytes bigint, max_dateien int, laeuft_ab timestamptz, password_hash text NOT NULL DEFAULT '',
  aktiv boolean NOT NULL DEFAULT true, anzahl int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS anfragen_user_idx ON anfragen(user_id);

-- Etappe 3: Import von anderen Diensten. Ein Lauf = eine Quelle; jede Datei ist ein Posten, damit ein
-- Neustart dort weitermacht, wo er stand, und nichts doppelt holt.
-- status: analyse | bereit | laeuft | pausiert | fertig | fehler | abgebrochen
CREATE TABLE IF NOT EXISTS importe (
  id serial PRIMARY KEY, user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE, quelle text NOT NULL,
  weg text NOT NULL, titel text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'analyse', optionen jsonb NOT NULL DEFAULT '{}',
  zugang jsonb NOT NULL DEFAULT '{}', plan jsonb NOT NULL DEFAULT '{}', gesamt int NOT NULL DEFAULT 0, erledigt int NOT NULL DEFAULT 0,
  fehlgeschlagen int NOT NULL DEFAULT 0, uebersprungen int NOT NULL DEFAULT 0, bytes bigint NOT NULL DEFAULT 0, bytes_gesamt bigint NOT NULL DEFAULT 0,
  protokoll jsonb NOT NULL DEFAULT '[]', meldung text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
  gestartet_at timestamptz, fertig_at timestamptz);
-- status: offen | ok | fehler | uebersprungen
CREATE TABLE IF NOT EXISTS import_posten (
  id bigserial PRIMARY KEY, import_id int NOT NULL REFERENCES importe(id) ON DELETE CASCADE, schluessel text NOT NULL,
  daten jsonb NOT NULL, status text NOT NULL DEFAULT 'offen', meldung text NOT NULL DEFAULT '', file_id bigint,
  UNIQUE (import_id, schluessel));
CREATE INDEX IF NOT EXISTS import_posten_offen_idx ON import_posten(import_id, id) WHERE status = 'offen';
CREATE INDEX IF NOT EXISTS import_posten_ok_idx ON import_posten(schluessel) WHERE status = 'ok';
-- Alte Pfade (z. B. /u/abc.png von Zipline) leiten nach dem Umzug auf die neue Datei weiter.
-- ziel: seite | direkt | download | raw
CREATE TABLE IF NOT EXISTS alte_pfade (
  pfad text PRIMARY KEY, file_id bigint NOT NULL REFERENCES files(id) ON DELETE CASCADE, ziel text NOT NULL DEFAULT 'direkt');
CREATE INDEX IF NOT EXISTS alte_pfade_file_idx ON alte_pfade(file_id);

-- Etappe 4 (Pro). Knoten: jeder laufende Server meldet sich hier (siehe knoten.ts).
CREATE TABLE IF NOT EXISTS knoten (
  id text PRIMARY KEY, name text NOT NULL, version text NOT NULL DEFAULT '', ordner text NOT NULL DEFAULT '', rolle text NOT NULL DEFAULT 'alles',
  gestartet_at timestamptz NOT NULL DEFAULT now(), zuletzt_at timestamptz NOT NULL DEFAULT now(), info jsonb NOT NULL DEFAULT '{}');
-- Hintergrundarbeit wird per Datenbank verteilt: wer arbeitet gerade woran, seit wann
ALTER TABLE files ADD COLUMN IF NOT EXISTS verarbeitung_seit timestamptz;
ALTER TABLE files ADD COLUMN IF NOT EXISTS verarbeitet_von text;
ALTER TABLE importe ADD COLUMN IF NOT EXISTS knoten text;
ALTER TABLE importe ADD COLUMN IF NOT EXISTS lease_bis timestamptz;
ALTER TABLE importe ADD COLUMN IF NOT EXISTS daten_ordner text;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS speicher text NOT NULL DEFAULT 'lokal';
-- Teams: Mitglieder teilen Team-Ordner (folders.team_id). rolle: leitung | mitglied
CREATE TABLE IF NOT EXISTS teams (
  id serial PRIMARY KEY, name text NOT NULL UNIQUE, farbe text NOT NULL DEFAULT '#1e73be', beschreibung text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS team_mitglieder (
  team_id int NOT NULL REFERENCES teams(id) ON DELETE CASCADE, user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rolle text NOT NULL DEFAULT 'mitglied', created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (team_id, user_id));
CREATE INDEX IF NOT EXISTS team_mitglieder_user_idx ON team_mitglieder(user_id);
ALTER TABLE folders ADD COLUMN IF NOT EXISTS team_id int REFERENCES teams(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS folders_team_idx ON folders(team_id) WHERE team_id IS NOT NULL;
-- Eigene Rollen: Rechte und Grenzen fuer normale Konten (Admins sind nie eingeschraenkt)
CREATE TABLE IF NOT EXISTS rollen (
  id serial PRIMARY KEY, name text NOT NULL UNIQUE, farbe text NOT NULL DEFAULT '#3b82f6', rechte jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE users ADD COLUMN IF NOT EXISTS rolle_id int REFERENCES rollen(id) ON DELETE SET NULL;
-- Anmeldung ueber SSO: welches Konto gehoert zu welcher Identitaet beim Anbieter
CREATE TABLE IF NOT EXISTS user_identitaeten (
  anbieter text NOT NULL, subjekt text NOT NULL, user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE, email text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), zuletzt_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (anbieter, subjekt));
CREATE INDEX IF NOT EXISTS user_identitaeten_user_idx ON user_identitaeten(user_id);

-- Etappe 5. Papierkorb: geloeschte Dateien (Zeile als JSON, Inhalt bleibt im Speicher) — nach 30 Tagen endgueltig weg
CREATE TABLE IF NOT EXISTS papierkorb (
  id bigserial PRIMARY KEY, user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE, datei jsonb NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]', alte_pfade jsonb NOT NULL DEFAULT '[]', geloescht_von int, geloescht_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS papierkorb_user_idx ON papierkorb(user_id, geloescht_at DESC);
-- Galerie: Ordner als oeffentliche Seite /g/<token>
ALTER TABLE folders ADD COLUMN IF NOT EXISTS galerie_token text UNIQUE;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS galerie jsonb NOT NULL DEFAULT '{}';
-- Verschluesselt (Ende zu Ende, der Server kennt den Schluessel nicht) · Virenscan: '' | sauber | fund | fehler
ALTER TABLE files ADD COLUMN IF NOT EXISTS verschluesselt boolean NOT NULL DEFAULT false;
ALTER TABLE files ADD COLUMN IF NOT EXISTS scan text NOT NULL DEFAULT '';
ALTER TABLE files ADD COLUMN IF NOT EXISTS scan_info text NOT NULL DEFAULT '';
-- Statistik: Aufrufe je Datei und Tag, nach Herkunft und Land (keine IP-Adressen)
CREATE TABLE IF NOT EXISTS aufrufe (
  file_id bigint NOT NULL REFERENCES files(id) ON DELETE CASCADE, tag date NOT NULL, quelle text NOT NULL DEFAULT '', land text NOT NULL DEFAULT '',
  n int NOT NULL DEFAULT 0, PRIMARY KEY (file_id, tag, quelle, land));
-- Passkeys (WebAuthn)
CREATE TABLE IF NOT EXISTS passkeys (
  id text PRIMARY KEY, user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE, schluessel text NOT NULL, zaehler bigint NOT NULL DEFAULT 0,
  transports jsonb NOT NULL DEFAULT '[]', name text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), zuletzt_at timestamptz);
CREATE INDEX IF NOT EXISTS passkeys_user_idx ON passkeys(user_id);
CREATE INDEX IF NOT EXISTS events_user_idx ON events(user_id, created_at DESC);
ALTER TABLE upload_tokens ADD COLUMN IF NOT EXISTS rechte jsonb NOT NULL DEFAULT '["upload"]';
CREATE TABLE IF NOT EXISTS webhooks (
  id serial PRIMARY KEY, user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE, name text NOT NULL DEFAULT '', url text NOT NULL,
  geheimnis text NOT NULL, ereignisse jsonb NOT NULL DEFAULT '[]', aktiv boolean NOT NULL DEFAULT true, fehler_in_folge int NOT NULL DEFAULT 0,
  zuletzt_at timestamptz, zuletzt_status int, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS webhooks_user_idx ON webhooks(user_id);
CREATE TABLE IF NOT EXISTS webhook_lieferungen (
  id bigserial PRIMARY KEY, webhook_id int NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE, ereignis text NOT NULL, nutzlast jsonb NOT NULL,
  status text NOT NULL DEFAULT 'offen', versuche int NOT NULL DEFAULT 0, naechster_at timestamptz NOT NULL DEFAULT now(),
  antwort_code int, antwort text NOT NULL DEFAULT '', dauer_ms int, created_at timestamptz NOT NULL DEFAULT now(), erledigt_at timestamptz);
CREATE INDEX IF NOT EXISTS webhook_lieferungen_offen_idx ON webhook_lieferungen(naechster_at) WHERE status = 'offen';
CREATE INDEX IF NOT EXISTS webhook_lieferungen_hook_idx ON webhook_lieferungen(webhook_id, created_at DESC);
CREATE TABLE IF NOT EXISTS regeln (
  id serial PRIMARY KEY, user_id int REFERENCES users(id) ON DELETE CASCADE, von int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '', aktiv boolean NOT NULL DEFAULT true, geltung text NOT NULL DEFAULT 'eigen', bedingung jsonb NOT NULL DEFAULT '{}',
  aktion text NOT NULL DEFAULT 'papierkorb', favoriten_schonen boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  zuletzt_at timestamptz, zuletzt_anzahl int, zuletzt_bytes bigint);
CREATE TABLE IF NOT EXISTS messwerte (zeit timestamptz NOT NULL, knoten text NOT NULL, name text NOT NULL DEFAULT '', werte jsonb NOT NULL, PRIMARY KEY (zeit, knoten));
CREATE TABLE IF NOT EXISTS sicherung_lauf (id text PRIMARY KEY, status text NOT NULL, schritt text NOT NULL DEFAULT '', anteil int NOT NULL DEFAULT 0, meldung text NOT NULL DEFAULT '', zeit timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS traffic (tag date NOT NULL, user_id int NOT NULL, file_id bigint NOT NULL DEFAULT 0, bytes bigint NOT NULL DEFAULT 0, PRIMARY KEY (tag, user_id, file_id));
CREATE INDEX IF NOT EXISTS traffic_nutzer ON traffic (user_id, tag);
-- 1.5.0: HEIC-Fotos bekommen eine JPEG-Ansicht, Live Photos ein Begleitvideo (Nebendateien ansicht / live / livemp4)
ALTER TABLE files ADD COLUMN IF NOT EXISTS ansicht boolean NOT NULL DEFAULT false;
ALTER TABLE files ADD COLUMN IF NOT EXISTS live boolean NOT NULL DEFAULT false;
ALTER TABLE files ADD COLUMN IF NOT EXISTS live_mp4 boolean NOT NULL DEFAULT false;
ALTER TABLE files ADD COLUMN IF NOT EXISTS notiz text NOT NULL DEFAULT '';
ALTER TABLE anfragen ADD COLUMN IF NOT EXISTS aufnahme boolean NOT NULL DEFAULT true;
ALTER TABLE anfragen ADD COLUMN IF NOT EXISTS aufnahme_min int NOT NULL DEFAULT 5;
ALTER TABLE files ADD COLUMN IF NOT EXISTS notiz text NOT NULL DEFAULT '';
ALTER TABLE anfragen ADD COLUMN IF NOT EXISTS aufnahme boolean NOT NULL DEFAULT true;
ALTER TABLE anfragen ADD COLUMN IF NOT EXISTS aufnahme_min int NOT NULL DEFAULT 5;
-- 1.6.0: Speicher — Storage-Boxen (SFTPGo: Ordner box-<id>, Login = kennung) mit Unterkonten (<kennung>-sub<n>, eigener
-- Unterordner, teilen das Kontingent der Box) und S3-Buckets (Garage, globalAlias = name) mit Zugangsschluesseln.
-- Passwoerter nur als bcrypt-Hash, Bucket-Secrets gar nicht (werden nur beim Anlegen gezeigt). gewarnt: 0 | 80 | 100
CREATE TABLE IF NOT EXISTS speicher_boxen (
  id serial PRIMARY KEY, user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE, name text NOT NULL DEFAULT '',
  kennung text NOT NULL UNIQUE, kontingent bigint NOT NULL, passwort_hash text NOT NULL DEFAULT '', ssh_keys jsonb NOT NULL DEFAULT '[]',
  sftp boolean NOT NULL DEFAULT true, webdav boolean NOT NULL DEFAULT true, belegt bigint NOT NULL DEFAULT 0, dateien bigint NOT NULL DEFAULT 0,
  zuletzt_login timestamptz, gewarnt int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS speicher_unterkonten (
  id serial PRIMARY KEY, box_id int NOT NULL REFERENCES speicher_boxen(id) ON DELETE CASCADE, nr int NOT NULL, login text NOT NULL UNIQUE,
  ordner text NOT NULL, schreiben boolean NOT NULL DEFAULT true, notiz text NOT NULL DEFAULT '', passwort_hash text NOT NULL DEFAULT '',
  ssh_keys jsonb NOT NULL DEFAULT '[]', zuletzt_login timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (box_id, nr));
CREATE TABLE IF NOT EXISTS speicher_buckets (
  id serial PRIMARY KEY, user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE, name text NOT NULL UNIQUE, garage_id text NOT NULL DEFAULT '',
  kontingent bigint NOT NULL, belegt bigint NOT NULL DEFAULT 0, objekte bigint NOT NULL DEFAULT 0, gewarnt int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS speicher_schluessel (
  id serial PRIMARY KEY, bucket_id int NOT NULL REFERENCES speicher_buckets(id) ON DELETE CASCADE, name text NOT NULL DEFAULT '',
  access_key text NOT NULL UNIQUE, schreiben boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
-- Belegung je Stunde (art: box | bucket), 100 Tage
CREATE TABLE IF NOT EXISTS speicher_verlauf (art text NOT NULL, ref int NOT NULL, zeit timestamptz NOT NULL, bytes bigint NOT NULL, anzahl bigint NOT NULL DEFAULT 0, PRIMARY KEY (art, ref, zeit));

-- ===== 1.1.0 Cloud =====
-- Jeder Bereich haengt seine Aenderungen NUR unter seiner eigenen Markierung an (verhindert Merge-Konflikte).

-- [cloud:dateimanager] Aenderungszeit fuer Dateien/Ordner (WebDAV-ETag, "Zuletzt geaendert"), Ordner-Favoriten
ALTER TABLE files ADD COLUMN IF NOT EXISTS geaendert_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE folders ADD COLUMN IF NOT EXISTS geaendert_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE folders ADD COLUMN IF NOT EXISTS favorite boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS folders_parent_idx ON folders(parent_id);

-- [cloud:webdav] App-Passwoerter fuer WebDAV-Clients (nur Hash gespeichert, Klartext wird einmal gezeigt)
CREATE TABLE IF NOT EXISTS dav_zugaenge (
  id serial PRIMARY KEY, user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE, name text NOT NULL,
  prefix text NOT NULL, key_hash text NOT NULL UNIQUE, schreiben boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz);
CREATE INDEX IF NOT EXISTS dav_zugaenge_user_idx ON dav_zugaenge(user_id);
-- WebDAV-Sperren (LOCK/UNLOCK, Klasse 2): res = f<Datei-id> | o<Ordner-id>, tiefe = 0 | infinity
CREATE TABLE IF NOT EXISTS dav_sperren (
  token text PRIMARY KEY, res text NOT NULL, user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tiefe text NOT NULL DEFAULT '0', besitzer text NOT NULL DEFAULT '', timeout_s int NOT NULL DEFAULT 600,
  ablauf_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS dav_sperren_res_idx ON dav_sperren(res);
CREATE INDEX IF NOT EXISTS dav_sperren_ablauf_idx ON dav_sperren(ablauf_at);

-- [cloud:quota] Warnstufe je Konto (0 | 80 | 100) und Team-Kontingent
ALTER TABLE users ADD COLUMN IF NOT EXISTS quota_gewarnt int NOT NULL DEFAULT 0;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS quota_bytes bigint;
-- Chunk-Upload: Zeitpunkt, an dem ein fertig-Aufruf den Upload beansprucht hat (verhindert doppeltes Anlegen bei Parallelaufrufen)
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS fertig_at timestamptz;

-- [cloud:sftp] Speicher-Erweiterungen: externe SFTP-Speicher, die Admins online einbinden (Zugang verschluesselt)
CREATE TABLE IF NOT EXISTS speicher_ziele (
  id serial PRIMARY KEY, name text NOT NULL, art text NOT NULL DEFAULT 'sftp', host text NOT NULL, port int NOT NULL DEFAULT 22,
  benutzer text NOT NULL, auth text NOT NULL DEFAULT 'passwort', geheim text NOT NULL DEFAULT '', host_key text NOT NULL DEFAULT '',
  basis_pfad text NOT NULL DEFAULT '/', aktiv boolean NOT NULL DEFAULT true, schreibbar boolean NOT NULL DEFAULT true,
  status jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
`

export const TABELLEN = [
  'settings',
  'rollen',
  'users',
  'teams',
  'team_mitglieder',
  'user_identitaeten',
  'upload_tokens',
  'dav_zugaenge',
  'speicher_ziele',
  'folders',
  'anfragen',
  'files',
  'tags',
  'file_tags',
  'events'
] as const

export async function migrate(): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await db().query('SELECT 1')
      break
    } catch (e: any) {
      if (i >= 30) throw e
      console.log(`[db] warte auf Datenbank (${i}/30) …`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  const c = await db().connect()
  try {
    await c.query('SELECT pg_advisory_lock(5242001)')
    try {
      await c.query(SCHEMA)
    } finally {
      await c.query('SELECT pg_advisory_unlock(5242001)').catch(() => {})
    }
  } finally {
    c.release()
  }
  const enc = await q1<{ server_encoding: string }>('SHOW server_encoding')
  if (enc && !/^utf-?8$/i.test(enc.server_encoding))
    console.warn(
      `[vylariscloud] WARNUNG: Die Datenbank nutzt ${enc.server_encoding} statt UTF-8 — Emojis und manche Zeichen lassen sich nicht speichern. Bitte eine UTF-8-Datenbank verwenden.`
    )
}

export async function ereignis(
  type: string,
  userId: number | null,
  detail: Record<string, unknown> = {},
  ip = ''
): Promise<void> {
  try {
    await q('INSERT INTO events (type, user_id, detail, ip) VALUES ($1, $2, $3::jsonb, $4)', [
      type,
      userId,
      JSON.stringify(detail),
      ip
    ])
  } catch {}
}
