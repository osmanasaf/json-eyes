<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
  /**
   * Goruntuleyicide secili alanin metindeki yeri (GridSync). Verildiginde
   * editor o satira kayar ve satirlar isaretlenir.
   */
  syncRange?: { start: number; end: number; startLine: number; endLine: number } | null
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
  collapse: []
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

/**
 * Buyuk bir metni tarayicinin kendi yapistirma davranisina birakirsak (native
 * paste), Chromium `input` olayini islerken saniyeler suren bir donmaya yol
 * aciyor — bu, uygulama kodundan bagimsiz, dogrudan textarea'nin kendi ic
 * isleyisinden kaynaklaniyor (bkz. commit mesaji). Bu esigin ustundeki
 * yapistirmalarda varsayilan davranisi engelleyip metni doğrudan Vue
 * uzerinden uyguluyoruz; bu yol yalnizca ~1-2 saniye suruyor. Esigin
 * altindaki yapistirmalarda tarayicinin geri-alinabilir native davranisi
 * korunuyor.
 */
const LARGE_PASTE_THRESHOLD = 200_000

function handlePaste(event: ClipboardEvent) {
  const pasted = event.clipboardData?.getData('text')
  if (pasted === undefined || pasted.length < LARGE_PASTE_THRESHOLD) return
  event.preventDefault()
  const ta = codeEl.value
  const start = ta?.selectionStart ?? text.value.length
  const end = ta?.selectionEnd ?? text.value.length
  text.value = text.value.slice(0, start) + pasted + text.value.slice(end)
  const caret = start + pasted.length
  void nextTick(() => ta?.setSelectionRange(caret, caret))
}

function measureViewport() {
  if (codeEl.value) viewportHeight.value = codeEl.value.clientHeight
}

/**
 * GridSync: secili alanin satirini goruntuye getirir. Satir hesabi ancak metin
 * sarilmadiginda (wrap="off") dogru; textarea bu yuzden yatay kaydirmali.
 * Zaten gorunen bir satir icin kaydirma yapilmaz — kullanicinin baktigi yer
 * her secimde zıplamasin.
 */
watch(() => props.syncRange, (range) => {
  const ta = codeEl.value
  if (!range || !ta) return
  const top = (range.startLine - 1) * LINE_HEIGHT
  const bottom = range.endLine * LINE_HEIGHT
  const viewTop = ta.scrollTop
  const viewBottom = viewTop + ta.clientHeight
  if (top >= viewTop + LINE_HEIGHT && bottom <= viewBottom - LINE_HEIGHT) return
  const target = Math.max(0, top - Math.max(LINE_HEIGHT * 2, ta.clientHeight / 3))
  ta.scrollTop = target
  scrollTop.value = ta.scrollTop
})

/** Isaretli satir araligi; gutter ve arka plan seridi bunu kullanir. */
const syncLines = computed(() => {
  const range = props.syncRange
  if (!range) return null
  return { first: range.startLine, last: range.endLine }
})

/** Arka plandaki isaret seridinin konumu (textarea saydam, serit arkasinda). */
const bandStyle = computed(() => {
  const lines = syncLines.value
  if (!lines) return null
  const height = (lines.last - lines.first + 1) * LINE_HEIGHT
  return {
    top: `${(lines.first - 1) * LINE_HEIGHT - scrollTop.value}px`,
    height: `${height}px`,
  }
})

function isSynced(line: number): boolean {
  const lines = syncLines.value
  return lines !== null && line >= lines.first && line <= lines.last
}

// Viewport yuksekligi yalnizca kutunun boyutu degisince degisir (panel acilip
// kapanmasi, pencere yeniden boyutlanmasi) — icerik degisince degil. Onceden
// bir `watch(() => props.modelValue, measureViewport)` vardi; bu, buyuk bir
// JSON yapistirildiginda her seferinde clientHeight okuyarak tarayiciyi devasa
// textarea'nin tamamini senkron olarak yeniden duzenlemeye (forced reflow)
// zorluyor, birkac saniyelik donmalara yol aciyordu.
let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  measureViewport()
  resizeObserver = new ResizeObserver(measureViewport)
  if (codeEl.value) resizeObserver.observe(codeEl.value)
})
onBeforeUnmount(() => resizeObserver?.disconnect())

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
      <button class="tab-action collapse" title="Editörü gizle" @click="emit('collapse')">‹</button>
    </div>

    <div v-if="tab === 'input'" class="code-area">
      <div class="gutter">
        <div class="gutter-inner" :style="{ transform: `translateY(${gutterOffset}px)` }">
          <span
            v-for="n in visibleLines"
            :key="n"
            class="line-no"
            :class="{ bad: n === errorLine, synced: isSynced(n) }"
          >{{ n }}</span>
        </div>
      </div>
      <div class="code-wrap">
        <!-- Secili alanin satirlari: saydam textarea'nin arkasindaki serit. -->
        <div v-if="bandStyle" class="sync-band" :style="bandStyle" />
        <textarea
          ref="codeEl"
          v-model="text"
          class="code"
          :class="{ invalid: parseError }"
          spellcheck="false"
          wrap="off"
          placeholder="JSON verisini buraya yapıştırın veya dosya sürükleyin…"
          @scroll="syncScroll"
          @paste="handlePaste"
        />
      </div>
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
.tab-action.collapse { margin-left: 4px; border-left: 1px solid var(--border-subtle); border-radius: 0 5px 5px 0; font-size: 15px; }
.tab-action.collapse:hover { color: var(--accent); }

.code-area { flex: 1; min-height: 0; display: flex; background: var(--bg-primary); padding: 8px 0; }
.gutter { width: 34px; flex-shrink: 0; overflow: hidden; padding-left: 12px; }
.gutter-inner { display: flex; flex-direction: column; }
.line-no { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; line-height: 20px; height: 20px; color: var(--border); text-align: right; flex-shrink: 0; }
.line-no.bad { color: var(--red); font-weight: 600; }
.line-no.synced { color: var(--accent); }
/*
 * Sarma kapali: satir numaralari ve GridSync satir hesabi ancak boyle koda
 * denk gelir (sarilan tek bir uzun satir gutter'i kaydiriyordu). Uzun satirlar
 * icin yatay kaydirma var.
 */
.code-wrap { position: relative; flex: 1; min-width: 0; display: flex; }
.sync-band { position: absolute; left: 0; right: 0; background: var(--accent-wash); border-left: 2px solid var(--accent); pointer-events: none; }
.code { flex: 1; min-width: 0; position: relative; background: transparent; color: var(--text-primary); border: none; outline: none; resize: none; padding: 0 12px 0 10px; font-family: 'JetBrains Mono', monospace; font-size: 11.5px; line-height: 20px; white-space: pre; overflow-x: auto; }
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
