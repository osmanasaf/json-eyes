<script setup lang="ts">
import type { FieldDoc, JsonValue } from '../types'
import type { SearchIndex } from '../utils/search'
import type { RefIndex } from '../utils/references'
import JsonTreeNode from './JsonTreeNode.vue'

defineProps<{
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
</script>

<template>
  <div class="tree">
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
      @focus-path="emit('focusPath', $event)"
    />
  </div>
</template>

<style scoped>
.tree {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 13px;
  line-height: 1.6;
  padding: 12px 0;
}
</style>
