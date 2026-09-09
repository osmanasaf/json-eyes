<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { COMMENTS, SELECT_FIELD } from '../utils/injection'
import type { FieldDoc, JsonValue } from '../types'
import { effectiveFieldName, isRefField, resolveRef, type RefIndex } from '../utils/references'
import type { SearchIndex } from '../utils/search'
import { autoOpenPaths, highlightParts } from '../utils/grid'
import { flattenRows, pathToOpen, scalarText, type GridRow } from '../utils/rows'
import RefPreview from './RefPreview.vue'
import InlineArrayTable from './InlineArrayTable.vue'
import CommentThread from './CommentThread.vue'

/**
 * Grid: urunun ana ekrani. Uc kolon — **Alan · Tip · Deger** — ve derinligi
 * girintiyle anlatan tek bir duz liste.
 *
 * Liste gercekten duz: `flattenRows` agaci once tek boyutlu bir diziye
 * indiriyor, cizim de o dizinin yalnizca gorunen penceresini kuruyor. 100k+
 * dugumlu NDC yanitlarinda ozyinelemeli cizim tarayiciyi kilitliyordu; burada
 * acilmis dal sayisi ne olursa olsun DOM'da birkac düzine satir duruyor.
 *
 * Satirin altina acilabilen uc serit var — referans onizlemesi, yorum konusu
 * ve nesne dizisinin tablosu. Ucu de listenin kendi ogeleri; boylece
 * sanallastirma onlari da kapsiyor.
 */
const props = defineProps<{
  data: JsonValue
  rootKey: string
  searchTerm?: string
  docLookup?: (nodePath: string) => FieldDoc | undefined
  refIndex?: RefIndex
  /** Arama sonuclari; eslesmelere giden dallar bununla kendiliginden acilir. */
  search?: SearchIndex
  focusRequest?: { path: string; seq: number } | null
  selectedPath?: string | null
  /** Sunucudan alan aciklamalari geldi mi; gelmediyse sema isaretleri gizlenir. */
  schemaKnown?: boolean
  /** Nesne dizileri yerinde tablolassin mi ("Iç içe / Tablo" segmenti). */
  arrayTable?: boolean
}>()

const emit = defineEmits<{
  focusPath: [path: string]
  /** Bir dizinin tam tablosunu ac (Ekran 4). */
  openTable: [path: string]
  stats: [value: { rows: number; rendered: number }]
}>()

const selectField = inject(SELECT_FIELD, null)
const comments = inject(COMMENTS, null)

/** "Tümünü aç"in acabilecegi en fazla dal; tasarimin ust siniri. */
const EXPAND_BUDGET = 5000

const expanded = ref(new Set<string>())
const refOpen = ref<string | null>(null)
const expandNote = ref<string | null>(null)

const filterActive = computed(() => (props.searchTerm ?? '').trim().length > 0)

/**
 * Filtre acikken eslesmeye giden dallarin hepsi acik sayilir: kullanicinin
 * eslesmeyi gormek icin ayrica tiklamasi gerekmiyor. Kapatinca kendi actigi
 * dallar geri geliyor — filtre kullanicinin acma kararlarini bozmuyor.
 */
const effectiveExpanded = computed(() => {
  if (!filterActive.value || !props.search) return expanded.value
  const next = new Set(expanded.value)
  for (const path of props.search.visible) next.add(path)
  return next
})

const visibleSet = computed(() =>
  filterActive.value && props.search ? props.search.visible : null,
)

const rows = computed<GridRow[]>(() =>
  flattenRows(props.data, props.rootKey, {
    expanded: effectiveExpanded.value,
    visible: visibleSet.value,
    arrayTable: props.arrayTable === true,
    refOpen: refOpen.value,
    threadOpen: comments?.available.value ? comments.openPath.value : null,
  }),
)

// --- Sanallastirma -----------------------------------------------------------

const scrollEl = ref<HTMLElement | null>(null)
const virtualVersion = ref(0)
const virtualizer = useVirtualizer(computed(() => ({
  count: rows.value.length,
  getScrollElement: () => scrollEl.value,
  // Normal yogunlukta satir ~27px; serit satirlari olculerek duzeltiliyor.
  estimateSize: () => 27,
  overscan: 14,
  getItemKey: (index: number) => rows.value[index]?.id ?? index,
  onChange: () => { virtualVersion.value++ },
})))

const virtualRows = computed(() => {
  void virtualVersion.value
  return virtualizer.value.getVirtualItems()
})

const totalSize = computed(() => {
  void virtualVersion.value
  return virtualizer.value.getTotalSize()
})

function measure(el: Element | { $el?: Element } | null) {
  const node = (el as { $el?: Element } | null)?.$el ?? el
  if (node instanceof HTMLElement) virtualizer.value.measureElement(node)
}

// Liste bastan kurulunca olcum onbellegi tazelenmeli; yoksa pencere eski
// yuksekliklere gore hesaplanip ustte bosluk birakiyor.
watch(rows, () => {
  virtualizer.value.measure()
  emit('stats', { rows: rows.value.length, rendered: virtualRows.value.length })
})

watch(virtualRows, (items) => {
  emit('stats', { rows: rows.value.length, rendered: items.length })
})

// --- Acilis ve odak ----------------------------------------------------------

/** Yeni bir belgede acilis dallari kuruluyor; onceki secimler anlamsiz. */
watch(() => props.data, (data) => {
  expanded.value = autoOpenPaths(data, props.rootKey)
  refOpen.value = null
  expandNote.value = null
  void nextTick(() => {
    virtualizer.value.measure()
    virtualizer.value.scrollToOffset(0)
  })
}, { immediate: true })

watch(() => props.focusRequest, (request) => {
  if (!request) return
  focus(request.path)
}, { deep: false })

function focus(path: string) {
  const next = new Set(expanded.value)
  for (const ancestor of pathToOpen(path, props.rootKey)) next.add(ancestor)
  expanded.value = next
  void nextTick(() => {
    const index = rows.value.findIndex(row => row.kind === 'row' && row.path === path)
    if (index >= 0) virtualizer.value.scrollToIndex(index, { align: 'center' })
  })
}

// --- Satir etkilesimleri -----------------------------------------------------

function onRowClick(row: GridRow) {
  if (row.container) toggle(row.path)
  select(row.path)
}

function toggle(path: string) {
  const next = new Set(expanded.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  expanded.value = next
}

function select(path: string) {
  selectField?.(path)
}

function toggleRef(row: GridRow, event: Event) {
  event.stopPropagation()
  refOpen.value = refOpen.value === row.path ? null : row.path
}

function toggleThread(row: GridRow, event: Event) {
  event.stopPropagation()
  comments?.toggle(row.path)
}

function gotoRef(path: string) {
  refOpen.value = null
  emit('focusPath', path)
}

/**
 * Bir dugumun referans hedefi. Rozet yalnizca hedef *gercekten cozuluyorsa*
 * cikiyor; cozulmeyen bir `*RefID` icin rozet gostermek kullaniciyi bos bir
 * kutuya tikliyor.
 */
function refTargetOf(row: GridRow) {
  if (!props.refIndex || row.container) return undefined
  const field = effectiveFieldName(row.path)
  if (!isRefField(field)) return undefined
  return resolveRef(props.refIndex, field, row.value, row.path.slice(0, row.path.lastIndexOf('.')))
}

function docOf(row: GridRow): FieldDoc | undefined {
  return props.docLookup?.(row.path)
}

// --- Klavye ------------------------------------------------------------------

/** J/K ile satir gezinme; imlec cizilmis satirlar uzerinde dolasiyor. */
function moveSelection(step: number) {
  const list = rows.value.filter(row => row.kind === 'row')
  if (list.length === 0) return
  const current = list.findIndex(row => row.path === props.selectedPath)
  const next = current === -1
    ? (step > 0 ? 0 : list.length - 1)
    : (current + step + list.length) % list.length
  const target = list[next]
  select(target.path)
  const index = rows.value.findIndex(row => row.kind === 'row' && row.path === target.path)
  if (index >= 0) virtualizer.value.scrollToIndex(index, { align: 'auto' })
}

function expandAll() {
  const next = new Set<string>()
  let budget = EXPAND_BUDGET
  const walk = (value: JsonValue, path: string) => {
    if (budget <= 0 || value === null || typeof value !== 'object') return
    next.add(path)
    budget--
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}.${index}`))
      return
    }
    for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`)
  }
  if (props.data !== null && typeof props.data === 'object') {
    if (Array.isArray(props.data)) props.data.forEach((item, i) => walk(item, `${props.rootKey}.${i}`))
    else for (const [key, child] of Object.entries(props.data)) walk(child, `${props.rootKey}.${key}`)
  }
  expandNote.value = budget <= 0
    ? `Açılan dal sayısı ${EXPAND_BUDGET.toLocaleString('tr-TR')} ile sınırlandı.`
    : null
  expanded.value = next
}

function collapseAll() {
  expanded.value = new Set()
  expandNote.value = null
  refOpen.value = null
  void nextTick(() => virtualizer.value.scrollToOffset(0))
}

defineExpose({ moveSelection, expandAll, collapseAll })

// --- Gorunum yardimcilari ----------------------------------------------------

/**
 * Tip rozetinin metni. `toUpperCase` yerine sabit tablo: Turkce yerelde
 * `text-transform: uppercase` "string" kelimesini "STRİNG" yapiyor.
 */
const TYPE_LABEL: Record<string, string> = {
  object: 'OBJECT', array: 'ARRAY', string: 'STRING',
  number: 'NUMBER', boolean: 'BOOL', null: 'NULL',
}

function typeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type
}

function valueText(row: GridRow): string {
  return row.container ? row.summary : scalarText(row.value)
}

function parts(text: string) {
  return highlightParts(text, props.searchTerm ?? '')
}

function commentCount(path: string): number {
  return comments?.available.value ? comments.countFor(path) : 0
}
</script>

<template>
  <div class="grid">
    <div class="grid-head">
      <span class="th">Alan</span>
      <span class="th">Tip</span>
      <span class="th">Değer</span>
    </div>

    <p v-if="expandNote" class="grid-note">{{ expandNote }}</p>

    <div ref="scrollEl" class="scroll" tabindex="0">
      <p v-if="rows.length === 0" class="empty">
        {{ filterActive ? 'Bu filtreye uyan alan yok.' : 'Gösterilecek alan yok.' }}
      </p>

      <div v-else class="canvas" :style="{ height: `${totalSize}px` }">
        <div
          v-for="vrow in virtualRows"
          :key="String(vrow.key)"
          :ref="measure"
          :data-index="vrow.index"
          class="vrow"
          :style="{ transform: `translateY(${vrow.start}px)` }"
        >
          <template v-if="rows[vrow.index]">
            <!-- Alan · Tip · Deger satiri -->
            <div
              v-if="rows[vrow.index].kind === 'row'"
              class="row"
              :class="{ selected: rows[vrow.index].path === selectedPath }"
              @click="onRowClick(rows[vrow.index])"
            >
              <div class="cell field">
                <span class="indent" :style="{ width: `${rows[vrow.index].depth * 18}px` }" />
                <button
                  v-if="rows[vrow.index].container"
                  class="caret"
                  :aria-expanded="rows[vrow.index].open"
                  :aria-label="rows[vrow.index].open ? 'Kapat' : 'Aç'"
                  @click.stop="onRowClick(rows[vrow.index])"
                >{{ rows[vrow.index].open ? '▾' : '▸' }}</button>
                <span v-else class="caret" />
                <span class="name" :title="rows[vrow.index].key">
                  <template v-for="(part, i) in parts(rows[vrow.index].key)" :key="i">
                    <mark v-if="part.hit">{{ part.text }}</mark>
                    <template v-else>{{ part.text }}</template>
                  </template>
                </span>
                <span
                  v-if="schemaKnown"
                  class="doc-mark"
                  :class="docOf(rows[vrow.index]) ? 'known' : 'unknown'"
                  :title="docOf(rows[vrow.index]) ? 'Şemada var' : 'Şemada yok'"
                >{{ docOf(rows[vrow.index]) ? 'ⓘ' : '●' }}</span>
              </div>

              <div class="cell type">
                <span class="badge" :class="`t-${rows[vrow.index].type}`">
                  {{ typeLabel(rows[vrow.index].type) }}
                </span>
              </div>

              <div class="cell value">
                <span
                  class="text"
                  :class="[`t-${rows[vrow.index].type}`, { soft: rows[vrow.index].container }]"
                  :title="valueText(rows[vrow.index])"
                >
                  <template v-for="(part, i) in parts(valueText(rows[vrow.index]))" :key="i">
                    <mark v-if="part.hit">{{ part.text }}</mark>
                    <template v-else>{{ part.text }}</template>
                  </template>
                </span>

                <button
                  v-if="refTargetOf(rows[vrow.index])"
                  class="ref-chip"
                  :class="{ on: refOpen === rows[vrow.index].path }"
                  @click="toggleRef(rows[vrow.index], $event)"
                >↳ referans</button>

                <span class="spacer" />

                <button
                  v-if="comments?.available.value"
                  class="comment-btn"
                  :class="{ has: commentCount(rows[vrow.index].path) > 0 }"
                  :aria-label="`${rows[vrow.index].key} alanına yorum`"
                  @click="toggleThread(rows[vrow.index], $event)"
                >
                  💬<template v-if="commentCount(rows[vrow.index].path) > 0">
                    {{ ' ' + commentCount(rows[vrow.index].path) }}
                  </template>
                </button>
              </div>
            </div>

            <!-- Referans onizlemesi -->
            <RefPreview
              v-else-if="rows[vrow.index].kind === 'ref' && refTargetOf(rows[vrow.index])"
              :target="refTargetOf(rows[vrow.index])!"
              :depth="rows[vrow.index].depth"
              @goto="gotoRef"
            />

            <!-- Yorum konusu -->
            <div
              v-else-if="rows[vrow.index].kind === 'thread' && comments"
              class="thread-strip"
              :style="{ '--depth': rows[vrow.index].depth + 1 }"
            >
              <CommentThread
                :path="rows[vrow.index].path"
                :comments="comments.commentsFor(rows[vrow.index].path)"
                :author="comments.author.value"
                :enabled="comments.enabled.value"
                :can-delete="comments.canDelete"
                @add="comments.add"
                @remove="comments.remove"
                @update:author="value => comments!.author.value = value"
                @close="comments.toggle(rows[vrow.index].path)"
              />
            </div>

            <!-- Nesne dizisinin yerinde tablosu -->
            <InlineArrayTable
              v-else-if="rows[vrow.index].kind === 'table'"
              :items="rows[vrow.index].items!"
              :path="rows[vrow.index].path"
              :depth="rows[vrow.index].depth"
              @expand="emit('openTable', $event)"
            />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid { display: flex; flex-direction: column; flex: 1; min-height: 0; }

.grid-head {
  display: grid;
  grid-template-columns: var(--grid-cols);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.th {
  font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px;
  color: var(--text-secondary); padding: 8px var(--row-pad-x);
}

.grid-note { font-size: 11px; color: var(--orange); padding: 6px var(--row-pad-x); background: var(--orange-dim); }

.scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; outline: none; }
.canvas { position: relative; width: 100%; }
.vrow { position: absolute; top: 0; left: 0; width: 100%; }

.empty { font-size: 12.5px; color: var(--text-muted); padding: 18px var(--row-pad-x); }

.row {
  display: grid;
  grid-template-columns: var(--grid-cols);
  align-items: center;
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: background .1s;
}
.row:hover { background: var(--bg-secondary); }
.row.selected { background: var(--accent-wash); box-shadow: inset 2px 0 0 var(--accent); }

.cell { padding: var(--row-pad-y) var(--row-pad-x); min-width: 0; }
.field { display: flex; align-items: center; font-family: 'JetBrains Mono', monospace; font-size: 12.5px; }
.indent { display: inline-block; flex-shrink: 0; }
.caret {
  width: 16px; flex-shrink: 0; color: var(--text-muted); font-size: 10px; text-align: center;
  line-height: 1; padding: 0;
}
.caret:hover { color: var(--text-primary); }
.name { color: var(--color-key); font-weight: 500; margin-left: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.doc-mark { margin-left: 6px; font-size: 9px; opacity: .75; flex-shrink: 0; }
.doc-mark.known { color: var(--accent); }
.doc-mark.unknown { color: var(--orange); }

.badge {
  font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px;
  font-family: 'JetBrains Mono', monospace; letter-spacing: .3px;
}

.value { display: flex; align-items: center; gap: 8px; }
.text { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.text.soft { color: var(--text-muted); font-style: italic; }
.spacer { flex: 1; }

.ref-chip {
  font-size: 10px; color: var(--accent); background: var(--accent-dim);
  padding: 1px 8px; border-radius: 10px; white-space: nowrap; flex-shrink: 0;
}
.ref-chip.on { background: var(--accent-strong); }

.comment-btn {
  font-size: 10.5px; color: var(--text-muted); opacity: .35;
  padding: 1px 7px; border-radius: 10px; white-space: nowrap; flex-shrink: 0;
}
.row:hover .comment-btn { opacity: .8; }
.comment-btn:hover { background: var(--bg-tertiary); }
.comment-btn.has { color: var(--purple); opacity: 1; }

.thread-strip { border-bottom: 1px solid var(--border-subtle); padding: 7px var(--row-pad-x); }
.thread-strip > :deep(.thread) { margin-left: calc(var(--depth) * var(--indent)); }

/* Tip renkleri: metin --color-*, rozet zemini --bg-*. */
.t-string { color: var(--color-string); }
.badge.t-string { background: var(--bg-string); }
.t-number { color: var(--color-number); }
.badge.t-number { background: var(--bg-number); }
.t-boolean { color: var(--color-bool); }
.badge.t-boolean { background: var(--bg-bool); }
.t-null { color: var(--color-null); font-style: italic; }
.badge.t-null { background: var(--bg-null); font-style: normal; }
.t-object { color: var(--purple); }
.badge.t-object { background: var(--bg-object); }
.t-array { color: var(--green); }
.badge.t-array { background: var(--bg-array); }
</style>
