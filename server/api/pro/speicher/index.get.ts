import { q } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'
import { ausUmgebung, getSpeicher } from '../../../utils/s3'
import { umzugStand } from '../../../utils/umzug'
import { alleKnoten, KNOTEN_ID } from '../../../utils/knoten'
import { platte, poolPlatz, zielOrt } from '../../../utils/speicher'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const w = await getSpeicher()
  const verteilung = await q<{ ort: string; n: string; s: string }>(
    `SELECT CASE WHEN ablage LIKE 's3:%' THEN 's3' WHEN ablage ~ '^sftp[0-9]+:' THEN 'sftp' ELSE 'lokal' END AS ort, count(*) AS n, coalesce(sum(size), 0) AS s FROM files GROUP BY 1`
  )
  const knoten = await alleKnoten()
  return {
    art: w.art,
    ziel: await zielOrt(),
    ausUmgebung: ausUmgebung(),
    s3: w.s3 ? { ...w.s3, geheim: '', hatGeheim: !!w.s3.geheim } : null,
    verteilung: Object.fromEntries(verteilung.map((v) => [v.ort, { anzahl: Number(v.n), bytes: Number(v.s) }])),
    umzug: await umzugStand(),
    platte: await platte(),
    pool: w.art === 'pool' ? await poolPlatz() : null,
    knoten: knoten.map((k) => ({ ...k, ich: k.id === KNOTEN_ID })),
    ordnerGeteilt: new Set(knoten.filter((k) => k.lebt).map((k) => k.ordner)).size <= 1
  }
})
