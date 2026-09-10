<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue'
import type { FieldDoc, JsonObject, JsonValue } from '../types'
import { GRID, type GridContext } from '../utils/gridContext'
import { effectiveFieldName, isRefField, resolveRef, type RefIndex, type RefTarget } from '../utils/references'
import { isRecordArray, toCsv, valueAtPath } from '../utils/grid'
import { applyFilters, modelOf, nextSort, type GridSort } from '../utils/gridModel'
import GridTable from './GridTable.vue'

/**
 * Grid gorunumunun kabugu: arac cubugu, tuval ve paylasilan durum.
 *
 * Gosterilen dugum **kirinti yolundaki** dugumdur — grid butun belgeyi degil,
 * o an bakilan dugumu cizer. Derine inmek iki yoldan olur: hucreyi acmak
 * (uc seviye, yerinde) ya da `→ yolu aç` ile o dugume gecmek.
 *
 * Arac cubugunda filtre dugmesi **yok**: filtre tablonun kendi kosesinde,
 * cunku hangi tabloyu filtreledigin oradan belli.
 */
const props = defineProps<{
  data: JsonValue
  rootKey: string
  /** Gosterilecek dugumun yolu (kirinti yolu). */
  nodePath: string
  selectedPath?: string | null
  searchTerm?: string
  docLookup?: (nodePath: string) => FieldDoc | undefined
  refIndex?: RefIndex
  schemaKnown?: boolean
}>()

const emit = defineEmits<{
  /** Bu dugume gec: kirinti oraya tasinir. */
  goTo: [path: string]
  /** Secim degisti: GridSync tetiklenir. */
  select: [path: string]
  /** Referans hedefi karti acilsin. */
  openRef: [target: RefTarget]
}>()

// --- Yol anahtarli durum ------------------------------------------------------

const open = ref<Record<string, boolean>>({})
const sort = ref<Record<string, GridSort>>({})
const filters = ref<Record<string, string>>({})
const filtersOn = ref<Record<string, boolean>>({})

// Veri degistiginde eski yollarin durumu anlamsiz; hepsi temizleniyor.
watch(() => props.data, () => {
  open.value = {}
  sort.value = {}
  filters.value = {}
  filtersOn.value = {}
})

/** Gosterilen dugum; yol belgede yoksa koke duser. */
const node = computed<JsonValue>(() => {
  const value = valueAtPath(props.data, props.rootKey, props.nodePath)
  return value === undefined ? props.data : value
})

const model = computed(() => modelOf(node.value))

const context: GridContext = {
  rootKey: props.rootKey,
  selectedPath: computed(() => props.selectedPath ?? null),
  searchTerm: computed(() => props.searchTerm ?? ''),
  schemaKnown: computed(() => props.schemaKnown === true),

  isOpen: (path: string) => open.value[path] === true,
  toggleOpen: (path: string) => { open.value = { ...open.value, [path]: !open.value[path] } },

  sortOf: (path: string) => sort.value[path],
  cycleSort: (path: string, column: string) => {
    const next = nextSort(sort.value[path], column)
    const copy = { ...sort.value }
    if (next) copy[path] = next
    else delete copy[path]
    sort.value = copy
  },

  filtersOn: (path: string) => filtersOn.value[path] === true,
  toggleFilters: (path: string) => {
    filtersOn.value = { ...filtersOn.value, [path]: !filtersOn.value[path] }
  },
  filterOf: (path: string, column: string) => filters.value[`${path}::${column}`] ?? '',
  setFilter: (path: string, column: string, value: string) => {
    filters.value = { ...filters.value, [`${path}::${column}`]: value }
  },

  select: (path: string) => emit('select', path),
  goTo: (path: string) => emit('goTo', path),

  docFor: (path: string) => props.docLookup?.(path),
  refFor: (path: string, value: JsonValue) => {
    if (!props.refIndex) return undefined
    const field = effectiveFieldName(path)
    if (!isRefField(field)) return undefined
    return resolveRef(props.refIndex, field, value, path.slice(0, path.lastIndexOf('.')))
  },
  openRef: (target: RefTarget) => emit('openRef', target),
}

provide(GRID, context)

// --- Arac cubugu --------------------------------------------------------------

/**
 * "Tumunu ac": gosterilen dugumun altindaki kapsayici hucreleri derinlik
 * butcesi kadar acar. Butun belgeyi degil — grid zaten tek dugume bakiyor.
 */
function expandAll() {
  const next: Record<string, boolean> = {}
  const walk = (value: JsonValue, path: string, depth: number) => {
    if (depth > 2 || value === null || typeof value !== 'object') return
    const entries = Array.isArray(value)
      ? value.map((item, index) => [String(index), item] as const)
      : Object.entries(value as JsonObject)
    for (const [key, child] of entries) {
      if (child === null || typeof child !== 'object') continue
      const nextPath = `${path}.${key}`
      next[nextPath] = true
      walk(child, nextPath, depth + 1)
    }
  }
  walk(node.value, props.nodePath, 0)
  open.value = next
}

function collapseAll() {
  open.value = {}
}

/** Gorunen kayit dizisini CSV olarak indirir. */
function downloadCsv() {
  const value = node.value
  if (!isRecordArray(value)) return
  const names = model.value.columns.map(column => column.name)
  const csv = toCsv(names, value as JsonObject[])
  // BOM: Excel dosyayi UTF-8 olarak acsin diye.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  const name = props.nodePath.split('.').filter(part => !/^\d+$/.test(part)).slice(-1)[0] ?? 'tablo'
  link.download = `${name}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}

const canCsv = computed(() => isRecordArray(node.value))

/**
 * Arac cubugunun sagindaki tek meta. Filtre acikken **gorunen** sayiyi
 * yaziyor: tabloda dort satir varken "12 satır" yazmak filtrenin ise
 * yaradigini gizler.
 */
const meta = computed(() => {
  const columns = model.value.columns.length
  const unit = model.value.shape === 'records' ? 'satır' : 'alan'
  const total = model.value.total
  let shown = total
  if (isRecordArray(node.value)) {
    shown = applyFilters(node.value as JsonObject[], props.nodePath, filters.value).length
  }
  const count = shown === total
    ? total.toLocaleString('tr-TR')
    : `${shown.toLocaleString('tr-TR')} / ${total.toLocaleString('tr-TR')}`
  return `${count} ${unit} · ${columns} kolon`
})
</script>

<template>
  <div class="grid">
    <div class="toolbar">
      <button class="tool" @click="expandAll"><span class="glyph">⊞</span>tümünü aç</button>
      <button class="tool" @click="collapseAll"><span class="glyph">⊟</span>tümünü kapat</button>
      <button v-if="canCsv" class="tool" @click="downloadCsv">CSV</button>
      <div class="toolbar-spacer" />
      <span class="meta">{{ meta }}</span>
    </div>

    <div class="canvas">
      <GridTable :value="node" :path="nodePath" :depth="0" />
    </div>
  </div>
</template>

<style scoped>
.grid { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }

.toolbar {
  display: flex; align-items: center; gap: 14px; padding: 0 14px;
  height: var(--h-toolbar); background: var(--bg-chrome);
  border-bottom: 1px solid var(--line); flex-shrink: 0;
}
.tool { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ink-2); white-space: nowrap; }
.tool:hover { color: var(--ink); }
.glyph { font-size: 9px; color: var(--ink-3); }
.toolbar-spacer { flex: 1; }
.meta { font-size: 11px; color: var(--ink-3); white-space: nowrap; }

/*
 * Tuval: tablo burada *durur*, alani kaplamaz. Genis tablolar yatayda
 * kayar; tuvali daraltmak yerine kaydirmak tasarimin karari.
 */
.canvas { flex: 1; min-height: 0; overflow: auto; background: var(--bg-app); padding: 12px 14px 28px; }
</style>
