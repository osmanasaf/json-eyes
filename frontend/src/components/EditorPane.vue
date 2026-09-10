<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { RecentFile } from '../utils/storage'
import { formatRelative, formatSize } from '../utils/storage'
import { XmlParseError, xmlToJson } from '../utils/xml'

/**
 * Girdi paneli. Buraya iki sey tasindi:
 *
 * - **XML bir girdi bicimi**, ayri bir ekran degil. Onceden ust bardaki gorunum
 *   anahtarinda "XML" diye bir dugme vardi; oysa anahtarin isi ayni belgeye
 *   nasil bakildigini secmek (Tree/Grid/Kolon), belgenin nereden geldigini
 *   secmek degil. Artik sekmeler: JSON · XML · Geçmiş.
 * - **Karsilastirma ikinci bir girdidir**: "Fark" da gorunum anahtarindan
 *   cikti, dugmesi girdinin yaninda. Sonucun bir gorunum olmasi dogru ama
 *   *girisi* buradan yapiliyor.
 */

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
  /** Karsilastirma acik mi; dugme durumunu gosterir. */
  comparing?: boolean
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
  /** XML cevrildi: JSON metni ve cevirim notlari. */
  xml: [payload: { text: string; name: string | null; root: string; notes: string[] }]
  toggleCompare: []
}>()

type Tab = 'json' | 'xml' | 'history'
const tab = ref<Tab>('json')

/** XML girdisi ve cevirim secenekleri; CLI'daki bayraklarin aynisi. */
const xmlText = ref('')
const xmlName = ref<string | null>(null)
const keepPrefixes = ref(false)
const numbers = ref(false)
const xmlError = ref<string | null>(null)
const xmlErrorLine = ref<number | null>(null)

const isXml = computed(() => tab.value === 'xml')

/**
 * Duzenlenen metin. Gutter, yapistirma ve senkron seridi tek bir textarea
 * uzerinden calisiyor; bicim degisince altindaki kaynak degisiyor.
 */
const text = computed({
  get: () => (isXml.value ? xmlText.value : props.modelValue),
  set: (value: string) => {
    if (isXml.value) {
      xmlText.value = value
      xmlError.value = null
      xmlErrorLine.value = null
    } else {
      emit('update:modelValue', value)
    }
  },
})

/** Gosterilecek hata satiri: JSON'da ayristirma, XML'de cevirim hatasi. */
const activeErrorLine = computed(() => (isXml.value ? xmlErrorLine.value : props.errorLine))

function convertXml() {
  const source = xmlText.value
  if (!source.trim()) {
    xmlError.value = 'XML boş.'
    return
  }
  try {
    const result = xmlToJson(source, { keepPrefixes: keepPrefixes.value, numbers: numbers.value })
    xmlError.value = null
    xmlErrorLine.value = null
    emit('xml', {
      text: JSON.stringify(result.data, null, 2),
      name: xmlName.value ? xmlName.value.replace(/\.xml$/i, '.json') : null,
      root: result.root,
      notes: result.notes,
    })
    // Cevrilen JSON artik girdinin kendisi; kullanici JSON sekmesinde devam eder.
    tab.value = 'json'
  } catch (error) {
    if (error instanceof XmlParseError) {
      xmlError.value = error.message
      xmlErrorLine.value = error.line
    } else {
      xmlError.value = (error as Error).message
      xmlErrorLine.value = null
    }
  }
}

/** `.xml` dosyasi secildiginde App buradan XML sekmesini dolduruyor. */
function openXml(source: string, name: string | null) {
  xmlText.value = source
  xmlName.value = name
  xmlError.value = null
  xmlErrorLine.value = null
  tab.value = 'xml'
}

defineExpose({ openXml })

/** Satir yuksekligi; numara sutunundaki pencereleme buna dayaniyor. */
/**
 * Satir yuksekligi. Tasarimin degeri 19px; oluk hizasi, kaydirma hesabi ve
 * isaret seridi hep buna bagli oldugu icin CSS'teki `line-height` ile birebir
 * ayni kalmali (token: `--editor-line`).
 */
const LINE_HEIGHT = 19

const lineCount = computed(() => {
  const source = text.value
  if (source.length === 0) return 1
  let count = 1
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) count++
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
  // Senkron seridi JSON metnine ait; XML sekmesinde anlamsiz.
  if (!range || !ta || isXml.value) return
  // Tasarimin hedefi: (satir-1)*19 - 130. `scrollIntoView` kullanilmiyor —
  // sayfayi da kaydirip kabugu oynatiyor; dogrudan scrollTop atanıyor.
  const target = Math.max(0, (range.startLine - 1) * LINE_HEIGHT - 130)
  ta.scrollTop = target
  scrollTop.value = ta.scrollTop
})

/**
 * Isaretli satir araligi. Cok satirli bir dugum (or. tum Response govdesi)
 * belgenin tamamini kaplayabilir; isaret o zaman anlamini yitirdigi icin
 * baslangictan itibaren sinirli sayida satir vurgulaniyor.
 */
const MAX_BAND_LINES = 40

const syncLines = computed(() => {
  const range = props.syncRange
  if (!range || isXml.value) return null
  return { first: range.startLine, last: Math.min(range.endLine, range.startLine + MAX_BAND_LINES - 1) }
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
  if (count === 0 && tab.value === 'history') tab.value = 'json'
})
</script>

<template>
  <section class="editor-pane" @drop="emit('drop', $event)" @dragover.prevent>
    <!-- Sekmeler girdinin *bicimi*: JSON mu XML mi, ya da gecmis. -->
    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'json' }" @click="tab = 'json'">JSON</button>
      <button
        class="tab"
        :class="{ active: tab === 'xml' }"
        title="XML yapıştır, JSON'a çevir — sonuç girdinin kendisi olur"
        @click="tab = 'xml'"
      >XML</button>
      <button
        class="tab"
        :class="{ active: tab === 'history' }"
        :disabled="recents.length === 0"
        @click="tab = 'history'"
      >Geçmiş</button>
      <div class="tab-spacer" />
      <button class="tab-action" :disabled="!hasData || isXml" title="Girintili biçime getir" @click="emit('format')">⤢</button>
      <button class="tab-action" :disabled="!hasData || isXml" title="Tek satıra indir" @click="emit('minify')">⤡</button>
      <button class="tab-action" title="Örnek JSON yükle" @click="emit('sample')">◇</button>
      <button class="tab-action danger" title="Temizle" @click="emit('clear')">×</button>
      <button class="tab-action collapse" title="Editörü gizle" @click="emit('collapse')">‹</button>
    </div>

    <!-- Karsilastirma da bir girdi isi: ikinci bir belge seciliyor. -->
    <button
      class="compare-btn"
      :class="{ on: comparing }"
      :disabled="!hasData"
      :title="comparing ? 'Karşılaştırmayı kapat' : 'Bu JSON\'u ikinci bir JSON ile karşılaştır'"
      @click="emit('toggleCompare')"
    >
      <span class="compare-glyph">⇄</span>
      {{ comparing ? 'Karşılaştırma açık' : 'Karşılaştır' }}
    </button>

    <div v-if="tab !== 'history'" class="code-area">
      <div class="gutter">
        <div class="gutter-inner" :style="{ transform: `translateY(${gutterOffset}px)` }">
          <span
            v-for="n in visibleLines"
            :key="n"
            class="line-no"
            :class="{ bad: n === activeErrorLine, synced: isSynced(n) }"
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
          :class="{ invalid: isXml ? xmlError : parseError }"
          spellcheck="false"
          wrap="off"
          :placeholder="isXml
            ? 'XML yapıştırın veya .xml dosyası sürükleyin — sonra JSON\'a çevirin…'
            : 'JSON verisini buraya yapıştırın veya dosya sürükleyin…'"
          @scroll="syncScroll"
          @paste="handlePaste"
        />
      </div>
    </div>

    <!-- XML sekmesinin cevirim seridi: secenekler CLI bayraklarinin aynisi. -->
    <div v-if="isXml" class="xml-bar">
      <label class="xml-opt" title="iata:Order → Order yerine olduğu gibi kalsın">
        <input v-model="keepPrefixes" type="checkbox" />
        önekleri koru
      </label>
      <label class="xml-opt" title="0123 gibi değerler yine metin kalır; kod alanları bozulmaz">
        <input v-model="numbers" type="checkbox" />
        sayıları çıkar
      </label>
      <div class="tab-spacer" />
      <button class="xml-go" :disabled="!text.trim()" @click="convertXml">JSON'a çevir</button>
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

    <div v-if="isXml" class="status" :class="xmlError ? 'bad' : 'ok'">
      <span class="status-dot" />
      <span class="status-text">
        <template v-if="xmlError">
          <template v-if="xmlErrorLine">Satır {{ xmlErrorLine }}: </template>{{ xmlError }}
        </template>
        <template v-else-if="xmlName">{{ xmlName }} · {{ lineCount.toLocaleString('tr-TR') }} satır XML</template>
        <template v-else>XML → JSON · değerler metin kalır, öznitelikler "@ad" olur</template>
      </span>
    </div>
    <div v-else-if="parseError" class="status bad">
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

/*
 * Karsilastir dugmesi: girdinin hemen altinda, gorunum anahtarinda degil.
 * Ikinci bir belge secmek bir *girdi* isi; sonucun fark gorunumu olmasi
 * ondan sonra geliyor.
 */
.compare-btn { display: flex; align-items: center; justify-content: center; gap: 7px; margin: 6px 8px 0; padding: 5px 10px; border: 1px solid var(--border); border-radius: 7px; font-size: 11.5px; color: var(--text-secondary); }
.compare-btn:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); background: var(--accent-dim); }
.compare-btn.on { color: var(--accent); border-color: var(--accent); background: var(--accent-wash); }
.compare-btn:disabled { opacity: .35; cursor: not-allowed; }
.compare-glyph { font-size: 13px; }

/* XML sekmesinin cevirim seridi. */
.xml-bar { display: flex; align-items: center; gap: 10px; padding: 7px 12px; border-top: 1px solid var(--border-subtle); background: var(--bg-secondary); }
.xml-opt { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-secondary); white-space: nowrap; cursor: pointer; }
.xml-go { font-size: 11.5px; color: var(--accent); border: 1px solid var(--accent); background: var(--accent-dim); border-radius: 6px; padding: 3px 11px; white-space: nowrap; }
.xml-go:hover:not(:disabled) { background: var(--accent-strong); }
.xml-go:disabled { opacity: .4; cursor: not-allowed; border-color: var(--border); color: var(--text-muted); background: transparent; }

.code-area { flex: 1; min-height: 0; display: flex; background: var(--bg-primary); padding: 8px 0; }
.gutter { width: 34px; flex-shrink: 0; overflow: hidden; padding-left: 12px; }
.gutter-inner { display: flex; flex-direction: column; }
.line-no { font-size: 11.5px; line-height: var(--editor-line); height: var(--editor-line); color: var(--border); text-align: right; flex-shrink: 0; }
.line-no.bad { color: var(--red); font-weight: 600; }
.line-no.synced { color: var(--accent); }
/*
 * Sarma kapali: satir numaralari ve GridSync satir hesabi ancak boyle koda
 * denk gelir (sarilan tek bir uzun satir gutter'i kaydiriyordu). Uzun satirlar
 * icin yatay kaydirma var.
 */
.code-wrap { position: relative; flex: 1; min-width: 0; display: flex; }
.sync-band { position: absolute; left: 0; right: 0; background: var(--accent-wash); border-left: 2px solid var(--accent); pointer-events: none; }
.code { flex: 1; min-width: 0; position: relative; background: transparent; color: var(--text-primary); border: none; outline: none; resize: none; padding: 0 12px 0 10px; font-family: 'JetBrains Mono', monospace; font-size: 11.5px; line-height: var(--editor-line); white-space: pre; overflow-x: auto; }
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
