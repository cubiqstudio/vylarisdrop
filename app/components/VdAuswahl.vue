<script lang="ts">
import {
  Comment,
  Fragment,
  Static,
  Teleport,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  type SlotsType,
  type VNode
} from 'vue'
import Ico from './Ico.vue'

interface Eintrag {
  wert: any
  text: string
  klein: string
  aus: boolean
}

function textVon(c: unknown): string {
  if (typeof c === 'string') return c
  if (Array.isArray(c))
    return c.map((x) => (x && typeof x === 'object' ? textVon((x as VNode).children) : String(x ?? ''))).join('')
  return ''
}
const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }
const entschluesselt = (t: string) => t.replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => ENT[m]!)
function ausHtml(html: string, aus: Eintrag[]) {
  for (const m of html.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)) {
    const a = m[1] || ''
    const attr = (n: string) => new RegExp('\\b' + n + '="([^"]*)"').exec(a)?.[1]
    const text = entschluesselt(m[2]!.trim())
    const wert = attr('value')
    aus.push({
      wert: wert === undefined ? text : entschluesselt(wert),
      text,
      klein: entschluesselt(attr('data-klein') || ''),
      aus: /\bdisabled\b/.test(a)
    })
  }
}
function eintraege(knoten: unknown, aus: Eintrag[] = []): Eintrag[] {
  if (!Array.isArray(knoten)) return aus
  for (const k of knoten as VNode[]) {
    if (!k || typeof k !== 'object' || k.type === Comment) continue
    if (k.type === Fragment) {
      eintraege(k.children, aus)
      continue
    }
    if (k.type === Static) {
      ausHtml(String(k.children || ''), aus)
      continue
    }
    if (k.type !== 'option') continue
    const p: Record<string, any> = k.props || {}
    const text = textVon(k.children).trim()
    aus.push({
      wert: 'value' in p ? p.value : text,
      text,
      klein: String(p['data-klein'] ?? ''),
      aus: p.disabled != null && p.disabled !== false
    })
  }
  return aus
}
const gleich = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '')

export default defineComponent({
  name: 'VdAuswahl',
  props: {
    modelValue: { type: null, default: undefined },
    modelModifiers: { type: Object, default: () => ({}) },
    disabled: { type: Boolean, default: false },
    required: { type: Boolean, default: false }
  },
  emits: { 'update:modelValue': (_w: any) => true, change: (_w: any) => true },
  slots: Object as SlotsType<{ default: () => any }>,
  setup(props, { slots, emit, attrs }) {
    const id = useId()
    const auf = ref(false)
    const aktiv = ref(-1)
    const lage = ref<Record<string, string>>({})
    const knopf = ref<HTMLButtonElement | null>(null)
    const liste = ref<HTMLElement | null>(null)
    let aktuell: Eintrag[] = []
    let zuAm = 0
    let tipp = '',
      tippUhr: ReturnType<typeof setTimeout> | undefined
    const fehlt = ref(false)
    function absenden(e: Event) {
      if (!props.required || props.disabled || !knopf.value?.isConnected) return
      const g = aktuell.find((e) => gleich(e.wert, props.modelValue))
      if (g && !g.aus && String(g.wert ?? '') !== '') return
      e.preventDefault()
      e.stopImmediatePropagation()
      fehlt.value = true
      knopf.value.focus()
      oeffnen()
    }
    let formular: HTMLFormElement | null = null
    onMounted(() => {
      formular = knopf.value?.closest('form') || null
      formular?.addEventListener('submit', absenden, true)
    })

    function messen() {
      const b = knopf.value
      if (!b) return
      const r = b.getBoundingClientRect()
      const unten = innerHeight - r.bottom - 12,
        oben = r.top - 12
      const hoch = unten < 200 && oben > unten
      const breite = liste.value?.offsetWidth || r.width
      lage.value = {
        left: Math.max(8, Math.min(r.left, innerWidth - breite - 8)) + 'px',
        minWidth: Math.min(r.width, innerWidth - 16) + 'px',
        maxHeight: Math.max(120, Math.min(320, hoch ? oben : unten)) + 'px',
        ...(hoch ? { bottom: innerHeight - r.top + 4 + 'px' } : { top: r.bottom + 4 + 'px' })
      }
    }
    function zeigen() {
      nextTick(() => {
        const el = liste.value?.children[aktiv.value] as HTMLElement | undefined
        el?.scrollIntoView({ block: 'nearest' })
      })
    }
    function draussen(e: Event) {
      const z = e.target as Node
      if (knopf.value?.contains(z) || liste.value?.contains(z)) return
      zuAm = Date.now()
      schliessen()
    }
    function verschoben(e: Event) {
      if (!liste.value?.contains(e.target as Node)) messen()
    }
    function horchen(an: boolean) {
      const f = an ? 'addEventListener' : 'removeEventListener'
      document[f]('pointerdown', draussen, true)
      window[f]('scroll', verschoben, true)
      window[f]('resize', messen)
    }
    function oeffnen() {
      if (props.disabled || auf.value || Date.now() - zuAm < 200) return
      const i = aktuell.findIndex((e) => gleich(e.wert, props.modelValue) && !e.aus)
      aktiv.value = i >= 0 ? i : aktuell.findIndex((e) => !e.aus)
      messen()
      auf.value = true
      horchen(true)
      nextTick(() => {
        messen()
        zeigen()
      })
    }
    function schliessen() {
      if (!auf.value) return
      auf.value = false
      horchen(false)
    }
    function waehlen(e: Eintrag | undefined) {
      if (!e || e.aus) return
      const neu = !gleich(e.wert, props.modelValue)
      schliessen()
      knopf.value?.focus()
      fehlt.value = false
      if (neu) {
        emit('update:modelValue', e.wert)
        emit('change', e.wert)
      }
    }
    function schritt(von: number, um: number) {
      for (let i = von + um; i >= 0 && i < aktuell.length; i += um) {
        if (!aktuell[i]!.aus) {
          aktiv.value = i
          zeigen()
          return
        }
      }
    }
    function tippen(z: string) {
      clearTimeout(tippUhr)
      tipp += z.toLowerCase()
      tippUhr = setTimeout(() => {
        tipp = ''
      }, 700)
      const i = aktuell.findIndex((e) => !e.aus && e.text.toLowerCase().startsWith(tipp))
      if (i < 0) return
      if (auf.value) {
        aktiv.value = i
        zeigen()
      } else waehlen(aktuell[i])
    }
    function taste(e: KeyboardEvent) {
      if (e.key === 'Tab') {
        schliessen()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const wie = () => {
        e.preventDefault()
        e.stopPropagation()
      }
      if (!auf.value) {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
          wie()
          oeffnen()
        } else if (e.key.length === 1) {
          wie()
          tippen(e.key)
        }
        return
      }
      if (e.key === 'Escape') {
        wie()
        schliessen()
      } else if (e.key === 'ArrowDown') {
        wie()
        schritt(aktiv.value, 1)
      } else if (e.key === 'ArrowUp') {
        wie()
        schritt(aktiv.value, -1)
      } else if (e.key === 'Home') {
        wie()
        schritt(-1, 1)
      } else if (e.key === 'End') {
        wie()
        schritt(aktuell.length, -1)
      } else if (e.key === 'Enter' || e.key === ' ') {
        wie()
        waehlen(aktuell[aktiv.value])
      } else if (e.key.length === 1) {
        wie()
        tippen(e.key)
      }
    }
    onBeforeUnmount(() => {
      horchen(false)
      clearTimeout(tippUhr)
      formular?.removeEventListener('submit', absenden, true)
    })

    return () => {
      aktuell = eintraege(slots.default?.())
      const gewaehlt = aktuell.find((e) => gleich(e.wert, props.modelValue))
      const mono = String(attrs.class || '').includes('mono')
      return h(
        'button',
        {
          ref: knopf,
          type: 'button',
          class: ['vd-wahl', { fehlt: fehlt.value }],
          role: 'combobox',
          disabled: props.disabled,
          'aria-required': props.required || undefined,
          'aria-invalid': fehlt.value || undefined,
          'aria-haspopup': 'listbox',
          'aria-expanded': auf.value,
          'aria-controls': auf.value ? id : undefined,
          'aria-activedescendant': auf.value && aktiv.value >= 0 ? `${id}-${aktiv.value}` : undefined,
          onClick: () => {
            if (auf.value) schliessen()
            else oeffnen()
          },
          onKeydown: taste
        },
        [
          h('span', { class: ['vd-wahl-text', { leer: !gewaehlt || gewaehlt.aus }] }, gewaehlt?.text || '—'),
          h(Ico, { n: 'chevron', class: 'vd-wahl-pfeil' }),
          auf.value
            ? h(
                Teleport,
                { to: 'body' },
                h(
                  'ul',
                  {
                    ref: liste,
                    id,
                    role: 'listbox',
                    class: ['vd-wahl-liste', { mono }],
                    style: lage.value,
                    onMousedown: (e: Event) => e.preventDefault()
                  },
                  aktuell.map((e, i) =>
                    h(
                      'li',
                      {
                        id: `${id}-${i}`,
                        key: i,
                        role: 'option',
                        'aria-selected': gleich(e.wert, props.modelValue),
                        'aria-disabled': e.aus || undefined,
                        class: { aktiv: i === aktiv.value, an: gleich(e.wert, props.modelValue), aus: e.aus },
                        onPointermove: () => {
                          if (!e.aus) aktiv.value = i
                        },
                        onClick: () => waehlen(e)
                      },
                      [
                        h('span', { class: 'vd-wahl-zeile' }, [
                          h('span', e.text),
                          e.klein ? h('small', e.klein) : null
                        ]),
                        gleich(e.wert, props.modelValue) && !e.aus ? h(Ico, { n: 'check' }) : null
                      ]
                    )
                  )
                )
              )
            : null
        ]
      )
    }
  }
})
</script>
