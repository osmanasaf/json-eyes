<script setup lang="ts">
import { computed, ref, watch, inject } from 'vue'
import type { FieldDoc, JsonObject, JsonValue } from '../types'
import { GRID } from '../utils/gridContext'
import { childPath, matchesDeep } from '../utils/search'
import { getType } from '../utils/json'
import type { RefTarget } from '../utils/references'
import {
  MAX_DETAIL_CHARS, cellText, childCount, clippedCount, detailText, entriesOf, gridShape,
  highlightParts, isContainer, isLongValue, previewFields, recordColumns, searchText,
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
 * *hucrenin icinde* aciliyor; hicbir tiklama gorunumu degistirmiyor.
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
const columns = computed(() =>
  records.value ? recordColumns(records.value) : { columns: [] as GridColumn[], hidden: 0 },
)

/** Kolon basliklarindaki XSD aciklamalari; dizi indeksleri sema yolunda dusuyor. */
const columnDocs = computed<Array<FieldDoc | undefined>>(() =>
  columns.value.columns.map(column => ctx.docFor(childPath(childPath(props.path, 0), column.name))),
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

const activeFilters = computed(() =>
  Object.entries(filters.value)
    .map(([name, text]) => [name, text.trim().toLowerCase()] as const)
    .filter(([, text]) => text.length > 0),
)

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
}

interface RowModel {
  key: string
  lead: string
  leadMatched: boolean
  path: string
  cells: CellModel[]
  doc: FieldDoc | undefined
  /** Kayit tablosunda satirin kaynak nesnesi; CSV ve "satırın tamamı" bunu kullanir. */
  item: JsonObject | null
}

function makeCell(path: string, value: JsonValue | undefined, kind: ColumnKind, column: string | null): CellModel {
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
      const kind = columns.value.columns.find(c => c.name === sort.value!.column)?.kind ?? 'text'
      list = sortRecords(list, sort.value, kind)
    }
    return list.map(({ index, item }) => {
      const rowPath = childPath(props.path, index)
      return {
        key: String(index),
        lead: String(index),
        leadMatched: false,
        path: rowPath,
        item,
        doc: undefined,
        cells: columns.value.columns.map(column =>
          makeCell(childPath(rowPath, column.name), item[column.name], column.kind, column.name)),
      }
    })
  }

  return entriesOf(props.value)
    .filter(entry => !filtering.value
      || entry.key.toLowerCase().includes(needle.value)
      || matchesDeep(entry.value, term.value))
    .map((entry) => {
      const path = childPath(props.path, entry.key)
      const kind: ColumnKind = isContainer(entry.value)
        ? 'nested'
        : typeof entry.value === 'number' ? 'number' : 'text'
      return {
        key: entry.key,
        lead: entry.key,
        leadMatched: needle.value.length > 0 && entry.key.toLowerCase().includes(needle.value),
        path,
        item: null,
        doc: shape.value === 'object' ? ctx.docFor(path) : undefined,
        cells: [makeCell(path, entry.value, kind, null)],
      }
    })
})

const shown = computed(() => rows.value.slice(0, ctx.windowOf(props.path)))
const pending = computed(() => Math.max(0, rows.value.length - shown.value.length))

const leadLabel = computed(() => (shape.value === 'object' ? 'anahtar' : '#'))
const colspan = computed(() => (records.value ? columns.value.columns.length + 1 : 2))

/** Kayit tablosunda toplam; siralanan kolon sayisalsa o, degilse ilk sayisal kolon. */
const sumColumn = computed(() => {
  if (!records.value) return null
  const list = columns.value.columns
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

function downloadCsv() {
  if (!records.value) return
  const names = columns.value.columns.map(column => column.name)
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

const copiedPath = ref<string | null>(null)
let copyTimer: ReturnType<typeof setTimeout> | null = null

async function copyValue(cell: CellModel) {
  try {
    await navigator.clipboard.writeText(
      cell.container ? JSON.stringify(cell.value, null, 2) : String(cell.value ?? ''),
    )
    copiedPath.value = cell.path
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copiedPath.value = null }, 1500)
  } catch {
    copiedPath.value = null
  }
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
</script>

<template>
  <div class="gt" :class="[`d-${Math.min(depth, 4)}`, shape, { root: depth === 0 }]">
    <!-- Kayit tablosu seridi: sayim, siralama durumu, kolon filtresi, CSV -->
    <div v-if="records" class="gt-bar">
      <span class="gt-count">{{ rows.length.toLocaleString('tr-TR') }} kayıt</span>
      <span class="gt-dim">{{ columns.columns.length }} kolon</span>
      <span v-if="columns.hidden > 0" class="gt-warn">
        {{ columns.hidden }} kolon gizli (en seyrek dolanlar)
      </span>
      <span v-if="sort" class="gt-sort">{{ sort.column }} {{ sort.dir === 'asc' ? '↑' : '↓' }}</span>
      <span v-if="sumColumn" class="gt-dim">Σ {{ sumColumn.name }} = {{ sumValue }}</span>
      <div class="gt-spacer" />
      <button
        class="gt-btn"
        :class="{ on: filtersOpen || activeFilters.length > 0 }"
        title="Kolon filtreleri"
        @click="filtersOpen = !filtersOpen"
      >⌕ filtre</button>
      <button v-if="activeFilters.length > 0" class="gt-btn clear" @click="filters = {}">temizle</button>
      <button class="gt-btn" title="Görünen kayıtları CSV olarak indir" @click="downloadCsv">CSV</button>
    </div>

    <div class="gt-scroll" :class="{ scroll: depth > 0 }">
      <table class="gt-table" :class="{ sticky: depth === 0 }">
        <thead v-if="records || depth === 0">
          <tr>
            <th class="th-lead">{{ leadLabel }}</th>
            <th v-if="!records" class="th-value">değer</th>
            <th
              v-for="(column, ci) in columns.columns"
              :key="column.name"
              class="th-col"
            >
              <button
                class="th-sort"
                :class="{ active: sort?.column === column.name, hit: isMatch(column.name) }"
                @click="toggleSort(column.name)"
              >
                <span class="th-name" :title="column.name">{{ column.name }}</span>
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
            <th v-for="column in columns.columns" :key="column.name">
              <input
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
                v-for="cell in row.cells"
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
                  },
                ]"
                @click="onCellClick(cell)"
              >
                <!-- Kapsayici: ozet rozeti; acikken alt tablo hucrenin icinde -->
                <template v-if="cell.container">
                  <span class="nest-chip" :class="{ empty: cell.count === 0 }">
                    <span v-if="cell.count > 0" class="caret">{{ ctx.isOpen(cell.path) ? '▾' : '▸' }}</span>
                    <span class="nest-brace">{{ cell.isArray ? '[' : '{' }}</span>
                    <span class="nest-summary">{{ cell.text }}</span>
                    <span class="nest-brace">{{ cell.isArray ? ']' : '}' }}</span>
                  </span>
                  <div v-if="cell.count > 0 && ctx.isOpen(cell.path)" class="nest-body" @click.stop>
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
                      <button class="gt-btn" @click="copyValue(cell)">
                        {{ copiedPath === cell.path ? '✓ kopyalandı' : '⧉ kopyala' }}
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
              </td>
            </tr>

            <!-- Kayit satirinin tamami: indeks hucresine tiklandiginda -->
            <tr v-if="records && ctx.isOpen(row.path)" class="tr-extra">
              <td :colspan="colspan">
                <div class="row-open">
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
  </div>
</template>

<style scoped>
.gt { min-width: 0; }
.gt-spacer { flex: 1; }

.gt-bar { display: flex; align-items: center; gap: 9px; padding: 4px 8px; background: var(--bg-secondary); border: 1px solid var(--border); border-bottom: none; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; }
.gt-count { color: var(--purple); }
.gt-dim { color: var(--text-muted); white-space: nowrap; }
.gt-warn { color: var(--orange); }
.gt-sort { color: var(--accent); }
.gt-btn { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--text-secondary); border: 1px solid var(--border); border-radius: 5px; padding: 1px 7px; white-space: nowrap; }
.gt-btn:hover { color: var(--accent); border-color: var(--accent); }
.gt-btn.on { color: var(--accent); border-color: var(--accent); background: var(--accent-dim); }
.gt-btn.clear:hover { color: var(--red); border-color: var(--red); }

/* Genis kayit tablolari kendi icinde yatay kaydirilir; sayfa asla kaymaz. */
.gt-scroll.scroll { overflow-x: auto; }
.gt-table { border-collapse: collapse; width: max-content; min-width: 100%; background: var(--bg-primary); }

th, td { border: 1px solid var(--border-subtle); vertical-align: top; text-align: left; }

thead th { background: var(--bg-secondary); padding: 3px 8px; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: .4px; white-space: nowrap; }
/* Yalnizca kok tablonun basligi yapisir: kaydiran kutu goruntuleyicinin kendisi. */
.gt-table.sticky thead th { position: sticky; top: 0; z-index: 2; }
/*
 * Anahtar/indeks kolonu icerigi kadar yer alir: `width: 1%` tarayiciya "bu
 * kolonu en dara sik" der, artan genislik degerlere kalir. Yoksa otomatik
 * yerlesim anahtar kolonuna bol yer verip ic ice tabloyu saga sikistiriyordu.
 */
.th-lead { width: 1%; min-width: 42px; }
.th-col { max-width: 260px; }
.th-sort { display: inline-flex; align-items: baseline; gap: 4px; max-width: 240px; font-family: inherit; font-size: inherit; font-weight: inherit; text-transform: none; letter-spacing: 0; color: var(--text-secondary); }
.th-sort:hover, .th-sort.active { color: var(--accent); }
.th-sort.hit { color: var(--orange); }
.th-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.th-arrow { font-size: 8px; }
.th-kind { display: block; font-size: 9px; font-weight: 400; color: var(--text-muted); text-transform: none; letter-spacing: 0; }
.tr-filters th { position: static; padding: 0 4px 3px; }
.th-filter { width: 100%; min-width: 62px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 4px; outline: none; color: var(--text-primary); font-family: 'JetBrains Mono', monospace; font-size: 10.5px; padding: 1px 5px; }
.th-filter.filled, .th-filter:focus { border-color: var(--accent); }

/* Kayit tablosunda tek/cift satir ayrimi: 1200 satirda gozun kaymasini onler. */
.records > .gt-scroll > .gt-table > tbody > tr:nth-of-type(odd) > td { background: var(--row-zebra); }
.tr:hover > td { background: var(--bg-secondary); }
.tr.selected > td { background: var(--accent-wash); }
.tr.selected > .td-lead { box-shadow: inset 2px 0 0 var(--accent); }

.td-lead { padding: 3px 8px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--color-key); white-space: nowrap; cursor: pointer; }
.td-lead.hit { background: var(--match-bg); }
.lead-text { font-weight: 500; }
.td-lead { width: 1%; }
/* Kayit/liste tablosunda indeks kolonu silik ve saga dayali: goz kolonlara gider. */
.records > .gt-scroll > .gt-table > tbody > tr > .td-lead,
.list > .gt-scroll > .gt-table > tbody > tr > .td-lead { color: var(--text-muted); text-align: right; }

/*
 * Hucre icerigi tek satirda kalir: rozet (uzun deger / referans) alt satira
 * kaymasin, kolon genislesin. Satir yukseklikleri boyle esit kaliyor.
 */
.td-cell { padding: 3px 8px; font-family: 'JetBrains Mono', monospace; font-size: 12px; max-width: 460px; cursor: pointer; white-space: nowrap; }
.td-cell.num { text-align: right; }
.td-cell.hit { background: var(--match-bg); }
.td-cell.missing { background: var(--bg-secondary); }
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

.nest-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--purple); background: var(--bg-object); border-radius: 10px; padding: 0 7px; white-space: nowrap; }
.td-cell.nested:hover .nest-chip { background: var(--purple-wash); }
.nest-chip.empty { color: var(--text-muted); background: var(--bg-tertiary); }
.caret { font-size: 9px; }
.nest-brace { opacity: .55; }
.nest-summary { font-size: 10.5px; }
/*
 * Alt tablo hucrenin icinde aciliyor: kullanici baktigi tabloyu kaybetmiyor.
 * Soldaki cizginin rengi seviyeyi gosteriyor.
 */
.nest-body { margin: 4px 0 2px; padding-left: 7px; border-left: 2px solid var(--purple); cursor: default; }
.d-1 > .gt-scroll .nest-body { border-left-color: var(--accent); }
.d-2 > .gt-scroll .nest-body { border-left-color: var(--cyan); }
.d-3 > .gt-scroll .nest-body { border-left-color: var(--green); }
.d-4 > .gt-scroll .nest-body { border-left-color: var(--orange); }

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
</style>
