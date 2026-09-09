<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { JsonObject, JsonValue } from '../types'
import {
  cellText, statusTone, childCount, isContainer, recordColumns, searchText, sortRecords, toCsv,
  type GridColumn, type SortState,
} from '../utils/grid'
import { getType } from '../utils/json'
import { isRefField } from '../utils/references'

/**
 * Dizi tablosu (Ekran 4): nesne dizisini kayitlar arasi karsilastirilabilir
 * hale getirir.
 *
 * Agacta `Order[64]` yalnizca bir sayidir; QA'nin sordugu soru ise "hangi
 * siparisler PENDING ve EUR" gibi bir seydir. Kolon basina filtre, siralama ve
 * alt seritteki toplamlar o soruyu tabloyu terk etmeden cevapliyor; CSV ise
 * cevabin disari tasinmasi gereken halini.
 */
const props = defineProps<{
  items: JsonObject[]
  /** Dizinin belgedeki yolu; baslikta ve secim yolunda kullanilir. */
  path: string
  rootKey: string
  selectedPath?: string | null
}>()

const emit = defineEmits<{
  select: [path: string]
  focusPath: [path: string]
  close: []
}>()

const sort = ref<SortState | null>(null)
const filters = ref<Record<string, string>>({})

const columns = computed(() => recordColumns(props.items))

/** Kolon adi -> tip; siralama ve hizalama bundan okunuyor. */
function kindOf(name: string): GridColumn['kind'] {
  return columns.value.columns.find(column => column.name === name)?.kind ?? 'text'
}

const filtered = computed(() => {
  const active = Object.entries(filters.value).filter(([, text]) => text.trim().length > 0)
  const indexed = props.items.map((item, index) => ({ index, item }))
  if (active.length === 0) return indexed
  // Filtreler AND ile birlesir; her biri kucuk/buyuk harf duyarsiz `contains`.
  return indexed.filter(({ item }) =>
    active.every(([name, text]) =>
      searchText(item[name]).toLowerCase().includes(text.trim().toLowerCase()),
    ),
  )
})

const rows = computed(() => {
  const state = sort.value
  if (!state) return filtered.value
  return sortRecords(filtered.value, state, kindOf(state.column))
})

function toggleSort(name: string) {
  const state = sort.value
  sort.value = state?.column === name && state.dir === 'asc'
    ? { column: name, dir: 'desc' }
    : { column: name, dir: 'asc' }
}

function arrow(name: string): string {
  if (sort.value?.column !== name) return ''
  return sort.value.dir === 'asc' ? '▲' : '▼'
}

function setFilter(name: string, value: string) {
  filters.value = { ...filters.value, [name]: value }
}

function clearFilters() {
  filters.value = {}
}

const activeFilters = computed(() =>
  Object.entries(filters.value).filter(([, text]) => text.trim().length > 0),
)

const filterSummary = computed(() => {
  if (activeFilters.value.length === 0) return ''
  return activeFilters.value.map(([name, text]) => `${name} ⊃ "${text.trim()}"`).join(' · ')
})

/** Kolon genisligi: tarih alanlari tek satira sigmadigi icin daha genis. */
function flexOf(name: string): string {
  if (/date|time/i.test(name)) return '1.3'
  if (/^(cur|currency|code)/i.test(name)) return '.6'
  return '1'
}

function typeTag(name: string): string {
  const kind = kindOf(name)
  return kind === 'number' ? 'num' : kind === 'nested' ? 'obj' : 'str'
}

function cellClass(item: JsonObject, name: string): string {
  const value = item[name]
  if (value === undefined) return 't-missing'
  if (isContainer(value)) return 't-nested'
  // Tasarimin tablo paleti: durum kodlari ve referans alanlari kendi rengiyle.
  const tone = statusTone(name, value)
  if (tone) return `t-status-${tone}`
  if (isRefField(name)) return 't-ref'
  return `t-${getType(value)}`
}

function cell(item: JsonObject, name: string): string {
  const value = item[name]
  if (value === undefined) return '—'
  if (Array.isArray(value)) return `[${value.length}]`
  if (isContainer(value)) return `{${childCount(value)}}`
  return cellText(value)
}

function rowPath(index: number): string {
  return `${props.path}.${index}`
}

function onSelect(index: number) {
  emit('select', rowPath(index))
}

// --- Alt toplam seridi -------------------------------------------------------

/**
 * Toplami gosterilecek kolon. NDC tablolarinda bakilan sayi neredeyse her
 * zaman bir tutar; adinda tutar/amount gecen ilk sayisal kolon one aliniyor,
 * yoksa ilk sayisal kolon.
 */
const sumColumn = computed(() => {
  const numeric = columns.value.columns.filter(column => column.kind === 'number')
  if (numeric.length === 0) return null
  return numeric.find(column => /amount|price|total|tutar|fiyat/i.test(column.name)) ?? numeric[0]
})

const sumValue = computed(() => {
  const column = sumColumn.value
  if (!column) return null
  let total = 0
  for (const { item } of rows.value) {
    const value = item[column.name]
    if (typeof value === 'number' && Number.isFinite(value)) total += value
  }
  return total
})

const selectedLabel = computed(() => {
  const selected = props.selectedPath
  if (!selected || !selected.startsWith(`${props.path}.`)) return null
  const index = Number(selected.slice(props.path.length + 1).split('.')[0])
  if (!Number.isInteger(index) || !props.items[index]) return null
  // Kaydin kimligi: adinda ID gecen ilk skaler alan, yoksa sira numarasi.
  const item = props.items[index]
  const idKey = Object.keys(item).find(key => /id$/i.test(key) && !isContainer(item[key]))
  return idKey ? cellText(item[idKey]) : `#${index}`
})

function downloadCsv() {
  const names = columns.value.columns.map(column => column.name)
  const csv = toCsv(names, rows.value.map(row => row.item))
  // BOM: Excel dosyayi UTF-8 olarak acsin diye.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `${props.path.split('.').filter(part => !/^\d+$/.test(part)).slice(-1)[0] ?? 'tablo'}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}

// --- Sanallastirma -----------------------------------------------------------

const scrollEl = ref<HTMLElement | null>(null)
const virtualVersion = ref(0)
const virtualizer = useVirtualizer(computed(() => ({
  count: rows.value.length,
  getScrollElement: () => scrollEl.value,
  estimateSize: () => 27,
  overscan: 12,
  getItemKey: (index: number) => rows.value[index]?.index ?? index,
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

watch(rows, () => {
  virtualizer.value.measure()
})

const label = computed(() => `${props.path.split('.').slice(1).join('.')}[]`)

function short(value: number): string {
  return value.toLocaleString('tr-TR', { maximumFractionDigits: 2 })
}

function isNumericValue(item: JsonObject, name: string): boolean {
  return typeof item[name] === 'number'
}

function valueOf(item: JsonObject, name: string): JsonValue | undefined {
  return item[name]
}
</script>

<template>
  <div class="array-table">
    <div class="strip">
      <span class="path" :title="path">{{ label }}</span>
      <span class="count">{{ rows.length.toLocaleString('tr-TR') }} kayıt</span>
      <span v-if="filterSummary" class="filter-summary">{{ filterSummary }}</span>
      <span v-if="columns.hidden > 0" class="filter-summary">
        {{ columns.hidden }} kolon gizlendi
      </span>
      <span class="spacer" />
      <button
        class="action"
        :disabled="activeFilters.length === 0"
        @click="clearFilters"
      >Filtreleri temizle</button>
      <button class="action accent" @click="downloadCsv">CSV indir</button>
      <button class="action" @click="emit('close')">× kapat</button>
    </div>

    <div class="head">
      <div
        v-for="column in columns.columns"
        :key="column.name"
        class="col"
        :style="{ flex: flexOf(column.name) }"
      >
        <button
          class="col-head"
          :class="{ sorted: sort?.column === column.name }"
          :title="`${column.name} — sıralamayı çevir`"
          @click="toggleSort(column.name)"
        >
          <span class="col-name">{{ column.name }}</span>
          <span class="arrow">{{ arrow(column.name) }}</span>
          <span class="spacer" />
          <span class="kind">{{ typeTag(column.name) }}</span>
        </button>
        <div class="col-filter">
          <input
            class="filter-input"
            :class="{ filled: (filters[column.name] ?? '').length > 0 }"
            type="text"
            placeholder="filtre"
            :value="filters[column.name] ?? ''"
            @input="setFilter(column.name, ($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>
    </div>

    <div ref="scrollEl" class="scroll">
      <p v-if="rows.length === 0" class="empty">Bu filtrelere uyan kayıt yok.</p>

      <div v-else class="canvas" :style="{ height: `${totalSize}px` }">
        <div
          v-for="vrow in virtualRows"
          :key="String(vrow.key)"
          class="vrow"
          :style="{ transform: `translateY(${vrow.start}px)` }"
        >
          <div
            v-if="rows[vrow.index]"
            class="tr"
            :class="{
              zebra: vrow.index % 2 === 1,
              selected: selectedPath === rowPath(rows[vrow.index].index),
            }"
            @click="onSelect(rows[vrow.index].index)"
            @dblclick="emit('focusPath', rowPath(rows[vrow.index].index))"
          >
            <div
              v-for="column in columns.columns"
              :key="column.name"
              class="td"
              :class="[cellClass(rows[vrow.index].item, column.name), { num: isNumericValue(rows[vrow.index].item, column.name) }]"
              :style="{ flex: flexOf(column.name) }"
              :title="String(valueOf(rows[vrow.index].item, column.name) ?? '')"
            >{{ cell(rows[vrow.index].item, column.name) }}</div>
          </div>
        </div>
      </div>

      <p v-if="rows.length > 0" class="virtual-note">
        <span class="dot" />
        {{ rows.length.toLocaleString('tr-TR') }} kayıt eşleşti ·
        {{ virtualRows.length }} satır render edildi · sanal scroll
      </p>
    </div>

    <div class="totals">
      <span class="total"><span class="label">kayıt</span><span class="value">{{ rows.length.toLocaleString('tr-TR') }}</span></span>
      <span v-if="sumColumn && sumValue !== null" class="total">
        <span class="label">toplam {{ sumColumn.name }}</span>
        <span class="value number">{{ short(sumValue) }}</span>
      </span>
      <span v-if="sort" class="total">
        <span class="label">sıralama</span>
        <span class="value accent">{{ sort.column }} {{ sort.dir === 'asc' ? '↑' : '↓' }}</span>
      </span>
      <span v-if="selectedLabel" class="total">
        <span class="label">seçili</span>
        <span class="value purple">{{ selectedLabel }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.array-table { display: flex; flex-direction: column; flex: 1; min-height: 0; }

.strip {
  display: flex; align-items: center; gap: 10px; padding: 9px 14px;
  background: var(--bg-secondary); border-bottom: 1px solid var(--border-subtle); flex-shrink: 0;
}
.path { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.count {
  font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--purple);
  background: var(--purple-dim); border-radius: 20px; padding: 2px 9px; white-space: nowrap; flex-shrink: 0;
}
.filter-summary { font-size: 11.5px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spacer { flex: 1; }
.action {
  font-size: 11.5px; color: var(--text-muted); border: 1px solid var(--border);
  border-radius: 6px; padding: 3px 9px; white-space: nowrap; flex-shrink: 0;
}
.action:hover:not(:disabled) { color: var(--red); border-color: var(--red); }
.action:disabled { opacity: .4; cursor: not-allowed; }
.action.accent { color: var(--accent); }
.action.accent:hover { color: var(--accent); border-color: var(--accent); }

.head { display: flex; background: var(--bg-secondary); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.col { min-width: 0; border-right: 1px solid var(--border-subtle); }
.col-head { display: flex; align-items: center; gap: 5px; padding: 8px 10px 5px; width: 100%; text-align: left; }
.col-head:hover { background: var(--bg-tertiary); }
.col-name {
  font-family: 'JetBrains Mono', monospace; font-size: 10.5px; font-weight: 700;
  color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.col-head.sorted .col-name { color: var(--accent); }
.arrow { font-size: 9px; color: var(--accent); }
.kind { font-size: 9px; color: var(--text-muted); flex-shrink: 0; }

.col-filter { padding: 0 8px 7px; }
.filter-input {
  width: 100%; background: var(--bg-primary); border: 1px solid var(--border);
  border-radius: 5px; outline: none; color: var(--text-primary);
  font-family: 'JetBrains Mono', monospace; font-size: 11px; padding: 3px 7px;
}
.filter-input.filled, .filter-input:focus { border-color: var(--accent); }

.scroll { flex: 1; min-height: 0; overflow-y: auto; }
.canvas { position: relative; width: 100%; }
.vrow { position: absolute; top: 0; left: 0; width: 100%; }
.empty { font-size: 12.5px; color: var(--text-muted); padding: 18px 14px; }

.tr { display: flex; border-bottom: 1px solid var(--border-subtle); cursor: pointer; transition: background .1s; }
.tr:hover { background: var(--bg-secondary); }
.tr.zebra { background: var(--row-zebra); }
.tr.selected { background: var(--purple-wash); box-shadow: inset 2px 0 0 var(--purple); }
.td {
  min-width: 0; padding: 6px 10px; font-family: 'JetBrains Mono', monospace; font-size: 12px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  border-right: 1px solid var(--border-subtle);
}
.td.num { text-align: right; }

.t-string { color: var(--color-string); }
.t-number { color: var(--color-number); }
.t-boolean { color: var(--color-bool); }
.t-null { color: var(--color-null); font-style: italic; }
.t-nested { color: var(--purple); }
.t-missing { color: var(--text-muted); }
.t-ref { color: var(--cyan); }
.t-status-ok { color: var(--green); }
.t-status-warn { color: var(--orange); }
.t-status-off { color: var(--text-muted); }

.virtual-note {
  display: flex; align-items: center; justify-content: center; gap: 10px; padding: 12px;
  font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-muted);
}
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--orange); }

.totals {
  display: flex; align-items: center; gap: 14px; height: 32px; padding: 0 14px;
  background: var(--bg-secondary); border-top: 1px solid var(--border); flex-shrink: 0;
}
.total { display: flex; align-items: center; gap: 6px; font-family: 'JetBrains Mono', monospace; font-size: 11px; }
.label { color: var(--text-muted); }
.value { color: var(--text-primary); }
.value.number { color: var(--color-number); }
.value.accent { color: var(--accent); }
.value.purple { color: var(--purple); }
</style>
