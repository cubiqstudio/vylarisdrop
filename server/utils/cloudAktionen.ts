import { z } from 'zod'
import type { H3Event } from 'h3'
import { q, q1, ereignis } from './db'
import { clientIp, type Nutzer } from './auth'
import { aenderbareDateien, dateiRecht, meineTeams, ordnerRecht, type OrdnerRecht } from './teams'
import { eindeutigerName, mitNamenssperre, namenSaeubern, sperrSchluessel } from './dateiNamen'
import { inPapierkorb } from './papierkorb'
import { webhookAusloesen } from './webhooks'
import { dateiAnlegen, type DateiZeile } from './dateien'
import { freierPlatz } from './hochladen'
import { lesen, loeschen, schreiben } from './speicher'

const MAX_ORDNER_JE_NUTZER = 10_000
const MAX_LOESCHEN = 20_000
const MAX_KOPIEREN = 5_000

export const DateiIds = z
  .array(z.string().regex(/^\d{1,18}$/))
  .max(20_000)
  .default([])
export const OrdnerIds = z.array(z.number().int().positive()).max(20_000).default([])
const Ziel = z.number().int().positive().nullable().default(null)

export const AuswahlBody = z.object({ dateien: DateiIds, ordner: OrdnerIds })
export const ZielBody = AuswahlBody.extend({ ziel: Ziel })

const nichtGefunden = () => fehler(404, 'Ordner nicht gefunden.', 'Folder not found.')
const dateiNichtGefunden = () => fehler(404, 'Datei nicht gefunden.', 'File not found.')

/** Alle Ordner unterhalb der angegebenen (einschließlich dieser selbst). */
export async function unterbaum(ids: number[]): Promise<Array<{ id: number; parent_id: number | null; name: string; wurzel: number; user_id: number; team_id: number | null }>> {
  if (!ids.length) return []
  return q(
    `WITH RECURSIVE s AS (
      SELECT id, parent_id, name, id AS wurzel, user_id, team_id, 0 AS tiefe FROM folders WHERE id = ANY($1::int[])
      UNION ALL SELECT o.id, o.parent_id, o.name, s.wurzel, o.user_id, o.team_id, s.tiefe + 1 FROM folders o JOIN s ON o.parent_id = s.id WHERE s.tiefe < 100)
    SELECT id, parent_id, name, wurzel, user_id, team_id FROM s`,
    [ids]
  )
}

async function zielRecht(u: Nutzer, ziel: number | null): Promise<OrdnerRecht | null> {
  if (ziel == null) return null
  const r = await ordnerRecht(u.id, ziel)
  if (!r?.hineinladen) throw nichtGefunden()
  return r
}

async function teamSetzen(id: number, team: number | null) {
  await q(
    `WITH RECURSIVE unter(id) AS (SELECT $1::int UNION SELECT f.id FROM folders f JOIN unter ON f.parent_id = unter.id)
    UPDATE folders SET team_id = $2 WHERE id IN (SELECT id FROM unter)`,
    [id, team]
  )
}

// ---------- Verschieben ----------

export async function verschieben(u: Nutzer, b: z.infer<typeof ZielBody>, event: H3Event) {
  const ziel = b.ziel
  const zr = await zielRecht(u, ziel)
  const dIds = [...new Set(b.dateien)]
  const oIds = [...new Set(b.ordner)]
  if (!dIds.length && !oIds.length) throw fehler(400, 'Nichts ausgewählt.', 'Nothing selected.')

  const erlaubt = new Set((await aenderbareDateien(u.id, dIds)).map((x) => x.id))
  if (dIds.some((id) => !erlaubt.has(id))) throw dateiNichtGefunden()
  const dateien = dIds.length
    ? await q<{ id: string; name: string; user_id: number; folder_id: number | null }>(
        'SELECT id, name, user_id, folder_id FROM files WHERE id = ANY($1::bigint[])',
        [dIds]
      )
    : []
  for (const f of dateien)
    if (f.user_id !== u.id && !zr?.team_id)
      throw fehler(400, 'Dateien aus dem Team bleiben im Team.', 'Files from a team stay in the team.')

  const ordner: Array<{ id: number; name: string; parent_id: number | null; team_id: number | null; eigen: boolean }> = []
  for (const id of oIds) {
    const r = await ordnerRecht(u.id, id)
    if (!r?.verwalten) throw nichtGefunden()
    const o = (await q1<{ name: string; parent_id: number | null }>('SELECT name, parent_id FROM folders WHERE id = $1', [id]))!
    if (!r.eigen && !zr?.team_id)
      throw fehler(400, 'Ein Team-Ordner bleibt im Team.', 'A team folder stays in the team.')
    if (ziel != null) {
      const kreis = await q1(
        `WITH RECURSIVE unter(id, tiefe) AS (SELECT $1::int, 0 UNION SELECT f.id, unter.tiefe + 1 FROM folders f JOIN unter ON f.parent_id = unter.id WHERE unter.tiefe < 100)
        SELECT 1 FROM unter WHERE id = $2`,
        [id, ziel]
      )
      if (kreis)
        throw fehler(
          400,
          'Ein Ordner kann nicht in sich selbst oder in einen seiner Unterordner verschoben werden.',
          'A folder cannot be moved into itself or one of its subfolders.'
        )
    }
    ordner.push({ id, name: o.name, parent_id: o.parent_id, team_id: r.team_id, eigen: r.eigen })
  }

  const umbenannt: Array<{ typ: 'datei' | 'ordner'; id: string | number; name: string }> = []
  let verschoben = 0
  let unveraendert = 0
  await mitNamenssperre(sperrSchluessel(u.id, ziel), async () => {
    for (const o of ordner) {
      if (o.parent_id === ziel && (ziel != null || !o.team_id)) {
        unveraendert++
        continue
      }
      const name = await eindeutigerName({ ordnerId: ziel, userId: u.id, teamId: zr?.team_id, name: o.name, art: 'ordner', ausser: o.id })
      await q('UPDATE folders SET parent_id = $1, name = $2, geaendert_at = now() WHERE id = $3', [ziel, name, o.id])
      const neuesTeam = zr ? zr.team_id : null
      if (neuesTeam !== o.team_id) await teamSetzen(o.id, neuesTeam)
      if (name !== o.name) umbenannt.push({ typ: 'ordner', id: o.id, name })
      verschoben++
    }
    for (const f of dateien) {
      if (f.folder_id === ziel) {
        unveraendert++
        continue
      }
      const name = await eindeutigerName({ ordnerId: ziel, userId: u.id, name: f.name, art: 'datei', ausser: f.id })
      await q('UPDATE files SET folder_id = $1, name = $2, geaendert_at = now() WHERE id = $3', [ziel, name, f.id])
      if (name !== f.name) umbenannt.push({ typ: 'datei', id: f.id, name })
      verschoben++
    }
  })
  await ereignis('cloud_verschoben', u.id, { anzahl: verschoben, ziel }, clientIp(event))
  return { ok: true, verschoben, unveraendert, umbenannt }
}

// ---------- Umbenennen ----------

export const UmbenennenBody = z.object({
  typ: z.enum(['datei', 'ordner']),
  id: z.union([z.string().regex(/^\d{1,18}$/), z.number().int().positive()]),
  name: z.string().max(400)
})

export async function umbenennen(u: Nutzer, b: z.infer<typeof UmbenennenBody>, event: H3Event) {
  const gewuenscht = namenSaeubern(b.name, b.typ)
  if (!gewuenscht) throw fehler(400, 'Der Name darf nicht leer sein.', 'The name must not be empty.')
  if (b.typ === 'datei') {
    const f = await dateiRecht<DateiZeile>(u.id, String(b.id), 'aendern')
    if (!f) throw dateiNichtGefunden()
    const name = await mitNamenssperre(sperrSchluessel(f.user_id, f.folder_id), async () => {
      const n = await eindeutigerName({ ordnerId: f.folder_id, userId: f.user_id, name: gewuenscht, art: 'datei', ausser: f.id })
      if (n !== f.name) await q('UPDATE files SET name = $1, geaendert_at = now() WHERE id = $2', [n, f.id])
      return n
    })
    await ereignis('cloud_umbenannt', u.id, { typ: 'datei', name: name.slice(0, 80) }, clientIp(event))
    return { ok: true, name, angepasst: name !== gewuenscht }
  }
  const id = Number(b.id)
  const r = await ordnerRecht(u.id, id)
  if (!r?.verwalten) throw nichtGefunden()
  const o = (await q1<{ parent_id: number | null; name: string }>('SELECT parent_id, name FROM folders WHERE id = $1', [id]))!
  const name = await mitNamenssperre(sperrSchluessel(u.id, o.parent_id), async () => {
    const n = await eindeutigerName({ ordnerId: o.parent_id, userId: r.user_id, teamId: r.team_id, name: gewuenscht, art: 'ordner', ausser: id })
    if (n !== o.name) await q('UPDATE folders SET name = $1, geaendert_at = now() WHERE id = $2', [n, id])
    return n
  })
  await ereignis('cloud_umbenannt', u.id, { typ: 'ordner', name: name.slice(0, 80) }, clientIp(event))
  return { ok: true, name, angepasst: name !== gewuenscht }
}

// ---------- Neuer Ordner ----------

export const OrdnerBody = z.object({
  name: z.string().max(400),
  ordner: z.number().int().positive().nullable().default(null),
  team: z.number().int().positive().nullable().optional(),
  wiederverwenden: z.boolean().optional()
})

export async function ordnerAnlegen(u: Nutzer, b: z.infer<typeof OrdnerBody>, event: H3Event) {
  const gewuenscht = namenSaeubern(b.name, 'ordner')
  if (!gewuenscht) throw fehler(400, 'Bitte einen Namen eingeben.', 'Please enter a name.')
  let team: number | null = null
  if (b.ordner != null) {
    const r = await ordnerRecht(u.id, b.ordner)
    if (!r?.hineinladen) throw fehler(404, 'Übergeordneter Ordner nicht gefunden.', 'Parent folder not found.')
    team = r.team_id
  } else if (b.team != null) {
    const m = (await meineTeams(u.id)).find((t) => t.team_id === b.team)
    if (!m || m.rolle !== 'leitung')
      throw fehler(403, 'Team-Ordner legt die Team-Leitung an.', 'Team folders are created by the team lead.')
    team = m.team_id
  }
  return mitNamenssperre(b.ordner == null && team ? `t${team}` : sperrSchluessel(u.id, b.ordner), async () => {
    if (b.wiederverwenden) {
      const da = await q1<any>(
        b.ordner != null
          ? 'SELECT id, name, parent_id, team_id FROM folders WHERE parent_id = $1 AND lower(name) = lower($2) ORDER BY id LIMIT 1'
          : team
            ? 'SELECT id, name, parent_id, team_id FROM folders WHERE parent_id IS NULL AND team_id = $3 AND lower(name) = lower($2) AND $1::int > 0 ORDER BY id LIMIT 1'
            : 'SELECT id, name, parent_id, team_id FROM folders WHERE parent_id IS NULL AND team_id IS NULL AND user_id = $1 AND lower(name) = lower($2) ORDER BY id LIMIT 1',
        b.ordner != null ? [b.ordner, gewuenscht] : team ? [u.id, gewuenscht, team] : [u.id, gewuenscht]
      )
      if (da) return { ok: true, bestehend: true, ordner: eintragOrdner(da, 0) }
    }
    const n = await q1<{ n: string }>('SELECT count(*) AS n FROM folders WHERE user_id = $1', [u.id])
    if (Number(n?.n || 0) >= MAX_ORDNER_JE_NUTZER)
      throw fehler(400, 'Höchstens 10.000 Ordner.', 'At most 10,000 folders.')
    const name = await eindeutigerName({ ordnerId: b.ordner, userId: u.id, teamId: team, name: gewuenscht, art: 'ordner' })
    const o = (await q1<any>(
      'INSERT INTO folders (user_id, parent_id, name, team_id) VALUES ($1, $2, $3, $4) RETURNING id, name, parent_id, team_id',
      [u.id, b.ordner, name, team]
    ))!
    await ereignis('cloud_ordner', u.id, { name: name.slice(0, 80) }, clientIp(event))
    return { ok: true, bestehend: false, ordner: eintragOrdner(o, 0) }
  })
}
const eintragOrdner = (o: any, anzahl: number) => ({
  typ: 'ordner' as const,
  id: o.id as number,
  name: o.name as string,
  parent_id: (o.parent_id ?? null) as number | null,
  team_id: (o.team_id ?? null) as number | null,
  team: null,
  favorite: false,
  geaendert_at: new Date().toISOString(),
  anzahl,
  galerie: false,
  eigen: true,
  darf_aendern: true
})

// ---------- Favoriten ----------

export const FavoritBody = AuswahlBody.extend({ wert: z.boolean() })

export async function favorit(u: Nutzer, b: z.infer<typeof FavoritBody>) {
  const dIds = [...new Set(b.dateien)]
  const oIds = [...new Set(b.ordner)]
  let n = 0
  if (dIds.length) {
    const ok = await aenderbareDateien(u.id, dIds)
    if (ok.length) {
      await q('UPDATE files SET favorite = $1 WHERE id = ANY($2::bigint[])', [b.wert, ok.map((x) => x.id)])
      n += ok.length
    }
  }
  if (oIds.length) {
    const erlaubt: number[] = []
    for (const id of oIds) if ((await ordnerRecht(u.id, id))?.verwalten) erlaubt.push(id)
    if (erlaubt.length) {
      await q('UPDATE folders SET favorite = $1 WHERE id = ANY($2::int[])', [b.wert, erlaubt])
      n += erlaubt.length
    }
  }
  return { ok: true, geaendert: n, uebersprungen: dIds.length + oIds.length - n }
}

// ---------- Löschen (Papierkorb) ----------

export async function loeschenAuswahl(u: Nutzer, b: z.infer<typeof AuswahlBody>, event: H3Event) {
  const dIds = [...new Set(b.dateien)]
  const oIds = [...new Set(b.ordner)]
  if (!dIds.length && !oIds.length) throw fehler(400, 'Nichts ausgewählt.', 'Nothing selected.')
  const teams = await meineTeams(u.id)
  const leitung = teams.filter((t) => t.rolle === 'leitung').map((t) => t.team_id)

  // Dateien, die direkt gewählt wurden (nicht mehr vorhandene werden übersprungen)
  const vorhanden = dIds.length
    ? new Set((await q<{ id: string }>('SELECT id::text AS id FROM files WHERE id = ANY($1::bigint[])', [dIds])).map((x) => x.id))
    : new Set<string>()
  const erlaubt = new Set((await aenderbareDateien(u.id, dIds.filter((id) => vorhanden.has(id)))).map((x) => x.id))
  if ([...vorhanden].some((id) => !erlaubt.has(id)))
    throw dateiNichtGefunden()
  const alleDateien = new Set<string>(erlaubt)

  // Ordner: ganzer Teilbaum muss löschbar sein
  const wurzeln: number[] = []
  for (const id of oIds) {
    const da = await q1('SELECT 1 FROM folders WHERE id = $1', [id])
    if (!da) continue
    const r = await ordnerRecht(u.id, id)
    if (!r) throw nichtGefunden()
    if (!r.verwalten)
      throw fehler(403, 'Das darf der Ersteller oder die Team-Leitung.', 'Only the creator or the team lead may do this.')
    wurzeln.push(id)
  }
  const baum = await unterbaum(wurzeln)
  if (baum.some((o) => o.user_id !== u.id && !(o.team_id && leitung.includes(o.team_id))))
    throw fehler(
      403,
      'Der Ordner enthält Ordner anderer Mitglieder, die du nicht löschen darfst.',
      'The folder contains folders of other members that you may not delete.'
    )
  if (baum.length) {
    const inOrdnern = await q<{ id: string; user_id: number; team_id: number | null }>(
      `SELECT f.id::text AS id, f.user_id, o.team_id FROM files f JOIN folders o ON o.id = f.folder_id WHERE f.folder_id = ANY($1::int[])`,
      [[...new Set(baum.map((o) => o.id))]]
    )
    if (inOrdnern.some((f) => f.user_id !== u.id && !(f.team_id && leitung.includes(f.team_id))))
      throw fehler(
        403,
        'Der Ordner enthält Dateien anderer Mitglieder, die du nicht löschen darfst.',
        'The folder contains files of other members that you may not delete.'
      )
    for (const f of inOrdnern) alleDateien.add(f.id)
  }
  if (alleDateien.size > MAX_LOESCHEN)
    throw fehler(400, `Zu viele Dateien auf einmal (höchstens ${MAX_LOESCHEN}).`, `Too many files at once (at most ${MAX_LOESCHEN}).`)

  const ids = [...alleDateien]
  const zeilen = ids.length
    ? await q<{ id: string; slug: string; name: string; user_id: number }>(
        'SELECT id::text AS id, slug, name, user_id FROM files WHERE id = ANY($1::bigint[])',
        [ids]
      )
    : []
  let geloescht = 0
  const arbeiter = async (liste: typeof zeilen) => {
    for (const f of liste) {
      if (await inPapierkorb({ id: f.id }, u.id)) {
        geloescht++
        webhookAusloesen(f.user_id, 'file.deleted', {
          file: { id: f.id, slug: f.slug, name: f.name },
          trashed: true,
          by: u.username
        })
      }
    }
  }
  const teile = Array.from({ length: 6 }, (_, i) => zeilen.filter((_f, j) => j % 6 === i))
  await Promise.all(teile.map(arbeiter))
  if (wurzeln.length) await q('DELETE FROM folders WHERE id = ANY($1::int[])', [wurzeln])
  const papierkorb = ids.length
    ? await q<{ id: string; fid: string }>(
        `SELECT id::text AS id, datei->>'id' AS fid FROM papierkorb WHERE datei->>'id' = ANY($1::text[]) AND geloescht_von = $2`,
        [ids, u.id]
      )
    : []
  const nameVon = new Map(zeilen.map((z) => [z.id, z.name]))
  await ereignis('files_deleted', u.id, { anzahl: geloescht, ordner: wurzeln.length }, clientIp(event))
  return {
    ok: true,
    dateien: geloescht,
    ordner: wurzeln.length,
    papierkorb: papierkorb.map((p) => ({ id: p.id, name: nameVon.get(p.fid) || '' }))
  }
}

// ---------- Kopieren ----------

export async function kopieren(u: Nutzer, b: z.infer<typeof ZielBody>, event: H3Event) {
  const ziel = b.ziel
  const zr = await zielRecht(u, ziel)
  const dIds = [...new Set(b.dateien)]
  const oIds = [...new Set(b.ordner)]
  if (!dIds.length && !oIds.length) throw fehler(400, 'Nichts ausgewählt.', 'Nothing selected.')
  const teams = await meineTeams(u.id)
  const teamIds = teams.map((t) => t.team_id)

  const einzel: DateiZeile[] = []
  for (const id of dIds) {
    const f = await dateiRecht<DateiZeile>(u.id, id, 'lesen')
    if (!f) throw dateiNichtGefunden()
    einzel.push(f)
  }
  for (const id of oIds) if (!(await ordnerRecht(u.id, id))) throw nichtGefunden()
  const baum = await unterbaum(oIds)
  const ordnerIds = [...new Set(baum.map((o) => o.id))]
  // Dateien in privaten Ordnern: nur eigene; in Team-Ordnern alle für Mitglieder lesbaren
  const inOrdnern = ordnerIds.length
    ? await q<DateiZeile & { team: number | null }>(
        `SELECT f.*, o.team_id AS team FROM files f JOIN folders o ON o.id = f.folder_id
        WHERE f.folder_id = ANY($1::int[]) AND (f.user_id = $2 OR o.team_id = ANY($3::int[])) ORDER BY f.id`,
        [ordnerIds, u.id, teamIds]
      )
    : []
  const gesamt = einzel.length + inOrdnern.length
  if (gesamt > MAX_KOPIEREN)
    throw fehler(400, `Zu viele Dateien auf einmal (höchstens ${MAX_KOPIEREN}).`, `Too many files at once (at most ${MAX_KOPIEREN}).`)
  const bytes = einzel.reduce((a, f) => a + Number(f.size), 0) + inOrdnern.reduce((a, f) => a + Number(f.size), 0)
  if (bytes > (await freierPlatz(u)))
    throw fehler(413, 'Dafür ist nicht genug Speicherplatz frei.', 'There is not enough free storage for this.')
  const n = await q1<{ n: string }>('SELECT count(*) AS n FROM folders WHERE user_id = $1', [u.id])
  if (Number(n?.n || 0) + baum.length > MAX_ORDNER_JE_NUTZER)
    throw fehler(400, 'Höchstens 10.000 Ordner.', 'At most 10,000 folders.')

  const sprache = u.prefs?.lang === 'en' ? 'en' : 'de'
  const fehlerListe: string[] = []
  let kopiert = 0
  const kopierDatei = async (f: DateiZeile, ordnerId: number | null, teamId: number | null) => {
    try {
      await mitNamenssperre(sperrSchluessel(u.id, ordnerId), async () => {
        const name = await eindeutigerName({ ordnerId, userId: u.id, teamId, name: f.name, art: 'datei' })
        const g = await schreiben(lesen(f.ablage), 0)
        if (f.sha256 && g.sha256 !== f.sha256) {
          await loeschen(g.schluessel)
          throw new Error('Prüfsumme stimmt nicht')
        }
        const neu = await dateiAnlegen(
          u.id,
          g,
          name,
          f.mime,
          { ordner: ordnerId, stil: u.prefs?.stil, verschluesselt: !!f.verschluesselt, name },
          sprache
        )
        await q(
          'INSERT INTO file_tags (file_id, tag_id) SELECT $1, ft.tag_id FROM file_tags ft JOIN tags t ON t.id = ft.tag_id WHERE ft.file_id = $2 AND t.user_id = $3 ON CONFLICT DO NOTHING',
          [neu.id, f.id, u.id]
        )
      })
      kopiert++
    } catch (e: any) {
      fehlerListe.push(`${f.name}: ${String(e?.message || e).slice(0, 120)}`)
    }
  }

  const neueOrdner: Array<{ id: number; name: string }> = []
  await Promise.resolve()
  for (const f of einzel) await kopierDatei(f, ziel, zr?.team_id ?? null)
  // Ordner: Struktur zuerst, dann die Dateien
  for (const wurzel of oIds) {
    const teil = baum.filter((o) => o.wurzel === wurzel)
    const neuId = new Map<number, number>()
    const start = teil.find((o) => o.id === wurzel)!
    const wo = await mitNamenssperre(
      ziel == null && zr?.team_id ? `t${zr.team_id}` : sperrSchluessel(u.id, ziel),
      async () => {
        const name = await eindeutigerName({ ordnerId: ziel, userId: u.id, teamId: zr?.team_id ?? null, name: start.name, art: 'ordner' })
        const neu = await q1<{ id: number; name: string }>(
          'INSERT INTO folders (user_id, parent_id, name, team_id) VALUES ($1, $2, $3, $4) RETURNING id, name',
          [u.id, ziel, name, zr?.team_id ?? null]
        )
        return neu!
      }
    )
    neuId.set(wurzel, wo.id)
    neueOrdner.push(wo)
    // nach Tiefe: Eltern vor Kindern
    let offen = teil.filter((o) => o.id !== wurzel)
    while (offen.length) {
      const bereit = offen.filter((o) => o.parent_id != null && neuId.has(o.parent_id))
      if (!bereit.length) break
      for (const o of bereit) {
        const neu = await q1<{ id: number }>(
          'INSERT INTO folders (user_id, parent_id, name, team_id) VALUES ($1, $2, $3, $4) RETURNING id',
          [u.id, neuId.get(o.parent_id!)!, o.name, zr?.team_id ?? null]
        )
        neuId.set(o.id, neu!.id)
      }
      offen = offen.filter((o) => !neuId.has(o.id))
    }
    for (const f of inOrdnern.filter((x) => x.folder_id != null && teil.some((o) => o.id === x.folder_id)))
      await kopierDatei(f, neuId.get(f.folder_id!) ?? null, zr?.team_id ?? null)
  }
  await ereignis('cloud_kopiert', u.id, { anzahl: kopiert, ziel }, clientIp(event))
  if (!kopiert && fehlerListe.length)
    throw fehler(500, `Kopieren fehlgeschlagen: ${fehlerListe[0]}`, `Copy failed: ${fehlerListe[0]}`)
  return { ok: true, kopiert, ordner: neueOrdner.length, fehler: fehlerListe.length ? fehlerListe.slice(0, 10) : undefined }
}
