<script setup lang="ts">
import { computed, ref } from 'vue'
import type { RecentFile } from '../utils/storage'
import { formatRelative, formatSize } from '../utils/storage'
import EditorPane from './EditorPane.vue'
import DiffPanel from './DiffPanel.vue'

/**
 * Sol panel: girdinin tamami burada yasar.
 *
 * Tasarimin karari net — **gorunum anahtari yalnizca gorunum tasir**. Belgenin
 * nereden geldigi (JSON mu XML mi) ve neyle karsilastirildigi girdi isidir,
 * dolayisiyla bu panelin sekmeleri: `Girdi · Fark · Geçmiş`.
 */
export type InputTab = 'input' | 'diff' | 'history'

const props = defineProps<{
  modelValue: string
  parseError: string | null
  errorLine: number | null
  nodeCount: number
  parseMs: number
  hasData: boolean
  recents: RecentFile[]
  /** Goruntuleyicide secili alanin metindeki yeri (GridSync). */
  syncRange?: { start: number; end: number; startLine: number; endLine: number } | null
  /** Karsilastirmanin A ve B taraflari; Fark sekmesi bunlari duzenler. */
  textA: string
  textB: string
  currentName: string
  diffOnlyChanges: boolean
  diffIndex: number
  diffTotal: number
  diffSummary: { added: number; removed: number; changed: number } | null
  diffNote: string
  /**
   * Acik sekme. Panelin kendi state'i degil: karsilastirmayi App de
   * kapatabiliyor (bir alandan belgeye gidildiginde, ornek yuklendiginde).
   * Yerel tutuldugunda orta bolge belgeye donuyor ama sekme "Fark"ta kaliyordu.
   */
  tab: InputTab
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:textA': [value: string]
  'update:textB': [value: string]
  'update:diffOnlyChanges': [value: boolean]
  format: []
  minify: []
  sample: []
  clear: []
  repair: []
  openRecent: [file: RecentFile]
  drop: [event: DragEvent]
  collapse: []
  xml: [payload: { text: string; name: string | null; root: string; notes: string[] }]
  /** Fark sekmesi acildi/kapandi; orta bolge buna gore A/B'ye doner. */
  'update:tab': [tab: InputTab]
  diffStep: [step: number]
  diffSwap: []
  diffUseA: []
}>()

const editorRef = ref<InstanceType<typeof EditorPane> | null>(null)

function setTab(next: InputTab) {
  emit('update:tab', next)
}

/** `.xml` dosyasi secildiginde App buradan XML bicimini dolduruyor. */
function openXml(source: string, name: string | null) {
  setTab('input')
  editorRef.value?.openXml(source, name)
}

defineExpose({ openXml })

const hasRecents = computed(() => props.recents.length > 0)

const model = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('update:modelValue', value),
})
</script>

<template>
  <section class="panel" @drop="emit('drop', $event)" @dragover.prevent>
    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'input' }" @click="setTab('input')">Girdi</button>
      <button class="tab" :class="{ active: tab === 'diff' }" @click="setTab('diff')">Fark</button>
      <button
        class="tab"
        :class="{ active: tab === 'history' }"
        :disabled="!hasRecents"
        @click="setTab('history')"
      >Geçmiş</button>
      <div class="tabs-spacer" />
      <button class="collapse" title="Paneli gizle" @click="emit('collapse')">‹</button>
    </div>

    <EditorPane
      v-show="tab === 'input'"
      ref="editorRef"
      v-model="model"
      :parse-error="parseError"
      :error-line="errorLine"
      :node-count="nodeCount"
      :parse-ms="parseMs"
      :has-data="hasData"
      :sync-range="syncRange"
      @xml="emit('xml', $event)"
      @format="emit('format')"
      @minify="emit('minify')"
      @sample="emit('sample')"
      @clear="emit('clear')"
      @repair="emit('repair')"
      @drop="emit('drop', $event)"
    />

    <DiffPanel
      v-if="tab === 'diff'"
      :text-a="textA"
      :text-b="textB"
      :current-name="currentName"
      :recents="recents"
      :only-changes="diffOnlyChanges"
      :index="diffIndex"
      :total="diffTotal"
      :summary="diffSummary"
      :note="diffNote"
      @update:text-a="emit('update:textA', $event)"
      @update:text-b="emit('update:textB', $event)"
      @update:only-changes="emit('update:diffOnlyChanges', $event)"
      @step="emit('diffStep', $event)"
      @swap="emit('diffSwap')"
      @use-a="emit('diffUseA')"
      @close="setTab('input')"
    />

    <div v-if="tab === 'history'" class="history">
      <button
        v-for="file in recents"
        :key="file.name"
        class="history-item"
        @click="emit('openRecent', file)"
      >
        <span class="history-name">{{ file.name }}</span>
        <span class="history-meta">{{ formatSize(file.size) }} · {{ formatRelative(file.openedAt) }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.panel {
  display: flex; flex-direction: column; min-width: 0; height: 100%;
  background: var(--bg-chrome); border-right: 1px solid var(--line);
}

.tabs {
  display: flex; align-items: stretch; height: var(--h-tabs); flex-shrink: 0;
  border-bottom: 1px solid var(--line-panel); padding: 0 6px;
}
.tab {
  padding: 0 10px; font-size: 11.5px; color: var(--ink-4);
  border-bottom: 1px solid transparent; margin-bottom: -1px;
}
.tab:hover:not(:disabled) { color: var(--ink-2); }
.tab.active { color: var(--ink); border-bottom-color: var(--accent); }
.tab:disabled { opacity: .45; cursor: not-allowed; }
.tabs-spacer { flex: 1; }
.collapse { padding: 0 8px; font-size: 13px; color: var(--ink-4); }
.collapse:hover { color: var(--ink); }

.history { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 6px; }
.history-item {
  display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
  padding: 7px 9px; border-radius: var(--radius);
}
.history-item:hover { background: var(--bg-subtle); }
.history-name { font-size: 12px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-meta { margin-left: auto; font-size: 11px; color: var(--ink-4); flex-shrink: 0; }
</style>
