<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { COMMENTS, SELECT_FIELD } from '../utils/injection'
import type { FieldDoc, JsonValue } from '../types'
import type { RefIndex } from '../utils/references'
import { collectExpandable, flattenTree, type GridRowItem } from '../utils/flatten'
import { getType } from '../utils/json'
import InfoBubble from './InfoBubble.vue'
import FieldDocCard from './FieldDocCard.vue'
import CommentThread from './CommentThread.vue'
import ArrayTable from './ArrayTable.vue'

const props = defineProps<{
  data: JsonValue
  rootKey: string
  searchTerm?: string
  docLookup?: (nodePath: string) => FieldDoc | undefined
  filterMatches?: boolean
  /** Nesne dizileri satir icinde tabloya donussun mu. */
  arrayTableMode?: boolean
  refIndex?: RefIndex
  focusRequest?: { path: string; seq: number } | null
  selectedPath?: string | null
  /** Sunucudan alan aciklamalari geldi mi; gelmediyse sema isaretleri gizlenir. */
  schemaKnown?: boolean
}>()

const emit = defineEmits<{
  focusPath: [path: string]
  expandTable: [path: string]
  stats: [value: { total: number; rendered: number }]
}>()

const selectField = inject(SELECT_FIELD, null)
const comments = inject(COMMENTS, null)

const ROW_PAGE_SIZE = 200

const expanded = ref(new Set<string>([props.rootKey]))
const pageSizes = ref(new Map<string, number>())
const refOpenPath = ref<string | null>(null)

watch(() => props.data, () => {
  expanded.value = new Set([props.rootKey])
  pageSizes.value = new Map()
  refOpenPath.value = null
})

const commentsAvailable = computed(() => comments?.available.value === true)

const rows = computed<GridRowItem[]>(() => flattenTree(props.data, {
  rootKey: props.rootKey,
  expanded: expanded.value,
  pageSizes: pageSizes.value,
  pageSize: ROW_PAGE_SIZE,
  searchTerm: props.searchTerm,
  filterMatches: props.filterMatches,
  arrayTableMode: props.arrayTableMode,
  docLookup: props.docLookup,
  refIndex: props.refIndex,
  refOpenPath: refOpenPath.value,
  openThreadPath: comments?.openPath.value ?? null,
  commentCountFor: path => comments?.countFor(path) ?? 0,
  commentsAvailable: commentsAvailable.value,
}))

const isEmptyRoot = computed(() => {
  const type = getType(props.data)
  return type !== 'object' && type !== 'array'
})

// --- Sanallastirma -----------------------------------------------------------
// Satir yukseklikleri degisken (referans/yorum/tablo kutulari), bu yuzden
// olculen yukseklik kullaniliyor; tahmin yalnizca ilk cizimde gecerli.
const scrollEl = ref<HTMLElement | null>(null)
/**
 * Sanallastiricinin kendi bildirimi Vue'nun computed onbellegini her durumda
 * tazelemedigi icin degisiklikleri acik bir sayacla izliyoruz.
 */
const virtualVersion = ref(0)
const virtualizer = useVirtualizer(computed(() => ({
  count: rows.value.length,
  getScrollElement: () => scrollEl.value,
  estimateSize: () => 29,
  overscan: 14,
  getItemKey: (index: number) => rows.value[index]?.key ?? index,
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

watch([rows, virtualRows], () => {
  emit('stats', { total: rows.value.length, rendered: virtualRows.value.length })
}, { immediate: true })

// --- Etkilesim ---------------------------------------------------------------

function toggle(path: string) {
  const next = new Set(expanded.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  expanded.value = next
}

function onRowClick(row: GridRowItem) {
  selectField?.(row.path)
  if (row.isContainer) toggle(row.path)
}

function expandAll() {
  expanded.value = collectExpandable(props.data, props.rootKey)
}

function collapseAll() {
  expanded.value = new Set([props.rootKey])
  pageSizes.value = new Map()
}

function showMore(path: string) {
  const next = new Map(pageSizes.value)
  next.set(path, (next.get(path) ?? ROW_PAGE_SIZE) + ROW_PAGE_SIZE * 5)
  pageSizes.value = next
}

function toggleRef(path: string) {
  refOpenPath.value = refOpenPath.value === path ? null : path
}

const PREVIEW_FIELD_LIMIT = 8

function scalarColor(value: JsonValue): string {
  if (typeof value === 'number') return 'var(--color-number)'
  if (typeof value === 'boolean') return 'var(--color-bool)'
  if (value === null) return 'var(--color-null)'
  return 'var(--color-string)'
}

/**
 * Referans onizlemesindeki alanlar. NDC'de aranan bilgi cogu zaman bir alt
 * nesnede duruyor (`Pax.Individual.GivenName`), bu yuzden bir seviye daha
 * iniliyor; liste onizleme olarak kalsin diye ust sinirla kesiliyor.
 */
function previewFields(value: JsonValue): Array<{ key: string; text: string; color: string }> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
  const fields: Array<{ key: string; text: string; color: string }> = []
  const nested: Array<[string, JsonValue]> = []

  for (const [key, child] of Object.entries(value)) {
    if (child === null || typeof child !== 'object') {
      fields.push({ key, text: child === null ? 'null' : String(child), color: scalarColor(child) })
    } else if (!Array.isArray(child)) {
      nested.push([key, child])
    }
  }

  for (const [parent, child] of nested) {
    for (const [key, leaf] of Object.entries(child as Record<string, JsonValue>)) {
      if (fields.length >= PREVIEW_FIELD_LIMIT) return fields
      if (leaf !== null && typeof leaf === 'object') continue
      fields.push({
        key: `${parent}.${key}`,
        text: leaf === null ? 'null' : String(leaf),
        color: scalarColor(leaf),
      })
    }
  }
  return fields.slice(0, PREVIEW_FIELD_LIMIT)
}

function displayValue(value: JsonValue): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  return String(value)
}

// --- Odak ve klavye gezinmesi ------------------------------------------------

watch(() => props.focusRequest, async (request) => {
  if (!request) return
  const next = new Set(expanded.value)
  const segments = request.path.split('.')
  for (let i = 1; i <= segments.length; i++) next.add(segments.slice(0, i).join('.'))
  expanded.value = next
  selectField?.(request.path)
  // Satir listesi yeniden kurulduktan sonra hedefin indeksi belli olur.
  await nextTick()
  const index = rows.value.findIndex(row => row.kind === 'row' && row.path === request.path)
  if (index >= 0) virtualizer.value.scrollToIndex(index, { align: 'center' })
})

/** J/K ile satir gezinmesi; App klavye kancasindan cagrilir. */
function moveSelection(step: number) {
  const dataRows = rows.value.filter(row => row.kind === 'row')
  if (dataRows.length === 0) return
  const current = dataRows.findIndex(row => row.path === props.selectedPath)
  const nextRow = dataRows[Math.min(Math.max(current + step, 0), dataRows.length - 1)] ?? dataRows[0]
  selectField?.(nextRow.path)
  const index = rows.value.indexOf(nextRow)
  if (index >= 0) virtualizer.value.scrollToIndex(index, { align: 'auto' })
}

defineExpose({ moveSelection, expandAll, collapseAll })
</script>

<template>
  <div class="grid">
    <div class="grid-head">
      <div class="hcell">Alan</div>
      <div class="hcell">Tip</div>
      <div class="hcell hcell-value">
        Değer
        <span class="head-tools">
          <button class="head-tool" @click="expandAll">tümünü aç</button>
          <button class="head-tool" @click="collapseAll">kapat</button>
        </span>
      </div>
    </div>

    <div ref="scrollEl" class="grid-body">
      <p v-if="isEmptyRoot" class="note">
        Bu JSON bir nesne veya dizi değil: <code>{{ displayValue(data) }}</code>
      </p>
      <p v-else-if="rows.length === 0" class="note">Filtreyle eşleşen alan yok.</p>

      <div v-else class="grid-canvas" :style="{ height: `${totalSize}px` }">
        <div
          v-for="vrow in virtualRows"
          :key="String(vrow.key)"
          :ref="measure"
          :data-index="vrow.index"
          class="vrow"
          :style="{ transform: `translateY(${vrow.start}px)` }"
        >
          <template v-if="rows[vrow.index]">
            <!-- Alan satiri -->
            <div
              v-if="rows[vrow.index].kind === 'row'"
              class="row"
              :class="{
                match: rows[vrow.index].matchKind === 'self',
                'match-deep': rows[vrow.index].matchKind === 'deep',
                selected: rows[vrow.index].path === selectedPath,
              }"
              @click="onRowClick(rows[vrow.index])"
            >
              <div class="cell cell-field">
                <span class="indent" :style="{ width: `${rows[vrow.index].depth * 18}px` }" />
                <button
                  v-if="rows[vrow.index].isContainer"
                  class="caret"
                  :aria-expanded="rows[vrow.index].isOpen"
                  :aria-label="rows[vrow.index].isOpen ? 'Kapat' : 'Aç'"
                  @click.stop="toggle(rows[vrow.index].path)"
                >{{ rows[vrow.index].isOpen ? '▾' : '▸' }}</button>
                <span v-else class="caret-ph" />
                <span class="field">{{ rows[vrow.index].field }}</span>
                <InfoBubble v-if="rows[vrow.index].doc">
                  <template #trigger>
                    <span
                      class="mark"
                      :class="rows[vrow.index].doc!.matchKind === 'INFERRED' ? 'guess-doc' : 'has-doc'"
                    >{{ rows[vrow.index].doc!.matchKind === 'INFERRED' ? '≈' : 'ⓘ' }}</span>
                  </template>
                  <FieldDocCard :field="rows[vrow.index].doc!" />
                </InfoBubble>
                <!-- Kok mesaj dugumunun XSD yolu bos oldugu icin isaretlenmez. -->
                <span
                  v-else-if="schemaKnown && rows[vrow.index].depth > 0"
                  class="mark no-doc"
                  title="Şemada karşılığı yok"
                >●</span>
              </div>

              <div class="cell cell-type">
                <span class="type-badge" :class="`t-${rows[vrow.index].type}`">{{ rows[vrow.index].type }}</span>
              </div>

              <div class="cell cell-value">
                <span v-if="rows[vrow.index].isContainer" class="summary">{{ rows[vrow.index].summary }}</span>
                <span v-else class="value" :class="`v-${rows[vrow.index].type}`">
                  {{ displayValue(rows[vrow.index].value!) }}
                </span>
                <button
                  v-if="rows[vrow.index].tableReady"
                  class="table-chip"
                  title="Bu diziyi tam ekran tabloda aç (kolon sıralama, filtre, CSV)"
                  @click.stop="emit('expandTable', rows[vrow.index].path)"
                >⊞ tablo</button>
                <button
                  v-if="rows[vrow.index].refTarget"
                  class="ref-chip"
                  :class="{ open: rows[vrow.index].refOpen }"
                  :title="`Referans: ${rows[vrow.index].refTarget!.idField} → ${rows[vrow.index].refTarget!.path}`"
                  @click.stop="toggleRef(rows[vrow.index].path)"
                >↳ referans</button>
                <span class="cell-spacer" />
                <button
                  v-if="commentsAvailable"
                  class="comment-chip"
                  :class="{ has: rows[vrow.index].commentCount! > 0, open: rows[vrow.index].threadOpen }"
                  :aria-label="rows[vrow.index].commentCount! > 0 ? `${rows[vrow.index].commentCount} yorum` : 'Yorum ekle'"
                  @click.stop="comments?.toggle(rows[vrow.index].path)"
                ><span>💬</span><span v-if="rows[vrow.index].commentCount! > 0">{{ rows[vrow.index].commentCount }}</span></button>
              </div>
            </div>

            <!-- Referans onizlemesi -->
            <div v-else-if="rows[vrow.index].kind === 'ref'" class="extra-row">
              <div class="ref-box" :style="{ marginLeft: `${(rows[vrow.index].depth + 1) * 18}px` }">
                <div class="ref-head">
                  <code class="ref-path">{{ rows[vrow.index].refTarget!.path }}</code>
                  <button class="ref-goto" @click="emit('focusPath', rows[vrow.index].refTarget!.path)">Hedefe git</button>
                </div>
                <div
                  v-for="field in previewFields(rows[vrow.index].refTarget!.value)"
                  :key="field.key"
                  class="ref-field"
                >
                  <span class="ref-key">{{ field.key }}</span>
                  <span class="ref-value" :style="{ color: field.color }">{{ field.text }}</span>
                </div>
              </div>
            </div>

            <!-- Yorum konusu -->
            <div v-else-if="rows[vrow.index].kind === 'thread' && comments" class="extra-row">
              <div :style="{ marginLeft: `${(rows[vrow.index].depth + 1) * 18}px` }">
                <CommentThread
                  :path="rows[vrow.index].path"
                  :comments="comments.commentsFor(rows[vrow.index].path)"
                  :author="comments.author.value"
                  :enabled="comments.enabled.value"
                  :can-delete="comments.canDelete"
                  @add="comments.add($event)"
                  @remove="comments.remove($event)"
                  @update:author="comments.author.value = $event"
                  @close="comments.toggle(rows[vrow.index].path)"
                />
              </div>
            </div>

            <!-- Dizi tablosu -->
            <div v-else-if="rows[vrow.index].kind === 'table'" class="extra-row">
              <div :style="{ marginLeft: `${(rows[vrow.index].depth + 1) * 18}px` }">
                <ArrayTable
                  :items="rows[vrow.index].items!"
                  :path="rows[vrow.index].path"
                  variant="inline"
                  @focus-path="emit('focusPath', $event)"
                  @expand="emit('expandTable', $event)"
                />
              </div>
            </div>

            <!-- Sayfalama -->
            <div v-else class="extra-row">
              <span class="indent" :style="{ width: `${rows[vrow.index].depth * 18}px` }" />
              <button class="more-btn" @click="showMore(rows[vrow.index].path)">
                {{ rows[vrow.index].pendingCount!.toLocaleString('tr-TR') }} satır daha göster
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid { display: flex; flex-direction: column; flex: 1; min-height: 0; }

.grid-head { display: grid; grid-template-columns: minmax(300px, 1fr) 84px minmax(220px, 1.4fr); background: var(--bg-secondary); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.hcell { padding: 8px 12px; font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; color: var(--text-secondary); }
.hcell-value { display: flex; align-items: center; gap: 8px; }
.head-tools { display: flex; gap: 4px; margin-left: auto; }
.head-tool { font-size: 10px; text-transform: none; letter-spacing: 0; color: var(--text-muted); border: 1px solid var(--border); border-radius: 4px; padding: 1px 7px; }
.head-tool:hover { color: var(--accent); border-color: var(--accent); }

.grid-body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.grid-canvas { position: relative; width: 100%; }
.vrow { position: absolute; top: 0; left: 0; width: 100%; }

.row { display: grid; grid-template-columns: minmax(300px, 1fr) 84px minmax(220px, 1.4fr); align-items: center; border-bottom: 1px solid var(--border-subtle); cursor: pointer; transition: background .1s; }
.row:hover { background: var(--bg-secondary); }
.row.match { background: var(--match-bg); }
.row.match-deep { background: var(--match-soft); }
.row.selected { background: var(--accent-wash); box-shadow: inset 2px 0 0 var(--accent); }

.cell { padding: var(--row-pad-y) 12px; min-width: 0; }
.cell-field { display: flex; align-items: center; font-family: 'JetBrains Mono', monospace; font-size: 12.5px; }
.cell-value { display: flex; align-items: center; gap: 8px; }
.cell-spacer { flex: 1; }

.indent { display: inline-block; flex-shrink: 0; }
.caret { width: 16px; flex-shrink: 0; color: var(--text-muted); font-size: 10px; text-align: center; }
.caret:hover { color: var(--text-primary); }
.caret-ph { display: inline-block; width: 16px; flex-shrink: 0; }
.field { color: var(--color-key); font-weight: 500; margin-left: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mark { margin-left: 6px; font-size: 9px; opacity: .75; flex-shrink: 0; }
.mark.has-doc { color: var(--accent); cursor: pointer; }
.mark.has-doc:hover { opacity: 1; }
/* Tahmini eslesme: semada karsiligi var ama ad tutmadi, yapidan cikarildi. */
.mark.guess-doc { color: var(--cyan); cursor: pointer; font-size: 11px; }
.mark.guess-doc:hover { opacity: 1; }
.mark.no-doc { color: var(--orange); }

.type-badge { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; }
.t-string { background: var(--bg-string); color: var(--color-string); }
.t-number { background: var(--bg-number); color: var(--color-number); }
.t-boolean { background: var(--bg-bool); color: var(--color-bool); }
.t-null { background: var(--bg-null); color: var(--color-null); }
.t-object { background: var(--bg-object); color: var(--purple); }
.t-array { background: var(--bg-array); color: var(--green); }

.value { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.v-string { color: var(--color-string); }
.v-number { color: var(--color-number); }
.v-boolean { color: var(--color-bool); }
.v-null { color: var(--color-null); font-style: italic; }
.summary { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; color: var(--text-muted); font-style: italic; }

.table-chip { font-size: 10px; color: var(--green); background: var(--bg-array); padding: 1px 8px; border-radius: 10px; white-space: nowrap; flex-shrink: 0; }
.table-chip:hover { background: var(--green-wash); }
.ref-chip { font-size: 10px; color: var(--accent); background: var(--accent-dim); padding: 1px 8px; border-radius: 10px; white-space: nowrap; flex-shrink: 0; }
.ref-chip:hover, .ref-chip.open { background: var(--accent-strong); }
.comment-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; color: var(--text-muted); opacity: .35; padding: 1px 7px; border-radius: 10px; white-space: nowrap; flex-shrink: 0; }
.comment-chip:hover { background: var(--bg-tertiary); opacity: 1; }
.comment-chip.has, .comment-chip.open { opacity: 1; color: var(--purple); }

.extra-row { display: flex; align-items: center; border-bottom: 1px solid var(--border-subtle); padding: 7px 12px; }
.extra-row > div { flex: 1; min-width: 0; }

.ref-box { border-left: 2px solid var(--accent); background: var(--accent-soft); border-radius: 0 6px 6px 0; padding: 7px 11px; }
.ref-head { display: flex; align-items: center; gap: 10px; margin-bottom: 5px; }
.ref-path { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--text-muted); word-break: break-all; }
.ref-goto { font-size: 10.5px; color: var(--accent); padding: 1px 8px; border-radius: 4px; border: 1px solid var(--border); white-space: nowrap; }
.ref-goto:hover { background: var(--accent-dim); }
.ref-field { display: flex; gap: 10px; padding: 2px 0; font-family: 'JetBrains Mono', monospace; font-size: 12px; }
.ref-key { color: var(--color-key); width: 110px; flex-shrink: 0; }
.ref-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.more-btn { font-size: 11px; color: var(--accent); background: var(--accent-dim); padding: 3px 10px; border-radius: 5px; }
.more-btn:hover { background: var(--accent-strong); }

.note { padding: 14px 16px; font-size: 12px; color: var(--text-muted); }
.note code { font-family: 'JetBrains Mono', monospace; color: var(--color-string); }

/* Dar goruntuleyicide kolonlar daralir; Deger sutunu asla tasmamali. */
@media (max-width: 1280px) {
  .grid-head, .row { grid-template-columns: minmax(200px, 1fr) 74px minmax(150px, 1.2fr); }
}
@media (max-width: 1024px) {
  .grid-head, .row { grid-template-columns: minmax(150px, 1fr) 66px minmax(110px, 1fr); }
  .cell { padding: var(--row-pad-y) 8px; }
}
</style>
