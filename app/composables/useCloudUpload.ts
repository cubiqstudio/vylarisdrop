// Hochladen in den Cloud-Dateimanager: Warteschlange (3 gleichzeitig), ganze Ordner per Ziehen oder Auswahl.
// Das Hochladen selbst macht useUploads (Teile à 8 MB, Wiederholung bei Fehlern).

interface Auftrag {
  datei: File
  ordner: number | null
}

const PARALLEL = 3
let aktiv = 0 // gemeinsam für alle Aufrufer, damit nie mehr als PARALLEL Dateien gleichzeitig laufen

export function useCloudUpload() {
  const { hochladen } = useUploads()
  const { ok, fehler } = useToast()
  const stand = useState('cloud-upload-stand', () => ({ gesamt: 0, fertig: 0, fehler: 0, leer: 0, laeuft: false }))
  const warte = useState<Auftrag[]>('cloud-upload-warte', () => [])

  function melden() {
    const s = stand.value
    const teile: string[] = []
    if (s.fertig) teile.push(t(`${s.fertig} Datei(en) hochgeladen`, `${s.fertig} file(s) uploaded`))
    if (s.leer) teile.push(t(`${s.leer} leere Datei(en) übersprungen`, `${s.leer} empty file(s) skipped`))
    if (s.fehler) fehler(t(`${s.fehler} Datei(en) konnten nicht hochgeladen werden — Details im Upload-Fenster`, `${s.fehler} file(s) could not be uploaded — see the upload panel`))
    if (teile.length) ok(teile.join(', '))
    stand.value = { gesamt: 0, fertig: 0, fehler: 0, leer: 0, laeuft: false }
  }

  function weiter() {
    while (aktiv < PARALLEL && warte.value.length) {
      const a = warte.value.shift()!
      aktiv++
      void hochladen([a.datei], { ordner: a.ordner, still: true, eindeutig: true })
        .then((r) => {
          stand.value = { ...stand.value, fertig: stand.value.fertig + r.ok, fehler: stand.value.fehler + r.fehler }
        })
        .catch(() => {
          stand.value = { ...stand.value, fehler: stand.value.fehler + 1 }
        })
        .finally(() => {
          aktiv--
          if (!aktiv && !warte.value.length) melden()
          else weiter()
        })
    }
  }

  function einreihen(dateien: File[], ordner: number | null) {
    let leer = 0
    const echte = dateien.filter((d) => {
      if (d.size > 0) return true
      leer++
      return false
    })
    stand.value = {
      ...stand.value,
      gesamt: stand.value.gesamt + echte.length,
      leer: stand.value.leer + leer,
      laeuft: true
    }
    warte.value.push(...echte.map((datei) => ({ datei, ordner })))
    if (!echte.length && !aktiv) melden()
    weiter()
  }

  async function ordnerHolen(name: string, eltern: number | null): Promise<number> {
    const r = await api('/api/cloud/ordner', { method: 'POST', body: { name, ordner: eltern, wiederverwenden: true } })
    return r.ordner.id
  }

  // ----- Ziehen von außen (Dateien und ganze Ordner) -----
  function eintraegeAus(dt: DataTransfer): { entries: FileSystemEntry[]; dateien: File[] } {
    // webkitGetAsEntry muss synchron im Drop-Ereignis aufgerufen werden
    const entries: FileSystemEntry[] = []
    for (const item of Array.from(dt.items || [])) {
      if (item.kind !== 'file') continue
      const e = (item as any).webkitGetAsEntry?.() as FileSystemEntry | null
      if (e) entries.push(e)
    }
    return { entries, dateien: Array.from(dt.files || []) }
  }
  const alleLesen = (leser: FileSystemDirectoryReader) =>
    new Promise<FileSystemEntry[]>((res, rej) => {
      const aus: FileSystemEntry[] = []
      const runde = () =>
        leser.readEntries((teil) => {
          if (!teil.length) return res(aus)
          aus.push(...teil)
          runde()
        }, rej)
      runde()
    })
  const dateiAus = (e: FileSystemFileEntry) => new Promise<File>((res, rej) => e.file(res, rej))

  async function ausEintraegen(entries: FileSystemEntry[], ziel: number | null) {
    const dateien: Auftrag[] = []
    let ordnerFehler = 0
    const gehe = async (e: FileSystemEntry, eltern: number | null) => {
      try {
        if (e.isFile) dateien.push({ datei: await dateiAus(e as FileSystemFileEntry), ordner: eltern })
        else if (e.isDirectory) {
          const id = await ordnerHolen(e.name, eltern)
          for (const k of await alleLesen((e as FileSystemDirectoryEntry).createReader())) await gehe(k, id)
        }
      } catch {
        ordnerFehler++
      }
    }
    for (const e of entries) await gehe(e, ziel)
    const nachOrdner = new Map<number | null, File[]>()
    for (const a of dateien) nachOrdner.set(a.ordner, [...(nachOrdner.get(a.ordner) || []), a.datei])
    for (const [o, l] of nachOrdner) einreihen(l, o)
    if (ordnerFehler) fehler(t(`${ordnerFehler} Eintrag/Einträge konnten nicht gelesen werden.`, `${ordnerFehler} entry/entries could not be read.`))
  }

  /** Dateien aus einem Drop oder einem Datei-Dialog (auch ganze Ordner mit webkitRelativePath). */
  async function ausDrop(dt: DataTransfer, ziel: number | null) {
    const { entries, dateien } = eintraegeAus(dt)
    if (entries.length) return ausEintraegen(entries, ziel)
    if (dateien.length) einreihen(dateien, ziel)
  }
  async function ausDateiliste(liste: FileList | File[], ziel: number | null) {
    const dateien = Array.from(liste)
    const cache = new Map<string, number>()
    const gruppen = new Map<number | null, File[]>()
    for (const d of dateien) {
      const teile = ((d as any).webkitRelativePath || '').split('/').slice(0, -1) as string[]
      let eltern = ziel
      let pfad = ''
      try {
        for (const name of teile) {
          pfad += '/' + name
          let id = cache.get(pfad)
          if (id == null) {
            id = await ordnerHolen(name, eltern)
            cache.set(pfad, id)
          }
          eltern = id
        }
      } catch (e: any) {
        fehler(e.message)
        continue
      }
      gruppen.set(eltern, [...(gruppen.get(eltern) || []), d])
    }
    for (const [o, l] of gruppen) einreihen(l, o)
  }

  return { stand, einreihen, ausDrop, ausDateiliste }
}
