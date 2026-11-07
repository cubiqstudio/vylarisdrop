// PostCSS-Plugin: verpackt jede Regel mit :hover in @media (hover: hover).
// Auf Touch-Geräten (Handy, Android-WebView) bleibt so nichts nach dem Antippen "hängen" (kleben bleibende Hover-Farben,
// Aktionen, die nur beim Überfahren erscheinen); Maus und Trackpad sehen unverändert dasselbe wie bisher.
// Selektorlisten werden aufgeteilt, die Reihenfolge im Stylesheet bleibt erhalten (Kopie direkt hinter der Regel).
const MARKE = Symbol('vd-hover')

const plugin = () => ({
  postcssPlugin: 'vd-hover-nur-maus',
  Rule(rule, { AtRule }) {
    if (rule[MARKE] || !rule.selector.includes(':hover')) return
    for (let p = rule.parent; p && p.type !== 'root'; p = p.parent) {
      if (p.type !== 'atrule') continue
      if (/keyframes$/i.test(p.name)) return
      if (p.name === 'media' && /hover\s*:\s*hover/i.test(p.params)) return
    }
    const mitHover = []
    const ohne = []
    for (const s of rule.selectors) (s.includes(':hover') ? mitHover : ohne).push(s)
    const huelle = new AtRule({ name: 'media', params: '(hover: hover)' })
    const kopie = rule.clone({ selectors: mitHover })
    kopie[MARKE] = true
    huelle.append(kopie)
    rule.after(huelle)
    if (ohne.length) rule.selectors = ohne
    else rule.remove()
  }
})
plugin.postcss = true
export default plugin
