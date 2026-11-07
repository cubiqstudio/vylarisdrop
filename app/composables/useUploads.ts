export interface UploadZeile {
  id: string
  name: string
  size: number
  teile: number
  fertig: number
  laeuft: number[]
  status: 'warte' | 'laeuft' | 'fertig' | 'fehler'
  fehler?: string
  link?: string
  serverId?: string
}
export interface UploadOpt {
  ordner?: number | null
  ablauf?: string | null
  maxAufrufe?: number | null
  passwort?: string
  stil?: string
  verschluesseln?: boolean
}

const PARALLEL = 3

export function useUploads() {
  const liste = useState<UploadZeile[]>('uploads', () => [])
  const neu = useState<number>('uploads-neu', () => 0)
  const { ok, fehler } = useToast()

  function aendern(id: string, patch: Partial<UploadZeile>) {
    liste.value = liste.value.map((z) => (z.id === id ? { ...z, ...patch } : z))
  }

  async function eineDatei(datei: File, opt: UploadOpt) {
    const id = Math.random().toString(36).slice(2)
    liste.value = [
      { id, name: datei.name || 'einfuegen.png', size: datei.size, teile: 1, fertig: 0, laeuft: [], status: 'warte' },
      ...liste.value
    ]
    try {
      const { verschluesseln: e2e, ...serverOpt } = opt
      const v = e2e ? await verschluesseln(datei) : null
      const quelle = v ? v.blob : { size: datei.size, slice: async (a: number, b: number) => datei.slice(a, b) }
      const s = await api('/api/upload/start', {
        method: 'POST',
        body: {
          name: datei.name || 'einfuegen.png',
          size: quelle.size,
          mime: v ? 'application/octet-stream' : datei.type,
          optionen: { ...serverOpt, ...(v ? { verschluesselt: true } : {}) }
        }
      })
      aendern(id, { teile: s.teile, status: 'laeuft', serverId: s.id })
      let naechstes = 0
      let fertig = 0
      const arbeiter = async () => {
        while (naechstes < s.teile) {
          const nr = naechstes++
          aendern(id, { laeuft: [...(liste.value.find((z) => z.id === id)?.laeuft || []), nr] })
          const stueck = await quelle.slice(nr * s.teilGroesse, Math.min(quelle.size, (nr + 1) * s.teilGroesse))
          for (let versuch = 1; ; versuch++) {
            try {
              await api(`/api/upload/${s.id}/${nr}`, {
                method: 'PUT',
                body: stueck,
                headers: { 'Content-Type': 'application/octet-stream' }
              })
              break
            } catch (e) {
              if (versuch >= 4) throw e
              await new Promise((r) => setTimeout(r, 600 * versuch))
            }
          }
          fertig++
          const z = liste.value.find((x) => x.id === id)
          aendern(id, { fertig, laeuft: (z?.laeuft || []).filter((x) => x !== nr) })
        }
      }
      await Promise.all(Array.from({ length: Math.min(PARALLEL, s.teile) }, arbeiter))
      const r = await api(`/api/upload/${s.id}/fertig`, { method: 'POST' })
      const link = v ? `${r.file.links.seite}#k=${v.schluessel}` : r.file.links.seite
      if (v) e2eMerken(r.file.slug, v.schluessel)
      aendern(id, { status: 'fertig', link })
      const kopiert = await kopieren(link)
      ok(
        kopiert
          ? t(`${datei.name || 'Datei'} hochgeladen — Link kopiert`, `${datei.name || 'File'} uploaded — link copied`)
          : t(`${datei.name || 'Datei'} hochgeladen`, `${datei.name || 'File'} uploaded`)
      )
      feiern(document.querySelector(`[data-upload="${id}"] .hl-status`), link)
      neu.value++
      setTimeout(() => {
        liste.value = liste.value.filter((z) => z.id !== id)
      }, 5000)
    } catch (e: any) {
      aendern(id, { status: 'fehler', fehler: e.message })
      fehler(`${datei.name}: ${e.message}`)
    }
  }

  function hochladen(dateien: FileList | File[], opt: UploadOpt = {}) {
    for (const d of Array.from(dateien)) void eineDatei(d, opt)
  }
  const wartend = useState<{ dateien: File[]; opt: UploadOpt } | null>('uploads-wartend', () => null)
  function vorbereiten(dateien: FileList | File[], opt: UploadOpt = {}) {
    const liste2 = Array.from(dateien)
    if (!liste2.length) return
    let direkt = false
    try {
      direkt = localStorage.getItem('vd_upload_direkt') === '1'
    } catch {}
    if (direkt) return hochladen(liste2, opt)
    wartend.value = { dateien: [...(wartend.value?.dateien || []), ...liste2], opt: { ...wartend.value?.opt, ...opt } }
  }
  function entfernen(id: string) {
    const z = liste.value.find((x) => x.id === id)
    if (z?.serverId && z.status !== 'fertig')
      void api(`/api/upload/${z.serverId}`, { method: 'DELETE' }).catch(() => {})
    liste.value = liste.value.filter((x) => x.id !== id)
  }
  return { liste, neu, hochladen, vorbereiten, wartend, entfernen }
}
