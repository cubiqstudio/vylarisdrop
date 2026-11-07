<script setup lang="ts">
// Dialog "Verschieben nach …" / "Kopieren nach …" mit Ordnerbaum
const props = defineProps<{ modus: 'verschieben' | 'kopieren'; items: any[]; start: number | null }>()
const emit = defineEmits<{ (e: 'zu'): void; (e: 'ok', ziel: number | null): void }>()

interface Knoten {
  id: number
  name: string
  parent_id: number | null
  team_id: number | null
  team: { name: string; farbe: string } | null
}
const alle = ref<Knoten[]>([])
const laedt = ref(true)
const fehlerText = ref('')
const offen = ref<Set<number>>(new Set())
const gewaehlt = ref<number | null | undefined>(undefined)
const laeuft = ref(false)

const kinderVon = computed(() => {
  const m = new Map<number | null, Knoten[]>()
  for (const o of alle.value) {
    const l = m.get(o.parent_id) || []
    l.push(o)
    m.set(o.parent_id, l)
  }
  const kol = new Intl.Collator(lang() === 'en' ? 'en' : 'de', { numeric: true, sensitivity: 'base' })
  for (const l of m.values()) l.sort((a, b) => kol.compare(a.name, b.name))
  return m
})
// Ordner, die nicht Ziel sein dürfen: die gewählten und alles darunter (nur beim Verschieben)
const gesperrt = computed(() => {
  const s = new Set<number>()
  if (props.modus !== 'verschieben') return s
  const rein = (id: number) => {
    s.add(id)
    for (const k of kinderVon.value.get(id) || []) rein(k.id)
  }
  for (const e of props.items) if (e.typ === 'ordner') rein(Number(e.id))
  return s
})

interface Zeile {
  id: number | null
  name: string
  tiefe: number
  hat: boolean
  gruppe?: boolean
  farbe?: string
  aus: boolean
}
const zeilen = computed<Zeile[]>(() => {
  const aus: Zeile[] = [{ id: null, name: t('Meine Dateien', 'My files'), tiefe: 0, hat: false, aus: false }]
  const rein = (o: Knoten, tiefe: number) => {
    const k = kinderVon.value.get(o.id) || []
    aus.push({ id: o.id, name: o.name, tiefe, hat: k.length > 0, aus: gesperrt.value.has(o.id), farbe: o.team?.farbe })
    if (offen.value.has(o.id)) for (const x of k) rein(x, tiefe + 1)
  }
  const wurzeln = kinderVon.value.get(null) || []
  for (const o of wurzeln.filter((x) => !x.team_id)) rein(o, 1)
  const team = wurzeln.filter((x) => x.team_id)
  if (team.length) {
    aus.push({ id: -1, name: t('Team-Ordner', 'Team folders'), tiefe: 0, hat: false, gruppe: true, aus: true })
    for (const o of team) rein(o, 1)
  }
  return aus
})

onMounted(async () => {
  try {
    const r = await api('/api/folders')
    alle.value = (r.ordner || []).map((o: any) => ({ id: o.id, name: o.name, parent_id: o.parent_id, team_id: o.team_id, team: o.team }))
    // Pfad zum aktuellen Ordner aufklappen
    const o = new Set<number>()
    let p = props.start
    const byId = new Map<number, Knoten>(alle.value.map((x) => [x.id, x]))
    while (p != null && byId.has(p)) {
      o.add(p)
      p = byId.get(p)!.parent_id
    }
    offen.value = o
  } catch (e: any) {
    fehlerText.value = e.message
  } finally {
    laedt.value = false
  }
})
function umschalten(id: number) {
  const s = new Set(offen.value)
  s.has(id) ? s.delete(id) : s.add(id)
  offen.value = s
}
function waehlen(z: Zeile) {
  if (z.aus || z.gruppe) return
  gewaehlt.value = z.id
}
function taste(e: KeyboardEvent, z: Zeile, i: number) {
  const rows = (e.currentTarget as HTMLElement).parentElement!.querySelectorAll<HTMLElement>('[role=treeitem]')
  if (e.key === 'ArrowDown') rows[i + 1]?.focus()
  else if (e.key === 'ArrowUp') rows[i - 1]?.focus()
  else if (e.key === 'ArrowRight' && z.id != null && z.hat && !offen.value.has(z.id)) umschalten(z.id)
  else if (e.key === 'ArrowLeft' && z.id != null && offen.value.has(z.id)) umschalten(z.id)
  else if (e.key === 'Enter' || e.key === ' ') {
    waehlen(z)
  } else return
  e.preventDefault()
}
async function los() {
  if (gewaehlt.value === undefined) return
  laeuft.value = true
  emit('ok', gewaehlt.value)
}
const titel = computed(() => {
  const n = props.items.length
  const was = n === 1 ? `„${props.items[0].name}“` : t(`${n} Elemente`, `${n} items`)
  return props.modus === 'verschieben' ? t(`${was} verschieben nach …`, `Move ${was} to …`) : t(`${was} kopieren nach …`, `Copy ${was} to …`)
})
</script>

<template>
  <VdModal :titel="titel" @zu="emit('zu')">
    <div v-if="laedt" class="mitte sehrleise"><Ico n="loader" spin /> {{ t('Lädt …', 'Loading …') }}</div>
    <p v-else-if="fehlerText" class="meldung meldung-fehler">{{ fehlerText }}</p>
    <div v-else class="baum" role="tree" :aria-label="t('Ordner', 'Folders')">
      <template v-for="(z, i) in zeilen" :key="z.id ?? 'wurzel'">
        <div v-if="z.gruppe" class="gruppe">{{ z.name }}</div>
        <div
          v-else
          role="treeitem"
          class="zeile"
          :class="{ an: gewaehlt === z.id, aus: z.aus, hier: z.id === start }"
          :style="{ paddingLeft: 8 + z.tiefe * 18 + 'px' }"
          :aria-level="z.tiefe + 1"
          :aria-selected="gewaehlt === z.id"
          :aria-expanded="z.hat ? offen.has(z.id as number) : undefined"
          :aria-disabled="z.aus || undefined"
          :tabindex="i === 0 ? 0 : -1"
          @click="waehlen(z)"
          @dblclick="z.id != null && z.hat && umschalten(z.id)"
          @keydown="taste($event, z, i)"
        >
          <button v-if="z.hat" type="button" class="auf" tabindex="-1" :aria-label="t('Aufklappen', 'Expand')" @click.stop="umschalten(z.id as number)">
            <Ico n="chevron" :style="{ transform: offen.has(z.id as number) ? 'none' : 'rotate(-90deg)' }" />
          </button>
          <span v-else class="auf leer"></span>
          <Ico :n="z.id == null ? 'cloud' : 'folder'" class="fi" :style="z.farbe ? { color: z.farbe } : undefined" />
          <span class="name">{{ z.name }}</span>
          <small v-if="z.id === start" class="sehrleise">{{ t('hier', 'here') }}</small>
        </div>
      </template>
    </div>
    <div class="modal-fuss">
      <button type="button" class="knopf" @click="emit('zu')">{{ t('Abbrechen', 'Cancel') }}</button>
      <button type="button" class="knopf rot" :disabled="gewaehlt === undefined || laeuft" @click="los">
        <Ico v-if="laeuft" n="loader" spin />
        {{ modus === 'verschieben' ? t('Hierher verschieben', 'Move here') : t('Hierher kopieren', 'Copy here') }}
      </button>
    </div>
  </VdModal>
</template>

<style scoped>
.baum {
  max-height: min(52vh, 420px);
  overflow-y: auto;
  border: 1px solid var(--linie);
  border-radius: 12px;
  padding: 6px;
  background: var(--bg);
}
.mitte {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  padding: 30px;
}
.gruppe {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text3);
  padding: 12px 10px 4px;
}
.zeile {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding-right: 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13.5px;
}
.zeile:hover {
  background: var(--flaeche2);
}
.zeile.an {
  background: rgba(var(--a-rgb), 0.14);
  box-shadow: inset 0 0 0 1px rgba(var(--a-rgb), 0.45);
}
.zeile.aus {
  opacity: 0.4;
  cursor: not-allowed;
}
.auf {
  width: 22px;
  height: 22px;
  border: 0;
  background: transparent;
  border-radius: 6px;
  display: grid;
  place-items: center;
  cursor: pointer;
  color: var(--text2);
  flex-shrink: 0;
}
.auf:hover {
  background: var(--linie);
}
.auf svg {
  width: 13px;
  height: 13px;
  transition: transform 0.15s;
}
.fi {
  width: 17px;
  height: 17px;
  color: var(--a);
  flex-shrink: 0;
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
