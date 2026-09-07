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
  sortRecords, toCsv, valueMeta,
  type ColumnKind, type GridColumn, type SortState,
} from '../utils/grid'
import InfoBubble from './InfoBubble.vue'
import FieldDocCard from './FieldDocCard.vue'
import CommentThread from './CommentThread.vue'

/**
 * Bir JSON dugumunu tablo olarak cizer ve ic ice degerler icin kendini yeniden
 * cagirir (Vue, SFC'nin kendi adiyla ozyinelemesine izin verir).
 *
 * Tablo bicimi dugumun seklinden geliyor: nesne -> anahtar/deger, nesne dizisi
 * -> kayit tablosu, diger dizi -> indeks/deger. Ic ice bir deger tiklanan
 * *hucrenin icinde*, adini tasiyan bir bant basligiyla aciliyor; hicbir tiklama
 * gorunumu degistirmiyor.
 *
 * Kolon basligindaki `⋮` menusu jsongrid'deki kolon menusunun karsiligi ama
 * daha fazlasini yapiyor: siralama, filtre, **kolon istatistigi** (kac farkli
 * deger, eksik alan, sayisal ozet), kolonu gizleme ve kolonun degerlerini
 * kopyalama.
 */
const props = defineProps<{
  value: JsonValue
  path: string
  depth: number
}>()

const ctx = inject(GRID)!

const shape = computed(() => gridShape(props.value))
const term = computed(() => ctx.searchTerm.value.trim())
const needle = computed(() => term.value.toLowerCase())
const filtering = computed(() => ctx.filterMatches.value && term.value.length > 0)

const records = computed<JsonObject[] | null>(() =>
  shape.value === 'records' ? (props.value as JsonObject[]) : null,
)

/** Diziden cikarilan tum kolonlar (cok anahtarliysa en seyrek dolanlar kirpilir). */
const columnInfo = computed(() =>
  records.value ? recordColumns(records.value) : { columns: [] as GridColumn[], hidden: 0 },
)

/** Kullanicinin gizledigi kolonlar dusuldukten sonra gorunenler. */
const visibleColumns = computed(() => {
  const hidden = ctx.hiddenColumns(props.path)
  return hidden.size === 0
    ? columnInfo.value.columns
    : columnInfo.value.columns.filter(column => !hidden.has(column.name))
})

/** Kolon basliklarindaki XSD aciklamalari; dizi indeksleri sema yolunda dusuyor. */
const columnDocs = computed<Array<FieldDoc | undefined>>(() =>
  visibleColumns.value.map(column => ctx.docFor(childPath(childPath(props.path, 0), column.name))),
)

// --- Kolon sirasi ve kolon filtreleri (yalnizca kayit tablosunda) -------------

const sort = ref<SortState | null>(null)
const filters = ref<Record<string, string>>({})
const filtersOpen = ref(false)

// Bilesen baska bir dugume baglanirsa yerel siralama/filtre gecersiz kalir.
watch(() => props.value, () => {
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
  requestAnimationFrame(() => {
    const input = filterInputs.value[name]
    input?.focus()
  })
}

const filterInputs = ref<Record<string, HTMLInputElement | null>>({})

// --- Satir modeli ------------------------------------------------------------

interface CellModel {
  path: string
  value: JsonValue | undefined
  /** Hucrede gorunen tek satirlik metin. */
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
  /** Ic ice tablonun bant basliginda gorunen ad. */
  label: string
}

interface RowModel {
  key: string
  lead: string
  leadMatched: boolean
  path: string
  /** Gorunen sira; klavye gezinmesi bunu kullaniyor. */
  index: number
  cells: CellModel[]
  doc: FieldDoc | undefined
  /** Kayit tablosunda satirin kaynak nesnesi. */
  item: JsonObject | null
}

function makeCell(
  path: string,
  value: JsonValue | undefined,
  kind: ColumnKind,
  column: string | null,
  label: string,
): CellModel {
  const container = isContainer(value)
  const text = cellText(value)
  return {
    path,
    value,
    text,
    container,
    count: container ? childCount(value) : 0,
    isArray: Array.isArray(value),
    long: isLongValue(value),
    numeric: kind === 'number',
    missing: value === undefined,
    matched: !container && needle.value.length > 0 && text.toLowerCase().includes(needle.value),
    tone: statusTone(column, value),
    refTarget: container || value === undefined ? undefined : ctx.refFor(path, value),
    label,
  }
}

/**
 * Durum alanlari renkle okunur olsun: NDC'de `StatusCode` tabloya bakarken ilk
 * arananlardan. Renk tek basina anlam tasimiyor, degerin metni yaninda duruyor.
 */
function statusTone(column: string | null, value: JsonValue | undefined): string | null {
  if (!column || typeof value !== 'string' || !/status/i.test(column)) return null
  const text = value.toUpperCase()
  if (/OPEN|OK|ACTIVE|CONFIRM|SUCCESS/.test(text)) return 'ok'
  if (/PEND|WARN|HOLD|PARTIAL/.test(text)) return 'warn'
  if (/CLOSE|CANCEL|VOID|EXPIRE|FAIL|ERROR/.test(text)) return 'off'
  return null
}

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
      const rowPath = childPath(props.path, index)
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

  return entriesOf(props.value)
    .filter(entry => !filtering.value
      || entry.key.toLowerCase().includes(needle.value)
      || matchesDeep(entry.value, term.value))
    .map((entry, position) => {
      const path = childPath(props.path, entry.key)
      const kind: ColumnKind = isContainer(entry.value)
        ? 'nested'
        : typeof entry.value === 'number' ? 'number' : 'text'
      return {
        key: entry.key,
        lead: entry.key,
        leadMatched: needle.value.length > 0 && entry.key.toLowerCase().includes(needle.value),
        path,
        index: position,
        item: null,
        doc: shape.value === 'object' ? ctx.docFor(path) : undefined,
        cells: [makeCell(path, entry.value, kind, null, entry.key)],
      }
    })
})

const shown = computed(() => rows.value.slice(0, ctx.windowOf(props.path)))
const pending = computed(() => Math.max(0, rows.value.length - shown.value.length))

const leadLabel = computed(() => (shape.value === 'object' ? 'anahtar' : '#'))
const colspan = computed(() => (records.value ? visibleColumns.value.length + 1 : 2))
const hiddenCount = computed(() => ctx.hiddenColumns(props.path).size)

/** Kayit tablosunda toplam; siralanan kolon sayisalsa o, degilse ilk sayisal kolon. */
const sumColumn = computed(() => {
  if (!records.value) return null
  const list = visibleColumns.value
  return list.find(c => c.name === sort.value?.column && c.kind === 'number')
    ?? list.find(c => c.kind === 'number')
    ?? null
})

const sumValue = computed(() => {
  const column = sumColumn.value
  if (!column) return null
  const total = rows.value.reduce((acc, row) => acc + (Number(row.item?.[column.name]) || 0), 0)
  return total.toLocaleString('tr-TR', { maximumFractionDigits: 2 })
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
  // Kayit satirinin indeksi satirin tamamini altta acar; nesne tablosunda
  // anahtar hucresi degerin kendisini acar.
  if (records.value) ctx.toggle(row.path)
  else if (row.cells[0].container && row.cells[0].count > 0) ctx.toggle(row.cells[0].path)
}

// --- Menuler (kolon ve hucre) ------------------------------------------------
/*
 * Menuler `position: fixed`: tablo kendi icinde kaydirildigi icin (genis kayit
 * tablolari) mutlak konumlu bir katman kirpilirdi.
 */
type MenuKind = 'column' | 'cell' | 'columns'
const menu = ref<{ kind: MenuKind; key: string; top: number; left: number } | null>(null)

function openMenu(kind: MenuKind, key: string, event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  menu.value = {
    kind,
    key,
    top: Math.min(rect.bottom + 4, window.innerHeight - 240),
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
  const value = row.item ?? row.cells[0]?.value ?? null
  void copy(JSON.stringify(value, null, 2), 'satır')
}

function copyPath(path: string) {
  void copy(path.split('.').slice(1).join('.'), 'yol')
}

/** Kolonun butun degerleri: baska bir araca (Excel, jq) tasimanin kisa yolu. */
function copyColumn(name: string) {
  const items = records.value
  if (!items) return
  void copy(items.map(item => searchText(item[name])).join('\n'), 'kolon')
}

function hideColumn(name: string) {
  ctx.toggleColumn(props.path, name)
  closeMenu()
}

/** Tek bir kaydi dahi doldurmayan kolonlari gizler; genis tablolarda ilk hamle. */
function hideSparse() {
  const items = records.value
  if (!items) return
  const half = items.length / 2
  ctx.setHiddenColumns(
    props.path,
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
  link.download = `${props.path.split('.').filter(s => !/^\d+$/.test(s)).slice(-1)[0] ?? 'tablo'}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

// --- Gorunum yardimcilari ----------------------------------------------------

function parts(text: string) {
  return term.value ? highlightParts(text, term.value) : [{ text, hit: false }]
}

function typeClass(value: JsonValue | undefined): string {
  return `v-${getType(value === undefined ? null : value)}`
}

function isMatch(text: string): boolean {
  return needle.value.length > 0 && text.toLowerCase().includes(needle.value)
}

function shortNumber(value: number): string {
  return value.toLocaleString('tr-TR', { maximumFractionDigits: 2 })
}
</script>

<template>
  <div class="gt" :class="[`d-${Math.min(depth, 4)}`, shape, { dense: ctx.dense.value }]">
    <!-- Kayit tablosu seridi: sayim, siralama durumu, kolonlar, CSV -->
    <div v-if="records" class="gt-bar">
      <span class="gt-count">{{ rows.length.toLocaleString('tr-TR') }} kayıt</span>
      <span class="gt-dim">{{ visibleColumns.length }}/{{ columnInfo.columns.length }} kolon</span>
      <span v-if="columnInfo.hidden > 0" class="gt-warn">
        {{ columnInfo.hidden }} kolon sığmadı
      </span>
      <span v-if="sort" class="gt-sort">{{ sort.column }} {{ sort.dir === 'asc' ? '↑' : '↓' }}</span>
      <span v-if="activeFilters.length > 0" class="gt-sort">
        {{ activeFilters.length }} kolon filtresi
      </span>
      <span v-if="sumColumn" class="gt-dim">Σ {{ sumColumn.name }} = {{ sumValue }}</span>
      <span v-if="copied" class="gt-ok">✓ {{ copied }} kopyalandı</span>
      <div class="gt-spacer" />
      <button
        class="gt-btn"
        :class="{ on: hiddenCount > 0 }"
        title="Kolonları göster/gizle"
        @click="openMenu('columns', props.path, $event)"
      >⚙ kolonlar<template v-if="hiddenCount > 0"> ({{ hiddenCount }} gizli)</template></button>
      <button class="gt-btn" title="Görünen kayıtları CSV olarak indir" @click="downloadCsv">CSV</button>
    </div>

    <div class="gt-scroll" :class="{ scroll: depth > 0 }">
      <table class="gt-table" :class="{ sticky: depth === 0 }">
        <thead v-if="records || depth === 0">
          <tr>
            <th class="th-lead">{{ leadLabel }}</th>
            <th v-if="!records" class="th-value">değer</th>
            <th v-for="(column, ci) in visibleColumns" :key="column.name" class="th-col">
              <div class="th-row">
                <button
                  class="th-sort"
                  :class="{ active: sort?.column === column.name, hit: isMatch(column.name) }"
                  :title="`${column.name} — sırala`"
                  @click="toggleSort(column.name)"
                >
                  <span class="th-name">{{ column.name }}</span>
                  <span v-if="sort?.column === column.name" class="th-arrow">
                    {{ sort.dir === 'asc' ? '▲' : '▼' }}
                  </span>
                </button>
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
                >⌕</button>
                <button
                  class="th-menu"
                  :title="`${column.name} — kolon menüsü`"
                  @click="openMenu('column', column.name, $event)"
                >⋮</button>
              </div>
              <span class="th-kind">
                {{ column.kind === 'number' ? 'num' : column.kind === 'nested' ? 'obj' : 'str' }}
                <template v-if="column.filled < records!.length">
                  · {{ column.filled }}/{{ records!.length }}
                </template>
              </span>
            </th>
          </tr>
          <tr v-if="records && filtersOpen" class="tr-filters">
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
              <!-- Bas hucre: nesne tablosunda anahtar, kayit tablosunda indeks -->
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
                  class="chip comment"
                  :class="{ has: (ctx.comments?.countFor(row.path) ?? 0) > 0 }"
                  :aria-label="`${row.lead} — yorumlar`"
                  @click.stop="ctx.comments?.toggle(row.path)"
                >💬<template v-if="(ctx.comments?.countFor(row.path) ?? 0) > 0">{{ ctx.comments!.countFor(row.path) }}</template></button>
              </td>

              <!-- Deger hucreleri: skaler metin ya da hucre icinde acilan alt tablo -->
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
                :data-table="props.path"
                :data-row="row.index"
                :data-col="ci"
                @click="onCellClick(cell)"
              >
                <!-- Kapsayici: ozet rozeti; acikken adiyla birlikte alt tablo -->
                <template v-if="cell.container">
                  <span class="nest-chip" :class="{ empty: cell.count === 0 }">
                    <span v-if="cell.count > 0" class="caret">{{ ctx.isOpen(cell.path) ? '▾' : '▸' }}</span>
                    <span class="nest-brace">{{ cell.isArray ? '[' : '{' }}</span>
                    <span class="nest-summary">{{ cell.text }}</span>
                    <span class="nest-brace">{{ cell.isArray ? ']' : '}' }}</span>
                  </span>
                  <div v-if="cell.count > 0 && ctx.isOpen(cell.path)" class="nest-body" @click.stop>
                    <!--
                      Bant basligi: derin ic ice yapida hangi dugumun icinde
                      oldugunu soyleyen tek sey bu. jsongrid'de de her seviye
                      adiyla cerceveleniyor; kapatma dugmesi de burada.
                    -->
                    <div class="nest-head">
                      <button class="nest-close" title="Kapat" @click="ctx.toggle(cell.path)">▾</button>
                      <span class="nest-name">{{ cell.label }}</span>
                      <span class="nest-meta">{{ cell.text }}</span>
                      <div class="gt-spacer" />
                      <button class="nest-act" title="Bu dalı JSON olarak kopyala" @click="copyCellValue(cell)">⧉</button>
                    </div>
                    <GridTable :value="cell.value!" :path="cell.path" :depth="depth + 1" />
                  </div>
                </template>

                <!-- Skaler deger -->
                <template v-else>
                  <span class="val" :class="{ clipped: cell.long }">
                    <template v-for="(part, i) in parts(cell.text)" :key="i">
                      <mark v-if="part.hit" class="hl">{{ part.text }}</mark>
                      <template v-else>{{ part.text }}</template>
                    </template>
                  </span>
                  <button
                    v-if="cell.long"
                    class="chip long"
                    :class="{ on: ctx.detailPath.value === cell.path }"
                    :title="ctx.detailPath.value === cell.path ? 'Tam değeri kapat' : 'Tam değeri aç'"
                    @click.stop="ctx.toggleDetail(cell.path)"
                  >{{ ctx.detailPath.value === cell.path ? '▴' : '⤢' }}</button>
                  <button
                    v-if="cell.refTarget"
                    class="chip ref"
                    :class="{ on: ctx.refPath.value === cell.path }"
                    :title="`Referans: ${cell.refTarget.idField} → ${cell.refTarget.path}`"
                    @click.stop="ctx.toggleRef(cell.path)"
                  >↳</button>

                  <!-- Tam deger: hucrenin icinde, satir yerinden oynamadan -->
                  <div v-if="ctx.detailPath.value === cell.path" class="detail" @click.stop>
                    <div class="detail-head">
                      <span class="detail-meta">{{ valueMeta(cell.value) }}</span>
                      <div class="gt-spacer" />
                      <button class="gt-btn" @click="copyCellValue(cell)">
                        {{ copied === 'değer' ? '✓ kopyalandı' : '⧉ kopyala' }}
                      </button>
                      <button class="gt-btn" title="Kapat" @click="ctx.toggleDetail(cell.path)">×</button>
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
                      <button class="gt-btn" @click="ctx.focusPath(cell.refTarget!.path)">hedefe git</button>
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

                <!-- Hucre menusu: kopyalama islerinin tek yeri -->
                <button
                  class="cell-menu"
                  :title="`${cell.label} — hücre menüsü`"
                  @click.stop="openMenu('cell', cell.path, $event)"
                >⋯</button>
              </td>
            </tr>

            <!-- Kayit satirinin tamami: indeks hucresine tiklandiginda -->
            <tr v-if="records && ctx.isOpen(row.path)" class="tr-extra">
              <td :colspan="colspan">
                <div class="row-open">
                  <div class="nest-head">
                    <button class="nest-close" title="Kapat" @click="ctx.toggle(row.path)">▾</button>
                    <span class="nest-name">#{{ row.lead }}</span>
                    <span class="nest-meta">satırın tamamı</span>
                    <div class="gt-spacer" />
                    <button class="nest-act" title="Satırı JSON olarak kopyala" @click="copyRow(row)">⧉</button>
                  </div>
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
            <td :colspan="colspan" class="empty">
              {{ activeFilters.length > 0 || filtering ? 'Filtreyle eşleşen satır yok.' : 'Boş.' }}
            </td>
          </tr>

          <tr v-if="pending > 0" class="tr-extra">
            <td :colspan="colspan" class="more">
              {{ shown.length.toLocaleString('tr-TR') }} / {{ rows.length.toLocaleString('tr-TR') }} satır
              <button class="gt-btn" @click="ctx.grow(path)">daha fazla göster</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Menuler: sabit konumlu katman, arkasinda kapatan bir yuzey -->
    <template v-if="menu">
      <div class="menu-backdrop" @click="closeMenu" @contextmenu.prevent="closeMenu" />
      <div class="menu" :style="{ top: `${menu.top}px`, left: `${menu.left}px` }">
        <!-- Kolon menusu: siralama, filtre, istatistik, gizleme, kopyalama -->
        <template v-if="menu.kind === 'column'">
          <div class="menu-head">{{ menu.key }}</div>
          <button class="menu-item" @click="setSort(menu.key, 'asc')">↑ artan sırala</button>
          <button class="menu-item" @click="setSort(menu.key, 'desc')">↓ azalan sırala</button>
          <button
            v-if="sort?.column === menu.key"
            class="menu-item"
            @click="setSort(menu.key, null)"
          >× sıralamayı kaldır (JSON sırası)</button>
          <button class="menu-item" @click="focusFilter(menu.key)">⌕ bu kolonu filtrele</button>
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

        <!-- Hucre menusu -->
        <template v-else-if="menu.kind === 'cell' && menuCell">
          <div class="menu-head">{{ menuCell.cell.label }}</div>
          <button class="menu-item" @click="copyCellValue(menuCell.cell)">⧉ değeri kopyala</button>
          <button class="menu-item" @click="copyRow(menuCell.row)">⧉ satırı JSON olarak kopyala</button>
          <button class="menu-item" @click="copyPath(menuCell.cell.path)">⧉ yolu kopyala</button>
          <template v-if="menuCell.cell.container && menuCell.cell.count > 0">
            <div class="menu-sep" />
            <button class="menu-item" @click="ctx.toggle(menuCell.cell.path); closeMenu()">
              {{ ctx.isOpen(menuCell.cell.path) ? '▴ hücreyi kapat' : '▾ hücrede aç' }}
            </button>
          </template>
          <template v-if="menuCell.cell.long">
            <div class="menu-sep" />
            <button class="menu-item" @click="ctx.toggleDetail(menuCell.cell.path); closeMenu()">
              ⤢ tam değeri aç
            </button>
          </template>
        </template>

        <!-- Kolon secici -->
        <template v-else-if="menu.kind === 'columns'">
          <div class="menu-head">kolonlar</div>
          <div class="menu-cols">
            <label v-for="column in columnInfo.columns" :key="column.name" class="menu-col">
              <input
                type="checkbox"
                :checked="!ctx.hiddenColumns(props.path).has(column.name)"
                @change="ctx.toggleColumn(props.path, column.name)"
              />
              <span class="menu-col-name">{{ column.name }}</span>
              <span class="menu-col-fill">{{ column.filled }}/{{ records?.length ?? 0 }}</span>
            </label>
          </div>
          <div class="menu-sep" />
          <button class="menu-item" @click="ctx.setHiddenColumns(props.path, []); closeMenu()">
            hepsini göster
          </button>
          <button class="menu-item" @click="hideSparse">yarısından azında dolu olanları gizle</button>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.gt { min-width: 0; }
.gt-spacer { flex: 1; }

.gt-bar { display: flex; align-items: center; gap: 9px; padding: 4px 8px; background: var(--bg-secondary); border: 1px solid var(--border); border-bottom: none; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; }
.gt-count { color: var(--purple); }
.gt-dim { color: var(--text-muted); white-space: nowrap; }
.gt-warn { color: var(--orange); }
.gt-sort { color: var(--accent); white-space: nowrap; }
.gt-ok { color: var(--green); white-space: nowrap; }
.gt-btn { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--text-secondary); border: 1px solid var(--border); border-radius: 5px; padding: 1px 7px; white-space: nowrap; }
.gt-btn:hover { color: var(--accent); border-color: var(--accent); }
.gt-btn.on { color: var(--accent); border-color: var(--accent); background: var(--accent-dim); }

/* Genis kayit tablolari kendi icinde yatay kaydirilir; sayfa asla kaymaz. */
.gt-scroll.scroll { overflow-x: auto; }
.gt-table { border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%; background: var(--bg-primary); }

th, td { border-right: 1px solid var(--border-subtle); border-bottom: 1px solid var(--border-subtle); vertical-align: top; text-align: left; }

thead th { background: var(--bg-secondary); padding: 3px 8px; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: .4px; white-space: nowrap; }
/* Yalnizca kok tablonun basligi yapisir: kaydiran kutu goruntuleyicinin kendisi. */
.gt-table.sticky thead th { position: sticky; top: 0; z-index: 3; }
.th-row { display: flex; align-items: center; gap: 3px; }
/*
 * Anahtar/indeks kolonu icerigi kadar yer alir (`width: 1%`) ve yatay
 * kaydirmada yerinde durur: 11 kolonlu bir tabloda saga kayarken hangi satirda
 * oldugunu gosteren tek sey o.
 */
.th-lead { width: 1%; min-width: 42px; position: sticky; left: 0; z-index: 2; }
.gt-table.sticky thead .th-lead { z-index: 4; }
.th-col { max-width: 260px; }
.th-sort { display: inline-flex; align-items: baseline; gap: 4px; max-width: 200px; font-family: inherit; font-size: inherit; font-weight: inherit; text-transform: none; letter-spacing: 0; color: var(--text-secondary); }
.th-sort:hover, .th-sort.active { color: var(--accent); }
.th-sort.hit { color: var(--orange); }
.th-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.th-arrow { font-size: 8px; }
.th-funnel, .th-menu { font-size: 10px; color: var(--text-muted); opacity: .45; padding: 0 2px; border-radius: 3px; }
.th-col:hover .th-funnel, .th-col:hover .th-menu { opacity: 1; }
.th-funnel:hover, .th-menu:hover { color: var(--accent); background: var(--accent-dim); }
.th-funnel.on { opacity: 1; color: var(--accent); }
.th-kind { display: block; font-size: 9px; font-weight: 400; color: var(--text-muted); text-transform: none; letter-spacing: 0; }
.tr-filters th { position: static; padding: 0 4px 3px; }
.th-filter { width: 100%; min-width: 62px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 4px; outline: none; color: var(--text-primary); font-family: 'JetBrains Mono', monospace; font-size: 10.5px; padding: 1px 5px; }
.th-filter.filled, .th-filter:focus { border-color: var(--accent); }

.tr:hover > td { background: var(--bg-secondary); }
.tr.selected > td { background: var(--accent-wash); }
.tr.selected > .td-lead { box-shadow: inset 2px 0 0 var(--accent); }

.td-lead { padding: 3px 8px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--color-key); white-space: nowrap; cursor: pointer; width: 1%; position: sticky; left: 0; z-index: 1; background: var(--bg-primary); }
.td-lead.hit { background: var(--match-bg); }
.lead-text { font-weight: 500; }
/* Kayit/liste tablosunda indeks kolonu silik ve saga dayali: goz kolonlara gider. */
.records > .gt-scroll > .gt-table > tbody > tr > .td-lead,
.list > .gt-scroll > .gt-table > tbody > tr > .td-lead { color: var(--text-muted); text-align: right; }

/*
 * Hucre icerigi tek satirda kalir: rozet (uzun deger / referans) alt satira
 * kaymasin, kolon genislesin. Satir yukseklikleri boyle esit kaliyor.
 */
.td-cell { position: relative; padding: 3px 8px; font-family: 'JetBrains Mono', monospace; font-size: 12px; max-width: 460px; cursor: pointer; white-space: nowrap; }
.td-cell.num { text-align: right; }
.td-cell.hit { background: var(--match-bg); }
.td-cell.missing { background: var(--bg-secondary); }
/* Klavye imleci: hangi hucrede oldugunu her zaman gosterir. */
.td-cell.cursor { outline: 2px solid var(--accent); outline-offset: -2px; }
.val { display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
.val.clipped { cursor: zoom-in; }
.v-string .val { color: var(--color-string); }
.v-number .val { color: var(--color-number); }
.v-boolean .val { color: var(--color-bool); }
.v-null .val { color: var(--color-null); font-style: italic; }
.tone-ok .val { color: var(--green); }
.tone-warn .val { color: var(--orange); }
.tone-off .val { color: var(--text-muted); }
.hl { background: var(--match-bg); color: var(--orange); border-radius: 2px; padding: 0 1px; }

/*
 * Hucre menusu yalnizca *uzerinde durulan* hucrede gorunur. Secici `>` ile
 * dogrudan cocuga baglandi: ic ice tablolar hucrenin *icinde* durdugu icin
 * `:hover .cell-menu` dis hucreye gelindiginde icteki butun dugmeleri de
 * gosteriyordu. Sayisal hucrelerde dugme sola geciyor — sayi saga dayali,
 * son hanenin ustune binmesin.
 */
.cell-menu { position: absolute; top: 1px; right: 1px; font-size: 11px; line-height: 1; color: var(--text-muted); opacity: 0; padding: 1px 3px; border-radius: 3px; background: var(--bg-secondary); }
.td-cell.num > .cell-menu { left: 1px; right: auto; }
.td-cell:hover > .cell-menu { opacity: .8; }
.cell-menu:hover { opacity: 1 !important; color: var(--accent); background: var(--accent-dim); }

.nest-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--purple); background: var(--bg-object); border-radius: 10px; padding: 0 7px; white-space: nowrap; }
.td-cell.nested:hover > .nest-chip { background: var(--purple-wash); }
.nest-chip.empty { color: var(--text-muted); background: var(--bg-tertiary); }
.caret { font-size: 9px; }
.nest-brace { opacity: .55; }
.nest-summary { font-size: 10.5px; }
/*
 * Alt tablo hucrenin icinde aciliyor: kullanici baktigi tabloyu kaybetmiyor.
 * Bant basligi hangi dugumun icinde oldugunu soyluyor, soldaki cizginin rengi
 * kaci derinde oldugunu.
 */
.nest-body { margin: 4px 0 2px; padding-left: 7px; border-left: 2px solid var(--purple); cursor: default; white-space: normal; }
.d-1 > .gt-scroll .nest-body { border-left-color: var(--accent); }
.d-2 > .gt-scroll .nest-body { border-left-color: var(--cyan); }
.d-3 > .gt-scroll .nest-body { border-left-color: var(--green); }
.d-4 > .gt-scroll .nest-body { border-left-color: var(--orange); }
.nest-head { display: flex; align-items: center; gap: 7px; padding: 2px 6px 3px; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; }
.nest-close { font-size: 9px; color: var(--text-muted); padding: 0 3px; border-radius: 3px; }
.nest-close:hover { color: var(--accent); background: var(--accent-dim); }
.nest-name { color: var(--color-key); font-weight: 600; }
.nest-meta { color: var(--text-muted); }
.nest-act { font-size: 11px; color: var(--text-muted); padding: 0 4px; border-radius: 3px; }
.nest-act:hover { color: var(--accent); background: var(--accent-dim); }

.chip { font-size: 10px; line-height: 1.6; padding: 0 5px; border-radius: 8px; margin-left: 5px; white-space: nowrap; }
.chip.long { color: var(--cyan); background: var(--bg-tertiary); }
.chip.long:hover, .chip.long.on { color: var(--accent); background: var(--accent-dim); }
.chip.ref { color: var(--accent); background: var(--accent-dim); }
.chip.ref:hover, .chip.ref.on { background: var(--accent-strong); }
.chip.comment { color: var(--text-muted); opacity: .4; }
.chip.comment:hover { opacity: 1; }
.chip.comment.has { opacity: 1; color: var(--purple); background: var(--bg-object); }

.mark { margin-left: 5px; font-size: 9px; opacity: .75; }
.mark.has-doc { color: var(--accent); cursor: pointer; }
.mark.guess-doc { color: var(--cyan); cursor: pointer; font-size: 11px; }
.mark.no-doc { color: var(--orange); }
.mark:hover { opacity: 1; }

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

.tr-extra > td { padding: 5px 8px; background: var(--bg-secondary); }
.row-open { border-left: 2px solid var(--purple); padding-left: 7px; }
.empty { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-muted); }
.more { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-muted); }
.more .gt-btn { margin-left: 9px; }

/* Sik yerlesim: ayni ekranda gorunur satir sayisi ~%40 artiyor. */
.gt.dense .td-lead, .gt.dense .td-cell { padding: 1px 6px; font-size: 11.5px; }
.gt.dense thead th { padding: 2px 6px; }
.gt.dense .th-kind { display: none; }

/* --- Menuler --------------------------------------------------------------- */
.menu-backdrop { position: fixed; inset: 0; z-index: 60; }
.menu { position: fixed; z-index: 61; width: 272px; max-height: 70vh; overflow-y: auto; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 12px 32px rgba(0, 0, 0, .35); padding: 5px; font-family: 'JetBrains Mono', monospace; }
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
.stat-track { height: 6px; background: var(--bg-tertiary); border-radius: 3px; overflow: hidden; }
/* Tek renk, tek anlam: yuksek deger daha dolu bir cubuk. */
.stat-fill { display: block; height: 100%; background: var(--accent); }
.stat-count { color: var(--text-muted); }

.menu-cols { max-height: 220px; overflow-y: auto; }
.menu-col { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 7px; padding: 3px 8px; font-size: 11.5px; border-radius: 5px; cursor: pointer; }
.menu-col:hover { background: var(--bg-secondary); }
.menu-col-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); }
.menu-col-fill { font-size: 10px; color: var(--text-muted); }
</style>
