import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { migrate, q } from '../utils/db'
import { getInstance, getSetting, ladeSprache, setSetting, settingsCacheLeeren, setupDone } from '../utils/settings'
import { aufraeumen } from '../utils/dateien'
import { datenordner, teileLoeschen } from '../utils/speicher'
import { arbeiten, ffmpegVorhanden, verarbeitungNachholen } from '../utils/medien'
import { importeNachholen } from '../utils/importKern'
import { importAnalysieren } from '../utils/importQuellen'
import { hoeren, knotenAbmelden, knotenStarten, mitSperre } from '../utils/knoten'
import { lizenzPruefen } from '../utils/lizenz'
import { umzugNachholen } from '../utils/umzug'
import { versionPruefen } from '../utils/update'
import { papierkorbAufraeumen } from '../utils/papierkorb'
import { geoAktualisieren } from '../utils/statistik'
import { scanArbeiten, scanAufraeumen } from '../utils/virenscan'
import { lieferungenAufraeumen, zustellen, zustellerStarten } from '../utils/webhooks'
import { regelnAusfuehren } from '../utils/regeln'
import { messungStarten } from '../utils/monitoring'
import { speicherMessen } from '../utils/speicherMessung'

export default defineNitroPlugin(async (nitro) => {
  try {
    await migrate()
    const inst = await getInstance()
    await ladeSprache()
    await fs.mkdir(join(datenordner(), 'dateien'), { recursive: true })
    await fs.mkdir(join(datenordner(), 'teile'), { recursive: true })
    await fs.rm(join(datenordner(), 'tmp'), { recursive: true, force: true }).catch(() => {})

    hoeren('vd_settings', (key) => {
      settingsCacheLeeren(key)
      if (key === 'lang' || key === '*') void ladeSprache()
    })
    hoeren('vd_arbeit', (art) => {
      if (art === 'medien') void arbeiten()
      if (art === 'import') void importeNachholen(importAnalysieren).catch(() => {})
      if (art === 'umzug') void umzugNachholen().catch(() => {})
      if (art === 'webhooks') void zustellen().catch(() => {})
    })
    await knotenStarten()
    nitro.hooks.hook('close', async () => {
      await knotenAbmelden()
    })

    if (!(await setupDone())) {
      console.log('')
      console.log('  ┌──────────────────────────────────────────────┐')
      console.log(`  │  ${'VylarisCloud — Einrichtung'.padEnd(44)}│`)
      console.log(`  │  Setup-Code:  ${inst.setupToken.padEnd(31)}│`)
      console.log('  │  Öffne die Adresse dieses Servers im Browser │')
      console.log('  └──────────────────────────────────────────────┘')
      console.log('')
    } else {
      console.log('[vylariscloud] bereit.')
    }
    console.log(
      (await ffmpegVorhanden())
        ? '[vylariscloud] ffmpeg gefunden — Vorschaubilder und Wellenformen aktiv.'
        : '[vylariscloud] ffmpeg fehlt — ohne Vorschaubilder und Wellenformen.'
    )
    const nachholen = () => {
      verarbeitungNachholen().catch((e) => console.error('[vylariscloud] Verarbeitung:', e.message))
      importeNachholen(importAnalysieren).catch((e) => console.error('[vylariscloud] Import:', e.message))
      umzugNachholen().catch((e) => console.error('[vylariscloud] Speicher-Umzug:', e.message))
    }
    setTimeout(nachholen, 6_000).unref?.()
    setInterval(nachholen, 60_000).unref?.()
    const reset = (process.env.VD_RESET_2FA || '').trim().toLowerCase()
    if (reset) {
      const r = await q(
        `UPDATE users SET totp_enabled = false, totp_secret = '', totp_pending = '', backup_codes = '[]' WHERE lower(username) = $1 RETURNING username`,
        [reset]
      )
      console.log(
        r.length
          ? `[vylariscloud] 2FA für "${reset}" zurückgesetzt. Bitte VD_RESET_2FA wieder entfernen.`
          : `[vylariscloud] VD_RESET_2FA: kein Konto "${reset}" gefunden.`
      )
    }
    const dateienWeg = () => {
      mitSperre('aufraeumen', aufraeumen)
        .then((n) => {
          if (n) console.log(`[vylariscloud] ${n} abgelaufene Datei(en) gelöscht.`)
        })
        .catch((e) => console.error('[vylariscloud] Aufräumen:', e.message))
    }
    setTimeout(dateienWeg, 20_000).unref?.()
    setInterval(dateienWeg, 120_000).unref?.()
    const putzen = () =>
      mitSperre('putzen', async () => {
        await q('DELETE FROM sessions WHERE expires_at < now()')
        const alt = await q<{ id: string; speicher: string }>(
          "DELETE FROM uploads WHERE created_at < now() - interval '2 days' RETURNING id, speicher"
        )
        for (const u of alt) await teileLoeschen(u.id, u.speicher === 's3' ? 's3' : 'lokal')
        await q("DELETE FROM events WHERE created_at < now() - interval '180 days'")
        const n = await papierkorbAufraeumen()
        if (n) console.log(`[vylariscloud] ${n} Datei(en) aus dem Papierkorb endgültig gelöscht.`)
      }).catch((e: any) => console.error('[vylariscloud] Aufräumen fehlgeschlagen:', e.message))
    setTimeout(putzen, 90_000).unref?.()
    setInterval(putzen, 6 * 3600_000).unref?.()
    const lizenz = () => {
      mitSperre('lizenz', () => lizenzPruefen()).catch((e) => console.error('[vylariscloud] Lizenz:', e.message))
    }
    setTimeout(lizenz, 15_000).unref?.()
    setInterval(lizenz, 30 * 60_000).unref?.()
    const version = () => {
      mitSperre('version', () => versionPruefen()).catch(() => {})
    }
    setTimeout(version, 30_000).unref?.()
    const geo = () => {
      mitSperre('geoip', geoAktualisieren).catch(() => {})
    }
    setTimeout(geo, 45_000).unref?.()
    setTimeout(() => {
      scanAufraeumen().catch(() => {})
    }, 20_000).unref?.()
    setInterval(() => {
      void scanArbeiten().catch(() => {})
    }, 10_000).unref?.()
    zustellerStarten()
    messungStarten()
    const regeln = () =>
      mitSperre('regeln', async () => {
        const l = await getSetting<{ zeit: number }>('regeln-lauf', { zeit: 0 }, true)
        if (Date.now() - l.zeit < 23 * 3600_000) return
        await setSetting('regeln-lauf', { zeit: Date.now() })
        await regelnAusfuehren()
      }).catch(() => {})
    setTimeout(regeln, 120_000).unref?.()
    setInterval(regeln, 3600_000).unref?.()
    setInterval(() => {
      mitSperre('webhook-putzen', lieferungenAufraeumen).catch(() => {})
    }, 6 * 3600_000).unref?.()
    const speicher = () => {
      mitSperre('speicher-messen', speicherMessen).catch((e: any) =>
        console.error('[vylariscloud] Speicher messen:', e.message)
      )
    }
    setTimeout(speicher, 120_000).unref?.()
    setInterval(speicher, 3600_000).unref?.()
    setInterval(geo, 24 * 3600_000).unref?.()
    setInterval(version, 60 * 60_000).unref?.()
  } catch (e: any) {
    console.error('[vylariscloud] Start fehlgeschlagen:', e.message)
  }
})
