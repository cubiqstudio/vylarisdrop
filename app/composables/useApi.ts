export async function api(url: string, opts: Record<string, any> = {}): Promise<any> {
  try {
    return await ($fetch as any)(url, opts)
  } catch (e: any) {
    const text =
      e?.data?.message ||
      (e?.statusCode === 429
        ? t('Zu viele Anfragen — bitte kurz warten.', 'Too many requests — please wait a moment.')
        : t('Verbindung fehlgeschlagen. Bitte versuche es erneut.', 'Connection failed. Please try again.'))
    throw Object.assign(new Error(text), { status: e?.statusCode || e?.status || 0 })
  }
}

export interface Toast {
  id: number
  text: string
  art: 'ok' | 'fehler'
}
export function useToast() {
  const toasts = useState<Toast[]>('toasts', () => [])
  function zeige(text: string, art: 'ok' | 'fehler' = 'ok') {
    const id = Date.now() + Math.random()
    toasts.value = [...toasts.value, { id, text, art }]
    setTimeout(
      () => {
        toasts.value = toasts.value.filter((x) => x.id !== id)
      },
      art === 'fehler' ? 6000 : 3400
    )
  }
  return { toasts, ok: (s: string) => zeige(s, 'ok'), fehler: (s: string) => zeige(s, 'fehler') }
}

export type ThemaArt = 'dark' | 'light' | 'system'
export interface Marke {
  weiss: boolean
  logo: string
  icon: string
  nurLogo: boolean
  hinweis: boolean
  loginText: string
  fusszeile: string
}
export interface Theme {
  setup: boolean
  color: string
  name: string
  lang: 'de' | 'en'
  user: null | { id: number; username: string; role: 'owner' | 'admin' | 'user'; theme: ThemaArt }
  proxy?: any
  pro?: boolean
  marke?: Marke
  sso?: { anbieter: Array<{ id: string; name: string; art: string }>; passwortAus: boolean }
}
export const useTheme = () =>
  useState<Theme>('theme', () => ({ setup: false, color: '#1e73be', name: 'VylarisCloud', lang: 'de', user: null }))
export const useBesucherThema = () =>
  useCookie<ThemaArt>('vd_thema', { default: () => 'system', maxAge: 365 * 86400, sameSite: 'lax' })

export const sprache = ref<'de' | 'en'>('de')
export const lang = (): 'de' | 'en' => sprache.value
export const t = (de: string, en: string): string => (lang() === 'en' ? en : de)
export const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')

export async function kopieren(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

const loc = () => (lang() === 'en' ? 'en-GB' : 'de-DE')
export const zahl = (n: number, nk = 0) =>
  Number(n || 0).toLocaleString(loc(), { minimumFractionDigits: nk, maximumFractionDigits: nk })
export function groesse(b: number): string {
  const n = Number(b || 0)
  if (n < 1024) return `${n} B`
  const e = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024,
    i = 0
  while (v >= 1024 && i < e.length - 1) {
    v /= 1024
    i++
  }
  return `${zahl(v, v < 10 ? 1 : 0)} ${e[i]}`
}
export const datum = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString(loc(), { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
export const zeitpunkt = (d: string | null | undefined) =>
  d
    ? new Date(d).toLocaleString(loc(), {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : '—'
export function vorher(d: string): string {
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return t('gerade eben', 'just now')
  if (s < 3600) return t(`vor ${Math.floor(s / 60)} Min.`, `${Math.floor(s / 60)} min ago`)
  if (s < 86400) return t(`vor ${Math.floor(s / 3600)} Std.`, `${Math.floor(s / 3600)} h ago`)
  if (s < 7 * 86400) return t(`vor ${Math.floor(s / 86400)} T.`, `${Math.floor(s / 86400)} d ago`)
  return datum(d)
}
export function restzeit(d: string): string {
  const s = (new Date(d).getTime() - Date.now()) / 1000
  if (s <= 0) return t('abgelaufen', 'expired')
  if (s < 3600) return t(`noch ${Math.ceil(s / 60)} Min.`, `${Math.ceil(s / 60)} min left`)
  if (s < 86400) return t(`noch ${Math.ceil(s / 3600)} Std.`, `${Math.ceil(s / 3600)} h left`)
  return t(`noch ${Math.ceil(s / 86400)} Tage`, `${Math.ceil(s / 86400)} days left`)
}
export const dauer = (ms: number | null | undefined) => {
  if (!ms) return ''
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const ruhig = () => import.meta.client && matchMedia('(prefers-reduced-motion: reduce)').matches

export function themaWechseln(neu: ThemaArt, e?: MouseEvent, setzen?: () => void) {
  const anwenden = () => {
    document.documentElement.dataset.theme = neu
    setzen?.()
  }
  const d = document as any
  if (!d.startViewTransition || ruhig() || !e) return anwenden()
  const x = e.clientX,
    y = e.clientY,
    r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  d.startViewTransition(anwenden).ready.then(() =>
    document.documentElement.animate(
      { clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 650, easing: 'cubic-bezier(.4,0,.2,1)', pseudoElement: '::view-transition-new(root)' }
    )
  )
}

export function feiern(quelle: Element | null, link: string) {
  if (!quelle || ruhig()) return
  const r = quelle.getBoundingClientRect(),
    x0 = r.left + r.width / 2,
    y0 = r.top + r.height / 2
  for (let i = 0; i < 22; i++) {
    const tr = document.createElement('i')
    tr.className = 'spritzer'
    document.body.append(tr)
    const w = Math.random() * Math.PI + Math.PI,
      v = 90 + Math.random() * 170,
      dx = Math.cos(w) * v,
      dy = Math.sin(w) * v
    tr.animate(
      [
        { transform: `translate(${x0}px,${y0}px) scale(1)`, opacity: 1 },
        { transform: `translate(${x0 + dx}px,${y0 + dy}px) scale(.9)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${x0 + dx * 1.15}px,${y0 + dy + 140}px) scale(.3)`, opacity: 0 }
      ],
      { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.4,1)' }
    ).onfinish = () => tr.remove()
  }
  const f = document.createElement('span')
  f.className = 'flieger'
  f.textContent = link.replace(/^https?:\/\//, '')
  document.body.append(f)
  f.animate(
    [
      { transform: `translate(${x0 - 60}px,${y0 - 14}px) scale(.6)`, opacity: 0 },
      { transform: `translate(${x0 - 80}px,${y0 - 60}px) scale(1)`, opacity: 1, offset: 0.25 },
      { transform: `translate(${innerWidth - 300}px,${innerHeight - 60}px) scale(.85)`, opacity: 0.2 }
    ],
    { duration: 1200, easing: 'cubic-bezier(.6,0,.3,1)' }
  ).onfinish = () => f.remove()
}

export function useHochzaehlen(ziel: () => number, ms = 1300) {
  // Beim Hydratisieren muss der Startwert dem vom Server gerenderten Text entsprechen (sonst Hydration-Fehler);
  // beim Seitenwechsel im Browser zählt der Zähler wie gewohnt von 0 hoch.
  const wert = ref(import.meta.client && !useNuxtApp().isHydrating ? 0 : ziel())
  // Nur ein Lauf gleichzeitig: kommt (z. B. durch Live-Aktualisierung) ein neues Ziel, läuft der Zähler sanft von der
  // aktuellen Anzeige dorthin, ohne dass ein alter Lauf dazwischenfunkt
  let lauf = 0
  const los = (z: number) => {
    const mein = ++lauf
    if (!import.meta.client || ruhig()) {
      wert.value = z
      return
    }
    const start = wert.value,
      t0 = performance.now()
    if (start === z) return
    // Kleine Änderungen sind kürzer unterwegs als der Einstiegs-Zähler von 0
    const dauer = start === 0 ? ms : Math.min(ms, 600)
    const f = (n: number) => {
      if (mein !== lauf) return
      const p = Math.min(1, (n - t0) / dauer)
      wert.value = start + (z - start) * (1 - Math.pow(1 - p, 4))
      if (p < 1) requestAnimationFrame(f)
    }
    requestAnimationFrame(f)
  }
  watch(ziel, los, { immediate: true })
  return wert
}
