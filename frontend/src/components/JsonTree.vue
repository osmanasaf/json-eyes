<script setup lang="ts">
import type { FieldDoc, JsonValue } from '../types'
import type { SearchIndex } from '../utils/search'
import type { RefIndex } from '../utils/references'
import { onMounted, onUpdated, ref } from 'vue'
import JsonTreeNode from './JsonTreeNode.vue'

/**
 * Tree gorunumu. Tasarim burada yapiyi degil **paleti ve tipografiyi**
 * degistiriyor; ustune arac cubugunu ekliyor (tumunu ac / kapat ve kac satirin
 * acik oldugu).
 */
const props = defineProps<{
  data: JsonValue
  searchTerm?: string
  docLookup?: (nodePath: string) => FieldDoc | undefined
  search?: SearchIndex
  activePath?: string | null
  filterMatches?: boolean
  rootKey: string
  refIndex?: RefIndex
  focusRequest?: { path: string; seq: number } | null
}>()

const emit = defineEmits<{ focusPath: [path: string] }>()

const bulk = ref<{ open: boolean; seq: number } | null>(null)
let bulkSeq = 0

function setAll(open: boolean) {
  bulk.value = { open, seq: ++bulkSeq }
}

/**
 * "N açık satır": cizilen satir sayisi. Acilma durumu her dugumun kendinde
 * durdugu icin sayiyi yukaridan bilmek mumkun degil; cizim sonrasi
 * sayilıyor — gorunen neyse o.
 */
const treeEl = ref<HTMLElement | null>(null)
const openCount = ref(0)

function countRows() {
  openCount.value = treeEl.value?.querySelectorAll('.row').length ?? 0
}

onMounted(countRows)
onUpdated(countRows)

void props
</script>

<template>
  <div class="tree-view">
    <div class="toolbar">
      <button class="tool" @click="setAll(true)"><span class="glyph">⊞</span>tümünü aç</button>
      <button class="tool" @click="setAll(false)"><span class="glyph">⊟</span>tümünü kapat</button>
      <div class="toolbar-spacer" />
      <span class="meta">{{ openCount.toLocaleString('tr-TR') }} açık satır</span>
    </div>

    <div ref="treeEl" class="tree">
    <JsonTreeNode
      :value="data"
      :key-name="rootKey"
      :depth="0"
      :is-last="true"
      :search-term="searchTerm"
      :doc-lookup="docLookup"
      path=""
      :default-expanded="true"
      :search="search"
      :active-path="activePath"
      :filter-matches="filterMatches"
      :ref-index="refIndex"
      :focus-request="focusRequest"
      :bulk="bulk"
      @focus-path="emit('focusPath', $event)"
    />
    </div>
  </div>
</template>

<style scoped>
.tree-view { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }

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

.tree { flex: 1; min-height: 0; overflow: auto; background: var(--bg-data); font-size: 12px; line-height: 1.5; padding: 8px 0; }
</style>
