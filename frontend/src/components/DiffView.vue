<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { JsonValue } from '../types'
import { parseJson } from '../utils/json'
import {
  changeList, changedPaths, diffJson, flattenDiff,
  type ChangeKind, type DiffNode, type DiffResult, type DiffRow,
} from '../utils/diff'

/**
 * Fark gorunumu. Tasarim, buyuk NDC yanitlarinda ise yarayan tek duzene gore
 * secildi: yan yana iki metin degil, tek bir *birlesik agac* — degisiklikler
 * kendi yerinde, degismeyenler katlanmis. Aciklamasi:
 *
 * - Yan yana gorunum ancak iki belge ayni sirada ve boyutta oldugunda okunur;
 *   1200 kayitlik bir dizide basa bir kayit eklenince tum satirlar kayar.
 * - Birlesik agacta ise okunacak sey yalnizca degisen dallar; "yalnizca
 *   degisenler" acikken degismeyen kardesler tek satira iner (git'in baglam
 *   katlamasi gibi).
 * - Diziler kimlige gore eslestirildigi icin (utils/diff.ts) "Order.7 degisti"
 *   yerine dogru kaydin degistigi gorunur.
 */
const props = defineProps<{
  /** Soldaki (mevcut) belge: editorde yuklu olan JSON. */
  current: JsonValue | null
  rootKey: string
  /** Yuklu belgenin adi; seritte gosterilir. */
  currentName: string
  /** Paylasim kimliginden JSON getiren fonksiyon; App'ten geliyor. */
  loadShare: (idOrUrl: string) => Promise<{ json: JsonValue; label: string }>
  /**
   * Karsilastirilacak tarafi kendiliginden getir (`?s=A&d=B` adresindeki `d`).
   * `jse diff` boyle bir link uretiyor: linki acan kisi iki tarafi da elle
   * yuklemek zorunda kalmasin.
   */
  autoShare?: string | null
}>()

const emit = defineEmits<{ focusPath: [path: string]; close: [] }>()

type Source = { json: JsonValue; label: string } | null

/**
 * Karsilastirilacak ikinci belge. shallowRef: JsonValue ozyinelemeli oldugu icin
 * derin unwrap tip cozumunu patlatiyor, ustelik agacin ic dugumlerinin reaktif
 * olmasina gerek de yok (depoda `parseState` ayni sebeple boyle).
 */
const other = shallowRef<Source>(null)
const otherError = ref<string | null>(null)
const loading = ref(false)
const pasteOpen = ref(false)
const pasteText = ref('')
const shareInput = ref('')
const fileRef = ref<HTMLInputElement | null>(null)

/** A ve B taraflari yer degistirebilir: "hangisi eski" kullanicinin karari. */
const swapped = ref(false)

const leftSide = computed(() => (swapped.value
  ? other.value
  : (props.current !== null ? { json: props.current, label: props.currentName || 'yüklü JSON' } : null)))
const rightSide = computed(() => (swapped.value
  ? (props.current !== null ? { json: props.current, label: props.currentName || 'yüklü JSON' } : null)
  : other.value))

function readFile(file: File) {
  const reader = new FileReader()
  reader.onload = (event) => {
    const text = String(event.target?.result ?? '')
    const parsed = parseJson(text)
    if (parsed.data === null) {
      otherError.value = `${file.name} geçerli JSON değil: ${parsed.error ?? 'boş'}`
      return
    }
    otherError.value = null
    other.value = { json: parsed.data, label: file.name }
  }
  reader.readAsText(file)
}

function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) readFile(file)
  input.value = ''
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  const file = event.dataTransfer?.files?.[0]
  if (file) readFile(file)
}

function applyPaste() {
  const parsed = parseJson(pasteText.value)
  if (parsed.data === null) {
    otherError.value = `Yapıştırılan metin geçerli JSON değil: ${parsed.error ?? 'boş'}`
    return
  }
  otherError.value = null
  other.value = { json: parsed.data, label: 'yapıştırılan' }
  pasteOpen.value = false
  pasteText.value = ''
}

async function loadFromShare(idOrUrl: string): Promise<void> {
  loading.value = true
  otherError.value = null
  try {
    other.value = await props.loadShare(idOrUrl)
  } catch (error) {
    otherError.value = (error as Error).message
  } finally {
    loading.value = false
  }
}

async function applyShare() {
  const value = shareInput.value.trim()
  if (!value) return
  await loadFromShare(value)
  if (!otherError.value) shareInput.value = ''
}

// Fark linkiyle gelindiyse ikinci taraf kendiliginden yuklenir.
watch(() => props.autoShare, (id) => {
  if (id) void loadFromShare(id)
}, { immediate: true })

// --- Karsilastirma -----------------------------------------------------------

const result = shallowRef<DiffResult | null>(null)
const computing = ref(false)
const elapsed = ref(0)

watch([leftSide, rightSide], async () => {
  const left = leftSide.value
  const right = rightSide.value
  if (!left || !right) {
    result.value = null
    return
  }
  computing.value = true
  // Bir kare bekle: buyuk belgelerde "hesaplanıyor" yazisi cizilebilsin.
  await nextTick()
  const started = performance.now()
  result.value = diffJson(left.json, right.json, props.rootKey)
  elapsed.value = performance.now() - started
  expanded.value = changedPaths(result.value)
  computing.value = false
  activeChange.value = 0
  await nextTick()
  virtualizer.value.measure()
  virtualizer.value.scrollToOffset(0)
}, { immediate: true })

const onlyChanges = ref(true)
const expanded = ref(new Set<string>())
const openValuePath = ref<string | null>(null)

const rows = computed<DiffRow[]>(() => (result.value
  ? flattenDiff(result.value, { expanded: expanded.value, onlyChanges: onlyChanges.value })
  : []))

const identical = computed(() => {
  const counts = result.value?.counts
  if (!counts) return false
  return counts.added + counts.removed + counts.changed + counts.moved === 0
})

// --- Degisiklikler arasinda gezinme -----------------------------------------

const changes = computed(() => (result.value ? changeList(result.value) : []))
const activeChange = ref(0)

function goToChange(step: number) {
  if (changes.value.length === 0) return
  activeChange.value = (activeChange.value + step + changes.value.length) % changes.value.length
  const target = changes.value[activeChange.value]
  // Hedefe giden dallari ac, sonra satiri goruntuye kaydir.
  const next = new Set(expanded.value)
  const segments = target.path.split('.')
  for (let i = 1; i <= segments.length; i++) next.add(segments.slice(0, i).join('.'))
  expanded.value = next
  void nextTick(() => {
    const index = rows.value.findIndex(row => row.node.path === target.path && row.collapsedCount === undefined)
    if (index >= 0) virtualizer.value.scrollToIndex(index, { align: 'center' })
  })
}

// --- Sanallastirma -----------------------------------------------------------

const scrollEl = ref<HTMLElement | null>(null)
const virtualVersion = ref(0)
const virtualizer = useVirtualizer(computed(() => ({
  count: rows.value.length,
  getScrollElement: () => scrollEl.value,
  estimateSize: () => 30,
  overscan: 12,
  getItemKey: (index: number) => rows.value[index]?.key ?? index,
  onChange: () => { virtualVersion.value++ },
})))

const virtualRows = computed(() => {
  void virtualVersion.value
  return virtualizer.value.getVirtualItems()
})
const totalSize = computed(() => {
  void virtualVersion.value
  return virtualizer.value.getTotalSize()
})

function measure(el: Element | { $el?: Element } | null) {
  const node = (el as { $el?: Element } | null)?.$el ?? el
  if (node instanceof HTMLElement) virtualizer.value.measureElement(node)
}

/**
 * Satir listesi bastan kurulunca olcum onbellegi tazelenmeli. Gorunum bos bir
 * listeyle aciliyor (ikinci belge henuz yok); onbellek o andaki olculerle
 * kaliyordu ve liste geldiginde pencere ortadan basliyordu — ustte kocaman bir
 * bosluk, ilk satirlar hic cizilmemis halde.
 */
watch(rows, () => {
  virtualizer.value.measure()
})

// --- Satir gorunumu ----------------------------------------------------------

function toggle(path: string) {
  const next = new Set(expanded.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  expanded.value = next
}

function expandAll() {
  if (!result.value) return
  const paths = new Set<string>()
  function walk(node: DiffNode) {
    if (node.children.length > 0) paths.add(node.path)
    for (const child of node.children) walk(child)
  }
  walk(result.value.root)
  expanded.value = paths
}

function collapseAll() {
  expanded.value = new Set([props.rootKey])
}

const GLYPH: Record<ChangeKind, string> = {
  added: '+', removed: '−', changed: '~', moved: '⇄', unchanged: '·',
}

const LABEL: Record<ChangeKind, string> = {
  added: 'eklendi', removed: 'silindi', changed: 'değişti', moved: 'taşındı', unchanged: 'aynı',
}

const PREVIEW = 90

/** Satirda gosterilen kisa deger metni. */
function preview(value: JsonValue | undefined): string {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${value.length} öğe]`
  if (typeof value === 'object') return `{${Object.keys(value).length} alan}`
  const text = String(value).replace(/\r?\n/g, ' ↵ ')
  return text.length > PREVIEW ? `${text.slice(0, PREVIEW)}…` : text
}

function fullText(value: JsonValue | undefined): string {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

/** Kirpilmis bir deger var mi; varsa satir tiklamayla tam halini acar. */
function truncated(node: DiffNode): boolean {
  const left = fullText(node.left)
  const right = fullText(node.right)
  return left.length > PREVIEW || right.length > PREVIEW || left.includes('\n') || right.includes('\n')
}

function onRowClick(row: DiffRow) {
  if (row.collapsedCount !== undefined) return
  if (row.expandable) {
    toggle(row.node.path)
    return
  }
  if (truncated(row.node)) {
    openValuePath.value = openValuePath.value === row.node.path ? null : row.node.path
  }
}

/** Kimlige gore eslestirilen diziler; kullanici neyin nasil karsilastirildigini bilmeli. */
const identityNote = computed(() => {
  const keys = result.value?.identityKeys
  if (!keys || keys.size === 0) return null
  const parts = [...keys].slice(0, 3).map(([path, key]) => `${path.split('.').pop()} → ${key}`)
  const rest = keys.size > 3 ? ` +${keys.size - 3}` : ''
  return `Diziler kimliğe göre eşleştirildi: ${parts.join(' · ')}${rest}`
})
</script>

<template>
  <section class="diff" @dragover.prevent @drop="onDrop">
    <!-- Kaynak seridi: A ve B belgeleri -->
    <div class="sources">
      <span class="side-label a">A</span>
      <span class="side-name" :title="leftSide?.label">{{ leftSide?.label ?? '—' }}</span>
      <button class="swap" title="A ve B'yi yer değiştir" :disabled="!other" @click="swapped = !swapped">⇄</button>
      <span class="side-label b">B</span>
      <span class="side-name" :title="rightSide?.label">{{ rightSide?.label ?? 'karşılaştırılacak JSON seçin' }}</span>

      <div class="spacer" />

      <button class="src-btn" @click="fileRef?.click()">Dosya…</button>
      <button class="src-btn" :class="{ active: pasteOpen }" @click="pasteOpen = !pasteOpen">Yapıştır</button>
      <div class="share-input">
        <input
          v-model="shareInput"
          class="share-field"
          type="text"
          placeholder="paylaşım linki veya id"
          @keydown.enter="applyShare"
        />
        <button class="src-btn" :disabled="loading || !shareInput.trim()" @click="applyShare">
          {{ loading ? '…' : 'Getir' }}
        </button>
      </div>
      <button class="src-btn close" title="Fark görünümünü kapat" @click="emit('close')">×</button>
      <input ref="fileRef" type="file" accept=".json,application/json" hidden @change="onFile" />
    </div>

    <div v-if="pasteOpen" class="paste">
      <textarea
        v-model="pasteText"
        class="paste-area"
        placeholder="Karşılaştırılacak JSON'u buraya yapıştırın…"
        spellcheck="false"
      />
      <button class="src-btn apply" :disabled="!pasteText.trim()" @click="applyPaste">Karşılaştır</button>
    </div>

    <p v-if="otherError" class="diff-error">{{ otherError }}</p>

    <!-- Ozet: dort sayi (grafik degil, deger kutulari) -->
    <div v-if="result" class="summary">
      <div class="tile added"><span class="tile-glyph">+</span><span class="tile-value">{{ result.counts.added.toLocaleString('tr-TR') }}</span><span class="tile-label">eklendi</span></div>
      <div class="tile removed"><span class="tile-glyph">−</span><span class="tile-value">{{ result.counts.removed.toLocaleString('tr-TR') }}</span><span class="tile-label">silindi</span></div>
      <div class="tile changed"><span class="tile-glyph">~</span><span class="tile-value">{{ result.counts.changed.toLocaleString('tr-TR') }}</span><span class="tile-label">değişti</span></div>
      <div class="tile moved"><span class="tile-glyph">⇄</span><span class="tile-value">{{ result.counts.moved.toLocaleString('tr-TR') }}</span><span class="tile-label">taşındı</span></div>

      <div class="spacer" />

      <span v-if="changes.length > 0" class="nav">
        <button class="nav-btn" title="Önceki değişiklik" @click="goToChange(-1)">↑</button>
        <span class="nav-count">{{ activeChange + 1 }}/{{ changes.length.toLocaleString('tr-TR') }}</span>
        <button class="nav-btn" title="Sonraki değişiklik" @click="goToChange(1)">↓</button>
      </span>
      <button class="ctl" :class="{ active: onlyChanges }" @click="onlyChanges = !onlyChanges">yalnız değişenler</button>
      <button class="ctl" @click="expandAll">tümünü aç</button>
      <button class="ctl" @click="collapseAll">kapat</button>
    </div>

    <p v-if="identityNote" class="identity-note">{{ identityNote }}</p>
    <p v-if="result?.degraded" class="identity-note warn">
      Çok büyük bir dizide öğe eşleştirmesi indekse göre yapıldı; sıra değişikliği varsa fark abartılı görünebilir.
    </p>

    <!-- Birlesik agac -->
    <div ref="scrollEl" class="tree">
      <p v-if="!rightSide" class="note">
        Karşılaştırmak için ikinci bir JSON verin: dosya seçin, sürükleyip bırakın, yapıştırın
        ya da bir paylaşım linki getirin. Soldaki (A) belge editörde yüklü olan.
      </p>
      <p v-else-if="computing" class="note">Karşılaştırılıyor…</p>
      <p v-else-if="identical" class="note same">İki belge birebir aynı.</p>
      <p v-else-if="rows.length === 0" class="note">Gösterilecek satır yok.</p>

      <div v-else class="canvas" :style="{ height: `${totalSize}px` }">
        <div
          v-for="vrow in virtualRows"
          :key="String(vrow.key)"
          :ref="measure"
          :data-index="vrow.index"
          class="vrow"
          :style="{ transform: `translateY(${vrow.start}px)` }"
        >
          <template v-if="rows[vrow.index]">
            <!-- Katlanmis degismeyen kardesler -->
            <div
              v-if="rows[vrow.index].collapsedCount !== undefined"
              class="row folded"
              :style="{ paddingLeft: `${12 + rows[vrow.index].depth * 16}px` }"
              @click="onlyChanges = false"
            >
              {{ rows[vrow.index].collapsedCount!.toLocaleString('tr-TR') }} değişmeyen
              {{ rows[vrow.index].collapsedUnit ?? 'alan' }}
            </div>

            <div
              v-else
              class="row"
              :class="[`k-${rows[vrow.index].node.kind}`, { container: rows[vrow.index].expandable }]"
              @click="onRowClick(rows[vrow.index])"
            >
              <span class="indent" :style="{ width: `${rows[vrow.index].depth * 16}px` }" />
              <button
                v-if="rows[vrow.index].expandable"
                class="caret"
                @click.stop="toggle(rows[vrow.index].node.path)"
              >{{ rows[vrow.index].isOpen ? '▾' : '▸' }}</button>
              <span v-else class="caret-ph" />

              <span class="glyph" :title="LABEL[rows[vrow.index].node.kind]">{{ GLYPH[rows[vrow.index].node.kind] }}</span>
              <span class="key">{{ rows[vrow.index].node.key }}</span>
              <!-- Dizi ogelerinde kimlik: "3" yerine "3 · ORD100003" -->
              <span v-if="rows[vrow.index].node.label" class="label">{{ rows[vrow.index].node.label }}</span>
              <span class="type">{{ rows[vrow.index].node.type }}</span>

              <!-- Degisiklik ozeti: kapsayicilarda sayilar, yapraklarda eski → yeni -->
              <span v-if="rows[vrow.index].expandable" class="badges">
                <span v-if="rows[vrow.index].node.counts.added" class="badge added">+{{ rows[vrow.index].node.counts.added }}</span>
                <span v-if="rows[vrow.index].node.counts.removed" class="badge removed">−{{ rows[vrow.index].node.counts.removed }}</span>
                <span v-if="rows[vrow.index].node.counts.changed" class="badge changed">~{{ rows[vrow.index].node.counts.changed }}</span>
                <span v-if="rows[vrow.index].node.counts.moved" class="badge moved">⇄{{ rows[vrow.index].node.counts.moved }}</span>
              </span>
              <span v-else class="values">
                <template v-if="rows[vrow.index].node.kind === 'changed'">
                  <span class="old">{{ preview(rows[vrow.index].node.left) }}</span>
                  <span class="arrow">→</span>
                  <span class="new">{{ preview(rows[vrow.index].node.right) }}</span>
                </template>
                <span v-else-if="rows[vrow.index].node.kind === 'removed'" class="old">{{ preview(rows[vrow.index].node.left) }}</span>
                <span v-else-if="rows[vrow.index].node.kind === 'added'" class="new">{{ preview(rows[vrow.index].node.right) }}</span>
                <span v-else class="same-value">{{ preview(rows[vrow.index].node.right) }}</span>
              </span>

              <span v-if="rows[vrow.index].node.kind === 'moved'" class="move-note">
                {{ rows[vrow.index].node.from }} → {{ rows[vrow.index].node.to }}
              </span>
              <span class="row-spacer" />
              <button
                class="goto"
                title="Bu alanı grid'de aç (A belgesi)"
                @click.stop="emit('focusPath', rows[vrow.index].node.oldPath ?? rows[vrow.index].node.path)"
              >↗</button>
            </div>

            <!-- Uzun degerlerin tam hali: eski ve yeni yan yana -->
            <div v-if="openValuePath === rows[vrow.index].node.path" class="full">
              <div v-if="rows[vrow.index].node.left !== undefined" class="full-col old">
                <span class="full-head">A (eski)</span>
                <pre class="full-text">{{ fullText(rows[vrow.index].node.left) }}</pre>
              </div>
              <div v-if="rows[vrow.index].node.right !== undefined" class="full-col new">
                <span class="full-head">B (yeni)</span>
                <pre class="full-text">{{ fullText(rows[vrow.index].node.right) }}</pre>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <footer v-if="result" class="diff-foot">
      <span class="foot-item">{{ rows.length.toLocaleString('tr-TR') }} satır</span>
      <span class="foot-item muted">karşılaştırma {{ Math.round(elapsed) }} ms</span>
      <div class="spacer" />
      <span class="foot-item muted">değişmeyen dallar katlı · satıra tıklayın: aç/kapat, uzun değerde tam hali</span>
    </footer>
  </section>
</template>

<style scoped>
.diff { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.spacer { flex: 1; }

/* --- Kaynak seridi -------------------------------------------------------- */
.sources { display: flex; align-items: center; gap: 8px; padding: 8px 14px; background: var(--bg-secondary); border-bottom: 1px solid var(--border-subtle); flex-shrink: 0; }
.side-label { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; font-weight: 700; border-radius: 4px; padding: 2px 6px; }
.side-label.a { color: var(--text-secondary); background: var(--bg-tertiary); }
.side-label.b { color: var(--accent); background: var(--accent-dim); }
.side-name { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
.swap { font-size: 12px; color: var(--text-muted); border: 1px solid var(--border); border-radius: 6px; padding: 1px 7px; }
.swap:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
.swap:disabled { opacity: .35; cursor: not-allowed; }
.src-btn { font-size: 11.5px; color: var(--text-secondary); border: 1px solid var(--border); border-radius: 6px; padding: 3px 9px; white-space: nowrap; }
.src-btn:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
.src-btn:disabled { opacity: .4; cursor: not-allowed; }
.src-btn.active { color: var(--accent); border-color: var(--accent); background: var(--accent-dim); }
.src-btn.close { font-size: 15px; line-height: 1; padding: 0 7px; }
.src-btn.close:hover { color: var(--red); border-color: var(--red); }
.share-input { display: flex; align-items: center; gap: 5px; }
.share-field { width: 180px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; outline: none; color: var(--text-primary); font-family: 'JetBrains Mono', monospace; font-size: 11px; padding: 3px 8px; }
.share-field:focus { border-color: var(--accent); }

.paste { display: flex; gap: 8px; padding: 8px 14px; background: var(--bg-secondary); border-bottom: 1px solid var(--border-subtle); }
.paste-area { flex: 1; height: 96px; resize: vertical; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 7px; outline: none; color: var(--text-primary); font-family: 'JetBrains Mono', monospace; font-size: 11.5px; padding: 8px 10px; }
.paste-area:focus { border-color: var(--accent); }
.src-btn.apply { align-self: flex-start; }

.diff-error { padding: 8px 14px; font-size: 11.5px; color: var(--red); background: var(--red-soft); }

/* --- Ozet ---------------------------------------------------------------- */
.summary { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border-subtle); flex-shrink: 0; }
.tile { display: flex; align-items: baseline; gap: 6px; background: var(--bg-secondary); border: 1px solid var(--border-subtle); border-radius: 7px; padding: 5px 10px; }
.tile-glyph { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 700; }
.tile-value { font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 600; color: var(--text-primary); }
.tile-label { font-size: 10px; color: var(--text-muted); }
/* Durum renkleri; her biri kendi isaretiyle birlikte geliyor (renk tek basina anlam tasimiyor). */
.tile.added .tile-glyph { color: var(--green); }
.tile.removed .tile-glyph { color: var(--red); }
.tile.changed .tile-glyph { color: var(--orange); }
.tile.moved .tile-glyph { color: var(--purple); }

.nav { display: flex; align-items: center; gap: 5px; }
.nav-btn { font-size: 11px; color: var(--text-secondary); border: 1px solid var(--border); border-radius: 5px; padding: 1px 7px; }
.nav-btn:hover { color: var(--accent); border-color: var(--accent); }
.nav-count { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--text-muted); }
.ctl { font-size: 11px; color: var(--text-muted); border: 1px solid var(--border); border-radius: 6px; padding: 3px 9px; white-space: nowrap; }
.ctl:hover { color: var(--text-primary); }
.ctl.active { color: var(--accent); border-color: var(--accent); background: var(--accent-dim); }

.identity-note { padding: 6px 14px; font-size: 10.5px; color: var(--text-muted); font-family: 'JetBrains Mono', monospace; border-bottom: 1px solid var(--border-subtle); }
.identity-note.warn { color: var(--orange); }

/* --- Agac ---------------------------------------------------------------- */
.tree { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.canvas { position: relative; width: 100%; }
.vrow { position: absolute; top: 0; left: 0; width: 100%; }

.row { display: flex; align-items: center; gap: 6px; padding: 5px 12px; border-bottom: 1px solid var(--border-subtle); cursor: pointer; font-family: 'JetBrains Mono', monospace; font-size: 12px; }
.row:hover { background: var(--bg-secondary); }
.row:hover .goto { opacity: 1; }
/* Satirin solundaki cizgi degisim turunu tasir; glyph ve baslik da ayni bilgiyi verir. */
.row.k-added { box-shadow: inset 2px 0 0 var(--green); }
.row.k-removed { box-shadow: inset 2px 0 0 var(--red); }
.row.k-changed { box-shadow: inset 2px 0 0 var(--orange); }
.row.k-moved { box-shadow: inset 2px 0 0 var(--purple); }

.row.folded { color: var(--text-muted); font-size: 11px; font-style: italic; border-bottom: 1px solid var(--border-subtle); }
.row.folded:hover { color: var(--accent); }

.indent { flex-shrink: 0; }
.caret { width: 14px; flex-shrink: 0; color: var(--text-muted); font-size: 10px; }
.caret-ph { width: 14px; flex-shrink: 0; }
.glyph { width: 12px; flex-shrink: 0; text-align: center; font-weight: 700; }
.k-added .glyph { color: var(--green); }
.k-removed .glyph { color: var(--red); }
.k-changed .glyph { color: var(--orange); }
.k-moved .glyph { color: var(--purple); }
.k-unchanged .glyph { color: var(--border); }
.key { color: var(--color-key); font-weight: 500; flex-shrink: 0; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.type { font-size: 9.5px; color: var(--text-muted); text-transform: uppercase; flex-shrink: 0; }
.label { font-size: 10.5px; color: var(--cyan); background: var(--bg-tertiary); border-radius: 10px; padding: 0 7px; flex-shrink: 0; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.badges { display: flex; gap: 4px; flex-shrink: 0; }
.badge { font-size: 10px; border-radius: 10px; padding: 0 6px; }
.badge.added { color: var(--green); background: var(--bg-array); }
.badge.removed { color: var(--red); background: var(--red-soft); }
.badge.changed { color: var(--orange); background: var(--bg-null); }
.badge.moved { color: var(--purple); background: var(--bg-object); }

.values { display: flex; align-items: center; gap: 6px; min-width: 0; }
.old { color: var(--red); text-decoration: line-through; text-decoration-color: var(--border); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.new { color: var(--green); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.arrow { color: var(--text-muted); flex-shrink: 0; }
.same-value { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.move-note { font-size: 10px; color: var(--purple); flex-shrink: 0; }
.row-spacer { flex: 1; }
.goto { font-size: 11px; color: var(--accent); opacity: 0; flex-shrink: 0; padding: 0 4px; }

.full { display: flex; gap: 10px; padding: 8px 12px 10px 40px; background: var(--bg-secondary); border-bottom: 1px solid var(--border-subtle); }
.full-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.full-head { font-size: 9.5px; text-transform: uppercase; letter-spacing: .5px; color: var(--text-muted); }
.full-col.old .full-head { color: var(--red); }
.full-col.new .full-head { color: var(--green); }
.full-text { margin: 0; font-family: 'JetBrains Mono', monospace; font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 260px; overflow-y: auto; color: var(--text-primary); }

.note { padding: 20px 16px; font-size: 12.5px; line-height: 1.6; color: var(--text-muted); max-width: 620px; }
.note.same { color: var(--green); }

.diff-foot { display: flex; align-items: center; gap: 14px; min-height: 32px; padding: 0 14px; background: var(--bg-secondary); border-top: 1px solid var(--border); flex-shrink: 0; }
.foot-item { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--text-primary); }
.foot-item.muted { color: var(--text-muted); }

@media (max-width: 1280px) {
  .share-field { width: 130px; }
  .side-name { max-width: 130px; }
}
</style>
