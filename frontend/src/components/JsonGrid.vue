<script setup lang="ts">
import { computed, inject, nextTick, provide, ref, watch } from 'vue'
import { COMMENTS, SELECT_FIELD } from '../utils/injection'
import { GRID, type GridContext } from '../utils/gridContext'
import type { FieldDoc, JsonValue } from '../types'
import { effectiveFieldName, isRefField, resolveRef, type RefIndex } from '../utils/references'
import type { SearchIndex } from '../utils/search'
import {
  ancestorsOf, autoOpenPaths, filterOpenable, gridShape, summaryOf, valueAtPath,
} from '../utils/grid'
import GridTable from './GridTable.vue'

/**
 * Grid gorunumunun kabugu: durumu tutar, ozyinelemeli tablolara inject ile
 * verir, klavyeyi yonetir. Cizim isinin tamami `GridTable`de.
 *
 * Klavye burada duruyor cunku imlec tablolar arasinda dolasiyor: hedef hucre
 * baska bir tablonun icinde olabilir, dolayisiyla tek bir tablo kendi basina
 * karar veremez. Gezinme cizilmis hucreler uzerinden (DOM sirasi) yapiliyor;
 * boylece "gorunen sey ne ise o gezilir" — pencereleme ve filtrelerle
 * kendiliginden tutarli.
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
const hidden = ref(new Map<string, Set<string>>())
const detailPath = ref<string | null>(null)
const refPath = ref<string | null>(null)
const cursor = ref<string | null>(null)
const dense = ref(false)
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
  hidden.value = new Map()
  detailPath.value = null
  refPath.value = null
  cursor.value = null
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

const EMPTY_HIDDEN: Set<string> = new Set()

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
  cursor: computed(() => cursor.value),
  setCursor: (path: string | null) => { cursor.value = path },
  dense: computed(() => dense.value),
  hiddenColumns: (tablePath: string) => hidden.value.get(tablePath) ?? EMPTY_HIDDEN,
  toggleColumn: (tablePath: string, name: string) => {
    const next = new Map(hidden.value)
    const set = new Set(next.get(tablePath) ?? [])
    if (set.has(name)) set.delete(name)
    else set.add(name)
    next.set(tablePath, set)
    hidden.value = next
    touch()
  },
  setHiddenColumns: (tablePath: string, names: string[]) => {
    const next = new Map(hidden.value)
    next.set(tablePath, new Set(names))
    hidden.value = next
    touch()
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

function cellElements(): HTMLElement[] {
  const root = scrollEl.value
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>('[data-cell-path]'))
}

// Sayim DOM'dan okunuyor: acik yol kumesi kapali bir dalin icindeki dallari da
// tasiyor, kullaniciya "acik" diye gosterilen sey ise gercekten cizilenler.
watch([version, () => props.searchTerm, () => props.filterMatches], async () => {
  await nextTick()
  const root = scrollEl.value
  emit('stats', {
    rows: rowElements().length,
    tables: root ? root.querySelectorAll('.table').length : 0,
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
  const cell = cellElements().find(element => element.dataset.cellPath === request.path)
  if (cell) {
    cursor.value = request.path
    cell.scrollIntoView({ block: 'center', inline: 'nearest' })
    return
  }
  findRow(request.path)?.scrollIntoView({ block: 'center' })
})

/** Imleci verilen hucreye tasir: secim, kaydirma ve editor senkronu birlikte. */
function placeCursor(element: HTMLElement | undefined) {
  const path = element?.dataset.cellPath
  if (!element || !path) return
  cursor.value = path
  selectField?.(path)
  element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function currentCell(): HTMLElement | null {
  const path = cursor.value
  if (!path) return null
  return cellElements().find(element => element.dataset.cellPath === path) ?? null
}

/**
 * Hucreler arasinda gezinme. Yukari/asagi ayni tablonun ayni kolonunda kalir
 * (elektronik tabloda beklenen davranis), sag/sol ayni satirda dolasir.
 */
function move(rowStep: number, colStep: number) {
  const elements = cellElements()
  if (elements.length === 0) return
  const current = currentCell()
  if (!current) {
    placeCursor(elements[0])
    return
  }
  const table = current.dataset.table
  const row = Number(current.dataset.row)
  const col = Number(current.dataset.col)

  if (rowStep !== 0) {
    const column = elements
      .filter(el => el.dataset.table === table && Number(el.dataset.col) === col)
      .sort((a, b) => Number(a.dataset.row) - Number(b.dataset.row))
    const index = column.indexOf(current)
    placeCursor(column[Math.min(Math.max(index + rowStep, 0), column.length - 1)])
    return
  }

  const line = elements
    .filter(el => el.dataset.table === table && Number(el.dataset.row) === row)
    .sort((a, b) => Number(a.dataset.col) - Number(b.dataset.col))
  const index = line.indexOf(current)
  placeCursor(line[Math.min(Math.max(index + colStep, 0), line.length - 1)])
}

function moveToEdge(end: boolean) {
  const current = currentCell()
  if (!current) return
  const table = current.dataset.table
  const row = Number(current.dataset.row)
  const line = cellElements()
    .filter(el => el.dataset.table === table && Number(el.dataset.row) === row)
    .sort((a, b) => Number(a.dataset.col) - Number(b.dataset.col))
  placeCursor(end ? line[line.length - 1] : line[0])
}

/** Enter: hucreyi ac/kapat. Tiklamayla ayni yol izlenir. */
function activate() {
  currentCell()?.click()
}

/**
 * Esc: "geri" tusu. Once imlecin uzerinde durdugu acik hucreyi kapatir —
 * kullanicinin en son actigi sey odur. Kapatacak bir sey yoksa icinde
 * bulundugun tabloyu kapatip bir ust seviyeye doner; yoksa derin bir dalda
 * actigi tablolarin icinde kaybolunuyor.
 */
function ascend() {
  const current = currentCell()
  if (!current) {
    cursor.value = null
    return
  }
  const path = current.dataset.cellPath
  if (path && expanded.value.has(path)) {
    toggle(path)
    return
  }
  const table = current.dataset.table
  if (!table || !expanded.value.has(table)) {
    cursor.value = null
    return
  }
  toggle(table)
  void nextTick(() => {
    // Ust seviye bir *kart* olabilir (hucre degil); o zaman imlec dusuruluyor,
    // yoksa artik cizilmeyen bir hucreyi isaret etmeye devam ederdi.
    const parent = cellElements().find(element => element.dataset.cellPath === table)
    if (parent) placeCursor(parent)
    else cursor.value = null
  })
}

async function copyCursor(kind: 'value' | 'branch' | 'path') {
  const path = cursor.value
  if (!path) return
  const value = valueAtPath(props.data, props.rootKey, path)
  const text = kind === 'path'
    ? path.split('.').slice(1).join('.')
    : kind === 'branch' || (value !== null && typeof value === 'object')
      ? JSON.stringify(value, null, 2)
      : String(value ?? '')
  try {
    await navigator.clipboard.writeText(text)
    copyNote.value = kind === 'path' ? 'yol kopyalandı' : kind === 'branch' ? 'dal kopyalandı' : 'değer kopyalandı'
    setTimeout(() => { copyNote.value = null }, 1500)
  } catch {
    copyNote.value = null
  }
}

const copyNote = ref<string | null>(null)

/**
 * Grid'in kendi klavyesi. Olay grid kutusunda yakalanip durduruluyor: App'in
 * genel kisayollari (J/K) grid dışında calismaya devam ediyor, grid odakliyken
 * ok tuslari sayfayi kaydirmiyor.
 */
function onKeydown(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  // Kolon filtresi de grid'in icinde: orada yazilan harfler kisayol degil.
  if (isTypingTarget(event.target)) return
  const handled = () => { event.preventDefault(); event.stopPropagation() }
  switch (event.key) {
    case 'ArrowDown': case 'j': handled(); move(1, 0); return
    case 'ArrowUp': case 'k': handled(); move(-1, 0); return
    case 'ArrowRight': case 'l': handled(); move(0, 1); return
    case 'ArrowLeft': case 'h': handled(); move(0, -1); return
    case 'PageDown': handled(); move(10, 0); return
    case 'PageUp': handled(); move(-10, 0); return
    case 'Home': handled(); moveToEdge(false); return
    case 'End': handled(); moveToEdge(true); return
    case 'Enter': case ' ': handled(); activate(); return
    case 'Escape': handled(); ascend(); return
    case 'c': handled(); void copyCursor('value'); return
    case 'C': handled(); void copyCursor('branch'); return
    case 'y': handled(); void copyCursor('path'); return
    default:
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable
}

/** Tiklama grid'e odak verir; oklar hemen calissin — girdi alanlari haric. */
function onPointerDown(event: PointerEvent) {
  if (isTypingTarget(event.target)) return
  scrollEl.value?.focus({ preventScroll: true })
}

/** J/K ile satir gezinmesi; App klavye kancasindan cagrilir. */
function moveSelection(step: number) {
  if (cursor.value) {
    move(step, 0)
    return
  }
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
      <span class="head-hint">[+] hücrede açar · oklarla gezin · Enter aç · Esc üst seviye</span>
      <span v-if="copyNote" class="head-ok">✓ {{ copyNote }}</span>
      <span v-if="expandNote" class="head-note">{{ expandNote }}</span>
      <div class="head-spacer" />
      <button
        class="head-tool"
        :class="{ on: dense }"
        title="Sık yerleşim: aynı ekranda daha fazla satır"
        @click="dense = !dense"
      >{{ dense ? '≡ sık' : '≣ rahat' }}</button>
      <button class="head-tool" @click="expandAll">tümünü aç</button>
      <button class="head-tool" @click="collapseAll">kapat</button>
    </div>

    <div
      ref="scrollEl"
      class="grid-body"
      tabindex="0"
      @keydown="onKeydown"
      @pointerdown="onPointerDown"
    >
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
.head-shape { border-radius: 10px; padding: 1px 8px; flex-shrink: 0; }
.head-shape.records { color: var(--green); background: var(--bg-array); }
.head-shape.object { color: var(--purple); background: var(--bg-object); }
.head-shape.list { color: var(--green); background: var(--bg-array); }
.head-shape.scalar { color: var(--text-muted); background: var(--bg-tertiary); }
.head-summary { color: var(--text-secondary); flex-shrink: 0; }
.head-hint { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.head-ok { color: var(--green); white-space: nowrap; }
.head-note { color: var(--orange); white-space: nowrap; }
.head-spacer { flex: 1; }
.head-tool { font-family: inherit; font-size: 10.5px; color: var(--text-muted); border: 1px solid var(--border); border-radius: 5px; padding: 1px 8px; white-space: nowrap; }
.head-tool:hover { color: var(--accent); border-color: var(--accent); }
.head-tool.on { color: var(--accent); border-color: var(--accent); background: var(--accent-dim); }

/*
 * Kaydiran kutu burasi: kok tablonun basligi buna gore yapisiyor, genis kayit
 * tablolari da yatayda burada kayiyor. `tabindex` klavye icin: oklar sayfayi
 * degil imleci oynatiyor.
 */
.grid-body { flex: 1; min-height: 0; overflow: auto; outline: none; padding: 10px; }
.grid-body:focus-visible { box-shadow: inset 0 0 0 1px var(--accent-strong); }

.note { padding: 14px 16px; font-size: 12px; color: var(--text-muted); }
.note code { font-family: 'JetBrains Mono', monospace; color: var(--color-string); }
</style>
