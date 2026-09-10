<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from 'vue'
import { SELECT_FIELD } from '../utils/injection'
import type { FieldDoc, JsonObject, JsonValue } from '../types'
import { getType } from '../utils/json'
import InfoBubble from './InfoBubble.vue'
import FieldDocCard from './FieldDocCard.vue'

/**
 * Finder tarzi kolon gorunumu: her seviye kendi sutunu. Agac gorunumu derin
 * NDC belgelerinde girintiyle bogulurken burada yol yatay okunur ve kardesler
 * arasinda gezinmek tek tusa iner.
 *
 * Kritik davranis: bir ust seviyede kardesler arasinda gezerken alt yol
 * korunur (Order.0.StatusCode -> Order.1.StatusCode). 1200 siparisin ayni
 * alanini karsilastirmanin en kisa yolu bu.
 */
const props = defineProps<{
  data: JsonValue
  rootKey: string
  /** Uygulamadaki secili yol; arama/odak istekleri buradan geliyor. */
  selectedPath?: string | null
  docLookup?: (nodePath: string) => FieldDoc | undefined
  searchTerm?: string
}>()

const emit = defineEmits<{ focusPath: [path: string] }>()

const selectField = inject(SELECT_FIELD, null)

/** Kok altindaki secim zinciri; ['IATA_OrderViewRS','Response','Order','0']. */
const chain = ref<string[]>([])
/**
 * Ok tuslarinin uzerinde calistigi sutunun derinligi. Zincirden ayri tutuluyor:
 * yukari cikmak secimi kisaltmaz, yalnizca "aktif sutunu" sola alir. Boylece
 * derin bir alan secili kalirken (Order.0.StatusCode) ust sutunda kardesler
 * arasinda gezip ayni alanin kardes kayitlardaki degeri okunabilir.
 */
const activeDepth = ref(0)
const scrollEl = ref<HTMLElement | null>(null)

const PAGE = 200
/** Sutun basina cizilen oge sayisi; secim ileri gidince buyur. */
const pageSizes = ref(new Map<number, number>())

watch(() => props.data, () => {
  chain.value = []
  activeDepth.value = 0
  pageSizes.value = new Map()
})

function childrenOf(value: JsonValue): Array<{ key: string; value: JsonValue }> {
  if (Array.isArray(value)) return value.map((item, index) => ({ key: String(index), value: item }))
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as JsonObject).map(([key, child]) => ({ key, value: child }))
  }
  return []
}

function valueAt(segments: string[]): JsonValue | undefined {
  let current: JsonValue = props.data
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined
    const next = Array.isArray(current)
      ? (current as JsonValue[])[Number(segment)]
      : (current as JsonObject)[segment]
    if (next === undefined) return undefined
    current = next
  }
  return current
}

function isContainer(value: JsonValue | undefined): boolean {
  return value !== undefined && value !== null && typeof value === 'object'
}

interface Column {
  /** Bu sutunun sahibi olan dugumun zincirdeki derinligi. */
  depth: number
  path: string
  entries: Array<{ key: string; value: JsonValue; type: string; summary: string; container: boolean }>
  /** Bu sutunda secili anahtar. */
  selectedKey: string | null
  total: number
  /** Ok tuslari bu sutunda mi calisiyor. */
  active: boolean
}

function summarize(value: JsonValue): string {
  const type = getType(value)
  if (type === 'array') return `${(value as JsonValue[]).length} öğe`
  if (type === 'object') return `${Object.keys(value as JsonObject).length} alan`
  if (value === null) return 'null'
  return String(value).replace(/\r?\n/g, ' ↵ ')
}

const columns = computed<Column[]>(() => {
  const out: Column[] = []
  for (let depth = 0; depth <= chain.value.length; depth++) {
    const segments = chain.value.slice(0, depth)
    const value = valueAt(segments)
    if (!isContainer(value)) break
    const all = childrenOf(value as JsonValue)
    const limit = pageSizes.value.get(depth) ?? PAGE
    out.push({
      depth,
      path: [props.rootKey, ...segments].join('.'),
      entries: all.slice(0, limit).map(child => ({
        key: child.key,
        value: child.value,
        type: getType(child.value),
        summary: summarize(child.value),
        container: isContainer(child.value),
      })),
      selectedKey: chain.value[depth] ?? null,
      total: all.length,
      active: depth === Math.min(activeDepth.value, Math.max(0, chain.value.length - 1)),
    })
  }
  return out
})

/** Secimin sonundaki dugum skalerse sagda deger karti gosterilir. */
const leaf = computed(() => {
  if (chain.value.length === 0) return null
  const value = valueAt(chain.value)
  if (value === undefined || isContainer(value)) return null
  const text = value === null ? 'null' : String(value)
  return {
    key: chain.value[chain.value.length - 1],
    path: currentPath.value,
    type: getType(value),
    text: text.length > 20_000 ? text.slice(0, 20_000) : text,
    clipped: Math.max(0, text.length - 20_000),
    chars: text.length,
    lines: text.split(/\r?\n/).length,
    doc: props.docLookup?.(currentPath.value),
  }
})

const currentPath = computed(() => [props.rootKey, ...chain.value].join('.'))

function pathOf(depth: number, key: string): string {
  return [props.rootKey, ...chain.value.slice(0, depth), key].join('.')
}

/**
 * Bir sutunda secim: alt yol korunmaya calisilir. Kardes kayitlar ayni sekle
 * sahip oldugu icin (NDC dizileri) bu, "ayni alanda kardese gec" demek olur.
 */
function select(depth: number, key: string) {
  const suffix = chain.value.slice(depth + 1)
  const base = [...chain.value.slice(0, depth), key]
  let next = base
  if (suffix.length > 0 && valueAt([...base, ...suffix]) !== undefined) {
    next = [...base, ...suffix]
  }
  chain.value = next
  activeDepth.value = depth
  selectField?.([props.rootKey, ...next].join('.'))
}

function showMore(depth: number) {
  const map = new Map(pageSizes.value)
  map.set(depth, (map.get(depth) ?? PAGE) + PAGE * 5)
  pageSizes.value = map
}

// --- Klavye ------------------------------------------------------------------

function moveSelection(step: number) {
  const depth = Math.min(activeDepth.value, Math.max(0, chain.value.length - 1))
  const parent = valueAt(chain.value.slice(0, depth))
  if (!isContainer(parent)) return
  const keys = childrenOf(parent as JsonValue).map(child => child.key)
  if (keys.length === 0) return
  const current = keys.indexOf(chain.value[depth] ?? '')
  const index = Math.min(Math.max(current + step, 0), keys.length - 1)
  // Secim cizilen pencerenin otesine gecerse pencereyi buyut.
  const limit = pageSizes.value.get(depth) ?? PAGE
  if (index >= limit) showMore(depth)
  select(depth, keys[index])
}

/**
 * Saga dogru: zincirde daha derin bir secim varsa aktif sutun oraya kayar,
 * yoksa bir seviye asagi inilir (ilk cocuk secilir).
 */
function descend() {
  if (activeDepth.value < chain.value.length - 1) {
    activeDepth.value += 1
    return
  }
  const target = chain.value.length === 0 ? props.data : valueAt(chain.value)
  if (!isContainer(target)) return
  const children = childrenOf(target as JsonValue)
  if (children.length === 0) return
  chain.value = [...chain.value, children[0].key]
  activeDepth.value = chain.value.length - 1
  selectField?.(currentPath.value)
}

/** Sola dogru: secim kisalmaz, yalnizca aktif sutun sola gecer. */
function ascend() {
  activeDepth.value = Math.max(0, activeDepth.value - 1)
}

defineExpose({ moveSelection, descend, ascend })

// --- Odak ve kaydirma --------------------------------------------------------

/**
 * Secim degisince aktif satir goruntuye getirilir. Yatay kaydirma yalnizca yeni
 * bir sutun acildiginda sona atilir: her kardes hareketinde saga kaydirmak
 * kullanicinin baktigi sutunu ekrandan cikariyordu.
 */
let lastColumnCount = 0

watch([chain, activeDepth], async () => {
  await nextTick()
  const container = scrollEl.value
  const opened = columns.value.length > lastColumnCount
  lastColumnCount = columns.value.length
  if (container && opened) container.scrollLeft = container.scrollWidth
  const active = container?.querySelector('.entry.selected-active')
    ?? container?.querySelectorAll('.entry.selected')[0]
  active?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}, { deep: true })

// Uygulamadaki secim (arama, referans atlamasi, breadcrumb) bu goruntuye tasinir.
watch(() => props.selectedPath, (path) => {
  if (!path) return
  const segments = path.split('.')
  if (segments[0] !== props.rootKey) return
  const next = segments.slice(1)
  if (next.join('.') === chain.value.join('.')) return
  if (valueAt(next) === undefined) return
  chain.value = next
  activeDepth.value = Math.max(0, next.length - 1)
}, { immediate: true })

const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

async function copyLeaf() {
  const value = valueAt(chain.value)
  if (value === undefined) return
  try {
    await navigator.clipboard.writeText(value === null ? 'null' : String(value))
    copied.value = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copied.value = false }, 1500)
  } catch {
    copied.value = false
  }
}

function matches(text: string): boolean {
  const term = props.searchTerm?.trim().toLowerCase()
  if (!term) return false
  return text.toLowerCase().includes(term)
}
</script>

<template>
  <div class="column-view">
    <div class="col-hint">
      <span class="keys">↑ ↓</span> kardeşler
      <span class="keys">→</span> içine gir
      <span class="keys">←</span> üst seviye
      <span class="sep">·</span>
      Üst sütunda gezerken alt yol korunur: aynı alanı kardeş kayıtlarda karşılaştırın.
    </div>

    <div ref="scrollEl" class="cols">
      <div v-for="col in columns" :key="col.depth" class="col" :class="{ active: col.active }">
        <div class="col-head">
          <code class="col-path">{{ col.depth === 0 ? rootKey : chain[col.depth - 1] }}</code>
          <span v-if="col.active" class="col-active" title="Ok tuşları bu sütunda çalışıyor">↕</span>
          <span class="col-count">{{ col.total.toLocaleString('tr-TR') }}</span>
        </div>
        <div class="col-body">
          <button
            v-for="entry in col.entries"
            :key="entry.key"
            class="entry"
            :class="{
              selected: col.selectedKey === entry.key,
              'selected-active': col.active && col.selectedKey === entry.key,
              container: entry.container,
              hit: matches(entry.key) || (!entry.container && matches(String(entry.value))),
            }"
            @click="select(col.depth, entry.key)"
            @dblclick="emit('focusPath', pathOf(col.depth, entry.key))"
          >
            <span class="entry-key">{{ entry.key }}</span>
            <InfoBubble v-if="docLookup?.(pathOf(col.depth, entry.key))" @click.stop>
              <template #trigger><span class="entry-doc">ⓘ</span></template>
              <FieldDocCard :field="docLookup(pathOf(col.depth, entry.key))!" />
            </InfoBubble>
            <span class="entry-value" :class="[`v-${entry.type}`, { summary: entry.container }]">{{ entry.summary }}</span>
            <span v-if="entry.container" class="entry-caret">›</span>
          </button>

          <button
            v-if="col.total > col.entries.length"
            class="col-more"
            @click="showMore(col.depth)"
          >+{{ (col.total - col.entries.length).toLocaleString('tr-TR') }} öğe daha</button>
        </div>
      </div>

      <!-- Skaler secimde sagdaki deger karti: tam deger, tip ve semadaki karsiligi. -->
      <div v-if="leaf" class="preview">
        <div class="col-head">
          <code class="col-path">{{ leaf.key }}</code>
          <span class="type-badge" :class="`t-${leaf.type}`">{{ leaf.type }}</span>
        </div>
        <div class="preview-body">
          <pre class="preview-value" :class="`v-${leaf.type}`">{{ leaf.text }}</pre>
          <p v-if="leaf.clipped > 0" class="preview-clip">
            +{{ leaf.clipped.toLocaleString('tr-TR') }} karakter daha (kırpıldı)
          </p>
          <div class="preview-meta">
            <span>{{ leaf.chars.toLocaleString('tr-TR') }} karakter</span>
            <span v-if="leaf.lines > 1">{{ leaf.lines.toLocaleString('tr-TR') }} satır</span>
          </div>
          <div v-if="leaf.doc" class="preview-doc">
            <span class="doc-name">{{ leaf.doc.name }}</span>
            <p class="doc-text">{{ leaf.doc.documentation }}</p>
          </div>
          <div class="preview-actions">
            <button class="preview-btn" @click="copyLeaf">{{ copied ? '✓ kopyalandı' : '⧉ kopyala' }}</button>
            <button class="preview-btn" @click="emit('focusPath', leaf.path)">Grid'de aç</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.column-view { display: flex; flex-direction: column; flex: 1; min-height: 0; }

.col-hint { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 7px 14px; font-size: 11px; color: var(--ink-5); background: var(--bg-chrome); border-bottom: 1px solid var(--line-cell); flex-shrink: 0; }
.keys { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--ink-2); border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; }
.sep { color: var(--line); }

.cols { flex: 1; min-height: 0; display: flex; overflow-x: auto; overflow-y: hidden; }
.col { width: 260px; flex-shrink: 0; display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--line); }
.col.active .col-head { background: var(--accent-soft); }
.col-active { font-size: 10px; color: var(--accent); }
.col-head { display: flex; align-items: center; gap: 8px; padding: 7px 10px; background: var(--bg-chrome); border-bottom: 1px solid var(--line-cell); flex-shrink: 0; }
.col-path { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-count { margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--ink-5); }
.col-body { flex: 1; min-height: 0; overflow-y: auto; padding: 3px 0; }

.entry { display: flex; align-items: center; gap: 6px; width: 100%; padding: 5px 10px; text-align: left; }
.entry:hover { background: var(--bg-chrome); }
/* Tiklama sonrasi kalan odak cercevesi secim isaretini bastiriyordu; klavye
   kullanicisi icin :focus-visible korunuyor. */
.entry:focus { outline: none; }
.entry:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.entry.selected { background: var(--bg-subtle); box-shadow: inset 2px 0 0 var(--line); }
.entry.selected-active { background: var(--accent-sel-bg); box-shadow: inset 2px 0 0 var(--accent); }
.entry.hit { background: var(--search-hit); }
.entry.hit.selected { background: var(--accent-sel-bg); }
.entry-key { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; max-width: 55%; }
.entry-doc { font-size: 9px; color: var(--accent); opacity: .8; }
.entry-value { flex: 1; min-width: 0; font-family: 'JetBrains Mono', monospace; font-size: 11.5px; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.entry-value.summary { color: var(--ink-5); font-style: italic; }
.v-string { color: var(--type-string); }
.v-number { color: var(--type-number); }
.v-boolean { color: var(--type-boolean); }
.v-null { color: var(--type-null); }
.entry-caret { color: var(--ink-5); font-size: 12px; flex-shrink: 0; }
.entry.selected .entry-caret { color: var(--accent); }

.col-more { width: 100%; margin: 4px 0; font-size: 11px; color: var(--accent); background: var(--accent-soft); padding: 4px 8px; }

.preview { width: 320px; flex-shrink: 0; display: flex; flex-direction: column; min-height: 0; background: var(--bg-chrome); }
.preview-body { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.preview-value { margin: 0; font-family: 'JetBrains Mono', monospace; font-size: 12px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
.preview-clip { font-size: 10.5px; color: var(--changed); }
.preview-meta { display: flex; gap: 10px; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--ink-5); }
.preview-doc { border-top: 1px solid var(--line-cell); padding-top: 8px; }
.doc-name { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); }
.doc-text { margin-top: 4px; font-size: 11.5px; line-height: 1.5; color: var(--ink-2); }
.preview-actions { display: flex; gap: 6px; margin-top: auto; }
.preview-btn { font-size: 11px; color: var(--ink-2); border: 1px solid var(--line); border-radius: 6px; padding: 3px 9px; }
.preview-btn:hover { color: var(--accent); border-color: var(--accent); }

.type-badge { margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; }
.t-string { background: var(--bg-subtle); color: var(--type-string); }
.t-number { background: var(--bg-subtle); color: var(--type-number); }
.t-boolean { background: var(--bg-subtle); color: var(--type-boolean); }
.t-null { background: var(--bg-subtle); color: var(--type-null); }
</style>
