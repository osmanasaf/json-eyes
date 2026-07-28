<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { FieldDoc, JsonArray, JsonObject, JsonValue } from '../types'
import { getType, highlightParts } from '../utils/json'
import { childPath, type SearchIndex } from '../utils/search'
import { effectiveFieldName, isRefField, resolveRef, type RefIndex, type RefTarget } from '../utils/references'
import JsonTreeNode from './JsonTreeNode.vue'

const props = defineProps<{
  value: JsonValue
  keyName?: string | number
  depth: number
  isLast: boolean
  searchTerm?: string
  docLookup?: (nodePath: string) => FieldDoc | undefined
  path: string
  defaultExpanded?: boolean
  search?: SearchIndex
  activePath?: string | null
  filterMatches?: boolean
  /** Ustteki bir dugum arama ile eslestiyse alt agac butunuyle gorunur kalir. */
  ancestorMatched?: boolean
  refIndex?: RefIndex
  /** Referans onizlemesi icinde ise ic ice referans acilmaz. */
  insidePreview?: boolean
  /** Referanstan atlanan hedef yol; bu yola giden dugumler acilir ve hedef vurgulanir. */
  focusPath?: string | null
}>()

const emit = defineEmits<{ focusPath: [path: string] }>()

const type = computed(() => getType(props.value))
const isExpandable = computed(() => type.value === 'object' || type.value === 'array')
const expanded = ref(props.defaultExpanded ?? props.depth < 2)
const copied = ref(false)
const rowRef = ref<HTMLElement | null>(null)

/** Cok cocuklu dugumlerde ilk render'da gosterilecek cocuk sayisi. */
const CHILD_PAGE_SIZE = 100

const childCount = computed(() => {
  if (!isExpandable.value) return 0
  return Array.isArray(props.value)
    ? (props.value as JsonArray).length
    : Object.keys(props.value as JsonObject).length
})

const visibleChildCount = ref(CHILD_PAGE_SIZE)

// Icerik degisince sayfalama basa doner.
watch(() => props.value, () => { visibleChildCount.value = CHILD_PAGE_SIZE })

function showMoreChildren() {
  visibleChildCount.value += CHILD_PAGE_SIZE * 5
}

const currentPath = computed(() =>
  props.keyName !== undefined ? childPath(props.path, props.keyName) : props.path,
)

const doc = computed(() =>
  props.keyName !== undefined ? props.docLookup?.(currentPath.value) : undefined,
)

// Tooltip: once XSD tip adi, sonra aciklama.
const docText = computed(() => {
  const info = doc.value
  if (!info) return undefined
  return info.type ? `${info.type}\n\n${info.documentation}` : info.documentation
})

const isMatched = computed(() => props.search?.matchSet.has(currentPath.value) ?? false)
const isActive = computed(
  () => props.activePath != null && props.activePath === currentPath.value,
)
const inMatchSubtree = computed(() => props.ancestorMatched === true || isMatched.value)

// --- NDC referanslari (PaxRefID -> DataLists icindeki Pax) --------------------

const refTarget = computed<RefTarget | undefined>(() => {
  if (isExpandable.value || props.insidePreview || !props.refIndex) return undefined
  const fieldName = effectiveFieldName(currentPath.value)
  if (!isRefField(fieldName)) return undefined
  return resolveRef(props.refIndex, fieldName, props.value, props.path)
})

const previewOpen = ref(false)

function togglePreview() {
  previewOpen.value = !previewOpen.value
}

function goToTarget() {
  if (refTarget.value) emit('focusPath', refTarget.value.path)
}

/** Filtre acikken elenen cocuklar sayfalamadan once cikarilir; aksi halde
 *  sayfa siniri eslesmeleri gizleyebilirdi. */
function childVisible(key: string | number): boolean {
  if (props.filterMatches !== true || inMatchSubtree.value) return true
  const search = props.search
  if (!search || search.matches.length === 0) return true
  return search.visible.has(childPath(currentPath.value, key))
}

const keptArrayItems = computed(() => {
  if (!Array.isArray(props.value)) return []
  return (props.value as JsonArray)
    .map((item, index) => ({ item, index }))
    .filter(entry => childVisible(entry.index))
})

const keptObjectEntries = computed(() => {
  if (!isExpandable.value || Array.isArray(props.value)) return []
  return Object.entries(props.value as JsonObject).filter(([key]) => childVisible(key))
})

const arrayItems = computed(() => keptArrayItems.value.slice(0, visibleChildCount.value))
const objectEntries = computed(() => keptObjectEntries.value.slice(0, visibleChildCount.value))

const hiddenChildCount = computed(() => {
  const kept = Array.isArray(props.value) ? keptArrayItems.value.length : keptObjectEntries.value.length
  return Math.max(0, kept - visibleChildCount.value)
})

// Aktif eslesme sayfa sinirinin otesindeyse sayfayi ona kadar genislet.
watch(
  () => props.activePath,
  (active) => {
    const path = currentPath.value
    if (!active || !path || !active.startsWith(`${path}.`)) return
    const segment = active.slice(path.length + 1).split('.')[0]
    const index = Array.isArray(props.value)
      ? keptArrayItems.value.findIndex(entry => String(entry.index) === segment)
      : keptObjectEntries.value.findIndex(([key]) => key === segment)
    if (index >= visibleChildCount.value) {
      visibleChildCount.value = index + 1
    }
  },
  { immediate: true },
)

// Filtre acikken yalnizca eslesmeler, onlara giden yol ve eslesen dugumlerin alt agaci kalir.
const hidden = computed(() => {
  if (props.filterMatches !== true) return false
  const search = props.search
  if (!search || search.matches.length === 0) return false
  return !search.visible.has(currentPath.value) && props.ancestorMatched !== true
})

// Eslesme bu dalda ise dugumu ac; kullanici sonrasinda elle kapatabilir.
watch(
  () => props.search?.visible.has(currentPath.value) ?? false,
  (onSearchPath) => { if (onSearchPath) expanded.value = true },
  { immediate: true },
)

watch(isActive, async (active) => {
  if (!active) return
  await nextTick()
  rowRef.value?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}, { immediate: true })

const isFocused = computed(() => props.focusPath != null && props.focusPath === currentPath.value)

// Referanstan atlanan hedefe giden yolu ac ve hedefi gorunume kaydir.
watch(() => props.focusPath, async (focus) => {
  if (!focus) return
  const path = currentPath.value
  if (focus !== path && !focus.startsWith(`${path}.`)) return
  expanded.value = true
  if (focus !== path) return
  await nextTick()
  rowRef.value?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}, { immediate: true })

function toggle() {
  if (isExpandable.value) expanded.value = !expanded.value
}

async function copyValue() {
  const text = typeof props.value === 'string' ? props.value : JSON.stringify(props.value, null, 2)
  await navigator.clipboard.writeText(text)
  copied.value = true
  setTimeout(() => { copied.value = false }, 1500)
}

function primitiveDisplay(value: JsonValue): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return `"${value}"`
  return String(value)
}
</script>

<template>
  <div v-if="!hidden" class="node" :class="{ matched: isMatched, active: isActive, focused: isFocused }">
    <div ref="rowRef" class="row" :class="{ expandable: isExpandable }" @click="toggle">
      <span class="indent" :style="{ width: `${depth * 20}px` }" />

      <span v-if="isExpandable" class="toggle" :class="{ open: expanded }">▾</span>
      <span v-else class="toggle-ph" />

      <template v-if="keyName !== undefined">
        <span class="key" :class="{ documented: !!doc }" :title="docText">
          <template v-for="(part, i) in highlightParts(String(keyName), searchTerm ?? '')" :key="i">
            <mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
          </template>
        </span>
        <span class="colon">:</span>
      </template>

      <template v-if="isExpandable">
        <span class="bracket">{{ type === 'array' ? '[' : '{' }}</span>
        <template v-if="!expanded">
          <span class="collapsed">{{ type === 'array' ? `${childCount} items` : `${childCount} keys` }}</span>
          <span class="bracket">{{ type === 'array' ? ']' : '}' }}</span>
        </template>
      </template>
      <span v-else class="val" :class="'val-' + type">
        <template v-for="(part, i) in highlightParts(primitiveDisplay(value), searchTerm ?? '')" :key="i">
          <mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
        </template>
      </span>

      <button
        v-if="refTarget"
        class="ref-btn"
        :class="{ open: previewOpen }"
        :title="`Referans: ${refTarget.idField} → ${refTarget.path}`"
        @click.stop="togglePreview"
      >↳ referans</button>

      <button class="copy" title="Kopyala" @click.stop="copyValue">{{ copied ? '✓' : '⧉' }}</button>
    </div>

    <!-- Referansin isaret ettigi nesne, satirin altinda yerinde acilir. -->
    <div v-if="refTarget && previewOpen" class="ref-preview" :style="{ marginLeft: `${(depth + 1) * 20}px` }">
      <div class="ref-head">
        <code class="ref-path">{{ refTarget.path }}</code>
        <button class="ref-goto" @click.stop="goToTarget">Hedefe git</button>
      </div>
      <JsonTreeNode
        :value="refTarget.value"
        :depth="0"
        :is-last="true"
        :path="refTarget.path"
        :default-expanded="true"
        :search-term="searchTerm"
        :doc-lookup="docLookup"
        :inside-preview="true"
      />
    </div>

    <div v-if="isExpandable && expanded" class="children">
      <template v-if="type === 'array'">
        <JsonTreeNode
          v-for="{ item, index } in arrayItems"
          :key="index"
          :key-name="index"
          :value="item"
          :depth="depth + 1"
          :is-last="index === childCount - 1"
          :search-term="searchTerm"
          :doc-lookup="docLookup"
          :path="currentPath"
          :search="search"
          :active-path="activePath"
          :filter-matches="filterMatches"
          :ancestor-matched="inMatchSubtree"
          :ref-index="refIndex"
          :inside-preview="insidePreview"
          :focus-path="focusPath"
          @focus-path="emit('focusPath', $event)"
        />
      </template>
      <template v-else>
        <JsonTreeNode
          v-for="(entry, i) in objectEntries"
          :key="entry[0]"
          :key-name="entry[0]"
          :value="entry[1]"
          :depth="depth + 1"
          :is-last="i === childCount - 1"
          :search-term="searchTerm"
          :doc-lookup="docLookup"
          :path="currentPath"
          :search="search"
          :active-path="activePath"
          :filter-matches="filterMatches"
          :ancestor-matched="inMatchSubtree"
          :ref-index="refIndex"
          :inside-preview="insidePreview"
          :focus-path="focusPath"
          @focus-path="emit('focusPath', $event)"
        />
      </template>
      <div v-if="hiddenChildCount > 0" class="row more">
        <span class="indent" :style="{ width: `${(depth + 1) * 20}px` }" />
        <span class="toggle-ph" />
        <button class="more-btn" @click.stop="showMoreChildren">
          {{ hiddenChildCount.toLocaleString() }} öğe daha göster
        </button>
      </div>

      <div class="row close">
        <span class="indent" :style="{ width: `${depth * 20}px` }" />
        <span class="toggle-ph" />
        <span class="bracket">{{ type === 'array' ? ']' : '}' }}</span>
        <span v-if="!isLast" class="comma">,</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.node { position: relative; }
.node.matched > .row { background: rgba(255,220,0,.08); border-radius: 4px; }
.node.active > .row { background: rgba(255,220,0,.18); box-shadow: inset 0 0 0 1px rgba(255,220,0,.45); border-radius: 4px; }
.node.focused > .row { background: var(--accent-dim); box-shadow: inset 0 0 0 1px var(--accent); border-radius: 4px; }

.ref-btn { font-size: 10px; color: var(--accent); background: var(--accent-dim); padding: 1px 7px; border-radius: 10px; margin-left: 8px; white-space: nowrap; flex-shrink: 0; }
.ref-btn:hover, .ref-btn.open { background: rgba(88,166,255,.28); }
.ref-preview { margin: 2px 0 6px; padding: 6px 10px; border-left: 2px solid var(--accent); background: rgba(88,166,255,.05); border-radius: 0 6px 6px 0; }
.ref-head { display: flex; align-items: center; gap: 10px; margin-bottom: 2px; }
.ref-path { font-size: 10px; color: var(--text-muted); word-break: break-all; }
.ref-goto { font-size: 10px; color: var(--accent); padding: 1px 8px; border-radius: 4px; border: 1px solid var(--border); white-space: nowrap; }
.ref-goto:hover { background: var(--accent-dim); }
.row { display: flex; align-items: center; min-height: 26px; padding: 1px 8px 1px 0; border-radius: 4px; }
.row.expandable { cursor: pointer; }
.row.expandable:hover { background: var(--bg-hover); }
.row:hover .copy { opacity: 1; }
.indent { display: inline-block; flex-shrink: 0; }
.toggle { width: 16px; text-align: center; color: var(--text-muted); transform: rotate(-90deg); transition: transform .15s; margin-right: 4px; font-size: 10px; }
.toggle.open { transform: rotate(0deg); }
.toggle-ph { display: inline-block; width: 20px; flex-shrink: 0; }
.key { color: var(--color-key); margin-right: 2px; }
/* XSD karsiligi olan alanlar noktali alt cizgiyle isaretlenir. */
.key.documented { cursor: help; border-bottom: 1px dotted var(--text-muted); }
.colon { color: var(--text-muted); margin-right: 6px; }
.comma { color: var(--text-muted); }
.bracket { color: var(--color-bracket); font-weight: 500; }
.collapsed { color: var(--text-muted); font-style: italic; margin: 0 6px; font-size: 11px; }
.val { flex: 1; }
.val-string { color: var(--color-string); }
.val-number { color: var(--color-number); }
.val-boolean { color: var(--color-bool); font-weight: 500; }
.val-null { color: var(--color-null); font-style: italic; }
.children { position: relative; }
.more-btn { font-size: 11px; color: var(--accent); background: var(--accent-dim); padding: 2px 10px; border-radius: 5px; }
.more-btn:hover { background: rgba(88,166,255,.25); }
.copy { opacity: 0; width: 22px; height: 22px; border-radius: 4px; color: var(--text-muted); margin-left: 6px; font-size: 11px; }
.copy:hover { background: var(--bg-hover); color: var(--text-primary); }
</style>
