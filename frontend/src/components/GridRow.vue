<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { FieldDoc, JsonArray, JsonObject, JsonValue } from '../types'
import { getType } from '../utils/json'
import { childPath, matchesDeep } from '../utils/search'
import { effectiveFieldName, isRefField, resolveRef, type RefIndex, type RefTarget } from '../utils/references'
import GridRow from './GridRow.vue'

const props = defineProps<{
  field: string
  value: JsonValue
  path: string
  depth: number
  /** Acik satirlarin yollari; tum agac icin ortak. */
  expanded: Set<string>
  searchTerm?: string
  docLookup?: (nodePath: string) => FieldDoc | undefined
  filterMatches?: boolean
  refIndex?: RefIndex
  focusPath?: string | null
  /** Referans onizlemesi icinde ise ic ice referans acilmaz. */
  insidePreview?: boolean
}>()

const emit = defineEmits<{ toggle: [path: string]; focusPath: [path: string] }>()

const ROW_PAGE_SIZE = 100

const type = computed(() => getType(props.value))
const isContainer = computed(() => type.value === 'object' || type.value === 'array')
const isOpen = computed(() => props.expanded.has(props.path))
const isFocused = computed(() => props.focusPath === props.path)

const doc = computed(() => props.docLookup?.(props.path))
const docTitle = computed(() => {
  const info = doc.value
  if (!info) return undefined
  return info.type ? `${info.type}\n\n${info.documentation}` : info.documentation
})

const childCount = computed(() => {
  if (!isContainer.value) return 0
  return Array.isArray(props.value)
    ? (props.value as JsonArray).length
    : Object.keys(props.value as JsonObject).length
})

const summary = computed(() => {
  if (type.value === 'array') return `${childCount.value} öğe`
  if (type.value === 'object') return `${childCount.value} alan`
  return ''
})

const filterActive = computed(() => props.filterMatches === true && !!props.searchTerm?.trim())

/** Bu satirin kendisi mi eslesti yoksa eslesme alt agacinda mi. */
const matchKind = computed<'self' | 'deep' | null>(() => {
  const term = props.searchTerm?.trim()
  if (!term) return null
  if (props.field.toLowerCase().includes(term.toLowerCase())) return 'self'
  if (!matchesDeep(props.value, term)) return null
  return isContainer.value ? 'deep' : 'self'
})

const allChildren = computed(() => {
  if (!isContainer.value) return []
  return Array.isArray(props.value)
    ? (props.value as JsonArray).map((value, index) => ({ key: String(index), value }))
    : Object.entries(props.value as JsonObject).map(([key, value]) => ({ key, value }))
})

// Filtre acikken elenen cocuklar sayfalamadan once cikarilir.
const keptChildren = computed(() => {
  if (!filterActive.value) return allChildren.value
  const term = props.searchTerm!.trim()
  const needle = term.toLowerCase()
  return allChildren.value.filter(
    child => child.key.toLowerCase().includes(needle) || matchesDeep(child.value, term),
  )
})

const visibleCount = ref(ROW_PAGE_SIZE)
watch([() => props.value, filterActive, () => props.searchTerm], () => {
  visibleCount.value = ROW_PAGE_SIZE
})

const visibleChildren = computed(() => keptChildren.value.slice(0, visibleCount.value))
const pendingCount = computed(() => Math.max(0, keptChildren.value.length - visibleCount.value))

function showMore() {
  visibleCount.value += ROW_PAGE_SIZE * 5
}

// --- NDC referanslari --------------------------------------------------------

const refTarget = computed<RefTarget | undefined>(() => {
  if (isContainer.value || props.insidePreview || !props.refIndex) return undefined
  const fieldName = effectiveFieldName(props.path)
  if (!isRefField(fieldName)) return undefined
  const parentPath = props.path.slice(0, props.path.lastIndexOf('.'))
  return resolveRef(props.refIndex, fieldName, props.value, parentPath)
})

const previewOpen = ref(false)

const refPreviewChildren = computed(() => {
  const target = refTarget.value
  if (!target || target.value === null || typeof target.value !== 'object') return []
  return Array.isArray(target.value)
    ? (target.value as JsonArray).map((value, index) => ({ key: String(index), value }))
    : Object.entries(target.value as JsonObject).map(([key, value]) => ({ key, value }))
})

function displayValue(value: JsonValue): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  return String(value)
}
</script>

<template>
  <tr
    class="tr"
    :class="{ match: matchKind === 'self', 'match-deep': matchKind === 'deep', focused: isFocused }"
  >
    <td class="td td-key">
      <span class="indent" :style="{ width: `${depth * 18}px` }" />
      <button v-if="isContainer" class="caret" :class="{ open: isOpen }" @click="emit('toggle', path)">▸</button>
      <span v-else class="caret-ph" />
      <span class="field" :class="{ documented: !!doc }" :title="docTitle">{{ field }}</span>
    </td>

    <td class="td td-type">
      <span class="badge" :class="'t-' + type">{{ type }}</span>
    </td>

    <td class="td td-value">
      <button v-if="isContainer" class="summary" @click="emit('toggle', path)">
        {{ summary }}
      </button>
      <template v-else>
        <span class="v" :class="'v-' + type">{{ displayValue(value) }}</span>
        <button
          v-if="refTarget"
          class="ref-btn"
          :class="{ open: previewOpen }"
          :title="`Referans: ${refTarget.idField} → ${refTarget.path}`"
          @click="previewOpen = !previewOpen"
        >↳ referans</button>
      </template>
    </td>
  </tr>

  <!-- Referans hedefi: satirin hemen altinda, yerinde -->
  <tr v-if="refTarget && previewOpen" class="tr ref-row">
    <td class="td ref-cell" colspan="3">
      <div class="ref-box" :style="{ marginLeft: `${(depth + 1) * 18}px` }">
        <div class="ref-head">
          <code class="ref-path">{{ refTarget.path }}</code>
          <button class="ref-goto" @click="emit('focusPath', refTarget.path)">Hedefe git</button>
        </div>
        <table class="inner-table">
          <tbody>
            <GridRow
              v-for="child in refPreviewChildren"
              :key="child.key"
              :field="child.key"
              :value="child.value"
              :path="childPath(refTarget.path, child.key)"
              :depth="0"
              :expanded="expanded"
              :doc-lookup="docLookup"
              :inside-preview="true"
              @toggle="emit('toggle', $event)"
            />
          </tbody>
        </table>
      </div>
    </td>
  </tr>

  <!-- Cocuk satirlar; drill-down yok, yerinde acilir -->
  <template v-if="isContainer && isOpen">
    <GridRow
      v-for="child in visibleChildren"
      :key="child.key"
      :field="child.key"
      :value="child.value"
      :path="childPath(path, child.key)"
      :depth="depth + 1"
      :expanded="expanded"
      :search-term="searchTerm"
      :doc-lookup="docLookup"
      :filter-matches="filterMatches"
      :ref-index="refIndex"
      :focus-path="focusPath"
      :inside-preview="insidePreview"
      @toggle="emit('toggle', $event)"
      @focus-path="emit('focusPath', $event)"
    />
    <tr v-if="pendingCount > 0" class="tr">
      <td class="td" colspan="3">
        <span class="indent" :style="{ width: `${(depth + 1) * 18}px` }" />
        <button class="more-btn" @click="showMore">{{ pendingCount.toLocaleString() }} satır daha göster</button>
      </td>
    </tr>
  </template>
</template>

<style scoped>
.tr { transition: background .1s; }
.tr:hover { background: var(--bg-hover); }
.tr.match { background: rgba(255,220,0,.1); }
.tr.match-deep { background: rgba(255,220,0,.04); }
.tr.focused { background: var(--accent-dim); box-shadow: inset 2px 0 0 var(--accent); }

.td { padding: 5px 12px; border-bottom: 1px solid var(--border-subtle); font-family: 'JetBrains Mono', monospace; font-size: 12.5px; vertical-align: middle; }
.td-key { white-space: nowrap; }
.td-type { width: 110px; }
.td-value { width: 100%; }

.indent { display: inline-block; flex-shrink: 0; }
.caret { width: 16px; color: var(--text-muted); font-size: 10px; transition: transform .15s; display: inline-block; }
.caret.open { transform: rotate(90deg); }
.caret:hover { color: var(--text-primary); }
.caret-ph { display: inline-block; width: 16px; }
.field { color: var(--color-key); font-weight: 500; margin-left: 4px; }
.field.documented { cursor: help; text-decoration: underline dotted var(--text-muted); }

.badge { font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; }
.t-string { background: rgba(165,214,255,.12); color: var(--color-string); }
.t-number { background: rgba(247,129,102,.12); color: var(--color-number); }
.t-boolean { background: rgba(121,192,255,.12); color: var(--color-bool); }
.t-null { background: rgba(110,118,129,.12); color: var(--color-null); }
.t-object { background: rgba(188,140,255,.12); color: var(--purple); }
.t-array { background: rgba(63,185,80,.12); color: var(--green); }

.summary { color: var(--text-muted); font-size: 11px; font-style: italic; }
.summary:hover { color: var(--accent); }
.v-string { color: var(--color-string); }
.v-number { color: var(--color-number); }
.v-boolean { color: var(--color-bool); font-weight: 500; }
.v-null { color: var(--color-null); font-style: italic; }

.ref-btn { font-size: 10px; color: var(--accent); background: var(--accent-dim); padding: 1px 7px; border-radius: 10px; margin-left: 8px; white-space: nowrap; }
.ref-btn:hover, .ref-btn.open { background: rgba(88,166,255,.28); }
.ref-row:hover { background: transparent; }
.ref-cell { padding: 6px 12px; }
.ref-box { border-left: 2px solid var(--accent); background: rgba(88,166,255,.05); border-radius: 0 6px 6px 0; padding: 6px 10px; }
.ref-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.ref-path { font-size: 10px; color: var(--text-muted); word-break: break-all; }
.ref-goto { font-size: 10px; color: var(--accent); padding: 1px 8px; border-radius: 4px; border: 1px solid var(--border); white-space: nowrap; }
.ref-goto:hover { background: var(--accent-dim); }
.inner-table { width: 100%; border-collapse: collapse; }

.more-btn { font-size: 11px; color: var(--accent); background: var(--accent-dim); padding: 3px 10px; border-radius: 5px; }
.more-btn:hover { background: rgba(88,166,255,.25); }
</style>
