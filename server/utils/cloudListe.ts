import { z } from 'zod'
import { q } from './db'
import type { Nutzer } from './auth'
import { fuerPanel, type DateiZeile } from './dateien'
import { meineTeams, ordnerRecht, type OrdnerRecht } from './teams'
import { sLang } from './settings'

export const MAX_ZEILEN = 100_000

export const ListenFrage = z.object({
  ansicht: z.enum(['alle', 'zuletzt', 'favoriten', 'team']).default('alle'),
  ordner: z.coerce.number().int().positive().optional(),
  sort: z.enum(['name', 'groesse', 'datum']).optional(),
  richtung: z.enum(['auf', 'ab']).optional(),
  suche: z.string().max(100).optional(),
  tags: z.enum(['0', '1']).default('1'),
  seite: z.coerce.number().int().min(1).max(100_000).default(1),
  pro: z.coerce.number().int().min(1).max(500).default(200),
  /** '1': nur die Schlüssel aller Treffer liefern (für "Alles auswählen" über mehrere Seiten) */
  ids: z.enum(['0', '1']).default('0')
})
export type ListenFrageT = z.infer<typeof ListenFrage>

export function eingabe<S extends z.ZodType>(schema: S, roh: unknown): z.infer<S> {
  const p = schema.safeParse(roh)
  if (!p.success) throw fehler(400, 'Bitte prüfe deine Eingaben.', 'Please check your input.')
  return p.data
}

export interface KettenGlied {
  id: number
  name: string
  parent_id: number | null
  team_id: number | null
}

/** Pfad von der Wurzel bis zum Ordner (für Brotkrumen). Bei Team-Ordnern endet die Kette an der Team-Wurzel. */
export async function ordnerKette(id: number): Promise<KettenGlied[]> {
  const z = await q<KettenGlied & { tiefe: number }>(
    `WITH RECURSIVE k(id, name, parent_id, team_id, tiefe) AS (
      SELECT id, name, parent_id, team_id, 0 FROM folders WHERE id = $1
      UNION ALL SELECT o.id, o.name, o.parent_id, o.team_id, k.tiefe + 1 FROM folders o JOIN k ON o.id = k.parent_id WHERE k.tiefe < 100)
    SELECT id, name, parent_id, team_id, tiefe FROM k ORDER BY tiefe DESC`,
    [id]
  )
  const team = z.length ? z[z.length - 1]!.team_id : null
  return (team ? z.filter((x) => x.team_id === team) : z).map(({ tiefe: _t, ...r }) => r)
}

/** Ausgeschriebene Pfade ("Fotos / 2024") für mehrere Ordner auf einmal. */
export async function ordnerPfade(ids: number[]): Promise<Map<number, string>> {
  const aus = new Map<number, string>()
  if (!ids.length) return aus
  const z = await q<{ start: number; name: string; tiefe: number }>(
    `WITH RECURSIVE k(start, id, name, parent_id, tiefe) AS (
      SELECT id, id, name, parent_id, 0 FROM folders WHERE id = ANY($1::int[])
      UNION ALL SELECT k.start, o.id, o.name, o.parent_id, k.tiefe + 1 FROM folders o JOIN k ON o.id = k.parent_id WHERE k.tiefe < 100)
    SELECT start, name, tiefe FROM k ORDER BY start, tiefe DESC`,
    [ids]
  )
  for (const r of z) aus.set(r.start, (aus.get(r.start) ? aus.get(r.start) + ' / ' : '') + r.name)
  return aus
}

interface Leicht {
  k: 'o' | 'd'
  id: string
  name: string
  size: number
  dat: number
}

const like = (s: string) => '%' + s.replace(/[%_\\]/g, (m) => '\\' + m) + '%'

export async function cloudListe(u: Nutzer, roh: ListenFrageT, basis: string) {
  // "Zuletzt" ist standardmäßig nach Datum absteigend, alles andere nach Name aufsteigend
  const sort = roh.sort ?? (roh.ansicht === 'zuletzt' ? 'datum' : 'name')
  const richtung = roh.richtung ?? (roh.ansicht === 'zuletzt' || sort !== 'name' ? 'ab' : 'auf')
  const p = { ...roh, sort, richtung }
  const teams = await meineTeams(u.id)
  const teamIds = teams.map((t) => t.team_id)
  const leitungIds = teams.filter((t) => t.rolle === 'leitung').map((t) => t.team_id)
  const suche = (p.suche || '').trim()

  let recht: OrdnerRecht | null = null
  let kette: KettenGlied[] = []
  if (p.ordner) {
    recht = await ordnerRecht(u.id, p.ordner)
    if (!recht) throw fehler(404, 'Ordner nicht gefunden.', 'Folder not found.')
    kette = await ordnerKette(p.ordner)
  }

  // Bedingungen für Dateien (f) und Ordner (o). $1 = Nutzer, $2 = Team-IDs (immer vorhanden)
  const w: unknown[] = [u.id, teamIds]
  const neu = (v: unknown) => {
    w.push(v)
    return `$${w.length}`
  }
  const sichtbarD = '(f.user_id = $1 OR f.folder_id IN (SELECT id FROM folders WHERE team_id = ANY($2::int[])))'
  const sichtbarO = '(o.user_id = $1 OR o.team_id = ANY($2::int[]))'
  let wD: string[] | null = []
  let wO: string[] | null = []
  let grenze = 0

  if (suche) {
    wD = [sichtbarD]
    wO = [sichtbarO]
    const m = neu(like(suche))
    const tagTeil =
      p.tags === '1'
        ? ` OR EXISTS (SELECT 1 FROM file_tags ft JOIN tags t ON t.id = ft.tag_id WHERE ft.file_id = f.id AND t.name ILIKE ${m})`
        : ''
    wD.push(`(f.name ILIKE ${m}${tagTeil})`)
    wO.push(`o.name ILIKE ${m}`)
    if (p.ordner) {
      const n = neu(p.ordner)
      const baum = `(WITH RECURSIVE s(id, tiefe) AS (SELECT id, 0 FROM folders WHERE id = ${n}::int UNION ALL SELECT o.id, s.tiefe + 1 FROM folders o JOIN s ON o.parent_id = s.id WHERE s.tiefe < 100) SELECT id FROM s)`
      wD.push(`f.folder_id IN ${baum}`)
      wO.push(`o.id IN ${baum} AND o.id <> ${n}::int`)
    }
    if (p.ansicht === 'favoriten') {
      wD.push('f.favorite')
      wO.push('o.favorite')
    } else if (p.ansicht === 'team') {
      wD.push('f.folder_id IN (SELECT id FROM folders WHERE team_id = ANY($2::int[]))')
      wO.push('o.team_id = ANY($2::int[])')
    }
    if (p.ansicht === 'zuletzt') wO = null
  } else if (p.ordner) {
    const ordnerWert = neu(p.ordner)
    wD = [`f.folder_id = ${ordnerWert}`, recht!.team_id ? 'true' : 'f.user_id = $1']
    wO = [`o.parent_id = ${ordnerWert}`]
    if (!recht!.team_id) wO.push('o.user_id = $1')
  } else if (p.ansicht === 'zuletzt') {
    wD = [sichtbarD]
    wO = null
    grenze = 500
  } else if (p.ansicht === 'favoriten') {
    wD = [sichtbarD, 'f.favorite']
    wO = [sichtbarO, 'o.favorite']
  } else if (p.ansicht === 'team') {
    wD = null
    wO = ['o.parent_id IS NULL', 'o.team_id = ANY($2::int[])']
  } else {
    wD = ['f.user_id = $1', 'f.folder_id IS NULL']
    wO = ['o.user_id = $1', 'o.parent_id IS NULL', '(o.team_id IS NULL OR NOT (o.team_id = ANY($2::int[])))']
  }

  // Jede Abfrage verweist auf $1 und $2, damit die Parameterzahl immer passt
  const dateienLeicht = wD
    ? await q<{ id: string; name: string; size: string; dat: Date }>(
        `SELECT f.id::text AS id, f.name, f.size, greatest(f.geaendert_at, f.created_at) AS dat FROM files f
        WHERE $1::int > 0 AND $2::int[] IS NOT NULL AND ${wD.join(' AND ')}
        ${grenze ? `ORDER BY greatest(f.geaendert_at, f.created_at) DESC LIMIT ${grenze}` : `LIMIT ${MAX_ZEILEN}`}`,
        w
      )
    : []
  const ordnerLeicht = wO
    ? await q<{ id: string; name: string; dat: Date }>(
        `SELECT o.id::text AS id, o.name, o.geaendert_at AS dat FROM folders o
        WHERE $1::int > 0 AND $2::int[] IS NOT NULL AND ${wO.join(' AND ')} LIMIT ${MAX_ZEILEN}`,
        w
      )
    : []

  const alle: Leicht[] = [
    ...ordnerLeicht.map((o) => ({ k: 'o' as const, id: o.id, name: o.name, size: 0, dat: new Date(o.dat).getTime() })),
    ...dateienLeicht.map((f) => ({
      k: 'd' as const,
      id: f.id,
      name: f.name,
      size: Number(f.size),
      dat: new Date(f.dat).getTime()
    }))
  ]
  const kol = new Intl.Collator(sLang() === 'en' ? 'en' : 'de', { numeric: true, sensitivity: 'base' })
  const mal = p.richtung === 'ab' ? -1 : 1
  alle.sort((a, b) => {
    if (a.k !== b.k) return a.k === 'o' ? -1 : 1
    let c = 0
    if (p.sort === 'groesse') c = a.size - b.size
    else if (p.sort === 'datum') c = a.dat - b.dat
    if (c) return c * mal
    c = kol.compare(a.name, b.name)
    if (c) return c * (p.sort === 'name' ? mal : 1)
    return Number(a.id) - Number(b.id)
  })

  const summe = {
    ordner: ordnerLeicht.length,
    dateien: dateienLeicht.length,
    bytes: dateienLeicht.reduce((a, f) => a + Number(f.size), 0)
  }
  if (p.ids === '1')
    return {
      gesamt: alle.length,
      ids: alle.map((x) => ({ typ: x.k === 'o' ? ('ordner' as const) : ('datei' as const), id: x.k === 'o' ? Number(x.id) : x.id, name: x.name }))
    }
  const von = (p.seite - 1) * p.pro
  const seitenZeilen = alle.slice(von, von + p.pro)
  const dIds = seitenZeilen.filter((x) => x.k === 'd').map((x) => x.id)
  const oIds = seitenZeilen.filter((x) => x.k === 'o').map((x) => Number(x.id))

  const dateien = dIds.length
    ? await q<DateiZeile & { von: string; ordner_team: number | null }>(
        `SELECT f.*, u.username AS von, fo.team_id AS ordner_team FROM files f JOIN users u ON u.id = f.user_id
        LEFT JOIN folders fo ON fo.id = f.folder_id WHERE f.id = ANY($1::bigint[])`,
        [dIds]
      )
    : []
  const tags = dIds.length
    ? await q<{ file_id: string; id: number; name: string; color: string }>(
        'SELECT ft.file_id, t.id, t.name, t.color FROM file_tags ft JOIN tags t ON t.id = ft.tag_id WHERE ft.file_id = ANY($1::bigint[])',
        [dIds]
      )
    : []
  const ordnerZeilen = oIds.length
    ? await q<any>(
        `SELECT o.id, o.name, o.parent_id, o.team_id, o.favorite, o.user_id, o.geaendert_at, o.created_at, o.galerie_token,
          (SELECT count(*) FROM files x WHERE x.folder_id = o.id)::int + (SELECT count(*) FROM folders y WHERE y.parent_id = o.id)::int AS anzahl
        FROM folders o WHERE o.id = ANY($1::int[])`,
        [oIds]
      )
    : []
  const pfade = suche ? await ordnerPfade([...new Set([...dateien.map((d) => d.folder_id), ...ordnerZeilen.map((o: any) => o.parent_id)].filter((x): x is number => !!x))]) : new Map<number, string>()

  const dMap = new Map(dateien.map((d) => [String(d.id), d]))
  const oMap = new Map(ordnerZeilen.map((o: any) => [String(o.id), o]))
  const eintraege = seitenZeilen
    .map((z) => {
      if (z.k === 'd') {
        const d = dMap.get(z.id)
        if (!d) return null
        const eigen = d.user_id === u.id
        const { von: vonName, ordner_team, ...zeile } = d
        return {
          typ: 'datei' as const,
          ...fuerPanel(
            basis,
            zeile as DateiZeile,
            tags.filter((t) => t.file_id === String(d.id)).map(({ id, name, color }) => ({ id, name, color }))
          ),
          geaendert_at: (d as any).geaendert_at,
          eigen,
          von: eigen ? undefined : vonName,
          darf_aendern: eigen || (!!ordner_team && leitungIds.includes(ordner_team)),
          team_id: ordner_team && teamIds.includes(ordner_team) ? ordner_team : null,
          ...(suche ? { pfad: d.folder_id ? pfade.get(d.folder_id) || '' : '' } : {})
        }
      }
      const o = oMap.get(z.id)
      if (!o) return null
      const eigen = o.user_id === u.id
      const team = o.team_id && teamIds.includes(o.team_id) ? teams.find((t) => t.team_id === o.team_id)! : null
      return {
        typ: 'ordner' as const,
        id: o.id as number,
        name: o.name as string,
        parent_id: o.parent_id as number | null,
        team_id: team ? (o.team_id as number) : null,
        team: team ? { name: team.name, farbe: team.farbe } : null,
        favorite: !!o.favorite,
        geaendert_at: o.geaendert_at,
        created_at: o.created_at,
        anzahl: o.anzahl as number,
        galerie: !!o.galerie_token,
        eigen,
        darf_aendern: eigen || (!!team && team.rolle === 'leitung'),
        ...(suche ? { pfad: o.parent_id ? pfade.get(o.parent_id) || '' : '' } : {})
      }
    })
    .filter(Boolean)

  const ansicht = p.ansicht
  return {
    ansicht,
    suche,
    sort: p.sort,
    richtung: p.richtung,
    ordner: recht
      ? {
          id: recht.id,
          name: kette[kette.length - 1]?.name || '',
          parent_id: kette[kette.length - 1]?.parent_id ?? null,
          team_id: recht.team_id,
          eigen: recht.eigen,
          hineinladen: recht.hineinladen,
          verwalten: recht.verwalten
        }
      : null,
    pfad: kette.map((k) => ({ id: k.id, name: k.name })),
    kontext: (recht?.team_id ?? null) || ansicht === 'team' ? 'team' : 'meine',
    kannTeamOrdner: leitungIds.length > 0,
    teams: ansicht === 'team' && !p.ordner ? teams.map((t) => ({ id: t.team_id, name: t.name, farbe: t.farbe, rolle: t.rolle })) : undefined,
    seite: p.seite,
    pro: p.pro,
    gesamt: alle.length,
    mehr: von + p.pro < alle.length,
    gekappt: ordnerLeicht.length >= MAX_ZEILEN || dateienLeicht.length >= MAX_ZEILEN || (grenze > 0 && dateienLeicht.length >= grenze),
    summe,
    eintraege
  }
}
