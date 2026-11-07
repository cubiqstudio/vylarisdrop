<script setup lang="ts">
useHead({ title: () => t('Ordner', 'Folders') })
const { ok, fehler } = useToast()
const bestaetigen = useBestaetigen()
const { data, refresh } = await (useFetch as any)('/api/folders', { key: 'ordner' })
const ordner = computed<any[]>(() => data.value?.ordner || [])
const teams = computed<any[]>(() => data.value?.teams || [])
const leitung = computed(() => teams.value.filter((x) => x.rolle === 'leitung'))
const baum = computed(() => {
  const aus: Array<any & { tiefe: number }> = []
  const kinder = (p: number | null, tiefe: number) => {
    for (const o of ordner.value.filter((x) => x.parent_id === p)) {
      aus.push({ ...o, tiefe })
      kinder(o.id, tiefe + 1)
    }
  }
  kinder(null, 0)
  return aus
})
const neu = reactive({ name: '', parent: null as number | null, team: null as number | null })
async function anlegen() {
  if (!neu.name.trim()) return
  try {
    await api('/api/folders', {
      method: 'POST',
      body: { name: neu.name, parent_id: neu.parent, ...(neu.parent == null && neu.team ? { team_id: neu.team } : {}) }
    })
    neu.name = ''
    await refresh()
    ok(t('Ordner angelegt', 'Folder created'))
  } catch (e: any) {
    fehler(e.message)
  }
}
const bearbeiten = ref<any>(null)
async function speichern() {
  const b = bearbeiten.value
  const body: Record<string, any> = { name: b.name, parent_id: b.parent_id }
  if (b.parent_id == null && b.team_id !== b.teamVorher) body.team_id = b.team_id
  try {
    await api(`/api/folders/${b.id}`, { method: 'PATCH', body })
    bearbeiten.value = null
    await refresh()
    ok(t('Gespeichert', 'Saved'))
  } catch (e: any) {
    fehler(e.message)
  }
}
const gal = ref<any>(null)
function galerieOeffnen(o: any) {
  gal.value = {
    id: o.id,
    name: o.name,
    an: !!o.galerie_token,
    token: o.galerie_token,
    titel: o.galerie?.titel || '',
    text: o.galerie?.text || '',
    download: o.galerie?.download !== false,
    sortierung: o.galerie?.sortierung || 'neu'
  }
}
const galLink = computed(() =>
  gal.value?.token && import.meta.client ? `${location.origin}/g/${gal.value.token}` : ''
)
async function galerieSpeichern(an?: boolean) {
  const g = gal.value
  if (an !== undefined) g.an = an
  try {
    const r = await api(`/api/folders/${g.id}`, {
      method: 'PATCH',
      body: { galerie: { an: g.an, titel: g.titel, text: g.text, download: g.download, sortierung: g.sortierung } }
    })
    g.token = r.galerie?.token || null
    await refresh()
    ok(g.an ? t('Galerie ist öffentlich', 'Gallery is public') : t('Galerie ist privat', 'Gallery is private'))
  } catch (e: any) {
    fehler(e.message)
  }
}
const galKopiert = ref(false)
async function galKopieren() {
  if (await kopieren(galLink.value)) {
    galKopiert.value = true
    setTimeout(() => {
      galKopiert.value = false
    }, 1500)
  }
}
function loeschen(o: any) {
  bestaetigen(
    t('Ordner löschen?', 'Delete folder?'),
    t(
      `„${o.name}“ und seine Unterordner werden gelöscht. Die Dateien darin bleiben erhalten (ohne Ordner).`,
      `“${o.name}” and its subfolders will be deleted. The files inside are kept (without a folder).`
    ),
    t('Löschen', 'Delete'),
    async () => {
      try {
        await api(`/api/folders/${o.id}`, { method: 'DELETE' })
        await refresh()
        ok(t('Gelöscht', 'Deleted'))
      } catch (e: any) {
        fehler(e.message)
      }
    }
  )
}
</script>

<template>
  <section class="rein">
    <div class="kopf"><div><div class="eyebrow"><Ico n="folder" /> {{ t('Bibliothek', 'Library') }}</div><h1>{{ t('Ordner', 'Folders') }}</h1><p>{{ t('Sortiere Dateien in Ordner — auch verschachtelt. Beim Hochladen in einem Ordner landen neue Dateien direkt dort.', 'Sort files into folders — nesting allowed. Uploading while inside a folder puts new files there.') }}</p></div></div>
    <form class="block reihe neu" @submit.prevent="anlegen">
      <input v-model="neu.name" class="eingabe" style="flex:1;min-width:200px" :placeholder="t('Neuer Ordner …', 'New folder …')" maxlength="80">
      <VdAuswahl v-model="neu.parent" class="eingabe" style="width:auto"><option :value="null">{{ t('Oberste Ebene', 'Top level') }}</option><option v-for="o in baum" :key="o.id" :value="o.id">{{ '— '.repeat(o.tiefe) }}{{ o.name }}</option></VdAuswahl>
      <VdAuswahl v-if="leitung.length && neu.parent == null" v-model="neu.team" class="eingabe" style="width:auto" :aria-label="t('Für', 'For')"><option :value="null">{{ t('Nur für mich', 'Just for me') }}</option><option v-for="tm in leitung" :key="tm.id" :value="tm.id">{{ t('Team', 'Team') }} {{ tm.name }}</option></VdAuswahl>
      <button class="knopf rot" :disabled="!neu.name.trim()"><Ico n="plus" /> {{ t('Anlegen', 'Create') }}</button>
    </form>
    <div v-if="baum.length" class="liste">
      <div v-for="(o, i) in baum" :key="o.id" class="zeile" :style="{ '--tiefe': o.tiefe, animationDelay: Math.min(i, 15) * 35 + 'ms' }">
        <NuxtLink :to="{ path: '/drop', query: { ordner: o.id } }" class="ziel" :style="o.team ? { '--tf': o.team.farbe } : {}"><span :class="['ic', { team: o.team }]"><Ico :n="o.team ? 'users' : 'folder'" /></span><b>{{ o.name }}</b>
          <span v-if="o.team && o.tiefe === 0" class="team-chip">{{ o.team.name }}</span><span v-if="!o.eigen" class="sehrleise klein">{{ t('geteilt', 'shared') }}</span>
          <span class="sehrleise anzahl">{{ zahl(o.anzahl) }} {{ o.anzahl === 1 ? t('Datei', 'file') : t('Dateien', 'files') }}</span></NuxtLink>
        <template v-if="o.verwalten">
          <button :class="['knopf nur-icon', { galerie: o.galerie_token }]" :aria-label="t('Galerie', 'Gallery')" :title="o.galerie_token ? t('Galerie ist öffentlich', 'Gallery is public') : t('Als Galerie teilen', 'Share as gallery')" @click="galerieOeffnen(o)"><Ico n="image" /></button>
          <button class="knopf nur-icon" :aria-label="t('Bearbeiten', 'Edit')" @click="bearbeiten = { ...o, teamVorher: o.team_id }"><Ico n="edit" /></button>
          <button class="knopf nur-icon" :aria-label="t('Löschen', 'Delete')" @click="loeschen(o)"><Ico n="trash" /></button>
        </template>
      </div>
    </div>
    <div v-else class="leer-hinweis block"><h3>{{ t('Noch keine Ordner', 'No folders yet') }}</h3><p>{{ t('Leg oben deinen ersten an.', 'Create your first one above.') }}</p></div>

    <VdModal v-if="gal" :titel="t(`Galerie: ${gal.name}`, `Gallery: ${gal.name}`)" @zu="gal = null">
      <label class="opt"><button type="button" :class="['schalter', { an: gal.an }]" role="switch" :aria-checked="gal.an" @click="galerieSpeichern(!gal.an)"></button><span><b>{{ t('Öffentlich als Galerie', 'Public as a gallery') }}</b><small>{{ t('Jeder mit dem Link sieht die Bilder, Videos und Dateien dieses Ordners samt Unterordnern — ohne passwortgeschützte und verschlüsselte.', 'Anyone with the link sees the images, videos and files of this folder and its subfolders — except password-protected and encrypted ones.') }}</small></span></label>
      <Transition name="aufklappen">
        <div v-if="gal.an && gal.token">
          <div class="gal-link"><code class="mono">{{ galLink }}</code><button type="button" class="knopf nur-icon" :aria-label="t('Kopieren', 'Copy')" @click="galKopieren"><Ico :n="galKopiert ? 'check' : 'copy'" /></button><a :href="galLink" target="_blank" rel="noopener" class="knopf nur-icon" :aria-label="t('Öffnen', 'Open')"><Ico n="external" /></a></div>
          <label class="feld"><span>{{ t('Titel', 'Title') }}</span><input v-model="gal.titel" class="eingabe" maxlength="120" :placeholder="gal.name"></label>
          <label class="feld"><span>{{ t('Text (optional)', 'Text (optional)') }}</span><textarea v-model="gal.text" class="eingabe" rows="2" maxlength="1000"></textarea></label>
          <div class="zwei">
            <label class="feld"><span>{{ t('Reihenfolge', 'Order') }}</span><VdAuswahl v-model="gal.sortierung" class="eingabe"><option value="neu">{{ t('Neueste zuerst', 'Newest first') }}</option><option value="alt">{{ t('Älteste zuerst', 'Oldest first') }}</option><option value="name">{{ t('Nach Name', 'By name') }}</option></VdAuswahl></label>
            <label class="opt mitte"><button type="button" :class="['schalter', { an: gal.download }]" role="switch" :aria-checked="gal.download" @click="gal.download = !gal.download"></button><span><b>{{ t('Alles als ZIP', 'Everything as ZIP') }}</b></span></label>
          </div>
          <div class="modal-fuss"><button type="button" class="knopf rot" @click="galerieSpeichern()">{{ t('Speichern', 'Save') }}</button></div>
        </div>
      </Transition>
    </VdModal>
    <VdModal v-if="bearbeiten" :titel="t('Ordner bearbeiten', 'Edit folder')" @zu="bearbeiten = null">
      <form @submit.prevent="speichern">
        <label class="feld"><span>{{ t('Name', 'Name') }}</span><input v-model="bearbeiten.name" class="eingabe" maxlength="80" required></label>
        <label class="feld"><span>{{ t('Liegt in', 'Inside') }}</span>
          <VdAuswahl v-model="bearbeiten.parent_id" class="eingabe"><option :value="null">{{ t('Oberste Ebene', 'Top level') }}</option><option v-for="o in baum.filter(x => x.id !== bearbeiten.id)" :key="o.id" :value="o.id">{{ '— '.repeat(o.tiefe) }}{{ o.name }}</option></VdAuswahl></label>
        <label v-if="teams.length && bearbeiten.parent_id == null" class="feld"><span>{{ t('Geteilt mit', 'Shared with') }}</span>
          <VdAuswahl v-model="bearbeiten.team_id" class="eingabe"><option :value="null">{{ t('Niemandem (privat)', 'Nobody (private)') }}</option><option v-for="tm in teams" :key="tm.id" :value="tm.id">{{ t('Team', 'Team') }} {{ tm.name }}</option></VdAuswahl>
          <small>{{ t('Alle Mitglieder sehen die Dateien und laden hinein; die Team-Leitung darf alle verwalten. Unterordner ziehen mit.', 'All members see the files and upload into it; team leads may manage all of them. Subfolders move along.') }}</small></label>
        <div class="modal-fuss"><button type="button" class="knopf" @click="bearbeiten = null">{{ t('Abbrechen', 'Cancel') }}</button><button class="knopf rot">{{ t('Speichern', 'Save') }}</button></div>
      </form>
    </VdModal>
  </section>
</template>

<style scoped>
.neu {
  margin-bottom: 16px;
}
.liste {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.zeile {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--flaeche);
  border: 1px solid var(--linie);
  border-radius: 12px;
  padding: 8px 8px 8px calc(12px + var(--tiefe) * 26px);
  animation: rein 0.45s var(--kurve) backwards;
  transition: border-color 0.2s;
}
.zeile:hover {
  border-color: var(--linie2);
}
.ziel {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.ziel b {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ziel .anzahl {
  margin-left: auto;
  font-size: 12px;
  white-space: nowrap;
}
.klein {
  font-size: 11.5px;
}
.knopf.galerie {
  color: var(--a);
  background: rgba(var(--a-rgb), 0.12);
}
.opt {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 14px;
  cursor: pointer;
}
.opt.mitte {
  align-items: center;
  margin-top: 18px;
}
.opt small {
  display: block;
  color: var(--text3);
  font-size: 12px;
}
.gal-link {
  display: flex;
  gap: 6px;
  align-items: center;
  background: var(--bg);
  border: 1px solid var(--linie);
  border-radius: 10px;
  padding: 5px 5px 5px 12px;
  margin-bottom: 14px;
}
.gal-link code {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zwei {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 12px;
}
.aufklappen-enter-active,
.aufklappen-leave-active {
  transition:
    opacity 0.25s,
    transform 0.3s var(--kurve);
}
.aufklappen-enter-from,
.aufklappen-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
.team-chip {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 99px;
  background: color-mix(in srgb, var(--tf) 16%, transparent);
  color: color-mix(in srgb, var(--tf) 75%, var(--text));
  white-space: nowrap;
}
.ic.team {
  background: color-mix(in srgb, var(--tf) 14%, transparent);
  color: var(--tf);
}
.ic {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: rgba(var(--a-rgb), 0.1);
  color: var(--a);
  display: grid;
  place-items: center;
  transition: transform 0.3s var(--kurve);
}
.ic svg {
  width: 16px;
  height: 16px;
}
.zeile:hover .ic {
  transform: rotate(-6deg) scale(1.06);
}
</style>
