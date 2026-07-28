<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { FieldDoc, JsonArray, JsonObject, JsonValue } from '../types'
import { getType } from '../utils/json'
import { childPath, matchesDeep } from '../utils/search'
import type { RefIndex } from '../utils/references'
import GridRow from './GridRow.vue'

const props = defineProps<{
  data: JsonValue
  rootKey: string
  searchTerm?: string
  docLookup?: (nodePath: string) => FieldDoc | undefined
  filterMatches?: boolean
  refIndex?: RefIndex
  focusRequest?: { path: string; seq: number } | null
}>()

const emit = defineEmits<{ focusPath: [path: string] }>()

/** Acik olan satirlarin yollari; drill-down yerine yerinde acilma. */
const expanded = ref(new Set<string>([props.rootKey]))

watch(() => props.data, () => {
  expanded.value = new Set([props.rootKey])
})

// Odak istegi ilgili dallari acar.
watch(() => props.focusRequest, (request) => {
  if (!request) return
  const next = new Set(expanded.value)
  const segments = request.path.split('.')
  for (let i = 1; i <= segments.length; i++) next.add(segments.slice(0, i).join('.'))
  expanded.value = next
})

function toggle(path: string) {
  const next = new Set(expanded.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  expanded.value = next
}

function expandAll() {
  const next = new Set<string>()
  const limit = 5000
  function walk(value: JsonValue, path: string) {
    if (next.size > limit) return
    if (value === null || typeof value !== 'object') return
    next.add(path)
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, childPath(path, i)))
    } else {
      for (const [key, child] of Object.entries(value as JsonObject)) {
        walk(child, childPath(path, key))
      }
    }
  }
  walk(props.data, props.rootKey)
  expanded.value = next
}

function collapseAll() {
  expanded.value = new Set([props.rootKey])
}

const rootType = computed(() => getType(props.data))
const rootChildren = computed(() => {
  if (rootType.value === 'array') {
    return (props.data as JsonArray).map((value, index) => ({ key: String(index), value }))
  }
  if (rootType.value === 'object') {
    return Object.entries(props.data as JsonObject).map(([key, value]) => ({ key, value }))
  }
  return []
})

const filterActive = computed(() => props.filterMatches === true && !!props.searchTerm?.trim())

const visibleRootChildren = computed(() => {
  if (!filterActive.value) return rootChildren.value
  const term = props.searchTerm!.trim()
  return rootChildren.value.filter(
    child => child.key.toLowerCase().includes(term.toLowerCase()) || matchesDeep(child.value, term),
  )
})

const hiddenRootCount = computed(() => rootChildren.value.length - visibleRootChildren.value.length)
</script>

<template>
  <div class="grid">
    <div class="grid-toolbar">
      <button class="tool-btn" @click="expandAll">Tümünü aç</button>
      <button class="tool-btn" @click="collapseAll">Tümünü kapat</button>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th class="th th-key">Alan</th>
            <th class="th th-type">Tip</th>
            <th class="th th-value">Değer</th>
          </tr>
        </thead>
        <tbody>
          <GridRow
            v-for="child in visibleRootChildren"
            :key="child.key"
            :field="child.key"
            :value="child.value"
            :path="childPath(rootKey, child.key)"
            :depth="0"
            :expanded="expanded"
            :search-term="searchTerm"
            :doc-lookup="docLookup"
            :filter-matches="filterMatches"
            :ref-index="refIndex"
            :focus-request="focusRequest"
            @toggle="toggle"
            @focus-path="emit('focusPath', $event)"
          />
        </tbody>
      </table>
    </div>

    <p v-if="filterActive && hiddenRootCount > 0" class="filter-note">
      Kök seviyede {{ hiddenRootCount }} alan filtrelendi.
    </p>
    <p v-if="rootChildren.length === 0" class="filter-note">
      Bu JSON bir nesne veya dizi değil: <code>{{ data }}</code>
    </p>
  </div>
</template>

<style scoped>
.grid { font-size: 13px; }
.grid-toolbar { display: flex; gap: 6px; padding: 8px 2px 10px; }
.tool-btn { font-size: 11px; padding: 4px 10px; border-radius: 6px; color: var(--text-secondary); background: var(--bg-tertiary); border: 1px solid var(--border); }
.tool-btn:hover { color: var(--text-primary); background: var(--bg-hover); }

.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
.table { width: 100%; border-collapse: collapse; }
.th { background: var(--bg-tertiary); color: var(--text-secondary); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; position: sticky; top: 0; z-index: 1; }
.th-type { width: 110px; }
.th-key { min-width: 220px; }

.filter-note { padding: 10px 4px; font-size: 11px; color: var(--text-muted); }
.filter-note code { color: var(--color-string); }
</style>
