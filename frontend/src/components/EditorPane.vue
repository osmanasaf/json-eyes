<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
  /** Ayristirma suresi (ms); durum satirinda gosterilir. */
  parseMs?: number
  hasData: boolean
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
  drop: [event: DragEvent]
  /** XML cevrildi: JSON metni ve cevirim notlari. */
  xml: [payload: { text: string; name: string | null; root: string; notes: string[] }]
}>()

/**
 * Girdinin **bicimi**: JSON mu XML mi. Ayri bir ekran degil, ayni panelde bir
 * satir — XML yapistirilir, istenince cevrilir ve sonuc girdinin kendisi olur.
 */
type Kind = 'json' | 'xml'
const kind = ref<Kind>('json')

/**
 * Canli mi elle mi ayristirilacak.
 *
 * Canli modda her tus vurusu goruntuyu tazeler; birkac MB'lik bir NDC
 * yanitinda bu yazarken donmaya yol aciyordu. Elle modda metin yerel kaliyor,
 * `uygula` denince veriye donusuyor.
 */
const live = ref(true)
/** Elle modda henuz uygulanmamis degisiklik var mi. */
const dirty = ref(false)
/** Elle moddaki yerel taslak. */
const draft = ref(props.modelValue)

/** XML girdisi ve cevirim secenekleri; CLI'daki bayraklarin aynisi. */
const xmlText = ref('')
const xmlName = ref<string | null>(null)
const keepPrefixes = ref(false)
const numbers = ref(false)
const xmlError = ref<string | null>(null)
const xmlErrorLine = ref<number | null>(null)

const isXml = computed(() => kind.value === 'xml')

/**
 * Duzenlenen metin. Gutter, yapistirma ve senkron seridi tek bir textarea
 * uzerinden calisiyor; bicim degisince altindaki kaynak degisiyor.
 */
const text = computed({
  get: () => {
    if (isXml.value) return xmlText.value
    return live.value ? props.modelValue : draft.value
  },
  set: (value: string) => {
    if (isXml.value) {
      xmlText.value = value
      xmlError.value = null
      xmlErrorLine.value = null
      return
    }
    if (live.value) {
      emit('update:modelValue', value)
      return
    }
    draft.value = value
    dirty.value = value !== props.modelValue
  },
})

/** Elle moddaki taslagi veriye uygular. */
function applyDraft() {
  emit('update:modelValue', draft.value)
  dirty.value = false
}

/** Mod degisince taslak guncel metinle esitlenir; kayip olmaz. */
watch(live, (on) => {
  if (on && dirty.value) applyDraft()
  draft.value = props.modelValue
  dirty.value = false
})

// Disaridan gelen metin (dosya, ornek, XML cevirimi) taslagi da tazeler.
watch(() => props.modelValue, (value) => {
  if (!live.value && !dirty.value) draft.value = value
})

/** Panodan yapistir: buyuk girdide elle moda gecmenin en pratik yolu. */
async function pasteFromClipboard() {
  try {
    const value = await navigator.clipboard.readText()
    if (value) text.value = value
  } catch {
    // Pano izni yoksa kullanici Ctrl+V ile yapistirir.
  }
}

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
    // Cevrilen JSON artik girdinin kendisi; bicim JSON'a doner.
    kind.value = 'json'
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
  kind.value = 'xml'
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

</script>

<template>
  <section class="editor-pane" @drop="emit('drop', $event)" @dragover.prevent>
    <!-- Bicim satiri: XML ayri bir ekran degil, girdinin bir bicimi. -->
    <div class="kinds">
      <button class="kind" :class="{ active: kind === 'json' }" @click="kind = 'json'">JSON</button>
      <button
        class="kind"
        :class="{ active: kind === 'xml' }"
        title="XML yapıştır, JSON'a çevir — sonuç girdinin kendisi olur"
        @click="kind = 'xml'"
      >XML</button>
      <div class="row-spacer" />
      <span class="kind-meta">{{ lineCount.toLocaleString('tr-TR') }} satır</span>
    </div>

    <!-- Eylem satiri: hepsi cercevesiz metin dugme. -->
    <div class="actions">
      <button class="act" :disabled="!hasData || isXml" title="Girintili biçime getir" @click="emit('format')">biçim</button>
      <button class="act" :disabled="!hasData || isXml" title="Tek satıra indir" @click="emit('minify')">küçült</button>
      <button class="act" title="Panodan yapıştır" @click="pasteFromClipboard">yapıştır</button>
      <button class="act" title="Örnek JSON yükle" @click="emit('sample')">örnek</button>
      <div class="row-spacer" />
      <button
        class="act mode"
        :class="{ on: live }"
        :title="live ? 'Her tuş vuruşunda ayrıştırılıyor' : 'Uygula denince ayrıştırılır — büyük dosyada donmaz'"
        @click="live = !live"
      >{{ live ? 'canlı' : 'elle' }}</button>
      <button v-if="!live && dirty" class="apply" @click="applyDraft">uygula</button>
      <button class="act danger" title="Temizle" @click="emit('clear')">temizle</button>
    </div>

    <div class="code-area">
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
    <!-- XML seridi: cevirim secenekleri CLI bayraklarinin aynisi. -->
    <div v-if="isXml" class="xml-bar">
      <button class="xml-opt" :class="{ on: keepPrefixes }" title="iata:Order → Order yerine olduğu gibi kalsın" @click="keepPrefixes = !keepPrefixes">ad alanı önekleri</button>
      <button class="xml-opt" :class="{ on: numbers }" title="0123 gibi değerler yine metin kalır; kod alanları bozulmaz" @click="numbers = !numbers">sayıya çevir</button>
      <div class="row-spacer" />
      <button class="xml-go" :disabled="!text.trim()" @click="convertXml">JSON'a çevir</button>
    </div>

    <!-- Durum satiri: gecerlilik, hata + duzelt, XML'de cevirim ozeti. -->
    <div v-if="isXml" class="status" :class="{ bad: xmlError }">
      <span class="status-text">
        <template v-if="xmlError">
          {{ xmlError }}<template v-if="xmlErrorLine"> · satır {{ xmlErrorLine }}</template>
        </template>
        <template v-else>kök: XML · öznitelikler @ad, tekrarlar dizi</template>
      </span>
    </div>
    <div v-else-if="parseError" class="status bad">
      <span class="status-text">
        {{ parseError }}<template v-if="errorLine"> · satır {{ errorLine }}</template>
      </span>
      <button class="status-fix" @click="emit('repair')">düzelt</button>
    </div>
    <div v-else-if="hasData" class="status">
      <span class="status-text">
        geçerli · {{ nodeCount.toLocaleString('tr-TR') }} node<template v-if="parseMs !== undefined"> · {{ parseMs }} ms</template>
      </span>
    </div>
  </section>
</template>

<style scoped>
.editor-pane { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; background: var(--bg-chrome); }

/* Bicim satiri: JSON | XML — girdinin bicimi, ayri bir ekran degil. */
.kinds {
  display: flex; align-items: center; gap: 12px; height: var(--h-toolbar);
  padding: 0 12px; flex-shrink: 0; border-bottom: 1px solid var(--line-panel);
}
.kind { font-size: 11.5px; color: var(--ink-5); white-space: nowrap; }
.kind:hover { color: var(--ink-2); }
.kind.active { color: var(--ink); }
.kind-meta { font-size: 11px; color: var(--ink-4); white-space: nowrap; }
.row-spacer { flex: 1; }

/* Eylem satiri: hepsi cercevesiz metin dugme. */
.actions {
  display: flex; align-items: center; gap: 12px; height: 31px;
  padding: 0 12px; flex-shrink: 0;
}
.act { font-size: 11px; color: var(--ink-2); white-space: nowrap; }
.act:hover:not(:disabled) { color: var(--ink); }
.act:disabled { opacity: .4; cursor: not-allowed; }
.act.mode.on { color: var(--accent); }
.act.danger { color: var(--ink-5); }
.act.danger:hover { color: var(--removed); }
.apply { font-size: 11px; color: var(--on-accent); background: var(--accent); border-radius: var(--radius); padding: 2px 9px; white-space: nowrap; }
.apply:hover { background: var(--accent-hover); }

/* XML seridi */
.xml-bar { display: flex; align-items: center; gap: 12px; padding: 6px 12px; flex-shrink: 0; border-top: 1px solid var(--line-panel); }
.xml-opt { font-size: 11px; color: var(--ink-4); white-space: nowrap; }
.xml-opt:hover { color: var(--ink-2); }
.xml-opt.on { color: var(--accent); }
.xml-go { font-size: 11px; color: var(--on-accent); background: var(--accent); border-radius: var(--radius); padding: 3px 10px; white-space: nowrap; }
.xml-go:hover:not(:disabled) { background: var(--accent-hover); }
.xml-go:disabled { opacity: .4; cursor: not-allowed; }

/* Durum satiri */
.status {
  display: flex; align-items: center; gap: 10px; padding: 6px 12px; flex-shrink: 0;
  border-top: 1px solid var(--line-panel); font-size: 11px; color: var(--ink-2);
}
.status.bad { color: var(--removed); background: var(--removed-bg-soft); }
.status-text { flex: 1; min-width: 0; line-height: 1.45; word-break: break-word; }
.status-fix { font-size: 11px; color: var(--on-accent); background: var(--removed); border-radius: var(--radius); padding: 2px 9px; flex-shrink: 0; }



/*
 * Karsilastir dugmesi: girdinin hemen altinda, gorunum anahtarinda degil.
 * Ikinci bir belge secmek bir *girdi* isi; sonucun fark gorunumu olmasi
 * ondan sonra geliyor.
 */

/* XML sekmesinin cevirim seridi. */

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


</style>
