<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, provide, ref, shallowRef, watch } from 'vue'
import { COMMENTS, SELECT_FIELD } from './utils/injection'
import { useComments } from './composables/useComments'
import type { AnnotateResponse, JsonObject, JsonValue, ViewMode } from './types'
import { annotateJson, createShare, getShare } from './api'
import { countNodes, describeParseError, findNodePath, parseJson, toSchemaPath } from './utils/json'
import { buildSearchIndex, EMPTY_SEARCH } from './utils/search'
import { buildRefIndex, EMPTY_REF_INDEX } from './utils/references'
import { isObjectArray } from './utils/flatten'
import { tryRepair } from './utils/repair'
import { pushRecent, readRecents, readTheme, writeTheme, type RecentFile, type Theme } from './utils/storage'
import JsonTree from './components/JsonTree.vue'
import JsonGrid from './components/JsonGrid.vue'
import IataPanel from './components/IataPanel.vue'
import EditorPane from './components/EditorPane.vue'
import EmptyState from './components/EmptyState.vue'
import ArrayTable from './components/ArrayTable.vue'

const SAMPLE_JSON = `{
  "IATA_OrderViewRS": {
    "Response": {
      "Order": [
        {
          "OrderID": "ABC123",
          "OwnerCode": "TK",
          "TotalPrice": {
            "TotalAmount": 1250.50,
            "CurCode": "EUR"
          }
        }
      ],
      "Warning": [
        { "DescText": "Partial availability" }
      ]
    }
  }
}`

/** Agacin kok dugumune verilen etiket; arama yollari da bu onekle kurulur. */
const ROOT_KEY = 'json'

// Uygulama bos durumla acilir (tasarimin 1. ekrani); ornek oradan yuklenir.
const rawInput = ref('')
const fileName = ref<string | null>(null)
const viewMode = ref<ViewMode>('grid')
const arrayTableMode = ref(false)
const searchInput = ref('')
const searchTerm = ref('')
const filterMatches = ref(false)
const activeIndex = ref(0)
const editorVisible = ref(true)
const iataVisible = ref(true)
// Kullanici paneli elle actiysa/kapattiysa genislik degisimi bu karari ezmez.
const editorPinned = ref(false)
const iataPinned = ref(false)
const recents = ref<RecentFile[]>(readRecents())

const theme = ref<Theme>(readTheme())

// Tema kok elemandaki data-theme ile degisir; tum renkler oradaki token setinden okunur.
watch(theme, (value) => {
  document.documentElement.dataset.theme = value
  writeTheme(value)
}, { immediate: true })

const shareUrl = ref<string | null>(null)
const shareCopied = ref(false)
const shareLoading = ref(false)
const shareError = ref<string | null>(null)
const shareMenuOpen = ref(false)
const loadError = ref<string | null>(null)

const shareTitle = ref('')
const shareCommentsEnabled = ref(true)
const sharedId = ref<string | null>(null)
const sharedTitle = ref<string | null>(null)
const sharedAt = ref<string | null>(null)
const sharedLoading = ref(false)
const isShared = computed(() => sharedId.value !== null)

const sharedAtLabel = computed(() => {
  if (!sharedAt.value) return null
  const date = new Date(sharedAt.value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString('tr-TR')
})

const annotation = ref<AnnotateResponse | null>(null)
const annotationLoading = ref(false)
const annotationError = ref<string | null>(null)

const fileInputRef = ref<HTMLInputElement | null>(null)
const filterInputRef = ref<HTMLInputElement | null>(null)
const gridRef = ref<InstanceType<typeof JsonGrid> | null>(null)

// Her tus vurusunda tum belgeyi ayristirmamak icin girisi geciktiriyoruz;
// paylasim/dosya yukleme gibi programatik degisikliklerde aninda uygulanir.
const parsedInput = ref(rawInput.value)
let parseTimer: ReturnType<typeof setTimeout> | null = null

watch(rawInput, (value) => {
  if (parseTimer) clearTimeout(parseTimer)
  parseTimer = setTimeout(() => { parsedInput.value = value }, 200)
})

function applyInputNow(value: string) {
  if (parseTimer) clearTimeout(parseTimer)
  rawInput.value = value
  parsedInput.value = value
}

/**
 * Ayristirma sonucu ve suresi birlikte tutuluyor: sure alt durum cubugunda
 * gosterilecegi icin olcumun ayristirmayla ayni geciste yapilmasi gerekiyor.
 */
// shallowRef: JsonValue ozyinelemeli oldugu icin derin unwrap tip cozumunu patlatiyor,
// ustelik agacin ic dugumlerinin reaktif olmasina da gerek yok.
const parseState = shallowRef<{ data: JsonValue | null; error: string | null; ms: number }>({
  data: null, error: null, ms: 0,
})

watch(parsedInput, (text) => {
  const started = performance.now()
  const result = parseJson(text)
  parseState.value = { ...result, ms: performance.now() - started }
}, { immediate: true })

const parsed = computed(() => parseState.value.data)
const parseError = computed(() => parseState.value.error)
const hasData = computed(() => parsed.value !== null)
const nodeCount = computed(() => (parsed.value !== null ? countNodes(parsed.value) : 0))

const errorDetail = computed(() =>
  parseError.value ? describeParseError(parseError.value, parsedInput.value) : null,
)

/** Dugum yolundan o alanin XSD bilgisini bulan arama fonksiyonu. */
const docLookup = computed(() => {
  const byPath = new Map((annotation.value?.fields ?? []).map(field => [field.path, field]))
  const messageType = annotation.value?.messageType ?? null
  return (nodePath: string) => byPath.get(toSchemaPath(nodePath, ROOT_KEY, messageType))
})

/** Sema isaretleri yalnizca sunucudan alan listesi geldiyse anlamli. */
const schemaKnown = computed(
  () => annotation.value?.schemaLoaded === true && (annotation.value?.fields.length ?? 0) > 0,
)

const searchIndex = computed(() =>
  parsed.value !== null && searchTerm.value.trim()
    ? buildSearchIndex(parsed.value, searchTerm.value, ROOT_KEY)
    : EMPTY_SEARCH,
)
/** NDC referanslarini (PaxRefID -> DataLists) cozmek icin ID indeksi. */
const refIndex = computed(() =>
  parsed.value !== null ? buildRefIndex(parsed.value, ROOT_KEY) : EMPTY_REF_INDEX,
)

/**
 * Odak istegi. Yalnizca yolu tutsaydik ayni hedefe ikinci kez atlamak izleyicileri
 * tetiklemezdi; sira numarasi her istegi benzersiz kilar.
 */
const focusRequest = ref<{ path: string; seq: number } | null>(null)
let focusSeq = 0

// --- Yorumlar ----------------------------------------------------------------

const comments = useComments(sharedId)
const openThreadPath = ref<string | null>(null)

provide(COMMENTS, {
  // Yorumlar bir paylasima baglidir; yerel JSON'da yorum yoktur.
  available: computed(() => isShared.value),
  enabled: comments.enabled,
  openPath: openThreadPath,
  author: comments.author,
  commentsFor: (path: string) => comments.byPath.value.get(path) ?? [],
  countFor: (path: string) => comments.byPath.value.get(path)?.length ?? 0,
  toggle: (path: string) => {
    openThreadPath.value = openThreadPath.value === path ? null : path
  },
  add: (payload) => { void comments.add(payload.path, payload.body, payload.parentId) },
  remove: (id: number) => { void comments.remove(id) },
  canDelete: comments.canDelete,
})

/** Yorum birakilmis alanlar arasinda gezinme. */
function goToComment(step: number) {
  const paths = comments.commentedPaths.value
  if (paths.length === 0) return
  const current = openThreadPath.value ? paths.indexOf(openThreadPath.value) : -1
  const next = (current + step + paths.length) % paths.length
  openThreadPath.value = paths[next]
  focusOnPath(paths[next])
}

// --- Secim, breadcrumb ve odak ----------------------------------------------

const selectedNodePath = ref<string | null>(null)
provide(SELECT_FIELD, (path: string | null) => { selectedNodePath.value = path })

const selectedSchemaPath = computed(() =>
  selectedNodePath.value
    ? toSchemaPath(selectedNodePath.value, ROOT_KEY, annotation.value?.messageType ?? null)
    : null,
)

/** Bağlam şeridi; kok etiketi atilir, cok derin yollarda bas kirpilir. */
const crumbs = computed(() => {
  const segments = (selectedNodePath.value ?? ROOT_KEY).split('.').slice(1)
  if (segments.length === 0) return [{ label: ROOT_KEY, last: true }]
  const trimmed = segments.length > 6 ? ['…', ...segments.slice(-6)] : segments
  return trimmed.map((label, index) => ({ label, last: index === trimmed.length - 1 }))
})

const pathCopied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

async function copySelectedPath() {
  const path = selectedNodePath.value ?? ROOT_KEY
  try {
    await navigator.clipboard.writeText(path)
    pathCopied.value = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { pathCopied.value = false }, 1500)
  } catch {
    pathCopied.value = false
  }
}

/** Bir JSON yolundaki degeri okur; Tablo modu icin gerekli. */
function valueAt(path: string): JsonValue | undefined {
  if (parsed.value === null) return undefined
  let current: JsonValue = parsed.value
  for (const segment of path.split('.').slice(1)) {
    if (current === null || typeof current !== 'object') return undefined
    current = Array.isArray(current)
      ? (current[Number(segment)] as JsonValue)
      : (current as JsonObject)[segment]
    if (current === undefined) return undefined
  }
  return current
}

/** Tam ekran Tablo modunda gosterilecek dizi; secimden yukari dogru aranir. */
const tablePath = ref<string | null>(null)

const tableCandidate = computed(() => {
  const segments = (selectedNodePath.value ?? '').split('.')
  for (let i = segments.length; i > 1; i--) {
    const path = segments.slice(0, i).join('.')
    const value = valueAt(path)
    if (value !== undefined && isObjectArray(value)) return path
  }
  return null
})

const tableItems = computed(() => {
  const path = tablePath.value
  if (!path) return null
  const value = valueAt(path)
  return value !== undefined && isObjectArray(value) ? value : null
})

function openTable(path: string) {
  tablePath.value = path
  viewMode.value = 'table'
}

function setViewMode(mode: ViewMode) {
  if (mode === 'table') {
    const path = tablePath.value ?? tableCandidate.value
    if (!path) return
    openTable(path)
    return
  }
  viewMode.value = mode
}

/** IATA panelindeki XSD yolunu goruntuleyicideki dugume cevirip oraya atlar. */
function focusUnmatched(schemaPath: string) {
  if (parsed.value === null) return
  const nodePath = findNodePath(
    parsed.value, ROOT_KEY, annotation.value?.messageType ?? null, schemaPath,
  )
  if (nodePath) focusOnPath(nodePath)
}

function focusOnPath(path: string) {
  // Tablo modundayken hedef satir grid'de; once grid'e donuyoruz.
  if (viewMode.value === 'table') viewMode.value = 'grid'
  selectedNodePath.value = path
  focusRequest.value = { path, seq: ++focusSeq }
}

// --- Arama -------------------------------------------------------------------

const matchCount = computed(() => searchIndex.value.matches.length)
const activePath = computed(() => searchIndex.value.matches[activeIndex.value] ?? null)

// Yeni bir sonuc kumesinde her zaman ilk eslesmeden basla.
watch(searchIndex, () => { activeIndex.value = 0 })

let searchTimer: ReturnType<typeof setTimeout> | null = null

// Her tus vurusunda tum agaci taramamak icin arama terimini geciktiriyoruz.
watch(searchInput, (value) => {
  if (searchTimer) clearTimeout(searchTimer)
  if (!value) {
    searchTerm.value = ''
    return
  }
  searchTimer = setTimeout(() => { searchTerm.value = value }, 150)
})

function goToMatch(step: number) {
  if (matchCount.value === 0) return
  activeIndex.value = (activeIndex.value + step + matchCount.value) % matchCount.value
  const path = searchIndex.value.matches[activeIndex.value]
  if (path && viewMode.value === 'grid') focusOnPath(path)
}

function clearSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchInput.value = ''
  searchTerm.value = ''
  activeIndex.value = 0
}

const filterHint = computed(() => {
  if (!searchTerm.value) return 'Ctrl+F'
  if (matchCount.value === 0) return 'yok'
  return `${activeIndex.value + 1}/${matchCount.value}`
})

const matchPercent = computed(() => {
  if (!annotation.value?.messageType) return null
  return Math.round((annotation.value.confidence ?? 0) * 100)
})

// --- Veri yukleme ------------------------------------------------------------

let annotateTimer: ReturnType<typeof setTimeout> | null = null

async function loadFromShareId(id: string) {
  sharedLoading.value = true
  try {
    loadError.value = null
    const share = await getShare(id)
    applyInputNow(JSON.stringify(share.json, null, 2))
    sharedId.value = share.id
    sharedTitle.value = share.title
    sharedAt.value = share.createdAt
    fileName.value = share.title ?? `paylaşım-${share.id}.json`
  } catch (e) {
    loadError.value = (e as Error).message
    sharedId.value = null
    sharedTitle.value = null
    sharedAt.value = null
  } finally {
    sharedLoading.value = false
  }
}

// Paylasilan JSON degistirilemez; duzenlemek isteyen kullanici yerel bir kopya uzerinde calisir.
function forkShared() {
  sharedId.value = null
  sharedTitle.value = null
  sharedAt.value = null
  shareUrl.value = null
  const url = new URL(window.location.href)
  url.searchParams.delete('s')
  window.history.replaceState({}, '', url.pathname + url.search)
}

async function runAnnotation(json: JsonValue) {
  annotationLoading.value = true
  annotationError.value = null
  try {
    annotation.value = await annotateJson(json)
  } catch (e) {
    annotationError.value = (e as Error).message
    annotation.value = null
  } finally {
    annotationLoading.value = false
  }
}

watch(parsed, (json) => {
  if (annotateTimer) clearTimeout(annotateTimer)
  if (json === null) {
    annotation.value = null
    return
  }
  annotateTimer = setTimeout(() => runAnnotation(json), 400)
})

// Veri degisince tabloya kilitlenmis gorunum gecersiz kalabilir.
watch(parsed, () => {
  tablePath.value = null
  if (viewMode.value === 'table') viewMode.value = 'grid'
})

onMounted(async () => {
  const params = new URLSearchParams(window.location.search)
  const shareId = params.get('s')
  if (shareId) {
    await loadFromShareId(shareId)
  }
  // Yukleme basarisiz olsa da elimizdeki JSON icin aciklamalari getir; watch'in
  // bekleyen cagrisini iptal edip tek seferde calistiriyoruz.
  if (annotateTimer) {
    clearTimeout(annotateTimer)
    annotateTimer = null
  }
  if (parsed.value !== null) {
    await runAnnotation(parsed.value)
  }
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', applyResponsivePanels)
  applyResponsivePanels()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', applyResponsivePanels)
})

/**
 * Dar ekranda once IATA paneli (<1280px), sonra editor (<1024px) kapanir;
 * ekran genisleyince geri gelir. Kullanici alt cubuktan elle bir karar verdiyse
 * o karar korunur — yoksa panel kullanicinin sirtindan acilip kapanirdi.
 */
function applyResponsivePanels() {
  const width = window.innerWidth
  if (!iataPinned.value) iataVisible.value = width >= 1280
  if (!editorPinned.value) editorVisible.value = width >= 1024
}

function toggleEditor() {
  editorVisible.value = !editorVisible.value
  editorPinned.value = true
}

function toggleIata() {
  iataVisible.value = !iataVisible.value
  iataPinned.value = true
}

function readFile(file: File) {
  const reader = new FileReader()
  reader.onload = (event) => {
    const text = event.target?.result as string
    applyInputNow(text)
    fileName.value = file.name
    recents.value = pushRecent(file.name, text)
  }
  reader.readAsText(file)
}

function handleFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) readFile(file)
  // Ayni dosya arka arkaya secilebilsin diye girdi sifirlanir.
  input.value = ''
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  const file = event.dataTransfer?.files?.[0]
  if (file) readFile(file)
}

function openRecent(file: RecentFile) {
  if (file.content === undefined) {
    // Icerik saklanmayacak kadar buyuktu; kullanici dosyayi yeniden secer.
    loadError.value = `${file.name} çok büyük olduğu için saklanmadı, dosyayı yeniden seçin.`
    fileInputRef.value?.click()
    return
  }
  applyInputNow(file.content)
  fileName.value = file.name
  recents.value = pushRecent(file.name, file.content)
}

function handleFormat() {
  if (!parsed.value) return
  applyInputNow(JSON.stringify(parsed.value, null, 2))
}

function handleMinify() {
  if (!parsed.value) return
  applyInputNow(JSON.stringify(parsed.value))
}

function handleClear() {
  applyInputNow('')
  clearSearch()
  shareUrl.value = null
  fileName.value = null
  selectedNodePath.value = null
}

function loadSample() {
  applyInputNow(SAMPLE_JSON)
  fileName.value = 'ornek.json'
}

/**
 * Logo tiklamasi: bos duruma (ana sayfa) doner. Ustunde calisilan JSON once
 * "Son açılanlar"a yazilir — tek tikla geri alinabilsin diye; yoksa logo
 * kullanicinin isini sessizce silen bir dugme olurdu.
 */
function goHome() {
  if (isShared.value) {
    window.location.href = window.location.pathname
    return
  }
  const text = rawInput.value.trim()
  if (text) {
    recents.value = pushRecent(fileName.value ?? 'yapıştırılan.json', rawInput.value)
  }
  handleClear()
}

/** "Otomatik düzelt ve dene": yorum, fazla virgul ve tek tirnak onarilir. */
function handleRepair() {
  const repaired = tryRepair(rawInput.value)
  if (repaired === null) {
    loadError.value = 'Otomatik düzeltme bu hatayı çözemedi; hatalı satırı elle düzeltin.'
    return
  }
  loadError.value = null
  applyInputNow(repaired)
}

async function handleShare() {
  if (!parsed.value || isShared.value) return
  shareLoading.value = true
  shareError.value = null
  shareCopied.value = false
  try {
    const result = await createShare(parsed.value, shareTitle.value, shareCommentsEnabled.value)
    shareUrl.value = result.url
    shareMenuOpen.value = false
    try {
      await navigator.clipboard.writeText(result.url)
      shareCopied.value = true
    } catch {
      shareCopied.value = false
    }
  } catch (e) {
    shareError.value = (e as Error).message
  } finally {
    shareLoading.value = false
  }
}

// --- Alt durum cubugu --------------------------------------------------------

const gridStats = ref({ total: 0, rendered: 0 })

// --- Klavye ------------------------------------------------------------------

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
}

function onKeydown(event: KeyboardEvent) {
  const meta = event.metaKey || event.ctrlKey
  if (meta && (event.key === 'k' || event.key === 'f')) {
    event.preventDefault()
    filterInputRef.value?.focus()
    filterInputRef.value?.select()
    return
  }
  if (event.key === 'Escape') {
    if (searchInput.value) clearSearch()
    shareMenuOpen.value = false
    return
  }
  if (isTypingTarget(event.target) || meta || event.altKey) return
  if (event.key === 'j' || event.key === 'J') {
    event.preventDefault()
    gridRef.value?.moveSelection(1)
  } else if (event.key === 'k' || event.key === 'K') {
    event.preventDefault()
    gridRef.value?.moveSelection(-1)
  }
}

// --- Basliktaki dosya adi ----------------------------------------------------

const displayName = computed(() => fileName.value ?? (rawInput.value.trim() ? 'girdi.json' : ''))
</script>

<template>
  <div class="app">
    <header class="header">
      <button class="brand" title="Ana sayfa — yeni JSON" @click="goHome">
        <svg width="26" height="26" viewBox="0 0 24 24">
          <rect x="1" y="1" width="22" height="22" rx="6" fill="var(--accent)" opacity=".14" />
          <ellipse cx="12" cy="12" rx="8" ry="5.2" fill="none" stroke="var(--accent)" stroke-width="1.6" />
          <circle cx="12" cy="12" r="2.7" fill="var(--accent)" />
          <circle cx="13.4" cy="10.6" r="0.9" fill="var(--bg-primary)" />
        </svg>
        <span class="wordmark">JSON <span class="wordmark-accent">EYES</span></span>
      </button>
      <div class="divider" />

      <div v-if="displayName" class="file">
        <span class="file-name">{{ displayName }}</span>
        <span v-if="hasData" class="valid-badge"><span class="dot" />geçerli</span>
        <span v-else-if="parseError" class="valid-badge bad"><span class="dot" />geçersiz</span>
      </div>

      <span v-if="isShared" class="lock-badge" :title="sharedAtLabel ? `Paylaşım: ${sharedAtLabel}` : undefined">
        🔒 salt okunur
      </span>

      <div class="command-wrap">
        <button class="command" @click="filterInputRef?.focus()">
          <span class="command-icon">⌕</span>
          <span class="command-text" :class="{ filled: searchTerm }">
            {{ searchTerm || 'Alan, değer veya komut' }}
          </span>
          <span v-if="searchTerm" class="command-count">{{ filterHint }}</span>
          <span class="command-key">Ctrl K</span>
        </button>
      </div>

      <span v-if="isShared && comments.total.value > 0" class="comment-total">
        <button class="comment-nav" title="Önceki yorum" @click="goToComment(-1)">↑</button>
        💬 {{ comments.total.value }}
        <button class="comment-nav" title="Sonraki yorum" @click="goToComment(1)">↓</button>
      </span>

      <button class="theme-btn" :title="theme === 'dark' ? 'Aydınlık temaya geç' : 'Karanlık temaya geç'" @click="theme = theme === 'dark' ? 'light' : 'dark'">
        {{ theme === 'dark' ? '☀' : '☾' }}
      </button>

      <div class="mode-switch">
        <button class="mode" :class="{ active: viewMode === 'tree' }" @click="setViewMode('tree')">Tree</button>
        <button class="mode" :class="{ active: viewMode === 'grid' }" @click="setViewMode('grid')">Grid</button>
        <button
          class="mode"
          :class="{ active: viewMode === 'table' }"
          :disabled="!tablePath && !tableCandidate"
          :title="tablePath || tableCandidate
            ? 'Seçili nesne dizisini tam ekran tabloda aç'
            : 'Önce grid\'de bir nesne dizisi seçin — dizi satırlarında ⊞ tablo rozeti çıkar'"
          @click="setViewMode('table')"
        >Tablo</button>
      </div>

      <div v-if="!isShared" class="share-wrap">
        <button class="share-btn" :disabled="!hasData || shareLoading" @click="shareMenuOpen = !shareMenuOpen">
          {{ shareLoading ? '…' : 'Paylaş' }}
        </button>
        <div v-if="shareMenuOpen" class="share-menu">
          <label class="share-label">Başlık (isteğe bağlı)</label>
          <input v-model="shareTitle" class="share-input" type="text" maxlength="120" @keydown.enter="handleShare" />
          <label class="share-check">
            <input v-model="shareCommentsEnabled" type="checkbox" />
            Yorumlara açık olsun
          </label>
          <p class="share-note">Link salt okunur açılır; veriyi kimse değiştiremez.</p>
          <button class="share-confirm" :disabled="shareLoading" @click="handleShare">
            {{ shareLoading ? 'Paylaşılıyor…' : 'Link oluştur' }}
          </button>
        </div>
      </div>
      <button v-else class="fork-btn" @click="forkShared">Kopyasını al ve düzenle</button>
    </header>

    <div v-if="shareUrl" class="banner accent">
      {{ shareCopied ? 'Link kopyalandı —' : 'Link oluşturuldu (kopyalanamadı) —' }}
      <a :href="shareUrl" target="_blank" class="banner-link">{{ shareUrl }}</a>
      <span class="banner-note">Açan herkes yorum bırakabilir, veriyi değiştiremez.</span>
      <button class="banner-close" @click="shareUrl = null">×</button>
    </div>
    <div v-if="isShared" class="banner accent">
      <strong v-if="sharedTitle" class="banner-strong">{{ sharedTitle }}</strong>
      Paylaşılmış görünüm — düzenleme kapalı.
      <span v-if="sharedAtLabel" class="banner-note">Paylaşım: {{ sharedAtLabel }}</span>
      <button class="banner-action" @click="forkShared">Kopyasını al ve düzenle</button>
    </div>
    <div v-if="shareError" class="banner bad">{{ shareError }}<button class="banner-close" @click="shareError = null">×</button></div>
    <div v-if="loadError" class="banner bad">{{ loadError }}<button class="banner-close" @click="loadError = null">×</button></div>

    <div v-if="hasData" class="crumbs-bar">
      <nav class="crumbs">
        <template v-for="(crumb, index) in crumbs" :key="index">
          <span class="crumb" :class="{ last: crumb.last }">{{ crumb.label }}</span>
          <span v-if="!crumb.last" class="crumb-sep">›</span>
        </template>
      </nav>
      <button class="copy-path" @click="copySelectedPath">
        {{ pathCopied ? '✓ kopyalandı' : '⧉ yolu kopyala' }}
      </button>
      <div class="crumbs-spacer" />

      <div class="filter-box">
        <span class="filter-icon">⌕</span>
        <input
          ref="filterInputRef"
          v-model="searchInput"
          class="filter-input"
          type="text"
          placeholder="Bu görünümü filtrele"
          @keydown.enter.prevent="goToMatch($event.shiftKey ? -1 : 1)"
          @keydown.esc="clearSearch"
        />
        <span class="filter-hint" :class="{ empty: searchTerm && matchCount === 0 }">{{ filterHint }}</span>
      </div>
      <button
        class="only-matches"
        :class="{ active: filterMatches }"
        :disabled="!searchTerm"
        title="Yalnızca eşleşen alanları ve onlara giden yolu göster"
        @click="filterMatches = !filterMatches"
      >yalnız eşleşen</button>

      <div class="segment" title="Tablo: nesne dizileri (ör. Response.Order) grid içinde satır satır değil, tek bir tabloda gösterilir">
        <button class="seg-btn" :class="{ 'active-nested': !arrayTableMode }" @click="arrayTableMode = false">İç içe</button>
        <button class="seg-btn" :class="{ 'active-table': arrayTableMode }" @click="arrayTableMode = true">Tablo</button>
      </div>
    </div>

    <div class="workspace">
      <!-- Sol: JSON editoru (paylasilan gorunumde hic render edilmez) -->
      <EditorPane
        v-if="editorVisible && !isShared"
        v-model="rawInput"
        :parse-error="parseError"
        :error-line="errorDetail?.line ?? null"
        :node-count="nodeCount"
        :has-data="hasData"
        :recents="recents"
        @format="handleFormat"
        @minify="handleMinify"
        @sample="loadSample"
        @clear="handleClear"
        @repair="handleRepair"
        @open-recent="openRecent"
        @drop="handleDrop"
        @collapse="toggleEditor"
      />

      <!-- Kapali panelleri geri acan kenar seritleri; kucuk bir dugmeden cok
           daha gorunur ve panelin nerede oldugunu da gosterir. -->
      <button
        v-if="!editorVisible && !isShared"
        class="rail left"
        title="Editörü aç"
        @click="toggleEditor"
      ><span class="rail-glyph">›</span><span class="rail-label">Girdi</span></button>

      <!-- Orta: goruntuleyici -->
      <section class="viewer">
        <div v-if="sharedLoading" class="center-note">Paylaşılan JSON yükleniyor…</div>

        <div v-else-if="parseError" class="center-note error">
          <h2 class="error-title">JSON ayrıştırılamadı</h2>
          <code class="error-code">{{ parseError }}</code>
          <p class="error-hint">Hatalı satır solda işaretlendi. Düzeltince grid kendiliğinden oluşur.</p>
          <button class="error-action" @click="handleRepair">Otomatik düzelt ve dene</button>
        </div>

        <EmptyState
          v-else-if="!hasData"
          :recents="recents"
          @pick-file="fileInputRef?.click()"
          @sample="loadSample"
          @open-recent="openRecent"
          @drop="handleDrop"
        />

        <!--
          Grid mount'ta kalir (v-show): Tablo veya Tree'ye gecip geri donuldugunde
          acilmis dallar ve sayfalama korunsun diye. Diger iki gorunum ise
          maliyetli olduklari icin yalnizca secildiklerinde kurulur.
        -->
        <template v-else>
          <ArrayTable
            v-if="viewMode === 'table' && tableItems"
            :items="tableItems"
            :path="tablePath!"
            variant="full"
            @focus-path="focusOnPath"
            @close="viewMode = 'grid'"
          />

          <div v-else-if="viewMode === 'tree'" class="tree-scroll">
            <JsonTree
              :data="parsed!"
              :root-key="ROOT_KEY"
              :search-term="searchTerm"
              :doc-lookup="docLookup"
              :search="searchIndex"
              :active-path="activePath"
              :filter-matches="filterMatches"
              :ref-index="refIndex"
              :focus-request="focusRequest"
              @focus-path="focusOnPath"
            />
          </div>

          <JsonGrid
            v-show="viewMode === 'grid'"
            ref="gridRef"
            :data="parsed!"
            :root-key="ROOT_KEY"
            :search-term="searchTerm"
            :doc-lookup="docLookup"
            :filter-matches="filterMatches"
            :array-table-mode="arrayTableMode"
            :ref-index="refIndex"
            :search="searchIndex"
            :focus-request="focusRequest"
            :selected-path="selectedNodePath"
            :schema-known="schemaKnown"
            @focus-path="focusOnPath"
            @expand-table="openTable"
            @stats="gridStats = $event"
          />
        </template>
      </section>

      <!-- Sag: IATA paneli -->
      <button
        v-if="!iataVisible && hasData"
        class="rail right"
        title="IATA panelini aç"
        @click="toggleIata"
      ><span class="rail-glyph">‹</span><span class="rail-label">IATA</span></button>

      <IataPanel
        v-if="iataVisible && hasData"
        :annotation="annotation"
        :loading="annotationLoading"
        :error="annotationError"
        :selected-path="selectedSchemaPath"
        @focus-path="focusUnmatched"
        @collapse="toggleIata"
      />
    </div>

    <footer class="status-bar">
      <span v-if="hasData" class="stat">{{ nodeCount.toLocaleString('tr-TR') }} node</span>
      <span v-if="hasData" class="stat">ayrıştırma {{ Math.round(parseState.ms) }} ms</span>
      <span v-if="viewMode === 'grid'" class="stat">{{ gridStats.rendered }}/{{ gridStats.total }} satır render</span>
      <span v-if="annotation?.messageType" class="stat">{{ annotation.messageType }} %{{ matchPercent }}</span>
      <div class="status-spacer" />
      <span class="stat">Ctrl+K komutlar · Ctrl+F filtre · J/K satır</span>
    </footer>

    <input ref="fileInputRef" type="file" accept=".json,application/json" hidden @change="handleFile" />
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100vh; background: var(--bg-primary); overflow: hidden; }

/* --- Ust bar --------------------------------------------------------------- */
.header { display: flex; align-items: center; gap: 14px; padding: 0 16px; height: var(--header-h); background: var(--bg-secondary); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.brand { display: flex; align-items: center; gap: 9px; flex-shrink: 0; border-radius: 8px; padding: 2px 4px; }
.brand:hover { background: var(--bg-tertiary); }
.wordmark { font-size: 15.5px; font-weight: 700; letter-spacing: .2px; white-space: nowrap; }
.wordmark-accent { color: var(--accent); }
.divider { width: 1px; height: 22px; background: var(--border); flex-shrink: 0; }

.file { display: flex; align-items: center; gap: 10px; min-width: 0; }
.file-name { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 190px; }
.valid-badge { display: flex; align-items: center; gap: 5px; font-size: 10.5px; color: var(--green); background: var(--bg-array); border-radius: 20px; padding: 2px 8px; white-space: nowrap; }
.valid-badge.bad { color: var(--red); background: var(--red-wash); }
.dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.lock-badge { display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: var(--text-secondary); background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: 20px; padding: 3px 9px; white-space: nowrap; }

.command-wrap { flex: 1; display: flex; justify-content: center; min-width: 0; }
.command { display: flex; align-items: center; gap: 8px; width: 360px; max-width: 100%; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 9px; padding: 7px 11px; }
.command:hover { border-color: var(--accent); }
.command-icon { color: var(--text-muted); font-size: 12px; }
.command-text { flex: 1; min-width: 0; font-size: 12.5px; color: var(--text-muted); text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.command-text.filled { color: var(--text-primary); }
.command-count { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--accent); }
.command-key { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--text-muted); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; white-space: nowrap; }

.comment-total { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--purple); background: var(--bg-object); border-radius: 20px; padding: 4px 10px; white-space: nowrap; }
.comment-nav { color: var(--purple); font-size: 11px; line-height: 1; }
.comment-nav:hover { color: var(--text-primary); }

.theme-btn { font-size: 14px; line-height: 1; color: var(--text-muted); border: 1px solid var(--border); border-radius: 8px; width: 30px; height: 30px; flex-shrink: 0; }
.theme-btn:hover { color: var(--accent); border-color: var(--accent); }

.mode-switch { display: flex; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 8px; padding: 3px; gap: 2px; flex-shrink: 0; }
.mode { padding: 5px 11px; border-radius: 6px; font-size: 12.5px; color: var(--text-muted); }
.mode:hover:not(:disabled) { color: var(--text-primary); }
.mode.active { background: var(--bg-tertiary); color: var(--text-primary); }
.mode:disabled { opacity: .35; cursor: not-allowed; }

.share-wrap { position: relative; flex-shrink: 0; }
.share-btn { font-size: 12.5px; font-weight: 600; color: var(--bg-primary); background: var(--accent); border-radius: 7px; padding: 6px 13px; }
.share-btn:hover:not(:disabled) { background: var(--cyan); }
.share-btn:disabled { opacity: .4; cursor: not-allowed; }
.share-menu { position: absolute; top: calc(100% + 8px); right: 0; z-index: 20; width: 260px; display: flex; flex-direction: column; gap: 7px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
.share-label { font-size: 11px; color: var(--text-muted); }
.share-input { background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary); font-size: 12px; padding: 6px 9px; outline: none; }
.share-input:focus { border-color: var(--accent); }
.share-check { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--text-secondary); cursor: pointer; }
.share-check input { accent-color: var(--accent); cursor: pointer; }
.share-note { font-size: 11px; color: var(--text-muted); line-height: 1.4; }
.share-confirm { font-size: 12px; font-weight: 600; color: var(--bg-primary); background: var(--accent); border-radius: 6px; padding: 6px 12px; }
.fork-btn { font-size: 12px; color: var(--accent); border: 1px solid var(--border); border-radius: 6px; padding: 5px 11px; white-space: nowrap; }
.fork-btn:hover { background: var(--accent-dim); }

/* --- Bantlar --------------------------------------------------------------- */
.banner { display: flex; align-items: center; gap: 10px; padding: 9px 16px; font-size: 12.5px; flex-shrink: 0; border-bottom: 1px solid var(--border-subtle); }
.banner.accent { background: var(--accent-wash); color: var(--accent); }
.banner.bad { background: var(--red-soft); color: var(--red); }
.banner-link { font-family: 'JetBrains Mono', monospace; color: inherit; }
.banner-note { font-size: 11.5px; color: var(--text-muted); }
.banner-strong { color: var(--text-primary); }
.banner-action { margin-left: auto; font-size: 12px; color: var(--accent); border: 1px solid var(--border); border-radius: 6px; padding: 3px 10px; white-space: nowrap; }
.banner-close { margin-left: auto; color: inherit; font-size: 16px; line-height: 1; opacity: .7; }
.banner-close:hover { opacity: 1; }

/* --- Baglam seridi --------------------------------------------------------- */
.crumbs-bar { display: flex; align-items: center; gap: 8px; height: var(--crumbs-h); padding: 0 16px; background: var(--bg-primary); border-bottom: 1px solid var(--border-subtle); flex-shrink: 0; overflow: hidden; }
.crumbs { display: flex; align-items: center; gap: 5px; min-width: 0; overflow: hidden; }
.crumb { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--text-secondary); white-space: nowrap; }
.crumb.last { color: var(--text-primary); background: var(--bg-tertiary); border-radius: 5px; padding: 2px 7px; }
.crumb-sep { color: var(--border); font-size: 11px; }
.copy-path { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-secondary); border: 1px solid var(--border); border-radius: 6px; padding: 2px 8px; white-space: nowrap; flex-shrink: 0; }
.copy-path:hover { color: var(--accent); border-color: var(--accent); }
.crumbs-spacer { flex: 1; }

.filter-box { display: flex; align-items: center; gap: 6px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 7px; padding: 0 9px; flex-shrink: 0; }
.filter-box:focus-within { border-color: var(--accent); }
.filter-icon { color: var(--text-muted); font-size: 11px; }
.filter-input { width: 190px; background: transparent; border: none; outline: none; color: var(--text-primary); font-family: 'JetBrains Mono', monospace; font-size: 12px; padding: 5px 0; }
.filter-hint { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--text-muted); white-space: nowrap; }
.filter-hint.empty { color: var(--red); }
.only-matches { font-size: 11px; color: var(--text-muted); border: 1px solid var(--border); border-radius: 6px; padding: 3px 9px; white-space: nowrap; flex-shrink: 0; }
.only-matches:hover:not(:disabled) { color: var(--text-primary); }
.only-matches.active { color: var(--accent); border-color: var(--accent); background: var(--accent-dim); }
.only-matches:disabled { opacity: .4; cursor: not-allowed; }

.segment { display: flex; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 7px; padding: 2px; gap: 2px; flex-shrink: 0; }
.seg-btn { padding: 3px 9px; border-radius: 5px; font-size: 11.5px; color: var(--text-muted); }
.seg-btn.active-nested { color: var(--text-primary); background: var(--bg-tertiary); }
.seg-btn.active-table { color: var(--green); background: var(--green-wash); }

/* --- Calisma alani --------------------------------------------------------- */
.workspace { display: flex; flex: 1; min-height: 0; }
.viewer { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--bg-primary); }
.tree-scroll { flex: 1; min-height: 0; overflow: auto; padding: 4px 16px 40px; }

.center-note { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 40px; font-size: 13px; color: var(--text-muted); }
.error-title { font-size: 17px; font-weight: 600; color: var(--red); }
.error-code { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; color: var(--text-secondary); background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; max-width: 560px; text-align: center; word-break: break-word; }
.error-hint { font-size: 13px; color: var(--text-muted); max-width: 360px; text-align: center; text-wrap: pretty; }
.error-action { margin-top: 4px; font-size: 13px; color: var(--accent); background: var(--accent-dim); border-radius: 8px; padding: 8px 18px; }
.error-action:hover { background: var(--accent-strong); }

/* --- Alt durum cubugu ------------------------------------------------------ */
.status-bar { display: flex; align-items: center; gap: 16px; height: var(--status-h); padding: 0 16px; background: var(--bg-secondary); border-top: 1px solid var(--border); flex-shrink: 0; }
.stat { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--text-muted); white-space: nowrap; }
.status-spacer { flex: 1; }

/* Kapali panelin kenar seridi: dikey yazili, tiklanabilir ince bir sutun. */
.rail { display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 10px; width: 26px; flex-shrink: 0; padding-top: 10px; background: var(--bg-secondary); color: var(--text-muted); }
.rail.left { border-right: 1px solid var(--border); }
.rail.right { border-left: 1px solid var(--border); }
.rail:hover { color: var(--accent); background: var(--bg-tertiary); }
.rail-glyph { font-size: 14px; line-height: 1; }
.rail-label { font-size: 10.5px; font-weight: 600; letter-spacing: .5px; writing-mode: vertical-rl; text-orientation: mixed; }

/* Dar ekranlarda once IATA paneli, sonra editor yer birakir. */
@media (max-width: 1280px) {
  .filter-input { width: 130px; }
}
@media (max-width: 1024px) {
  .command-wrap { display: none; }
}
</style>
