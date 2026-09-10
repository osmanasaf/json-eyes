<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from 'vue'
import { COMMENTS, SELECT_FIELD } from '../utils/injection'
import type { FieldDoc, JsonArray, JsonObject, JsonValue } from '../types'
import { getType, highlightParts } from '../utils/json'
import { childPath, type SearchIndex } from '../utils/search'
import { effectiveFieldName, isRefField, resolveRef, type RefIndex, type RefTarget } from '../utils/references'
import InfoBubble from './InfoBubble.vue'
import FieldDocCard from './FieldDocCard.vue'
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
  focusRequest?: { path: string; seq: number } | null
  /**
   * Toplu ac/kapa istegi. `seq` her istekte artiyor: ayni yonde iki kez
   * basmak da izleyiciyi tetiklemeli.
   */
  bulk?: { open: boolean; seq: number } | null
}>()

const emit = defineEmits<{ focusPath: [path: string] }>()
const selectField = inject(SELECT_FIELD, null)
const comments = inject(COMMENTS, null)

const type = computed(() => getType(props.value))
const isExpandable = computed(() => type.value === 'object' || type.value === 'array')
const expanded = ref(props.defaultExpanded ?? props.depth < 2)

// Arac cubugundaki "tümünü aç / kapat": kok haric her dugum istegi uygular.
watch(() => props.bulk, (request) => {
  if (!request) return
  expanded.value = props.depth === 0 ? true : request.open
})
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

const isFocused = computed(
  () => props.focusRequest != null && props.focusRequest.path === currentPath.value,
)

// Odaklanilan hedefe giden yolu ac ve hedefi gorunume kaydir.
watch(() => props.focusRequest, async (request) => {
  if (!request) return
  const path = currentPath.value
  if (request.path !== path && !request.path.startsWith(`${path}.`)) return
  expanded.value = true
  if (request.path !== path) return
  await nextTick()
  rowRef.value?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}, { immediate: true })

// --- Yorumlar ----------------------------------------------------------------

const commentsAvailable = computed(
  () => comments?.available.value === true && !props.insidePreview && props.keyName !== undefined,
)
const commentCount = computed(() => comments?.countFor(currentPath.value) ?? 0)

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
    <div
      ref="rowRef"
      class="row"
      :class="{ expandable: isExpandable }"
      @click="toggle"
      @mouseenter="selectField?.(currentPath)"
    >
      <span class="indent" :style="{ width: `${depth * 20}px` }" />

      <span v-if="isExpandable" class="toggle" :class="{ open: expanded }">▾</span>
      <span v-else class="toggle-ph" />

      <template v-if="keyName !== undefined">
        <span class="key">
          <template v-for="(part, i) in highlightParts(String(keyName), searchTerm ?? '')" :key="i">
            <mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
          </template>
        </span>
        <InfoBubble v-if="doc" @click.stop>
          <template #trigger><span class="info-dot">ⓘ</span></template>
          <FieldDocCard :field="doc" />
        </InfoBubble>
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

      <span
        v-if="commentsAvailable && commentCount > 0"
        class="comment-count"
        :title="`${commentCount} yorum — sağ panelde`"
      >{{ commentCount }} yorum</span>

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
          :focus-request="focusRequest"
          :bulk="bulk"
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
          :focus-request="focusRequest"
          :bulk="bulk"
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
.node.matched > .row { background: var(--search-hit); }
.node.active > .row { background: var(--search-hit); box-shadow: inset 2px 0 0 var(--changed); }
.node.focused > .row { background: var(--accent-sel-bg); box-shadow: inset 2px 0 0 var(--accent); }

.ref-btn { font-size: 10px; color: var(--accent); margin-left: 8px; white-space: nowrap; flex-shrink: 0; }
.ref-btn:hover, .ref-btn.open { color: var(--accent-hover); }
.ref-preview { margin: 2px 0 6px; padding: 6px 10px; border-left: 2px solid var(--accent); background: var(--accent-soft); border-radius: 0 6px 6px 0; }
.ref-head { display: flex; align-items: center; gap: 10px; margin-bottom: 2px; }
.ref-path { font-size: 10px; color: var(--ink-5); word-break: break-all; }
.ref-goto { font-size: 10px; color: var(--accent); padding: 1px 8px; border-radius: 4px; border: 1px solid var(--line); white-space: nowrap; }
.ref-goto:hover { background: var(--accent-soft); }
.row { display: flex; align-items: center; min-height: 22px; padding: 1px 8px 1px 0; font-size: 12px; }
.row.expandable { cursor: pointer; }
.row.expandable:hover { background: var(--bg-subtle); }
.row:hover .copy { opacity: 1; }
.indent { display: inline-block; flex-shrink: 0; }
.toggle { width: 16px; text-align: center; color: var(--ink-5); transform: rotate(-90deg); transition: transform .15s; margin-right: 4px; font-size: 10px; }
.toggle.open { transform: rotate(0deg); }
.toggle-ph { display: inline-block; width: 20px; flex-shrink: 0; }
.key { color: var(--ink-2); margin-right: 2px; }
/* XSD karsiligi olan alanlarda aciklama isareti. */
.info-dot { font-size: 10px; color: var(--accent); opacity: .55; cursor: pointer; margin-right: 3px; }
.info-dot:hover { opacity: 1; }
.colon { color: var(--ink-5); margin-right: 6px; }
.comma { color: var(--ink-5); }
.bracket { color: var(--ink-5); }
.collapsed { color: var(--ink-5); margin: 0 6px; font-size: 11px; }
.val { flex: 1; }
.val-string { color: var(--type-string); }
.val-number { color: var(--type-number); }
.val-boolean { color: var(--type-boolean); }
.val-null { color: var(--type-null); font-style: italic; }
.children { position: relative; }
.more-btn { font-size: 11px; color: var(--accent); background: var(--accent-soft); padding: 2px 10px; border-radius: 5px; }
.more-btn:hover { background: var(--accent-line); }
/* Yorumu olan satirlarda rozet her zaman gorunur. */
.row:hover .comment-btn { opacity: 1; }
.comment-count { font-size: 10px; color: var(--accent); margin-left: 8px; white-space: nowrap; flex-shrink: 0; }

.copy { opacity: 0; width: 22px; height: 22px; border-radius: 4px; color: var(--ink-5); margin-left: 6px; font-size: 11px; }
.copy:hover { background: var(--bg-inset); color: var(--ink); }
</style>
