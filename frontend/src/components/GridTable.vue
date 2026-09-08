<script setup lang="ts">
import { computed, ref, watch, inject } from 'vue'
import type { FieldDoc, JsonObject, JsonValue } from '../types'
import { GRID } from '../utils/gridContext'
import { childPath, matchesDeep } from '../utils/search'
import { getType } from '../utils/json'
import type { RefTarget } from '../utils/references'
import {
  MAX_DETAIL_CHARS, cellText, childCount, clippedCount, columnStats, detailText, entriesOf,
  gridShape, highlightParts, isContainer, isLongValue, previewFields, recordColumns, searchText,
  sortRecords, summaryOf, toCsv, valueMeta,
  type ColumnKind, type GridColumn, type SortState,
} from '../utils/grid'
import InfoBubble from './InfoBubble.vue'
import FieldDocCard from './FieldDocCard.vue'
import CommentThread from './CommentThread.vue'

/**
 * Bir JSON dugumunu tablo olarak cizer ve ic ice degerler icin kendini yeniden
 * cagirir (Vue, SFC'nin kendi adiyla ozyinelemesine izin verir).
 *
 * Duzen **jsongrid**'in duzeni: anahtar solda kendi sutununda durur, degeri
 * sagindaki hucrede; deger bir kapsayiciysa hucre once `[±] Ad{}` basligini,
 * acikken de o dugumun tablosunu *kendi icinde* tasir. Her seviye kendi
 * cercevesini ciziyor, boylece merdiven gibi ic ice gecen bir tablo cikiyor.
 *
 * - nesne -> `anahtar | deger` (kapsayici deger hucrede aciliyor)
 * - nesne dizisi -> tutamak + `#` + kolonlar (kolonlar anahtarlarin birlesimi)
 * - diger dizi -> `# | deger`
 *
 * Tablo basliginin kosesindeki `[…]` tablo menusu, kolon basligindaki
 * `▽` huni ve `⋮` kolon menusu de ayni duzenden.
 */
const props = defineProps<{
  value: JsonValue
  path: string
  depth: number
}>()

const ctx = inject(GRID)!

const value = computed(() => props.value)
const path = computed(() => props.path)
const shape = computed(() => gridShape(value.value))

const term = computed(() => ctx.searchTerm.value.trim())
const needle = computed(() => term.value.toLowerCase())
const filtering = computed(() => ctx.filterMatches.value && term.value.length > 0)

const records = computed<JsonObject[] | null>(() =>
  shape.value === 'records' ? (value.value as JsonObject[]) : null,
)

/** Diziden cikarilan tum kolonlar (cok anahtarliysa en seyrek dolanlar kirpilir). */
const columnInfo = computed(() =>
  records.value ? recordColumns(records.value) : { columns: [] as GridColumn[], hidden: 0 },
)

/** Kullanicinin gizledigi kolonlar dusuldukten sonra gorunenler. */
const visibleColumns = computed(() => {
  const hiddenSet = ctx.hiddenColumns(path.value)
  return hiddenSet.size === 0
    ? columnInfo.value.columns
    : columnInfo.value.columns.filter(column => !hiddenSet.has(column.name))
})

/** Kolon basliklarindaki XSD aciklamalari; dizi indeksleri sema yolunda dusuyor. */
const columnDocs = computed<Array<FieldDoc | undefined>>(() =>
  visibleColumns.value.map(column => ctx.docFor(childPath(childPath(path.value, 0), column.name))),
)

// --- Kolon sirasi ve kolon filtreleri (yalnizca kayit tablosunda) -------------

const sort = ref<SortState | null>(null)
const filters = ref<Record<string, string>>({})
const filtersOpen = ref(false)
const filterInputs = ref<Record<string, HTMLInputElement | null>>({})

// Bilesen baska bir dugume baglanirsa yerel siralama/filtre gecersiz kalir.
watch(value, () => {
  sort.value = null
  filters.value = {}
})

function toggleSort(name: string) {
  if (sort.value?.column === name) {
    // Ucuncu tiklama sirayi kaldirir: kullanici JSON'daki sirayi geri alabilsin.
    sort.value = sort.value.dir === 'asc' ? { column: name, dir: 'desc' } : null
    return
  }
  sort.value = { column: name, dir: 'asc' }
}

function setSort(name: string, dir: 'asc' | 'desc' | null) {
  sort.value = dir === null ? null : { column: name, dir }
  closeMenu()
}

const activeFilters = computed(() =>
  Object.entries(filters.value)
    .map(([name, text]) => [name, text.trim().toLowerCase()] as const)
    .filter(([, text]) => text.length > 0),
)

function focusFilter(name: string) {
  filtersOpen.value = true
  closeMenu()
  // Filtre satiri yeni cizildiyse odak bir sonraki kareye kaliyor.
  requestAnimationFrame(() => filterInputs.value[name]?.focus())
}

// --- Satir modeli ------------------------------------------------------------

interface CellModel {
  path: string
  value: JsonValue | undefined
  text: string
  container: boolean
  count: number
  isArray: boolean
  long: boolean
  numeric: boolean
  missing: boolean
  matched: boolean
  tone: string | null
  refTarget: RefTarget | undefined
  /** Hucredeki `[+] ad` etiketinde ve menude gorunen ad. */
  label: string
}

interface RowModel {
  key: string
  lead: string
  leadMatched: boolean
  path: string
  index: number
  cells: CellModel[]
  doc: FieldDoc | undefined
  item: JsonObject | null
}

function makeCell(
  cellPath: string,
  cellValue: JsonValue | undefined,
  kind: ColumnKind,
  column: string | null,
  label: string,
): CellModel {
  const container = isContainer(cellValue)
  const text = cellText(cellValue)
  return {
    path: cellPath,
    value: cellValue,
    text,
    container,
    count: container ? childCount(cellValue) : 0,
    isArray: Array.isArray(cellValue),
    long: isLongValue(cellValue),
    numeric: kind === 'number',
    missing: cellValue === undefined,
    matched: !container && needle.value.length > 0 && text.toLowerCase().includes(needle.value),
    tone: statusTone(column, cellValue),
    refTarget: container || cellValue === undefined ? undefined : ctx.refFor(cellPath, cellValue),
    label,
  }
}

/**
 * Durum alanlari renkle okunur olsun: NDC'de `StatusCode` tabloya bakarken ilk
 * arananlardan. Renk tek basina anlam tasimiyor, degerin metni yaninda duruyor.
 */
function statusTone(column: string | null, cellValue: JsonValue | undefined): string | null {
  if (!column || typeof cellValue !== 'string' || !/status/i.test(column)) return null
  const text = cellValue.toUpperCase()
  if (/OPEN|OK|ACTIVE|CONFIRM|SUCCESS/.test(text)) return 'ok'
  if (/PEND|WARN|HOLD|PARTIAL/.test(text)) return 'warn'
  if (/CLOSE|CANCEL|VOID|EXPIRE|FAIL|ERROR/.test(text)) return 'off'
  return null
}

function kindOf(entry: JsonValue | undefined): ColumnKind {
  if (isContainer(entry)) return 'nested'
  return typeof entry === 'number' ? 'number' : 'text'
}

/** Nesne dugumunun alanlari: hepsi tek `anahtar | deger` tablosunda. */
const objectRows = computed<RowModel[]>(() => {
  if (shape.value !== 'object') return []
  return entriesOf(value.value)
    .filter(entry => !filtering.value
      || entry.key.toLowerCase().includes(needle.value)
      || matchesDeep(entry.value, term.value))
    .map((entry, position) => {
      const entryPath = childPath(path.value, entry.key)
      return {
        key: entry.key,
        lead: entry.key,
        leadMatched: needle.value.length > 0 && entry.key.toLowerCase().includes(needle.value),
        path: entryPath,
        index: position,
        item: null,
        doc: ctx.docFor(entryPath),
        cells: [makeCell(entryPath, entry.value, kindOf(entry.value), null, entry.key)],
      }
    })
})

/** Kayit / liste tablosunun satirlari. */
const rows = computed<RowModel[]>(() => {
  const items = records.value
  if (items) {
    let list = items.map((item, index) => ({ index, item }))
    for (const [name, text] of activeFilters.value) {
      list = list.filter(({ item }) => searchText(item[name]).toLowerCase().includes(text))
    }
    // "Yalniz eslesen" acikken tablo da filtrelenir; yoksa gorunum kendi
    // filtresiyle celisirdi.
    if (filtering.value) list = list.filter(({ item }) => matchesDeep(item, term.value))
    if (sort.value) {
      const kind = columnInfo.value.columns.find(c => c.name === sort.value!.column)?.kind ?? 'text'
      list = sortRecords(list, sort.value, kind)
    }
    return list.map(({ index, item }, position) => {
      const rowPath = childPath(path.value, index)
      return {
        key: String(index),
        lead: String(index),
        leadMatched: false,
        path: rowPath,
        index: position,
        item,
        doc: undefined,
        cells: visibleColumns.value.map(column =>
          makeCell(childPath(rowPath, column.name), item[column.name], column.kind, column.name, column.name)),
      }
    })
  }

  if (shape.value !== 'list') return objectRows.value

  return entriesOf(value.value)
    .filter(entry => !filtering.value || matchesDeep(entry.value, term.value))
    .map((entry, position) => {
      const entryPath = childPath(path.value, entry.key)
      return {
        key: entry.key,
        lead: entry.key,
        leadMatched: false,
        path: entryPath,
        index: position,
        item: null,
        doc: undefined,
        cells: [makeCell(entryPath, entry.value, kindOf(entry.value), null, `#${entry.key}`)],
      }
    })
})

const shown = computed(() => rows.value.slice(0, ctx.windowOf(path.value)))
const pending = computed(() => Math.max(0, rows.value.length - shown.value.length))

const leadLabel = computed(() => (shape.value === 'object' ? 'anahtar' : '#'))
/** Tutamak (yalnizca kayit tablosunda) + `#`/anahtar + deger kolonlari. */
const colspan = computed(() =>
  (records.value ? visibleColumns.value.length + 2 : 2))
const hiddenCount = computed(() => ctx.hiddenColumns(path.value).size)

/** Kayit tablosunun alt bilgi satiri: sayim, filtre ve sayisal kolon toplami. */
const footNote = computed(() => {
  if (!records.value) return ''
  const parts = [`${rows.value.length.toLocaleString('tr-TR')} / ${records.value.length.toLocaleString('tr-TR')} kayıt`]
  if (activeFilters.value.length > 0) parts.push(`${activeFilters.value.length} kolon filtresi`)
  const column = visibleColumns.value.find(c => c.name === sort.value?.column && c.kind === 'number')
    ?? visibleColumns.value.find(c => c.kind === 'number')
  if (column) {
    const total = rows.value.reduce((acc, row) => acc + (Number(row.item?.[column.name]) || 0), 0)
    parts.push(`Σ ${column.name} = ${total.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`)
  }
  if (columnInfo.value.hidden > 0) parts.push(`${columnInfo.value.hidden} kolon sığmadı`)
  if (hiddenCount.value > 0) parts.push(`${hiddenCount.value} kolon gizli`)
  return parts.join(' · ')
})

// --- Etkilesim ---------------------------------------------------------------

function onCellClick(cell: CellModel) {
  ctx.select(cell.path)
  ctx.setCursor(cell.path)
  if (cell.container) {
    if (cell.count > 0) ctx.toggle(cell.path)
    return
  }
  // Kirpilan degere tiklamak tam halini acar: kullanici once oraya tikliyor.
  if (cell.long) ctx.toggleDetail(cell.path)
}

function onLeadClick(row: RowModel) {
  ctx.select(row.path)
  if (records.value) ctx.toggle(row.path)
  else if (row.cells[0].container && row.cells[0].count > 0) ctx.toggle(row.cells[0].path)
}

// --- Menuler (kolon, hucre, satir, kolon secici) -----------------------------
/*
 * Menuler `position: fixed`: tablo kendi icinde kaydirildigi icin (genis kayit
 * tablolari) mutlak konumlu bir katman kirpilirdi.
 */
type MenuKind = 'column' | 'cell' | 'row' | 'columns' | 'table'
const menu = ref<{ kind: MenuKind; key: string; top: number; left: number } | null>(null)

function openMenu(kind: MenuKind, key: string, event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  menu.value = {
    kind,
    key,
    top: Math.min(rect.bottom + 4, window.innerHeight - 260),
    left: Math.min(rect.left, window.innerWidth - 300),
  }
}

function closeMenu() { menu.value = null }

/** Menudeki kolonun istatistigi; yalnizca menu acikken hesaplanir. */
const menuStats = computed(() => {
  const current = menu.value
  const items = records.value
  if (!current || current.kind !== 'column' || !items) return null
  return columnStats(items, current.key)
})

const menuCell = computed(() => {
  const current = menu.value
  if (!current || current.kind !== 'cell') return null
  for (const row of shown.value) {
    for (const cell of row.cells) if (cell.path === current.key) return { row, cell }
  }
  return null
})

const menuRow = computed(() => {
  const current = menu.value
  if (!current || current.kind !== 'row') return null
  return shown.value.find(row => row.path === current.key) ?? null
})

const copied = ref<string | null>(null)
let copyTimer: ReturnType<typeof setTimeout> | null = null

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = label
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copied.value = null }, 1500)
  } catch {
    copied.value = null
  }
  closeMenu()
}

function copyCellValue(cell: CellModel) {
  void copy(cell.container ? JSON.stringify(cell.value, null, 2) : String(cell.value ?? ''), 'değer')
}

function copyRow(row: RowModel) {
  void copy(JSON.stringify(row.item ?? row.cells[0]?.value ?? null, null, 2), 'satır')
}

function copyPath(target: string) {
  void copy(target.split('.').slice(1).join('.'), 'yol')
}

/** Kolonun butun degerleri: baska bir araca (Excel, jq) tasimanin kisa yolu. */
function copyColumn(name: string) {
  const items = records.value
  if (!items) return
  void copy(items.map(item => searchText(item[name])).join('\n'), 'kolon')
}

function hideColumn(name: string) {
  ctx.toggleColumn(path.value, name)
  closeMenu()
}

/** Yarisindan azinda dolu kolonlari gizler; genis tablolarda ilk hamle. */
function hideSparse() {
  const items = records.value
  if (!items) return
  const half = items.length / 2
  ctx.setHiddenColumns(
    path.value,
    columnInfo.value.columns.filter(column => column.filled < half).map(column => column.name),
  )
  closeMenu()
}

function downloadCsv() {
  if (!records.value) return
  const names = visibleColumns.value.map(column => column.name)
  const csv = toCsv(names, rows.value.map(row => row.item).filter((i): i is JsonObject => i !== null))
  // Excel'in UTF-8'i dogru okumasi icin BOM sart.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${path.value.split('.').filter(s => !/^\d+$/.test(s)).slice(-1)[0] ?? 'tablo'}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

// --- Gorunum yardimcilari ----------------------------------------------------

function parts(text: string) {
  return term.value ? highlightParts(text, term.value) : [{ text, hit: false }]
}

function typeClass(entry: JsonValue | undefined): string {
  return `v-${getType(entry === undefined ? null : entry)}`
}

function isMatch(text: string): boolean {
  return needle.value.length > 0 && text.toLowerCase().includes(needle.value)
}

function shortNumber(entry: number): string {
  return entry.toLocaleString('tr-TR', { maximumFractionDigits: 2 })
}

function kindLabel(kind: ColumnKind): string {
  return kind === 'number' ? 'num' : kind === 'nested' ? 'obj' : 'str'
}
</script>

<template>
  <div
    class="gt"
    :class="[`d-${Math.min(depth, 4)}`, shape, { dense: ctx.dense.value, root: depth === 0 }]"
  >
    <div class="scroll" :class="{ pan: records || depth === 0 }">
      <table class="table" :class="{ sticky: depth === 0 }">
        <!--
          Kolon genislikleri colgroup'tan geliyor: hucrelere yazilan `width`
          otomatik yerlesimde yalnizca bir *tercih*, tutamak kolonu bu yuzden
          250px'e kadar sisiyordu.
        -->
        <colgroup>
          <col v-if="records" class="col-handle" />
          <col class="col-lead" />
          <col v-if="!records" />
          <col v-for="column in visibleColumns" :key="column.name" />
        </colgroup>

        <thead v-if="records || shape === 'list'">
          <tr>
            <th v-if="records" class="th-handle">
              <!-- Kosedeki tablo menusu: filtre satiri, kolonlar, CSV -->
              <button class="table-menu" title="Tablo menüsü" @click="openMenu('table', path, $event)">…</button>
            </th>
            <th class="th-lead">{{ leadLabel }}</th>
            <th v-if="!records" class="th-value">değer</th>
            <th v-for="(column, ci) in visibleColumns" :key="column.name" class="th-col">
              <span class="th-row">
                <button
                  class="th-sort"
                  :class="{ active: sort?.column === column.name, hit: isMatch(column.name) }"
                  :title="`${column.name} · ${kindLabel(column.kind)} — sırala`"
                  @click="toggleSort(column.name)"
                >{{ column.name }}</button>
                <span v-if="sort?.column === column.name" class="th-arrow">
                  {{ sort.dir === 'asc' ? '▲' : '▼' }}
                </span>
                <InfoBubble v-if="columnDocs[ci]">
                  <template #trigger>
                    <span
                      class="mark"
                      :class="columnDocs[ci]!.matchKind === 'INFERRED' ? 'guess-doc' : 'has-doc'"
                    >{{ columnDocs[ci]!.matchKind === 'INFERRED' ? '≈' : 'ⓘ' }}</span>
                  </template>
                  <FieldDocCard :field="columnDocs[ci]!" />
                </InfoBubble>
                <button
                  class="th-funnel"
                  :class="{ on: (filters[column.name] ?? '').trim().length > 0 }"
                  :title="`${column.name} — filtrele`"
                  @click="focusFilter(column.name)"
                >▽</button>
                <button
                  class="th-menu"
                  :title="`${column.name} — kolon menüsü`"
                  @click="openMenu('column', column.name, $event)"
                >⋮</button>
              </span>
              <span class="th-kind">
                {{ kindLabel(column.kind) }}
                <template v-if="column.filled < records!.length">
                  · {{ column.filled }}/{{ records!.length }}
                </template>
              </span>
            </th>
          </tr>
          <tr v-if="records && filtersOpen" class="tr-filters">
            <th class="th-handle" />
            <th class="th-lead" />
            <th v-for="column in visibleColumns" :key="column.name">
              <input
                :ref="el => { filterInputs[column.name] = el as HTMLInputElement | null }"
                v-model="filters[column.name]"
                class="th-filter"
                type="text"
                placeholder="filtre"
                :class="{ filled: (filters[column.name] ?? '').length > 0 }"
                @click.stop
              />
            </th>
          </tr>
        </thead>

        <tbody>
          <template v-for="row in shown" :key="row.key">
            <tr
              class="tr"
              :class="{ selected: ctx.selectedPath.value === row.path }"
              :data-row-path="row.path"
            >
              <!-- Tutamak: satirin menusu -->
              <td v-if="records" class="td-handle" @click.stop="openMenu('row', row.path, $event)">⋮</td>

              <!-- Anahtar / indeks sutunu: jsongrid'in sol oluğu -->
              <td class="td-lead" :class="{ hit: row.leadMatched }" @click="onLeadClick(row)">
                <span class="lead-text">
                  <template v-for="(part, i) in parts(row.lead)" :key="i">
                    <mark v-if="part.hit" class="hl">{{ part.text }}</mark>
                    <template v-else>{{ part.text }}</template>
                  </template>
                </span>
                <InfoBubble v-if="row.doc">
                  <template #trigger>
                    <span
                      class="mark"
                      :class="row.doc.matchKind === 'INFERRED' ? 'guess-doc' : 'has-doc'"
                    >{{ row.doc.matchKind === 'INFERRED' ? '≈' : 'ⓘ' }}</span>
                  </template>
                  <FieldDocCard :field="row.doc" />
                </InfoBubble>
                <span
                  v-else-if="shape === 'object' && ctx.schemaKnown.value"
                  class="mark no-doc"
                  title="Şemada karşılığı yok"
                >●</span>
                <button
                  v-if="ctx.commentsAvailable.value"
                  class="comment"
                  :class="{ has: (ctx.comments?.countFor(row.path) ?? 0) > 0 }"
                  :aria-label="`${row.lead} — yorumlar`"
                  @click.stop="ctx.comments?.toggle(row.path)"
                >💬<template v-if="(ctx.comments?.countFor(row.path) ?? 0) > 0">{{ ctx.comments!.countFor(row.path) }}</template></button>
              </td>

              <td
                v-for="(cell, ci) in row.cells"
                :key="cell.path"
                class="td-cell"
                :class="[
                  typeClass(cell.value),
                  cell.tone ? `tone-${cell.tone}` : '',
                  {
                    nested: cell.container,
                    open: cell.container && ctx.isOpen(cell.path),
                    num: cell.numeric,
                    hit: cell.matched,
                    missing: cell.missing,
                    cursor: ctx.cursor.value === cell.path,
                  },
                ]"
                :data-cell-path="cell.path"
                :data-table="path"
                :data-row="row.index"
                :data-col="ci"
                @click="onCellClick(cell)"
              >
                <!--
                  Kapsayici deger: `[±] Ad{}` basligi ve acikken o dugumun
                  tablosu — hucrenin *icinde*. Ic ice gecen tablolar boyle
                  merdiven gibi diziliyor (jsongrid duzeni).
                -->
                <template v-if="cell.container">
                  <span class="nest-head" :class="{ empty: cell.count === 0 }">
                    <span v-if="cell.count > 0" class="sign">[{{ ctx.isOpen(cell.path) ? '−' : '+' }}]</span>
                    <span class="nest-name">{{ cell.label }}</span>
                    <span class="nest-count">
                      {{ cell.isArray ? `[${cell.count.toLocaleString('tr-TR')}]` : '{}' }}
                    </span>
                  </span>
                  <div v-if="cell.count > 0 && ctx.isOpen(cell.path)" class="nest-body" @click.stop>
                    <GridTable :value="cell.value!" :path="cell.path" :depth="depth + 1" />
                  </div>
                </template>

                <!-- Skaler deger -->
                <template v-else>
                  <span class="cell-inner">
                    <span class="val" :class="{ clipped: cell.long }">
                      <template v-for="(part, i) in parts(cell.text)" :key="i">
                        <mark v-if="part.hit" class="hl">{{ part.text }}</mark>
                        <template v-else>{{ part.text }}</template>
                      </template>
                    </span>
                    <button
                      v-if="cell.long"
                      class="cell-mark long"
                      :class="{ on: ctx.detailPath.value === cell.path }"
                      :title="ctx.detailPath.value === cell.path ? 'Tam değeri kapat' : 'Tam değeri aç'"
                      @click.stop="ctx.toggleDetail(cell.path)"
                    >{{ ctx.detailPath.value === cell.path ? '▴' : '⤢' }}</button>
                    <button
                      v-if="cell.refTarget"
                      class="cell-mark ref"
                      :class="{ on: ctx.refPath.value === cell.path }"
                      :title="`Referans: ${cell.refTarget.idField} → ${cell.refTarget.path}`"
                      @click.stop="ctx.toggleRef(cell.path)"
                    >↳</button>
                  </span>

                  <!-- Tam deger: hucrenin icinde, satir yerinden oynamadan -->
                  <div v-if="ctx.detailPath.value === cell.path" class="detail" @click.stop>
                    <div class="detail-head">
                      <span class="detail-meta">{{ valueMeta(cell.value) }}</span>
                      <div class="spacer" />
                      <button class="act" @click="copyCellValue(cell)">
                        {{ copied === 'değer' ? '✓ kopyalandı' : '⧉ kopyala' }}
                      </button>
                      <button class="act" title="Kapat" @click="ctx.toggleDetail(cell.path)">×</button>
                    </div>
                    <pre class="detail-body">{{ detailText(cell.value) }}</pre>
                    <p v-if="clippedCount(cell.value) > 0" class="detail-clip">
                      İlk {{ MAX_DETAIL_CHARS.toLocaleString('tr-TR') }} karakter gösteriliyor;
                      kalan {{ clippedCount(cell.value).toLocaleString('tr-TR') }} karakter için kopyalayın.
                    </p>
                  </div>

                  <!-- Referans onizlemesi -->
                  <div v-if="cell.refTarget && ctx.refPath.value === cell.path" class="refbox" @click.stop>
                    <div class="refbox-head">
                      <code class="refbox-path">{{ cell.refTarget.path.split('.').slice(1).join('.') }}</code>
                      <button class="act" @click="ctx.focusPath(cell.refTarget!.path)">hedefe git</button>
                    </div>
                    <div
                      v-for="field in previewFields(cell.refTarget.value)"
                      :key="field.key"
                      class="refbox-field"
                    >
                      <span class="refbox-key">{{ field.key }}</span>
                      <span class="refbox-value" :class="typeClass(field.value)">{{ cellText(field.value) }}</span>
                    </div>
                  </div>
                </template>

                <button
                  class="cell-menu"
                  :title="`${cell.label} — hücre menüsü`"
                  @click.stop="openMenu('cell', cell.path, $event)"
                >⋯</button>
              </td>
            </tr>

            <!-- Kayit satirinin tamami -->
            <tr v-if="records && ctx.isOpen(row.path)" class="tr-extra">
              <td :colspan="colspan">
                <div class="row-open">
                  <span class="row-open-head">
                    <button class="sign" title="Kapat" @click="ctx.toggle(row.path)">[−]</button>
                    <span class="nest-name">#{{ row.lead }}</span>
                    <span class="nest-count">{{ '{' }}{{ summaryOf(row.item!) }}{{ '}' }}</span>
                  </span>
                  <GridTable :value="row.item!" :path="row.path" :depth="depth + 1" />
                </div>
              </td>
            </tr>

            <!-- Yorum zinciri -->
            <tr v-if="ctx.commentsAvailable.value && ctx.comments?.openPath.value === row.path" class="tr-extra">
              <td :colspan="colspan">
                <CommentThread
                  :path="row.path"
                  :comments="ctx.comments.commentsFor(row.path)"
                  :author="ctx.comments.author.value"
                  :enabled="ctx.comments.enabled.value"
                  :can-delete="ctx.comments.canDelete"
                  @add="ctx.comments.add($event)"
                  @remove="ctx.comments.remove($event)"
                  @update:author="ctx.comments.author.value = $event"
                  @close="ctx.comments.toggle(row.path)"
                />
              </td>
            </tr>
          </template>

          <tr v-if="rows.length === 0" class="tr-extra">
            <td :colspan="colspan" class="note">
              {{ activeFilters.length > 0 || filtering ? 'Filtreyle eşleşen satır yok.' : 'Boş.' }}
            </td>
          </tr>

          <!-- Alt bilgi: sayim, filtre, toplam -->
          <tr v-if="footNote || pending > 0 || copied" class="tr-foot">
            <td :colspan="colspan" class="foot">
              <span class="foot-inner">
                <span v-if="footNote">{{ footNote }}</span>
                <template v-if="pending > 0">
                  <span v-if="footNote" class="foot-sep">·</span>
                  <span>{{ shown.length.toLocaleString('tr-TR') }} satır çizildi</span>
                  <button class="act" @click="ctx.grow(path)">daha fazla göster</button>
                </template>
                <span v-if="copied" class="foot-ok">✓ {{ copied }} kopyalandı</span>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Menuler: sabit konumlu katman, arkasinda kapatan bir yuzey -->
    <template v-if="menu">
      <div class="menu-backdrop" @click="closeMenu" @contextmenu.prevent="closeMenu" />
      <div class="menu" :style="{ top: `${menu.top}px`, left: `${menu.left}px` }">
        <template v-if="menu.kind === 'table'">
          <div class="menu-head">tablo</div>
          <button class="menu-item" @click="filtersOpen = !filtersOpen; closeMenu()">
            {{ filtersOpen ? '▽ filtre satırını kapat' : '▽ filtre satırını aç' }}
          </button>
          <button class="menu-item" @click="openMenu('columns', path, $event)">⚙ kolonlar…</button>
          <button class="menu-item" @click="downloadCsv(); closeMenu()">⤓ CSV indir</button>
          <template v-if="sort">
            <div class="menu-sep" />
            <button class="menu-item" @click="setSort(sort!.column, null)">× sıralamayı kaldır</button>
          </template>
        </template>

        <template v-else-if="menu.kind === 'column'">
          <div class="menu-head">{{ menu.key }}</div>
          <button class="menu-item" @click="setSort(menu.key, 'asc')">↑ artan sırala</button>
          <button class="menu-item" @click="setSort(menu.key, 'desc')">↓ azalan sırala</button>
          <button
            v-if="sort?.column === menu.key"
            class="menu-item"
            @click="setSort(menu.key, null)"
          >× sıralamayı kaldır (JSON sırası)</button>
          <button class="menu-item" @click="focusFilter(menu.key)">▽ bu kolonu filtrele</button>
          <div class="menu-sep" />
          <div v-if="menuStats" class="menu-stats">
            <div class="stat-row">
              <span>farklı değer</span><strong>{{ menuStats.distinct.toLocaleString('tr-TR') }}</strong>
            </div>
            <div class="stat-row">
              <span>alan yok</span><strong>{{ menuStats.missing.toLocaleString('tr-TR') }}</strong>
            </div>
            <div v-if="menuStats.nulls > 0" class="stat-row">
              <span>null</span><strong>{{ menuStats.nulls.toLocaleString('tr-TR') }}</strong>
            </div>
            <template v-if="menuStats.numeric">
              <div class="stat-row"><span>en küçük</span><strong>{{ shortNumber(menuStats.numeric.min) }}</strong></div>
              <div class="stat-row"><span>en büyük</span><strong>{{ shortNumber(menuStats.numeric.max) }}</strong></div>
              <div class="stat-row"><span>toplam</span><strong>{{ shortNumber(menuStats.numeric.sum) }}</strong></div>
              <div class="stat-row"><span>ortalama</span><strong>{{ shortNumber(menuStats.numeric.avg) }}</strong></div>
            </template>
            <div class="stat-top">
              <div
                v-for="entry in menuStats.top"
                :key="entry.value"
                class="stat-bar"
                :title="`${entry.value}: ${entry.count}`"
              >
                <span class="stat-label">{{ entry.value || '(boş)' }}</span>
                <span class="stat-track">
                  <span
                    class="stat-fill"
                    :style="{ width: `${Math.max(4, (entry.count / (menuStats.top[0]?.count || 1)) * 100)}%` }"
                  />
                </span>
                <span class="stat-count">{{ entry.count.toLocaleString('tr-TR') }}</span>
              </div>
            </div>
            <p v-if="menuStats.truncated" class="menu-note">
              ilk {{ menuStats.scanned.toLocaleString('tr-TR') }} kayıt tarandı
            </p>
          </div>
          <div class="menu-sep" />
          <button class="menu-item" @click="copyColumn(menu.key)">⧉ kolonun değerlerini kopyala</button>
          <button class="menu-item" @click="hideColumn(menu.key)">⊘ kolonu gizle</button>
        </template>

        <template v-else-if="menu.kind === 'cell' && menuCell">
          <div class="menu-head">{{ menuCell.cell.label }}</div>
          <button class="menu-item" @click="copyCellValue(menuCell.cell)">⧉ değeri kopyala</button>
          <button class="menu-item" @click="copyPath(menuCell.cell.path)">⧉ yolu kopyala</button>
          <template v-if="menuCell.cell.container && menuCell.cell.count > 0">
            <div class="menu-sep" />
            <button class="menu-item" @click="ctx.toggle(menuCell.cell.path); closeMenu()">
              {{ ctx.isOpen(menuCell.cell.path) ? '[−] hücreyi kapat' : '[+] hücrede aç' }}
            </button>
          </template>
          <template v-if="menuCell.cell.long">
            <div class="menu-sep" />
            <button class="menu-item" @click="ctx.toggleDetail(menuCell.cell.path); closeMenu()">
              ⤢ tam değeri aç
            </button>
          </template>
        </template>

        <template v-else-if="menu.kind === 'row' && menuRow">
          <div class="menu-head">{{ records ? `satır #${menuRow.lead}` : menuRow.lead }}</div>
          <button v-if="records" class="menu-item" @click="ctx.toggle(menuRow.path); closeMenu()">
            {{ ctx.isOpen(menuRow.path) ? '[−] satırın tamamını kapat' : '[+] satırın tamamını aç' }}
          </button>
          <button class="menu-item" @click="copyRow(menuRow)">⧉ satırı JSON olarak kopyala</button>
          <button class="menu-item" @click="copyPath(menuRow.path)">⧉ yolu kopyala</button>
          <template v-if="ctx.commentsAvailable.value">
            <div class="menu-sep" />
            <button class="menu-item" @click="ctx.comments?.toggle(menuRow.path); closeMenu()">
              💬 yorumlar
            </button>
          </template>
        </template>

        <template v-else-if="menu.kind === 'columns'">
          <div class="menu-head">kolonlar</div>
          <div class="menu-cols">
            <label v-for="column in columnInfo.columns" :key="column.name" class="menu-col">
              <input
                type="checkbox"
                :checked="!ctx.hiddenColumns(path).has(column.name)"
                @change="ctx.toggleColumn(path, column.name)"
              />
              <span class="menu-col-name">{{ column.name }}</span>
              <span class="menu-col-fill">{{ column.filled }}/{{ records?.length ?? 0 }}</span>
            </label>
          </div>
          <div class="menu-sep" />
          <button class="menu-item" @click="ctx.setHiddenColumns(path, []); closeMenu()">
            hepsini göster
          </button>
          <button class="menu-item" @click="hideSparse">yarısından azında dolu olanları gizle</button>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
/*
 * jsongrid duzeni: her seviye kendi cercevesini ciziyor, anahtar solda kendi
 * sutununda duruyor, kapsayici deger hucrenin *icinde* aciliyor. Boylece ic
 * ice gecen tablolar merdiven gibi diziliyor ve her hucrenin hangi anahtara
 * ait oldugu her zaman solunda yaziyor.
 */
.gt { min-width: 0; }
.spacer { flex: 1; }

/* Genis kayit tablolari kendi icinde yatay kaydirilir; sayfa asla kaymaz. */
.scroll.pan { overflow-x: auto; }
.table { border-collapse: separate; border-spacing: 0; width: max-content; max-width: 100%; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-primary); }
.object > .scroll > .table { width: 100%; }
/*
 * Hucrenin icindeki tablo icerigi kadar genis olabilir ve hucreyi genisletir:
 * `max-width: 100%` ile sinirliyken `TotalAmount 1000` degeri kirpiliyordu.
 * Tasma en dista, goruntuleyicinin kaydiran kutusunda karsilaniyor.
 */
.gt:not(.root) .table { margin-top: 5px; max-width: none; }

th, td { border-right: 1px solid var(--border-subtle); border-bottom: 1px solid var(--border-subtle); vertical-align: top; text-align: left; }
th:last-child, td:last-child { border-right: none; }
tbody tr:last-child > td { border-bottom: none; }

thead th { background: var(--bg-secondary); padding: 3px 8px; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; color: var(--text-muted); white-space: nowrap; border-bottom: 1px solid var(--border); }
/* Yalnizca kok tablonun basligi yapisir: kaydiran kutu goruntuleyicinin kendisi. */
.table.sticky thead th { position: sticky; top: 0; z-index: 3; }
.th-row { display: inline-flex; align-items: center; gap: 3px; }
.col-handle { width: 22px; }
.col-lead { width: 0.1%; }
/* Tablo tasarken kolonlar oransal daralir; tutamak icin taban genislik. */
.th-handle, .td-handle { min-width: 20px; }
.th-handle { padding: 0; text-align: center; }
/*
 * Tutamak ve anahtar kolonu yatay kaydirmada yerinde durur: 11 kolonlu bir
 * tabloda saga kayarken hangi satirda oldugunu gosteren tek sey o.
 */
.th-handle, .th-lead { position: sticky; z-index: 2; background: var(--bg-secondary); }
.th-handle { left: 0; }
.th-lead { left: 22px; min-width: 34px; }
.object > .scroll > .table .th-lead { left: 0; }
.table.sticky thead .th-handle, .table.sticky thead .th-lead { z-index: 4; }
.th-col { max-width: 260px; }
.th-sort { font-family: inherit; font-size: 11px; font-weight: 700; color: var(--text-secondary); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-decoration: underline dotted var(--border); }
.th-sort:hover, .th-sort.active { color: var(--accent); text-decoration-color: var(--accent); }
.th-sort.hit { color: var(--orange); }
.th-arrow { font-size: 8px; color: var(--accent); }
.th-funnel, .th-menu { font-size: 9px; color: var(--text-muted); opacity: .5; padding: 0 2px; border-radius: 3px; }
.th-col:hover .th-funnel, .th-col:hover .th-menu { opacity: 1; }
.th-funnel:hover, .th-menu:hover { color: var(--accent); background: var(--accent-dim); }
.th-funnel.on { opacity: 1; color: var(--accent); }
.th-menu { font-size: 10px; }
.th-kind { display: block; font-size: 9px; font-weight: 400; color: var(--text-muted); }
/* Kosedeki tablo menusu (jsongrid'in mavi `…` dugmesi). */
.table-menu { font-size: 11px; line-height: 1; color: var(--accent); background: var(--accent-dim); border-radius: 3px; padding: 0 3px; }
.table-menu:hover { background: var(--accent-strong); }
.tr-filters th { position: static; background: var(--bg-primary); padding: 3px 5px; }
.tr-filters .th-handle, .tr-filters .th-lead { position: sticky; background: var(--bg-primary); }
.th-filter { width: 100%; min-width: 62px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 4px; outline: none; color: var(--text-primary); font-family: 'JetBrains Mono', monospace; font-size: 10.5px; padding: 2px 6px; }
.th-filter.filled, .th-filter:focus { border-color: var(--accent); }

.tr:hover > td { background: var(--bg-secondary); }
.tr.selected > td { background: var(--accent-wash); }
.tr.selected > .td-lead, .tr.selected > .td-handle { box-shadow: inset 2px 0 0 var(--accent); }

.td-handle { width: 22px; padding: 4px 0; text-align: center; font-size: 11px; line-height: 1; color: var(--text-muted); cursor: pointer; position: sticky; left: 0; z-index: 1; background: var(--bg-primary); }
.td-handle:hover { color: var(--accent); background: var(--accent-dim); }
/* Anahtar sutunu: jsongrid'in sol olugu — kaydirmada yerinde kalir. */
.td-lead { padding: 5px 8px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--color-key); white-space: nowrap; cursor: pointer; width: 1%; position: sticky; left: 22px; z-index: 1; background: var(--bg-secondary); }
.object > .scroll > .table .td-lead { left: 0; }
.td-lead.hit { background: var(--match-bg); }
/* Kayit/liste tablosunda indeks silik ve saga dayali: goz kolonlara gider. */
.records > .scroll > .table > tbody > tr > .td-lead,
.list > .scroll > .table > tbody > tr > .td-lead { color: var(--text-muted); text-align: right; background: var(--bg-primary); }

/*
 * Hucre icerigi tek satirda kalir: isaret (uzun deger / referans) alt satira
 * kaymasin, kolon genislesin. Satir yukseklikleri boyle esit kaliyor.
 */
.td-cell { position: relative; padding: 5px 8px; font-family: 'JetBrains Mono', monospace; font-size: 12px; max-width: 460px; cursor: pointer; white-space: nowrap; }
.td-cell.num { text-align: right; }
.td-cell.hit { background: var(--match-bg); }
.td-cell.missing { background: var(--bg-secondary); }
.td-cell.open { background: var(--bg-secondary); }
/* Klavye imleci: hangi hucrede oldugunu her zaman gosterir. */
.td-cell.cursor { outline: 2px solid var(--accent); outline-offset: -2px; }
.cell-inner { display: flex; align-items: baseline; gap: 4px; min-width: 0; }
.td-cell.num .cell-inner { justify-content: flex-end; }
.val { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.val.clipped { cursor: zoom-in; }
.cell-mark, .comment { flex-shrink: 0; }
.v-string .val { color: var(--color-string); }
.v-number .val { color: var(--color-number); }
.v-boolean .val { color: var(--color-bool); }
.v-null .val { color: var(--color-null); font-style: italic; }
.tone-ok .val { color: var(--green); }
.tone-warn .val { color: var(--orange); }
.tone-off .val { color: var(--text-muted); }
.hl { background: var(--match-bg); color: var(--orange); border-radius: 2px; padding: 0 1px; }

/* Kapsayici basligi: `[±] Ad{}` — isaret kutusu, ad, sayi. */
.nest-head { display: inline-flex; align-items: baseline; gap: 5px; white-space: nowrap; }
.sign { font-size: 10.5px; color: var(--text-secondary); border: 1px solid var(--border); border-radius: 3px; padding: 0 3px; }
.td-cell.nested:hover > .nest-head .sign { color: var(--accent); border-color: var(--accent); }
.nest-name { font-size: 11.5px; color: var(--color-key); }
.nest-count { font-size: 11px; color: var(--text-muted); }
.nest-head.empty .nest-name, .nest-head.empty .nest-count { opacity: .55; }
.nest-body { cursor: default; white-space: normal; }

.cell-mark { font-size: 10px; padding: 0 3px; border-radius: 3px; white-space: nowrap; }
.cell-mark.long { color: var(--cyan); }
.cell-mark.long:hover, .cell-mark.long.on { color: var(--accent); background: var(--accent-dim); }
.cell-mark.ref { color: var(--accent); font-size: 11px; }
.cell-mark.ref:hover, .cell-mark.ref.on { background: var(--accent-dim); }
.comment { font-size: 10.5px; margin-left: 5px; color: var(--text-muted); opacity: .4; padding: 0 4px; border-radius: 8px; }
.comment:hover { opacity: 1; }
.comment.has { opacity: 1; color: var(--purple); background: var(--bg-object); }

.mark { margin-left: 5px; font-size: 9px; opacity: .75; }
.mark.has-doc { color: var(--accent); cursor: pointer; }
.mark.guess-doc { color: var(--cyan); cursor: pointer; font-size: 11px; }
.mark.no-doc { color: var(--orange); }
.mark:hover { opacity: 1; }

/*
 * Hucre menusu yalnizca *uzerinde durulan* hucrede gorunur; secici dogrudan
 * cocuga bagli, cunku ic ice tablolar hucrenin icinde duruyor.
 */
.cell-menu { position: absolute; top: 1px; right: 1px; font-size: 11px; line-height: 1; color: var(--text-muted); opacity: 0; padding: 1px 3px; border-radius: 3px; background: var(--bg-secondary); }
.td-cell.num > .cell-menu { left: 1px; right: auto; }
.td-cell:hover > .cell-menu { opacity: .8; }
.cell-menu:hover { opacity: 1 !important; color: var(--accent); background: var(--accent-dim); }

.detail { margin: 5px 0 3px; border-left: 2px solid var(--cyan); background: var(--bg-secondary); border-radius: 0 6px 6px 0; padding: 5px 9px; cursor: default; white-space: normal; }
.detail-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.detail-meta { font-size: 10.5px; color: var(--text-muted); }
.detail-body { margin: 0; font-family: 'JetBrains Mono', monospace; font-size: 12px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 300px; overflow-y: auto; color: var(--text-primary); }
.detail-clip { margin: 5px 0 0; font-size: 10.5px; color: var(--orange); }

.refbox { margin: 5px 0 3px; border-left: 2px solid var(--accent); background: var(--accent-soft); border-radius: 0 6px 6px 0; padding: 5px 9px; cursor: default; white-space: normal; }
.refbox-head { display: flex; align-items: center; gap: 9px; margin-bottom: 3px; }
.refbox-path { font-size: 10.5px; color: var(--text-muted); word-break: break-all; }
.refbox-field { display: flex; gap: 9px; font-size: 11.5px; padding: 1px 0; }
.refbox-key { color: var(--color-key); min-width: 104px; }

.tr-extra > td { padding: 6px 8px; background: var(--bg-secondary); }
.row-open-head { display: inline-flex; align-items: baseline; gap: 6px; font-family: 'JetBrains Mono', monospace; }
.tr-foot > td { padding: 4px 8px; background: var(--bg-primary); }
.foot { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--text-muted); }
.foot-inner { display: flex; align-items: center; gap: 8px; }
.foot-sep { opacity: .5; }
.foot-ok { color: var(--green); }
.note { padding: 6px 8px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-muted); }
.act { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--text-secondary); border: 1px solid var(--border); border-radius: 5px; padding: 1px 8px; white-space: nowrap; }
.act:hover { color: var(--accent); border-color: var(--accent); }

/* Sik yerlesim: ayni ekranda gorunur satir sayisi ~%40 artiyor. */
.gt.dense .td-lead, .gt.dense .td-cell { padding: 1px 6px; font-size: 11.5px; }
.gt.dense .td-handle { padding: 1px 0; }
.gt.dense thead th { padding: 2px 6px; }
.gt.dense .th-kind { display: none; }

/* --- Menuler --------------------------------------------------------------- */
.menu-backdrop { position: fixed; inset: 0; z-index: 60; }
.menu { position: fixed; z-index: 61; width: 272px; max-height: 70vh; overflow-y: auto; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 8px; box-shadow: var(--shadow-popover); padding: 5px; font-family: 'JetBrains Mono', monospace; }
.menu-head { padding: 4px 8px 6px; font-size: 10.5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .4px; overflow: hidden; text-overflow: ellipsis; }
.menu-item { display: block; width: 100%; text-align: left; font-family: inherit; font-size: 11.5px; color: var(--text-primary); padding: 5px 8px; border-radius: 5px; }
.menu-item:hover { background: var(--accent-dim); color: var(--accent); }
.menu-sep { height: 1px; background: var(--border-subtle); margin: 4px 2px; }
.menu-note { margin: 4px 8px 0; font-size: 10px; color: var(--orange); }

.menu-stats { padding: 2px 8px; font-size: 11px; }
.stat-row { display: flex; justify-content: space-between; gap: 10px; padding: 1px 0; color: var(--text-muted); }
.stat-row strong { color: var(--text-primary); font-weight: 600; }
.stat-top { margin-top: 6px; display: flex; flex-direction: column; gap: 3px; }
.stat-bar { display: grid; grid-template-columns: 1fr 54px auto; align-items: center; gap: 6px; font-size: 10.5px; }
.stat-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); }
.stat-track { height: 4px; background: var(--bg-tertiary); border-radius: 2px; overflow: hidden; }
/* Tek renk, tek anlam: yuksek deger daha dolu bir cubuk. */
.stat-fill { display: block; height: 100%; background: var(--accent); }
.stat-count { color: var(--text-muted); }

.menu-cols { max-height: 220px; overflow-y: auto; }
.menu-col { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 7px; padding: 3px 8px; font-size: 11.5px; border-radius: 5px; cursor: pointer; }
.menu-col:hover { background: var(--bg-secondary); }
.menu-col-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); }
.menu-col-fill { font-size: 10px; color: var(--text-muted); }
</style>
