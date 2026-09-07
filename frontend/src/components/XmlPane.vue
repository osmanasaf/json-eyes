<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { countNodes } from '../utils/json'
import { XmlParseError, xmlToJson } from '../utils/xml'

/**
 * XML -> JSON: ayri bir hizmet.
 *
 * Onceden girdi icerigine bakip "bu XML'e benziyor" diye karar veriliyordu;
 * girdiden anlam cikarmak yanlis karar verebilecegi ve kullaniciyi
 * sasirtabilecegi icin artik boyle bir tahmin yok. Cevirim yalnizca burada,
 * kullanici isteyince oluyor: XML'i yapistir, seceneklere karar ver, sonucu
 * goruntuleyiciye yukle ya da indir. CLI'daki `jse xml2json` ayni cevirici
 * kodunu kullaniyor, dolayisiyla sonuc birebir ayni.
 */
const props = defineProps<{
  /** Ilk metin (or. .xml uzantili dosya secildiginde). */
  initial?: string
  initialName?: string | null
}>()

const emit = defineEmits<{
  /** Cevrilen JSON goruntuleyiciye yuklensin. */
  load: [payload: { text: string; name: string | null; root: string; notes: string[] }]
  /** Yazilan XML App'te tutulur: gorunum degisince yazdiklari kaybolmasin. */
  'update:text': [text: string]
  close: []
}>()

const input = ref(props.initial ?? '')
const name = ref<string | null>(props.initialName ?? null)
const keepPrefixes = ref(false)
const numbers = ref(false)

const output = ref<{ text: string; root: string; notes: string[]; nodes: number; ms: number } | null>(null)
const error = ref<string | null>(null)
const busy = ref(false)

/** Bu boyutun ustunde cevirim kendiliginden calismaz; kullanici dugmeye basar. */
const AUTO_LIMIT = 2_000_000
/** Onizlemede gosterilen en fazla karakter; sonuc her zaman tam indirilir. */
const PREVIEW_CHARS = 60_000

const tooBigForAuto = computed(() => input.value.length > AUTO_LIMIT)

function convert() {
  const text = input.value
  if (!text.trim()) {
    output.value = null
    error.value = null
    return
  }
  busy.value = true
  try {
    const started = performance.now()
    const result = xmlToJson(text, {
      keepPrefixes: keepPrefixes.value,
      numbers: numbers.value,
    })
    const json = JSON.stringify(result.data, null, 2)
    output.value = {
      text: json,
      root: result.root,
      notes: result.notes,
      nodes: countNodes(result.data),
      ms: performance.now() - started,
    }
    error.value = null
  } catch (e) {
    output.value = null
    error.value = e instanceof XmlParseError
      ? `Satır ${e.line}: ${e.message}`
      : (e as Error).message
  } finally {
    busy.value = false
  }
}

watch(input, value => emit('update:text', value))

let timer: ReturnType<typeof setTimeout> | null = null

watch([input, keepPrefixes, numbers], () => {
  if (timer) clearTimeout(timer)
  if (tooBigForAuto.value) {
    output.value = null
    return
  }
  timer = setTimeout(convert, 250)
})

onMounted(() => {
  if (input.value.trim() && !tooBigForAuto.value) convert()
})

const preview = computed(() => {
  const text = output.value?.text ?? ''
  return text.length > PREVIEW_CHARS ? text.slice(0, PREVIEW_CHARS) : text
})

const previewClipped = computed(() =>
  Math.max(0, (output.value?.text.length ?? 0) - PREVIEW_CHARS),
)

const jsonName = computed(() => (name.value ?? 'cevrilen').replace(/\.xml$/i, '') + '.json')

const fileRef = ref<HTMLInputElement | null>(null)
const copied = ref(false)

function pickFile(event: Event) {
  const element = event.target as HTMLInputElement
  const file = element.files?.[0]
  element.value = ''
  if (!file) return
  const reader = new FileReader()
  reader.onload = (e) => {
    input.value = (e.target?.result as string) ?? ''
    name.value = file.name
    if (tooBigForAuto.value) convert()
  }
  reader.readAsText(file)
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (e) => {
    input.value = (e.target?.result as string) ?? ''
    name.value = file.name
    if (tooBigForAuto.value) convert()
  }
  reader.readAsText(file)
}

async function copyJson() {
  if (!output.value) return
  try {
    await navigator.clipboard.writeText(output.value.text)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch {
    copied.value = false
  }
}

function download() {
  if (!output.value) return
  const blob = new Blob([output.value.text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = jsonName.value
  link.click()
  URL.revokeObjectURL(url)
}

function load() {
  if (!output.value) return
  emit('load', {
    text: output.value.text,
    name: jsonName.value,
    root: output.value.root,
    notes: output.value.notes,
  })
}
</script>

<template>
  <div class="xml">
    <div class="bar">
      <h2 class="title">XML → JSON</h2>
      <span class="sub">ayrı bir araç: çeviri yalnızca burada, isteyince olur</span>
      <div class="spacer" />
      <label class="opt" title="iata:Order → Order yerine iata:Order olarak kalsın">
        <input v-model="keepPrefixes" type="checkbox" />
        ad alanı öneklerini koru
      </label>
      <label class="opt" title="0123 gibi değerler yine metin kalır; kod alanları bozulmaz">
        <input v-model="numbers" type="checkbox" />
        sayıları çıkar
      </label>
      <button class="btn" @click="fileRef?.click()">XML dosyası seç</button>
      <button class="btn close" title="Görüntüleyiciye dön" @click="emit('close')">×</button>
    </div>

    <div class="panes">
      <section class="pane">
        <header class="pane-head">
          <span class="pane-title">XML</span>
          <span v-if="name" class="pane-name">{{ name }}</span>
          <div class="spacer" />
          <span class="pane-meta">{{ input.length.toLocaleString('tr-TR') }} karakter</span>
          <button v-if="input" class="mini" @click="input = ''; name = null; output = null; error = null">temizle</button>
        </header>
        <textarea
          v-model="input"
          class="editor"
          spellcheck="false"
          wrap="off"
          placeholder="XML'i buraya yapıştırın ya da dosyayı bu alana sürükleyin"
          @dragover.prevent
          @drop="onDrop"
        />
        <footer class="pane-foot">
          <button v-if="tooBigForAuto" class="btn primary" :disabled="busy" @click="convert">
            {{ busy ? 'Çevriliyor…' : 'Çevir' }}
          </button>
          <span v-if="tooBigForAuto" class="warn">
            2 MB üstü girdi kendiliğinden çevrilmiyor — düğmeye basın
          </span>
          <span v-else class="hint">yazdıkça çevriliyor</span>
        </footer>
      </section>

      <section class="pane">
        <header class="pane-head">
          <span class="pane-title">JSON</span>
          <span v-if="output" class="pane-root">kök: <code>{{ output.root }}</code></span>
          <div class="spacer" />
          <template v-if="output">
            <span class="pane-meta">{{ output.nodes.toLocaleString('tr-TR') }} node · {{ Math.round(output.ms) }} ms</span>
            <button class="mini" @click="copyJson">{{ copied ? '✓ kopyalandı' : '⧉ kopyala' }}</button>
            <button class="mini" @click="download">⤓ indir</button>
          </template>
        </header>

        <div v-if="error" class="error">
          <strong>XML ayrıştırılamadı</strong>
          <code>{{ error }}</code>
          <p>Kapanmayan etiket, tırnaksız öznitelik ya da ikinci bir kök eleman olabilir.</p>
        </div>
        <pre v-else-if="output" class="out">{{ preview }}</pre>
        <div v-else class="idle">
          <p>Soldaki alana XML yapıştırın.</p>
          <ul>
            <li>Ad alanı önekleri atılır (<code>iata:Order</code> → <code>Order</code>), <code>xmlns</code> düşer.</li>
            <li>Öznitelikler <code>@ad</code>, metin içeriği <code>#text</code> olur.</li>
            <li>Tekrarlayan kardeşler diziye düşer; tek öğeli listeler dizi <em>olmaz</em>.</li>
            <li>Değerler metin kalır — <code>0123</code> sayıya çevrilse baştaki sıfır giderdi.</li>
          </ul>
          <p class="cli">Aynı çevirici terminalde: <code>jse xml2json siparis.xml -o siparis.json</code></p>
        </div>

        <footer v-if="output" class="pane-foot">
          <button class="btn primary" @click="load">JSON'u görüntüleyiciye yükle</button>
          <span v-if="previewClipped > 0" class="hint">
            önizlemede ilk {{ PREVIEW_CHARS.toLocaleString('tr-TR') }} karakter ·
            {{ previewClipped.toLocaleString('tr-TR') }} karakter daha var
          </span>
          <span v-else-if="output.notes.length > 0" class="hint">{{ output.notes.join(' · ') }}</span>
        </footer>
      </section>
    </div>

    <input ref="fileRef" type="file" accept=".xml,text/xml,application/xml" hidden @change="pickFile" />
  </div>
</template>

<style scoped>
.xml { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.spacer { flex: 1; }

.bar { display: flex; align-items: center; gap: 12px; padding: 8px 14px; background: var(--bg-secondary); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.title { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-primary); }
.sub { font-size: 11.5px; color: var(--text-muted); }
.opt { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--text-secondary); white-space: nowrap; cursor: pointer; }
.btn { font-size: 11.5px; color: var(--text-secondary); border: 1px solid var(--border); border-radius: 6px; padding: 3px 10px; white-space: nowrap; }
.btn:hover { color: var(--accent); border-color: var(--accent); }
.btn.primary { color: var(--accent); border-color: var(--accent); background: var(--accent-dim); }
.btn.primary:hover { background: var(--accent-strong); }
.btn.close { font-size: 15px; line-height: 1; padding: 0 7px; }
.btn.close:hover { color: var(--red); border-color: var(--red); }

.panes { display: grid; grid-template-columns: 1fr 1fr; flex: 1; min-height: 0; }
.pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; border-right: 1px solid var(--border); }
.pane:last-child { border-right: none; }
.pane-head { display: flex; align-items: center; gap: 9px; padding: 5px 12px; background: var(--bg-secondary); border-bottom: 1px solid var(--border-subtle); flex-shrink: 0; }
.pane-title { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: .5px; }
.pane-name, .pane-meta, .pane-root { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pane-root code { color: var(--purple); }
.mini { font-size: 10.5px; color: var(--text-muted); border: 1px solid var(--border); border-radius: 5px; padding: 1px 7px; white-space: nowrap; }
.mini:hover { color: var(--accent); border-color: var(--accent); }

.editor { flex: 1; min-height: 0; width: 100%; resize: none; outline: none; border: none; background: var(--bg-primary); color: var(--text-primary); font-family: 'JetBrains Mono', monospace; font-size: 12.5px; line-height: 1.6; padding: 10px 12px; overflow: auto; white-space: pre; }
.out { flex: 1; min-height: 0; margin: 0; padding: 10px 12px; overflow: auto; background: var(--bg-primary); color: var(--text-primary); font-family: 'JetBrains Mono', monospace; font-size: 12.5px; line-height: 1.6; white-space: pre; }

.pane-foot { display: flex; align-items: center; gap: 10px; padding: 7px 12px; background: var(--bg-secondary); border-top: 1px solid var(--border-subtle); flex-shrink: 0; }
.hint { font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.warn { font-size: 11px; color: var(--orange); }

.error { padding: 16px; }
.error strong { display: block; font-size: 12.5px; color: var(--red); margin-bottom: 6px; }
.error code { display: block; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-primary); background: var(--bg-secondary); border-left: 2px solid var(--red); padding: 6px 9px; }
.error p { margin: 8px 0 0; font-size: 11.5px; color: var(--text-muted); }

.idle { padding: 16px; font-size: 12px; color: var(--text-secondary); overflow-y: auto; }
.idle p { margin: 0 0 8px; }
.idle ul { margin: 0; padding-left: 18px; }
.idle li { margin-bottom: 5px; color: var(--text-muted); }
.idle code { font-family: 'JetBrains Mono', monospace; color: var(--color-string); }
.idle .cli { margin-top: 12px; color: var(--text-muted); font-size: 11.5px; }

@media (max-width: 1024px) {
  .panes { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; }
  .pane { border-right: none; border-bottom: 1px solid var(--border); }
}
</style>
