<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { RecentFile } from '../utils/storage'
import { formatRelative, formatSize } from '../utils/storage'

const props = defineProps<{
  modelValue: string
  parseError: string | null
  /** Hatanin bulundugu satir; numara sutununda isaretlenir. */
  errorLine: number | null
  nodeCount: number
  hasData: boolean
  recents: RecentFile[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  format: []
  minify: []
  sample: []
  clear: []
  repair: []
  openRecent: [file: RecentFile]
  drop: [event: DragEvent]
}>()

type Tab = 'input' | 'history'
const tab = ref<Tab>('input')

const text = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('update:modelValue', value),
})

/** Satir yuksekligi; numara sutunundaki pencereleme buna dayaniyor. */
const LINE_HEIGHT = 20

const lineCount = computed(() => {
  if (props.modelValue.length === 0) return 1
  let count = 1
  for (let i = 0; i < props.modelValue.length; i++) {
    if (props.modelValue.charCodeAt(i) === 10) count++
  }
  return count
})

// Numara sutununda yalnizca goruntulenen araligi ciziyoruz: 50 bin satirlik bir
// JSON'da her satir icin dugum uretmek yazmayi gozle gorulur bicimde yavaslatiyor.
const scrollTop = ref(0)
const viewportHeight = ref(600)
const codeEl = ref<HTMLTextAreaElement | null>(null)

const visibleLines = computed(() => {
  const first = Math.floor(scrollTop.value / LINE_HEIGHT)
  const visible = Math.ceil(viewportHeight.value / LINE_HEIGHT) + 2
  const last = Math.min(lineCount.value, first + visible)
  return Array.from({ length: Math.max(0, last - first) }, (_, i) => first + i + 1)
})

const gutterOffset = computed(() => -(scrollTop.value % LINE_HEIGHT))

function syncScroll(event: Event) {
  const target = event.target as HTMLTextAreaElement
  scrollTop.value = target.scrollTop
  viewportHeight.value = target.clientHeight
}

function measureViewport() {
  if (codeEl.value) viewportHeight.value = codeEl.value.clientHeight
}

onMounted(measureViewport)
watch(() => props.modelValue, measureViewport)

watch(() => props.recents.length, (count) => {
  if (count === 0 && tab.value === 'history') tab.value = 'input'
})
</script>

<template>
  <section class="editor-pane" @drop="emit('drop', $event)" @dragover.prevent>
    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'input' }" @click="tab = 'input'">Girdi</button>
      <button
        class="tab"
        :class="{ active: tab === 'history' }"
        :disabled="recents.length === 0"
        @click="tab = 'history'"
      >Geçmiş</button>
      <div class="tab-spacer" />
      <button class="tab-action" :disabled="!hasData" title="Girintili biçime getir" @click="emit('format')">⤢</button>
      <button class="tab-action" :disabled="!hasData" title="Tek satıra indir" @click="emit('minify')">⤡</button>
      <button class="tab-action" title="Örnek JSON yükle" @click="emit('sample')">◇</button>
      <button class="tab-action danger" title="Temizle" @click="emit('clear')">×</button>
    </div>

    <div v-if="tab === 'input'" class="code-area">
      <div class="gutter">
        <div class="gutter-inner" :style="{ transform: `translateY(${gutterOffset}px)` }">
          <span
            v-for="n in visibleLines"
            :key="n"
            class="line-no"
            :class="{ bad: n === errorLine }"
          >{{ n }}</span>
        </div>
      </div>
      <textarea
        ref="codeEl"
        v-model="text"
        class="code"
        :class="{ invalid: parseError }"
        spellcheck="false"
        placeholder="JSON verisini buraya yapıştırın veya dosya sürükleyin…"
        @scroll="syncScroll"
      />
    </div>

    <div v-else class="history">
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

    <div v-if="parseError" class="status bad">
      <span class="status-dot" />
      <span class="status-text">
        <template v-if="errorLine">Satır {{ errorLine }}: </template>{{ parseError }}
      </span>
      <button class="status-fix" @click="emit('repair')">Düzelt</button>
    </div>
    <div v-else-if="hasData" class="status ok">
      <span class="status-dot" />
      Geçerli JSON · {{ nodeCount.toLocaleString('tr-TR') }} node
    </div>
  </section>
</template>

<style scoped>
.editor-pane { width: var(--editor-w); flex-shrink: 0; display: flex; flex-direction: column; border-right: 1px solid var(--border); background: var(--bg-secondary); }

.tabs { display: flex; align-items: center; gap: 2px; padding: 6px 8px 0; border-bottom: 1px solid var(--border-subtle); }
.tab { font-size: 11.5px; color: var(--text-muted); padding: 6px 11px; border-radius: 6px 6px 0 0; }
.tab:hover:not(:disabled) { color: var(--text-primary); }
.tab.active { color: var(--text-primary); background: var(--bg-tertiary); }
.tab:disabled { opacity: .4; cursor: not-allowed; }
.tab-spacer { flex: 1; }
.tab-action { font-size: 12px; color: var(--text-muted); width: 22px; height: 22px; border-radius: 5px; }
.tab-action:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-tertiary); }
.tab-action:disabled { opacity: .3; cursor: not-allowed; }
.tab-action.danger:hover { color: var(--red); }

.code-area { flex: 1; min-height: 0; display: flex; background: var(--bg-primary); padding: 8px 0; }
.gutter { width: 34px; flex-shrink: 0; overflow: hidden; padding-left: 12px; }
.gutter-inner { display: flex; flex-direction: column; }
.line-no { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; line-height: 20px; height: 20px; color: var(--border); text-align: right; flex-shrink: 0; }
.line-no.bad { color: var(--red); font-weight: 600; }
.code { flex: 1; min-width: 0; background: transparent; color: var(--text-primary); border: none; outline: none; resize: none; padding: 0 12px 0 10px; font-family: 'JetBrains Mono', monospace; font-size: 11.5px; line-height: 20px; }
.code.invalid { color: var(--text-secondary); }

.history { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; }
.history-item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; padding: 8px 10px; border-radius: 8px; text-align: left; }
.history-item:hover { background: var(--bg-tertiary); }
.history-name { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.history-meta { font-size: 11px; color: var(--text-muted); }

.status { display: flex; align-items: flex-start; gap: 8px; padding: 8px 14px; border-top: 1px solid var(--border-subtle); font-family: 'JetBrains Mono', monospace; font-size: 11px; line-height: 1.5; }
.status.ok { color: var(--green); align-items: center; }
.status.bad { color: var(--red); background: var(--red-soft); }
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; margin-top: 5px; }
.status.ok .status-dot { margin-top: 0; }
.status-text { flex: 1; min-width: 0; word-break: break-word; }
.status-fix { font-size: 11px; color: var(--text-secondary); flex-shrink: 0; }
.status-fix:hover { color: var(--text-primary); }
</style>
