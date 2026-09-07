<script setup lang="ts">
import { computed, inject, nextTick, provide, ref, watch } from 'vue'
import { COMMENTS, SELECT_FIELD } from '../utils/injection'
import { GRID, type GridContext } from '../utils/gridContext'
import type { FieldDoc, JsonValue } from '../types'
import { effectiveFieldName, isRefField, resolveRef, type RefIndex } from '../utils/references'
import type { SearchIndex } from '../utils/search'
import { ancestorsOf, autoOpenPaths, filterOpenable, gridShape, summaryOf } from '../utils/grid'
import GridTable from './GridTable.vue'

/**
 * Grid gorunumunun kabugu: durumu tutar, ozyinelemeli tablolara inject ile
 * verir. Cizim isinin tamami `GridTable`de.
 *
 * Eskiden burada duz bir satir listesi ve sanallastirici vardi; ic ice tablo
 * modelinde her tablo kendi penceresini yonetiyor (varsayilan 200 satir),
 * acilan dallar butceli oldugu icin DOM kontrol altinda kaliyor.
 */
const props = defineProps<{
  data: JsonValue
  rootKey: string
  searchTerm?: string
  docLookup?: (nodePath: string) => FieldDoc | undefined
  filterMatches?: boolean
  refIndex?: RefIndex
  /** Arama sonuclari; eslesmelere giden dallar bununla kendiliginden acilir. */
  search?: SearchIndex
  focusRequest?: { path: string; seq: number } | null
  selectedPath?: string | null
  /** Sunucudan alan aciklamalari geldi mi; gelmediyse sema isaretleri gizlenir. */
  schemaKnown?: boolean
}>()

const emit = defineEmits<{
  focusPath: [path: string]
  stats: [value: { rows: number; tables: number }]
}>()

const selectField = inject(SELECT_FIELD, null)
const comments = inject(COMMENTS, null)

/** Bir tabloda ilk cizilen satir sayisi; "daha fazla göster" bunu buyutur. */
const ROW_PAGE = 200
/** "Tümünü aç"in acabilecegi en fazla tablo; ic ice tablolar gercek DOM uretiyor. */
const EXPAND_BUDGET = 800

const expanded = ref(new Set<string>())
const windows = ref(new Map<string, number>())
const detailPath = ref<string | null>(null)
const refPath = ref<string | null>(null)
const expandNote = ref<string | null>(null)

/**
 * Arama icin acilan dallar ayri tutuluyor: terim silinince yalnizca onlar
 * kapanir, kullanicinin elle actigi dallar yerinde kalir.
 */
const searchOpened = ref(new Set<string>())
const userOpened = ref(new Set<string>())

/** Cizilen satir/tablo sayaci degistiginde durum cubugunu tazelemek icin. */
const version = ref(0)
function touch() { version.value++ }

function reset() {
  expanded.value = autoOpenPaths(props.data, props.rootKey)
  windows.value = new Map()
  detailPath.value = null
  refPath.value = null
  searchOpened.value = new Set()
  userOpened.value = new Set()
  expandNote.value = null
  touch()
}

watch(() => props.data, reset, { immediate: true })

// Arama eslesmeleri kapali bir dalin icinde kalabilir; eslesmelere giden atalar
// kendiliginden acilir (agac gorunumu de boyle davranir).
watch(() => props.search, (search) => {
  if (!search || search.visible.size === 0) {
    if (searchOpened.value.size === 0) return
    const next = new Set(expanded.value)
    for (const path of searchOpened.value) {
      if (!userOpened.value.has(path)) next.delete(path)
    }
    searchOpened.value = new Set()
    expanded.value = next
    touch()
    return
  }
  const openable = filterOpenable(props.data, props.rootKey, search.visible)
  const next = new Set(expanded.value)
  const opened = new Set(searchOpened.value)
  for (const path of openable) {
    if (!next.has(path)) opened.add(path)
    next.add(path)
  }
  searchOpened.value = opened
  expanded.value = next
  touch()
}, { immediate: true })

const commentsAvailable = computed(() => comments?.available.value === true)
const rootShape = computed(() => gridShape(props.data))
const rootSummary = computed(() => summaryOf(props.data))

// --- Inject edilen baglam ----------------------------------------------------

function toggle(path: string) {
  const next = new Set(expanded.value)
  const marks = new Set(userOpened.value)
  if (next.has(path)) {
    next.delete(path)
    marks.delete(path)
  } else {
    next.add(path)
    marks.add(path)
  }
  expanded.value = next
  userOpened.value = marks
  touch()
}

function openPath(path: string) {
  const next = new Set(expanded.value)
  const marks = new Set(userOpened.value)
  for (const ancestor of filterOpenable(props.data, props.rootKey, ancestorsOf(path, props.rootKey))) {
    next.add(ancestor)
    marks.add(ancestor)
  }
  expanded.value = next
  userOpened.value = marks
  growWindowsFor(path)
  touch()
}

/**
 * Hedef satir tablonun penceresinin otesinde olabilir (900. siparis, ilk 200
 * satir cizilmisken). Odaklanan yol uzerindeki her dizi icin pencere hedefi
 * kapsayacak kadar buyutuluyor; yoksa arama "eslesmeye gittim" der ama satir
 * ekranda olmaz.
 */
function growWindowsFor(path: string) {
  const segments = path.split('.')
  const next = new Map(windows.value)
  let changed = false
  for (let i = 1; i < segments.length; i++) {
    if (!/^\d+$/.test(segments[i])) continue
    const parent = segments.slice(0, i).join('.')
    const index = Number(segments[i])
    if (index >= (next.get(parent) ?? ROW_PAGE)) {
      next.set(parent, index + ROW_PAGE)
      changed = true
    }
  }
  if (changed) windows.value = next
}

const context: GridContext = {
  rootKey: props.rootKey,
  searchTerm: computed(() => props.searchTerm ?? ''),
  filterMatches: computed(() => props.filterMatches === true),
  selectedPath: computed(() => props.selectedPath ?? null),
  schemaKnown: computed(() => props.schemaKnown === true),
  isOpen: (path: string) => expanded.value.has(path),
  toggle,
  open: openPath,
  select: (path: string) => { selectField?.(path) },
  focusPath: (path: string) => emit('focusPath', path),
  docFor: (path: string) => props.docLookup?.(path),
  refFor: (path: string, value: JsonValue) => {
    if (!props.refIndex) return undefined
    const field = effectiveFieldName(path)
    if (!isRefField(field)) return undefined
    return resolveRef(props.refIndex, field, value, path.slice(0, path.lastIndexOf('.')))
  },
  detailPath: computed(() => detailPath.value),
  toggleDetail: (path: string) => {
    detailPath.value = detailPath.value === path ? null : path
    touch()
  },
  refPath: computed(() => refPath.value),
  toggleRef: (path: string) => {
    refPath.value = refPath.value === path ? null : path
    touch()
  },
  comments,
  commentsAvailable,
  windowOf: (path: string) => windows.value.get(path) ?? ROW_PAGE,
  grow: (path: string) => {
    const next = new Map(windows.value)
    next.set(path, (next.get(path) ?? ROW_PAGE) + ROW_PAGE * 5)
    windows.value = next
    touch()
  },
  touch,
}

provide(GRID, context)

// --- Basliktaki dugmeler -----------------------------------------------------

function expandAll() {
  const all = autoOpenPaths(props.data, props.rootKey, { maxDepth: 99, budget: EXPAND_BUDGET })
  // Elle acilmis sayilir: aramanin bitmesi "tümünü aç"i geri almamali.
  userOpened.value = new Set(all)
  expanded.value = all
  expandNote.value = all.size >= EXPAND_BUDGET
    ? `${EXPAND_BUDGET} tabloda durdu — daha derini hücreye tıklayarak açın`
    : null
  touch()
}

function collapseAll() {
  expanded.value = new Set()
  windows.value = new Map()
  detailPath.value = null
  refPath.value = null
  searchOpened.value = new Set()
  userOpened.value = new Set()
  expandNote.value = null
  touch()
}

// --- Sayim, odak ve klavye ---------------------------------------------------

const scrollEl = ref<HTMLElement | null>(null)

function rowElements(): HTMLElement[] {
  const root = scrollEl.value
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>('[data-row-path]'))
}

// Sayim DOM'dan okunuyor: acik yol kumesi kapali bir dalin icindeki dallari da
// tasiyor, kullaniciya "acik" diye gosterilen sey ise gercekten cizilenler.
watch([version, () => props.searchTerm, () => props.filterMatches], async () => {
  await nextTick()
  const root = scrollEl.value
  emit('stats', {
    rows: rowElements().length,
    tables: root ? root.querySelectorAll('.gt-table').length : 0,
  })
}, { immediate: true })

/** Yola en yakin cizilmis satir; kayit satirlarinda hedef alan kolon olarak durur. */
function findRow(path: string): HTMLElement | null {
  const elements = rowElements()
  let probe = path
  while (probe.includes('.')) {
    const hit = elements.find(element => element.dataset.rowPath === probe)
    if (hit) return hit
    probe = probe.slice(0, probe.lastIndexOf('.'))
  }
  return null
}

watch(() => props.focusRequest, async (request) => {
  if (!request) return
  openPath(request.path)
  selectField?.(request.path)
  // Tablolar yeniden cizildikten sonra hedef DOM'da bulunur.
  await nextTick()
  const row = findRow(request.path)
  row?.scrollIntoView({ block: 'center' })
})

/** J/K ile satir gezinmesi; App klavye kancasindan cagrilir. */
function moveSelection(step: number) {
  const elements = rowElements()
  if (elements.length === 0) return
  const current = elements.findIndex(element => element.dataset.rowPath === props.selectedPath)
  const next = elements[Math.min(Math.max(current + step, 0), elements.length - 1)] ?? elements[0]
  const path = next.dataset.rowPath
  if (!path) return
  selectField?.(path)
  next.scrollIntoView({ block: 'nearest' })
}

defineExpose({ moveSelection, expandAll, collapseAll })
</script>

<template>
  <div class="grid">
    <div class="grid-head">
      <span class="head-shape" :class="rootShape">
        {{ rootShape === 'records' ? 'kayıt tablosu' : rootShape === 'object' ? 'nesne' : rootShape === 'list' ? 'dizi' : 'değer' }}
      </span>
      <span class="head-summary">{{ rootSummary }}</span>
      <span class="head-hint">hücreye tıkla → içinde açılır</span>
      <span v-if="expandNote" class="head-note">{{ expandNote }}</span>
      <div class="head-spacer" />
      <button class="head-tool" @click="expandAll">tümünü aç</button>
      <button class="head-tool" @click="collapseAll">kapat</button>
    </div>

    <div ref="scrollEl" class="grid-body">
      <p v-if="rootShape === 'scalar'" class="note">
        Bu JSON bir nesne veya dizi değil: <code>{{ String(data) }}</code>
      </p>
      <GridTable v-else :value="data" :path="rootKey" :depth="0" />
    </div>
  </div>
</template>

<style scoped>
.grid { display: flex; flex-direction: column; flex: 1; min-height: 0; }

.grid-head { display: flex; align-items: center; gap: 10px; padding: 5px 12px; background: var(--bg-secondary); border-bottom: 1px solid var(--border); flex-shrink: 0; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; }
.head-shape { border-radius: 10px; padding: 1px 8px; }
.head-shape.records { color: var(--green); background: var(--bg-array); }
.head-shape.object { color: var(--purple); background: var(--bg-object); }
.head-shape.list { color: var(--green); background: var(--bg-array); }
.head-shape.scalar { color: var(--text-muted); background: var(--bg-tertiary); }
.head-summary { color: var(--text-secondary); }
.head-hint { color: var(--text-muted); }
.head-note { color: var(--orange); }
.head-spacer { flex: 1; }
.head-tool { font-family: inherit; font-size: 10.5px; color: var(--text-muted); border: 1px solid var(--border); border-radius: 5px; padding: 1px 8px; white-space: nowrap; }
.head-tool:hover { color: var(--accent); border-color: var(--accent); }

/*
 * Kaydiran kutu burasi: kok tablonun basligi buna gore yapisiyor, genis kayit
 * tablolari da yatayda burada kayiyor.
 */
.grid-body { flex: 1; min-height: 0; overflow: auto; }

.note { padding: 14px 16px; font-size: 12px; color: var(--text-muted); }
.note code { font-family: 'JetBrains Mono', monospace; color: var(--color-string); }
</style>
