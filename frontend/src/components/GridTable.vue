<script setup lang="ts">
import { computed, inject } from 'vue'
import type { JsonObject, JsonValue } from '../types'
import { GRID } from '../utils/gridContext'
import { childPath } from '../utils/search'
import { cellText, isContainer, sortRecords, type ColumnKind } from '../utils/grid'
import {
  MAX_CELL_DEPTH, NESTED_PAGE_SIZE, PAGE_SIZE, applyFilters, cellLabel, modelOf,
} from '../utils/gridModel'

/**
 * Grid'in tablosu — **gercek izgara**, satir listesi degil.
 *
 * Eski grid'in sikayeti sisme: her kapsayici satirin altina yeni bir tablo
 * aciliyor, ekran merdivene donuyordu. Burada kapsayici bir deger **kendi
 * hucresinin icinde** aciliyor: kolon hizasi bozulmuyor, bakilan tablo
 * kaybolmuyor, hangi hucrenin acildigi zemininden belli.
 *
 * Derinlik uc seviyeyle sinirli (0/1/2). Dorduncude hucre `{5} → yolu aç`
 * olur ve tiklama o dugume *gecer* — sonsuz ic ice acilma hem cizimi hem
 * okumayi bitiriyor.
 */
const props = defineProps<{
  value: JsonValue
  /** Bu tablonun temsil ettigi dugumun tam yolu; tum durum bununla anahtarlanir. */
  path: string
  /** Hucre ici yuvalanma derinligi (0 = ana tablo). */
  depth: number
}>()

const grid = inject(GRID)!

const model = computed(() => modelOf(props.value))
const pageSize = computed(() => (props.depth === 0 ? PAGE_SIZE : NESTED_PAGE_SIZE))
const sort = computed(() => grid.sortOf(props.path))

/** Satir yuksekligi ve tipografi ic seviyelerde bir kademe kuculur. */
const tight = computed(() => props.depth > 0)

// --- Satirlar ----------------------------------------------------------------

interface Row {
  /** Kaydin dizideki gercek indeksi; siralama/filtre sonrasi da bu gosterilir. */
  index: number
  /** Satirin yolu. */
  path: string
  /** Kayit tablosunda oge, nesne tablosunda [anahtar, deger]. */
  item: JsonObject | null
  key?: string
  value?: JsonValue
}

const kinds = computed(() => {
  const map = new Map<string, ColumnKind>()
  for (const column of model.value.columns) {
    map.set(column.name, column.numeric ? 'number' : 'text')
  }
  return map
})

const allRows = computed<Row[]>(() => {
  const value = props.value
  if (model.value.shape === 'records') {
    const items = value as JsonObject[]
    let rows = applyFilters(items, props.path, filtersSnapshot.value)
    const state = sort.value
    if (state) {
      rows = sortRecords(rows, state, kinds.value.get(state.column) ?? 'text')
    }
    return rows.map(row => ({
      index: row.index,
      path: childPath(props.path, row.index),
      item: row.item,
    }))
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => ({
      index, path: childPath(props.path, index), item: null, value: item,
    }))
  }
  if (isContainer(value)) {
    return Object.entries(value as JsonObject).map(([key, item], index) => ({
      index, path: childPath(props.path, key), item: null, key, value: item,
    }))
  }
  return []
})

/**
 * Filtreler reaktif okunmali ama `applyFilters` duz bir nesne bekliyor;
 * baglamdan o anki degerleri toplayip veriyoruz.
 */
const filtersSnapshot = computed(() => {
  const out: Record<string, string> = {}
  for (const column of model.value.columns) {
    const text = grid.filterOf(props.path, column.name)
    if (text) out[`${props.path}::${column.name}`] = text
  }
  return out
})

const rows = computed(() => allRows.value.slice(0, pageSize.value))
const overflow = computed(() => Math.max(0, allRows.value.length - rows.value.length))

const filtersOpen = computed(() => grid.filtersOn(props.path))
const isRecords = computed(() => model.value.shape === 'records')

/**
 * Sol bastaki hucre iki farkli is yapar: kayit ve skaler dizide **satir
 * indeksi** (dar, sabit), nesnede **anahtar** (genisligi icerikten). Anahtari
 * indeks genisligine sikistirmak alan adlarini okunmaz yapiyordu.
 */
const isObject = computed(() => model.value.shape === 'object')
const headWidth = computed(() => (isObject.value ? model.value.columns[0].width : null))
/** Deger kolonu: nesnede ikinci, digerlerinde tek kolon. */
const valueColumn = computed(() => model.value.columns[model.value.columns.length - 1])

/**
 * Icinde acik hucre olan kolonlar. Tasarimin kurali: **acik ic tablo varsa
 * kolon o tabloyu saracak kadar genisler**. Genisligi sabit birakmak alt
 * tabloyu kirpiyordu — hucre aciliyor ama icerigi gorunmuyordu.
 */
const openColumns = computed(() => {
  const out = new Set<string>()
  for (const row of rows.value) {
    if (row.item) {
      for (const column of model.value.columns) {
        if (grid.isOpen(childPath(row.path, column.name))) out.add(column.name)
      }
    } else if (grid.isOpen(row.path)) {
      out.add(valueColumn.value?.name ?? 'değer')
    }
  }
  return out
})

/**
 * Kolonun stili. Kapali kolonda genislik *kilitli* (satirlar hizali kalsin);
 * acik kolonda alt sinir olur, tablo icerige gore buyur.
 */
function columnStyle(column: { name: string; width: number }) {
  return openColumns.value.has(column.name)
    ? { minWidth: `${column.width}px` }
    : { width: `${column.width}px` }
}

// --- Hucre yardimcilari -------------------------------------------------------

function valueOf(row: Row, column: string): JsonValue | undefined {
  if (row.item) return row.item[column]
  return row.value
}

function cellPath(row: Row, column: string): string {
  return row.item ? childPath(row.path, column) : row.path
}

/** Hucrenin tipine gore sinif; sayilar saga yaslanir. */
function toneOf(value: JsonValue | undefined): string {
  if (value === undefined) return 'v-empty'
  if (value === null) return 'v-null'
  if (typeof value === 'number') return 'v-number'
  if (typeof value === 'boolean') return 'v-boolean'
  return 'v-string'
}

/** Bu hucre acilabilir mi (kapsayici ve derinlik butcesi doluyor mu). */
function expandable(value: JsonValue | undefined): boolean {
  return value !== undefined && isContainer(value)
}

/** Derinlik butcesi doldu mu; dolduysa hucre acilmaz, dugume gecilir. */
const atDepthLimit = computed(() => props.depth >= MAX_CELL_DEPTH)

function onCellClick(row: Row, column: string) {
  grid.select(cellPath(row, column))
}

function onToggle(path: string, event: Event) {
  event.stopPropagation()
  // Acmak da bir secimdir: prototipte `+ {2}` tiklandiginda hem alt tablo
  // aciliyor hem editor o alanin satirina kayiyor.
  grid.select(path)
  grid.toggleOpen(path)
}

function onJump(path: string, event: Event) {
  event.stopPropagation()
  grid.goTo(path)
}

function refTargetOf(row: Row, column: string) {
  const value = valueOf(row, column)
  if (value === undefined || isContainer(value)) return undefined
  return grid.refFor(cellPath(row, column), value)
}

function onRef(row: Row, column: string, event: Event) {
  event.stopPropagation()
  const target = refTargetOf(row, column)
  if (target) grid.openRef(target)
}

/** Sema isareti: kesin eslesme sessiz, tahmin `≈`, karsiligi yok `●`. */
function schemaMark(column: string): string {
  if (!grid.schemaKnown.value) return ''
  const doc = grid.docFor(childPath(props.path, `0.${column}`)) ?? grid.docFor(childPath(props.path, column))
  if (!doc) return '●'
  return doc.matchKind === 'INFERRED' ? '≈' : ''
}

function sortArrow(column: string): string {
  const state = sort.value
  if (!state || state.column !== column) return ''
  return state.dir === 'asc' ? '▲' : '▼'
}

function hit(value: JsonValue | undefined): boolean {
  const term = grid.searchTerm.value.trim().toLowerCase()
  if (!term || value === undefined) return false
  return cellText(value).toLowerCase().includes(term)
}

function rowHit(row: Row): boolean {
  if (!grid.searchTerm.value.trim()) return false
  if (row.item) return model.value.columns.some(column => hit(row.item![column.name]))
  return hit(row.value) || (row.key ?? '').toLowerCase().includes(grid.searchTerm.value.trim().toLowerCase())
}

function selected(path: string): boolean {
  return grid.selectedPath.value === path
}

/** Nesne tablosunda anahtar hucresi; kayit tablosunda satir indeksi. */
function rowLabel(row: Row): string {
  return row.key ?? String(row.index)
}
</script>

<template>
  <div class="table" :class="{ tight, nested: depth > 0 }">
    <!-- Baslik: yalnizca kayit tablosunda kolon adlari olur. -->
    <div v-if="isRecords" class="thead">
      <button
        class="corner"
        :class="{ on: filtersOpen }"
        title="Kolon filtreleri"
        @click="grid.toggleFilters(path)"
      >{{ filtersOpen ? '▼' : '▽' }}</button>
      <button
        v-for="column in model.columns"
        :key="column.name"
        class="th"
        :class="{ sorted: sort?.column === column.name }"
        :style="columnStyle(column)"
        :title="`${column.name} — sıralama`"
        @click="grid.cycleSort(path, column.name)"
      >
        <span class="th-name">{{ column.name }}</span>
        <span v-if="sortArrow(column.name)" class="th-arrow">{{ sortArrow(column.name) }}</span>
        <span class="th-spacer" />
        <span v-if="schemaMark(column.name)" class="th-mark" :class="{ guess: schemaMark(column.name) === '≈' }">
          {{ schemaMark(column.name) }}
        </span>
      </button>
    </div>

    <!-- Filtre satiri: tablonun kosesindeki anahtarla acilir. -->
    <div v-if="isRecords && filtersOpen" class="filter-row">
      <span class="corner-spacer" />
      <span v-for="column in model.columns" :key="column.name" class="filter-cell" :style="columnStyle(column)">
        <input
          class="filter-input"
          :class="{ filled: grid.filterOf(path, column.name) }"
          type="text"
          placeholder="içerir"
          :value="grid.filterOf(path, column.name)"
          @input="grid.setFilter(path, column.name, ($event.target as HTMLInputElement).value)"
        />
      </span>
    </div>

    <!-- Satirlar -->
    <div
      v-for="row in rows"
      :key="row.path"
      class="tr"
      :class="{ sel: selected(row.path), hit: rowHit(row) }"
    >
      <span
        class="rowhead"
        :class="{ sel: selected(row.path), key: isObject }"
        :style="headWidth ? { width: `${headWidth}px` } : undefined"
        @click="grid.select(row.path)"
      >{{ rowLabel(row) }}</span>

      <template v-if="isRecords">
        <div
          v-for="column in model.columns"
          :key="column.name"
          class="td"
          :class="[toneOf(valueOf(row, column.name)), {
            sel: selected(cellPath(row, column.name)),
            open: grid.isOpen(cellPath(row, column.name)),
            num: column.numeric,
          }]"
          :style="columnStyle(column)"
          @click="onCellClick(row, column.name)"
        >
          <template v-if="expandable(valueOf(row, column.name))">
            <button
              v-if="atDepthLimit"
              class="jump"
              :title="'Bu düğüme geç'"
              @click="onJump(cellPath(row, column.name), $event)"
            >{{ cellLabel(valueOf(row, column.name)) }} → yolu aç</button>
            <template v-else>
              <button class="expand" @click="onToggle(cellPath(row, column.name), $event)">
                <span class="sign">{{ grid.isOpen(cellPath(row, column.name)) ? '−' : '+' }}</span>
                <span class="label">{{ cellLabel(valueOf(row, column.name)) }}</span>
              </button>
              <GridTable
                v-if="grid.isOpen(cellPath(row, column.name))"
                :value="valueOf(row, column.name)!"
                :path="cellPath(row, column.name)"
                :depth="depth + 1"
              />
            </template>
          </template>
          <template v-else>
            <span class="cell-text">{{ cellLabel(valueOf(row, column.name)) }}</span>
            <button
              v-if="refTargetOf(row, column.name)"
              class="ref"
              title="Referansın hedefini göster"
              @click="onRef(row, column.name, $event)"
            >↳</button>
          </template>
        </div>
      </template>

      <!-- Nesne / skaler dizi: tek deger kolonu -->
      <div
        v-else
        class="td"
        :class="[toneOf(row.value), { sel: selected(row.path), open: grid.isOpen(row.path) }]"
        :style="valueColumn ? columnStyle(valueColumn) : undefined"
        @click="grid.select(row.path)"
      >
        <template v-if="expandable(row.value)">
          <button v-if="atDepthLimit" class="jump" @click="onJump(row.path, $event)">
            {{ cellLabel(row.value) }} → yolu aç
          </button>
          <template v-else>
            <button class="expand" @click="onToggle(row.path, $event)">
              <span class="sign">{{ grid.isOpen(row.path) ? '−' : '+' }}</span>
              <span class="label">{{ cellLabel(row.value) }}</span>
            </button>
            <GridTable
              v-if="grid.isOpen(row.path)"
              :value="row.value!"
              :path="row.path"
              :depth="depth + 1"
            />
          </template>
        </template>
        <template v-else>
          <span class="cell-text">{{ cellLabel(row.value) }}</span>
          <button v-if="grid.refFor(row.path, row.value!)" class="ref" @click="onRef(row, '', $event)">↳</button>
        </template>
      </div>
    </div>

    <!-- Pencere ve seyreklik notu -->
    <div v-if="overflow > 0 || model.hiddenColumns > 0" class="note">
      <template v-if="overflow > 0">{{ overflow.toLocaleString('tr-TR') }} satır daha var</template>
      <template v-if="overflow > 0 && model.hiddenColumns > 0"> · </template>
      <template v-if="model.hiddenColumns > 0">{{ model.hiddenColumns }} seyrek kolon gizli</template>
    </div>
  </div>
</template>

<style scoped>
/*
 * Tablo sayfada duran bir nesne: genisligi icerikten gelir, tam genisligi
 * kaplamaz. Kose yok — tasarim tablolari koseli birakiyor.
 */
.table { display: inline-block; min-width: 0; background: var(--bg-data); border: 1px solid var(--line-strong); }
.table.nested { border-color: var(--line-nested); background: var(--bg-nested); margin: 0 5px 6px; }

.thead { display: flex; background: var(--bg-subtle); border-bottom: 1px solid var(--line-strong); }
.corner {
  width: 44px; flex-shrink: 0; font-size: 9px; color: var(--ink-5);
  border-right: 1px solid var(--line-cell-head); display: flex; align-items: center; justify-content: center;
}
.corner:hover { color: var(--ink-2); }
.corner.on { color: var(--accent); }
.corner-spacer { width: 44px; flex-shrink: 0; border-right: 1px solid var(--line-cell-head); }

.th {
  display: flex; align-items: center; gap: 4px; padding: 4px 9px; min-width: 0;
  font-size: 11px; color: var(--ink-2); text-align: left;
  border-right: 1px solid var(--line-cell-head); flex-shrink: 0;
}
.th:hover { background: var(--bg-inset); }
.th.sorted { background: var(--sort-head-bg); color: var(--ink); }
.th-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.th-arrow { font-size: 8px; color: var(--accent); }
.th-spacer { flex: 1; }
.th-mark { font-size: 9px; color: var(--changed); }
.th-mark.guess { color: var(--type-boolean); }

.filter-row { display: flex; background: var(--bg-chrome); border-bottom: 1px solid var(--line-cell); }
.filter-cell { flex-shrink: 0; padding: 3px 9px; border-right: 1px solid var(--line-cell); }
/* Cerceve yok, yalniz alt cizgi; border-box kirpilmayi onler. */
.filter-input {
  width: 100%; box-sizing: border-box; background: none; border: none;
  border-bottom: 1px solid var(--line); outline: none; font-size: 10.5px;
  padding: 1px 0; color: var(--ink);
}
.filter-input::placeholder { color: var(--ink-5); }
.filter-input.filled, .filter-input:focus { border-bottom-color: var(--accent); }

.tr { display: flex; align-items: stretch; border-bottom: 1px solid var(--line-cell); }
.tr:last-of-type { border-bottom: none; }
.tr.hit { background: var(--search-hit); }
.tr.sel { background: var(--accent-sel-bg); box-shadow: inset 2px 0 0 var(--accent); }

.rowhead {
  width: 44px; flex-shrink: 0; padding: 4px 9px; font-size: 10.5px; color: var(--ink-row);
  border-right: 1px solid var(--line-cell); cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.rowhead.sel { color: var(--accent); }
/* Nesne tablosunda sol kolon anahtardir: koyu murekkep, sola yasli. */
.rowhead.key { color: var(--ink-2); font-size: 11.5px; }

.td {
  display: flex; flex-direction: column; align-items: flex-start; min-width: 0;
  border-right: 1px solid var(--line-cell); cursor: pointer; flex-shrink: 0;
  overflow: hidden;
}
.td:last-child { border-right: none; }
/* Acik hucre kirpmaz: icindeki tablo hucreyi tasiyabilir. */
.td.open { background: var(--bg-cell-open); overflow: visible; }
.td.sel { background: var(--accent-sel-bg); }

.cell-text {
  padding: 4px 9px; font-size: 12.5px; max-width: 100%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.td.num .cell-text { width: 100%; text-align: right; }

.v-string .cell-text { color: var(--type-string); }
.v-number .cell-text { color: var(--type-number); }
.v-boolean .cell-text { color: var(--type-boolean); }
.v-null .cell-text { color: var(--type-null); }
.v-empty .cell-text { color: var(--ink-empty); }

.ref { font-size: 10px; color: var(--accent); padding: 0 9px 3px; }
.ref:hover { color: var(--accent-hover); }

.expand { display: flex; align-items: center; gap: 6px; padding: 4px 9px; max-width: 100%; }
.expand:hover .label { color: var(--ink); }
.sign { font-size: 10px; color: var(--ink-3); }
.label { font-size: 11.5px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.jump { padding: 4px 9px; font-size: 11.5px; color: var(--ink-2); text-align: left; white-space: nowrap; }
.jump:hover { color: var(--accent); }

.note { padding: 4px 9px; font-size: 10.5px; color: var(--ink-5); background: var(--bg-chrome); border-top: 1px solid var(--line-cell); }

/* Ic seviyelerde tipografi ve bosluk bir kademe kuculur. */
.tight .cell-text { font-size: 11px; padding: 3px 7px; }
.tight .th { font-size: 10.5px; padding: 3px 7px; }
.tight .expand { padding: 3px 7px; }
.tight .label { font-size: 11px; }
.tight .rowhead { padding: 3px 7px; font-size: 10px; }
.tight .corner, .tight .corner-spacer { width: 34px; }
.tight .rowhead { width: 34px; }
.tight .filter-cell { padding: 2px 7px; }
</style>
