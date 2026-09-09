<script setup lang="ts">
import { computed, ref } from 'vue'
import type { JsonObject } from '../types'
import {
  cellText, statusTone, childCount, isContainer, recordColumns, sortRecords, type SortState,
} from '../utils/grid'
import { getType } from '../utils/json'
import { isRefField } from '../utils/references'

/**
 * Nesne dizisinin **yerinde** tablosu: agactan cikmadan, satirin hemen
 * altinda. Onizleme olarak duruyor — ilk birkac kayit ve siralama; kolon
 * filtresi, CSV ve toplamlar tam tabloda (`ArrayTable`).
 *
 * Buradaki isin tamami "bu dizide ne var" sorusuna bakmadan cevap vermek;
 * kayitlar arasinda gercekten calisacak kisi tam tabloyu aciyor.
 */
const props = defineProps<{
  items: JsonObject[]
  path: string
  depth: number
}>()

const emit = defineEmits<{ expand: [path: string] }>()

/** Onizlemede gosterilen kayit sayisi; tasarimin degeri bes. */
const PREVIEW_ROWS = 5

const sort = ref<SortState | null>(null)

const columns = computed(() => recordColumns(props.items).columns)

const rows = computed(() => {
  const indexed = props.items.map((item, index) => ({ index, item }))
  const state = sort.value
  if (!state) return indexed.slice(0, PREVIEW_ROWS)
  const kind = columns.value.find(column => column.name === state.column)?.kind ?? 'text'
  return sortRecords(indexed, state, kind).slice(0, PREVIEW_ROWS)
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

/**
 * Kolon genisligi: tarih alanlari tek satira sigmadigi icin daha genis
 * paylasiliyor (tasarimda `CreateDateTime` 1.4).
 */
function flexOf(name: string): string {
  return /date|time/i.test(name) ? '1.4' : '1'
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

const footer = computed(() => {
  const total = props.items.length
  if (total <= PREVIEW_ROWS) return `${total.toLocaleString('tr-TR')} kayıt · tam tabloyu aç`
  return `ilk ${PREVIEW_ROWS} kayıt · ${total.toLocaleString('tr-TR')} kayıt · tam tabloyu aç`
})
</script>

<template>
  <div class="table-strip" :style="{ '--depth': depth + 1 }">
    <div class="frame">
      <div class="head" role="row">
        <button
          v-for="column in columns"
          :key="column.name"
          class="th"
          :class="{ sorted: sort?.column === column.name }"
          :style="{ flex: flexOf(column.name) }"
          :title="`${column.name} — sıralamayı çevir`"
          @click="toggleSort(column.name)"
        >
          <span class="th-name">{{ column.name }}</span>
          <span class="arrow">{{ arrow(column.name) }}</span>
        </button>
      </div>

      <div v-for="(row, position) in rows" :key="row.index" class="tr" :class="{ zebra: position % 2 === 1 }">
        <div
          v-for="column in columns"
          :key="column.name"
          class="td"
          :class="cellClass(row.item, column.name)"
          :style="{ flex: flexOf(column.name) }"
          :title="cell(row.item, column.name)"
        >{{ cell(row.item, column.name) }}</div>
      </div>

      <button class="foot" @click="emit('expand', path)">{{ footer }}</button>
    </div>
  </div>
</template>

<style scoped>
.table-strip { border-bottom: 1px solid var(--border-subtle); padding: 8px var(--row-pad-x) 10px; }
.frame {
  margin-left: calc(var(--depth) * var(--indent));
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.head { display: flex; background: var(--bg-secondary); border-bottom: 1px solid var(--border); }
.th {
  min-width: 0; display: flex; align-items: center; gap: 4px; padding: 6px 9px;
  font-family: 'JetBrains Mono', monospace; font-size: 10.5px; font-weight: 600;
  color: var(--text-secondary); border-right: 1px solid var(--border-subtle); text-align: left;
}
.th:hover { background: var(--bg-tertiary); }
.th.sorted { color: var(--accent); }
.th-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.arrow { color: var(--accent); font-size: 9px; }

.tr { display: flex; border-bottom: 1px solid var(--border-subtle); }
.tr.zebra { background: var(--row-zebra); }
.tr:last-of-type { border-bottom: none; }
.td {
  min-width: 0; padding: 5px 9px; font-family: 'JetBrains Mono', monospace; font-size: 11.5px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  border-right: 1px solid var(--border-subtle);
}

.t-string { color: var(--color-string); }
.t-number { color: var(--color-number); text-align: right; }
.t-boolean { color: var(--color-bool); }
.t-null { color: var(--color-null); font-style: italic; }
.t-nested { color: var(--purple); }
.t-missing { color: var(--text-muted); }
.t-ref { color: var(--cyan); }
.t-status-ok { color: var(--green); }
.t-status-warn { color: var(--orange); }
.t-status-off { color: var(--text-muted); }

.foot {
  display: block; width: 100%; text-align: left; padding: 6px 9px; background: var(--bg-secondary);
  font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-muted);
  border-top: 1px solid var(--border-subtle);
}
.foot:hover { color: var(--accent); }
</style>
