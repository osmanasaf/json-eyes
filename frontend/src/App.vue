<script setup lang="ts">
import { computed, onMounted, provide, ref, watch } from 'vue'
import { COMMENTS, SELECT_FIELD } from './utils/injection'
import { useComments } from './composables/useComments'
import type { AnnotateResponse, JsonValue, ViewMode } from './types'
import { annotateJson, createShare, getShare } from './api'
import { countNodes, findNodePath, parseJson, toSchemaPath } from './utils/json'
import { buildSearchIndex, EMPTY_SEARCH } from './utils/search'
import { buildRefIndex, EMPTY_REF_INDEX } from './utils/references'
import JsonTree from './components/JsonTree.vue'
import JsonGrid from './components/JsonGrid.vue'
import IataPanel from './components/IataPanel.vue'

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

const rawInput = ref(SAMPLE_JSON)
const viewMode = ref<ViewMode>('tree')
const searchInput = ref('')
const searchTerm = ref('')
const filterMatches = ref(false)
const activeIndex = ref(0)
const editorCollapsed = ref(false)
const iataVisible = ref(true)

const shareUrl = ref<string | null>(null)
const shareCopied = ref(false)
const shareLoading = ref(false)
const shareError = ref<string | null>(null)
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
  const d = new Date(sharedAt.value)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString('tr-TR')
})

const annotation = ref<AnnotateResponse | null>(null)
const annotationLoading = ref(false)
const annotationError = ref<string | null>(null)

const fileInputRef = ref<HTMLInputElement | null>(null)

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

const parseResult = computed(() => parseJson(parsedInput.value))
const parsed = computed(() => parseResult.value.data)
const parseError = computed(() => parseResult.value.error)
const hasData = computed(() => parsed.value !== null)
const nodeCount = computed(() => (parsed.value !== null ? countNodes(parsed.value) : 0))
/** Dugum yolundan o alanin XSD bilgisini bulan arama fonksiyonu. */
const docLookup = computed(() => {
  const byPath = new Map((annotation.value?.fields ?? []).map(field => [field.path, field]))
  const messageType = annotation.value?.messageType ?? null
  return (nodePath: string) => byPath.get(toSchemaPath(nodePath, ROOT_KEY, messageType))
})

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
 * tetiklemezdi; sira numarasi her istegi benzersiz kilar. (Onceki cozum
 * requestAnimationFrame ile sifirliyordu, ama arka plandaki sekmede rAF calismaz.)
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

/** Uzerine gelinen alan; IATA paneli bunun XSD karsiligini gosterir. */
const selectedNodePath = ref<string | null>(null)
provide(SELECT_FIELD, (path: string | null) => { selectedNodePath.value = path })

const selectedSchemaPath = computed(() =>
  selectedNodePath.value
    ? toSchemaPath(selectedNodePath.value, ROOT_KEY, annotation.value?.messageType ?? null)
    : null,
)

/** IATA panelindeki XSD yolunu goruntuleyicideki dugume cevirip oraya atlar. */
function focusUnmatched(schemaPath: string) {
  if (parsed.value === null) return
  const nodePath = findNodePath(
    parsed.value, ROOT_KEY, annotation.value?.messageType ?? null, schemaPath,
  )
  if (nodePath) focusOnPath(nodePath)
}

function focusOnPath(path: string) {
  focusRequest.value = { path, seq: ++focusSeq }
}

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
}

function clearSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchInput.value = ''
  searchTerm.value = ''
  activeIndex.value = 0
}

const matchPercent = computed(() => {
  if (!annotation.value?.messageType) return null
  return Math.round((annotation.value.confidence ?? 0) * 100)
})

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
  editorCollapsed.value = false
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
})

function readFile(file: File) {
  const reader = new FileReader()
  reader.onload = ev => applyInputNow(ev.target?.result as string)
  reader.readAsText(file)
}

function handleFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) readFile(file)
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (file) readFile(file)
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
}

function loadSample() {
  applyInputNow(SAMPLE_JSON)
}

async function handleShare() {
  if (!parsed.value || isShared.value) return
  shareLoading.value = true
  shareError.value = null
  shareCopied.value = false
  try {
    const result = await createShare(parsed.value, shareTitle.value, shareCommentsEnabled.value)
    shareUrl.value = result.url
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
</script>

<template>
  <div class="app">
    <header class="header">
      <div class="header-left">
        <div class="logo">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="4" fill="var(--accent)" opacity="0.15" />
            <path d="M8 8h2v2H8V8zm0 3h2v2H8v-2zm0 3h2v2H8v-2zm3-6h5v2h-5V8zm0 3h5v2h-5v-2zm0 3h5v2h-5v-2z" fill="var(--accent)" />
          </svg>
          <span class="logo-text">JSON <span class="logo-accent">Sarp</span></span>
        </div>
        <span v-if="isShared" class="shared-badge" :title="sharedAtLabel ? 'Paylaşım tarihi: ' + sharedAtLabel : undefined">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M4 6V4.5a4 4 0 118 0V6h.5A1.5 1.5 0 0114 7.5v6A1.5 1.5 0 0112.5 15h-9A1.5 1.5 0 012 13.5v-6A1.5 1.5 0 013.5 6H4zm1.5 0h5V4.5a2.5 2.5 0 00-5 0V6z"/></svg>
          Salt okunur paylaşım
        </span>
        <span v-if="hasData" class="stat-badge"><span class="dot" />{{ nodeCount.toLocaleString() }} node</span>
        <span v-if="matchPercent !== null" class="match-badge">
          IATA · {{ annotation?.messageType }} · %{{ matchPercent }}
        </span>
      </div>

      <div class="header-center">
        <div class="mode-switch">
          <button class="mode-btn" :class="{ active: viewMode === 'tree' }" @click="viewMode = 'tree'">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.5a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM1 8a1.5 1.5 0 113 0A1.5 1.5 0 011 8zm0 5.5a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM6 3h9v1H6V3zm0 5h9v1H6V8zm0 5h9v1H6v-1z"/></svg>
            Tree
          </button>
          <button class="mode-btn" :class="{ active: viewMode === 'grid' }" @click="viewMode = 'grid'">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M0 2a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H2a2 2 0 01-2-2V2zm5 0v4H1V2h4zm5 0v4H6V2h4zm5 0v4h-4V2h4zM5 7v4H1V7h4zm5 0v4H6V7h4zm5 0v4h-4V7h4zM5 12v3H1v-3h4zm5 0v3H6v-3h4zm5 0v3h-4v-3h4z"/></svg>
            Grid
          </button>
        </div>
      </div>

      <div class="header-right">
        <button v-if="!isShared" class="icon-btn" :class="{ active: !editorCollapsed }" @click="editorCollapsed = !editorCollapsed">
          {{ editorCollapsed ? 'Editörü Aç' : 'Editörü Gizle' }}
        </button>
        <button class="icon-btn" :class="{ active: iataVisible }" @click="iataVisible = !iataVisible">IATA</button>
        <template v-if="!isShared">
          <button class="icon-btn" @click="fileInputRef?.click()">Yükle</button>
          <input
            v-if="hasData"
            v-model="shareTitle"
            class="share-title-input"
            type="text"
            maxlength="120"
            placeholder="Paylaşım başlığı (isteğe bağlı)"
            @keydown.enter="handleShare"
          />
          <label v-if="hasData" class="comments-toggle" title="Linke erişen herkes alanlara yorum bırakabilsin">
            <input v-model="shareCommentsEnabled" type="checkbox" />
            Yorum
          </label>
          <button v-if="hasData" class="icon-btn share-btn" :disabled="shareLoading" @click="handleShare">
            {{ shareLoading ? '...' : 'Paylaş' }}
          </button>
          <input ref="fileInputRef" type="file" accept=".json,application/json" style="display:none" @change="handleFile" />
        </template>
        <template v-else>
          <span v-if="comments.total.value > 0" class="comment-nav">
            <button class="nav-btn" title="Önceki yorum" @click="goToComment(-1)">↑</button>
            <span class="nav-label">{{ comments.total.value }} yorum</span>
            <button class="nav-btn" title="Sonraki yorum" @click="goToComment(1)">↓</button>
          </span>
          <button class="icon-btn fork-btn" @click="forkShared">Kopyasını al ve düzenle</button>
        </template>
      </div>
    </header>

    <div v-if="isShared" class="banner info">
      <strong v-if="sharedTitle" class="banner-title">{{ sharedTitle }}</strong>
      Bu JSON paylaşılmış bir kayıt ve değiştirilemez.
      <span v-if="sharedAtLabel" class="banner-meta">Paylaşım: {{ sharedAtLabel }}</span>
    </div>
    <div v-if="shareUrl" class="banner accent">
      {{ shareCopied ? 'Paylaşım linki kopyalandı:' : 'Paylaşım linki oluşturuldu (kopyalanamadı, elle kopyalayın):' }}
      <a :href="shareUrl" target="_blank">{{ shareUrl }}</a>
      <span class="banner-meta">Link salt okunur açılır.</span>
      <button class="banner-close" @click="shareUrl = null">×</button>
    </div>
    <div v-if="shareError" class="banner error">{{ shareError }}<button class="banner-close" @click="shareError = null">×</button></div>
    <div v-if="loadError" class="banner error">{{ loadError }}<button class="banner-close" @click="loadError = null">×</button></div>

    <div class="workspace">
      <!-- Sol: JSON editoru (paylasilan gorunumde hic render edilmez) -->
      <section v-if="!editorCollapsed && !isShared" class="editor-pane" @drop="handleDrop" @dragover.prevent>
        <div class="pane-head">
          <span class="pane-title">JSON Girişi</span>
          <div class="pane-actions">
            <button class="mini-btn" :disabled="!hasData" @click="handleFormat">Format</button>
            <button class="mini-btn" :disabled="!hasData" @click="handleMinify">Minify</button>
            <button class="mini-btn" @click="loadSample">Örnek</button>
            <button class="mini-btn danger" @click="handleClear">Temizle</button>
          </div>
        </div>
        <textarea
          v-model="rawInput"
          class="editor"
          :class="{ invalid: parseError }"
          placeholder="JSON verisini buraya yapıştırın veya dosya sürükleyin..."
          spellcheck="false"
        />
        <div v-if="parseError" class="editor-status error">
          <span class="status-dot error" /> {{ parseError }}
        </div>
        <div v-else-if="hasData" class="editor-status ok">
          <span class="status-dot ok" /> Geçerli JSON · {{ nodeCount.toLocaleString() }} node
        </div>
      </section>

      <!-- Orta: Tree / Grid goruntuleyici -->
      <section class="viewer-pane">
        <div class="viewer-head">
          <div class="search-wrap">
            <svg class="search-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.7 10.3a6.5 6.5 0 10-1.4 1.4l3.8 3.9a1 1 0 001.5-1.4l-3.9-3.9zM6.5 11a4.5 4.5 0 110-9 4.5 4.5 0 010 9z"/></svg>
            <input
              v-model="searchInput"
              class="search-input"
              type="text"
              placeholder="Değer veya key ara..."
              :disabled="!hasData"
              @keydown.enter.prevent="goToMatch($event.shiftKey ? -1 : 1)"
              @keydown.esc="clearSearch"
            />
            <span v-if="searchTerm" class="search-count" :class="{ empty: matchCount === 0 }">
              {{ matchCount === 0 ? 'eşleşme yok' : `${activeIndex + 1} / ${matchCount}` }}
            </span>
            <button v-if="searchTerm" class="search-nav" title="Önceki eşleşme (Shift+Enter)" :disabled="matchCount === 0" @click="goToMatch(-1)">↑</button>
            <button v-if="searchTerm" class="search-nav" title="Sonraki eşleşme (Enter)" :disabled="matchCount === 0" @click="goToMatch(1)">↓</button>
            <button v-if="searchInput" class="search-clear" title="Aramayı temizle (Esc)" @click="clearSearch">×</button>
          </div>
          <button
            class="filter-btn"
            :class="{ active: filterMatches }"
            :disabled="!searchTerm"
            title="Yalnızca eşleşen alanları ve onlara giden yolu göster"
            @click="filterMatches = !filterMatches"
          >
            Sadece eşleşenler
          </button>
          <span v-if="searchIndex.truncated" class="search-warn">
            İlk {{ matchCount }} eşleşme gösteriliyor; aramayı daraltın.
          </span>
        </div>
        <div class="viewer-body">
          <template v-if="hasData">
            <JsonTree
              v-if="viewMode === 'tree'"
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
            <JsonGrid
              v-else
              :data="parsed!"
              :root-key="ROOT_KEY"
              :search-term="searchTerm"
              :doc-lookup="docLookup"
              :filter-matches="filterMatches"
              :ref-index="refIndex"
              :focus-request="focusRequest"
              @focus-path="focusOnPath"
            />
          </template>
          <div v-else-if="sharedLoading" class="placeholder">
            <p class="ph-title">Paylaşılan JSON yükleniyor...</p>
          </div>
          <div v-else-if="parseError" class="placeholder error">
            <p class="ph-title">Geçersiz JSON</p>
            <p class="ph-detail">{{ parseError }}</p>
          </div>
          <div v-else class="placeholder">
            <p class="ph-title">Görüntülenecek JSON yok</p>
            <p class="ph-detail">Soldaki editöre JSON girin; tree ve grid burada oluşur.</p>
            <button class="ph-btn" @click="loadSample">Örnek JSON yükle</button>
          </div>
        </div>
      </section>

      <!-- Sag: IATA benzerlik paneli -->
      <IataPanel
        v-if="iataVisible"
        :annotation="annotation"
        :loading="annotationLoading"
        :error="annotationError"
        :selected-path="selectedSchemaPath"
        @focus-path="focusUnmatched"
      />
    </div>
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100vh; background: var(--bg-primary); overflow: hidden; }

.header { display: flex; align-items: center; justify-content: space-between; padding: 0 16px; height: 52px; background: var(--bg-secondary); border-bottom: 1px solid var(--border); flex-shrink: 0; gap: 12px; }
.header-left, .header-right { display: flex; align-items: center; gap: 8px; }
.logo { display: flex; align-items: center; gap: 8px; }
.logo-text { font-size: 15px; font-weight: 700; }
.logo-accent { color: var(--accent); }
.stat-badge { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-muted); background: var(--bg-tertiary); padding: 3px 8px; border-radius: 20px; border: 1px solid var(--border-subtle); white-space: nowrap; }
.dot { width: 5px; height: 5px; border-radius: 50%; background: var(--green); }
.match-badge { font-size: 11px; color: var(--accent); background: var(--accent-dim); padding: 3px 10px; border-radius: 20px; white-space: nowrap; font-family: 'JetBrains Mono', monospace; }

.mode-switch { display: flex; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 8px; padding: 3px; gap: 2px; }
.mode-btn { display: flex; align-items: center; gap: 5px; padding: 5px 12px; border-radius: 6px; font-size: 13px; color: var(--text-muted); }
.mode-btn:hover { color: var(--text-primary); }
.mode-btn.active { background: var(--bg-tertiary); color: var(--text-primary); }

.icon-btn { padding: 5px 10px; border-radius: 6px; font-size: 12px; color: var(--text-muted); white-space: nowrap; }
.icon-btn:hover, .icon-btn.active { background: var(--bg-tertiary); color: var(--text-primary); }
.share-btn { color: var(--accent); }
.share-title-input { width: 190px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary); font-size: 12px; padding: 5px 9px; outline: none; }
.share-title-input:focus { border-color: var(--accent); }
.comments-toggle { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-muted); cursor: pointer; white-space: nowrap; }
.comments-toggle input { accent-color: var(--accent); cursor: pointer; }

.comment-nav { display: flex; align-items: center; gap: 4px; background: rgba(188,140,255,.12); border-radius: 20px; padding: 2px 8px; }
.nav-label { font-size: 11px; color: var(--purple); white-space: nowrap; }
.nav-btn { color: var(--purple); font-size: 11px; width: 18px; height: 18px; border-radius: 4px; }
.nav-btn:hover { background: rgba(188,140,255,.2); }
.fork-btn { color: var(--accent); border: 1px solid var(--border); }

.shared-badge { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-secondary); background: var(--bg-tertiary); padding: 3px 9px; border-radius: 20px; border: 1px solid var(--border); white-space: nowrap; }

.banner { display: flex; align-items: center; gap: 8px; padding: 8px 16px; font-size: 12px; flex-shrink: 0; }
.banner.accent { background: var(--accent-dim); color: var(--accent); }
.banner.error { background: rgba(255,123,114,.08); color: var(--red); }
.banner.info { background: var(--bg-tertiary); color: var(--text-secondary); border-bottom: 1px solid var(--border-subtle); }
.banner-meta { color: var(--text-muted); font-size: 11px; }
.banner-title { color: var(--text-primary); }
.banner a { color: inherit; }
.banner-close { margin-left: auto; color: inherit; font-size: 16px; line-height: 1; opacity: .7; }
.banner-close:hover { opacity: 1; }

.workspace { display: flex; flex: 1; min-height: 0; }

.editor-pane { width: 380px; flex-shrink: 0; display: flex; flex-direction: column; border-right: 1px solid var(--border); background: var(--bg-secondary); }
.pane-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border-subtle); }
.pane-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; color: var(--text-muted); }
.pane-actions { display: flex; gap: 4px; }
.mini-btn { font-size: 11px; padding: 3px 8px; border-radius: 5px; color: var(--text-secondary); background: var(--bg-tertiary); border: 1px solid var(--border); }
.mini-btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
.mini-btn:disabled { opacity: .4; cursor: not-allowed; }
.mini-btn.danger { color: var(--red); border-color: transparent; }
.editor { flex: 1; width: 100%; background: var(--bg-primary); color: var(--text-primary); border: none; outline: none; padding: 14px 16px; font-family: 'JetBrains Mono', monospace; font-size: 13px; line-height: 1.6; resize: none; }
.editor.invalid { box-shadow: inset 0 0 0 1px rgba(255,123,114,.4); }
.editor-status { display: flex; align-items: center; gap: 8px; padding: 8px 16px; font-size: 12px; border-top: 1px solid var(--border-subtle); font-family: 'JetBrains Mono', monospace; }
.editor-status.error { color: var(--red); background: rgba(255,123,114,.06); }
.editor-status.ok { color: var(--green); }
.status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.status-dot.error { background: var(--red); }
.status-dot.ok { background: var(--green); }

.viewer-pane { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.viewer-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 16px; border-bottom: 1px solid var(--border-subtle); background: var(--bg-secondary); }
.search-wrap { display: flex; align-items: center; gap: 6px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 8px; padding: 0 10px; flex: 1; max-width: 480px; }
.search-wrap:focus-within { border-color: var(--accent); }
.search-icon { color: var(--text-muted); flex-shrink: 0; }
.search-input { flex: 1; min-width: 0; background: transparent; border: none; outline: none; color: var(--text-primary); font-size: 13px; padding: 8px 0; }
.search-count { font-size: 11px; color: var(--text-muted); font-family: 'JetBrains Mono', monospace; white-space: nowrap; }
.search-count.empty { color: var(--red); }
.search-nav { color: var(--text-muted); font-size: 12px; width: 20px; height: 20px; border-radius: 4px; flex-shrink: 0; }
.search-nav:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
.search-nav:disabled { opacity: .3; cursor: not-allowed; }
.search-clear { color: var(--text-muted); font-size: 18px; line-height: 1; flex-shrink: 0; }
.filter-btn { font-size: 11px; padding: 5px 10px; border-radius: 6px; color: var(--text-muted); background: var(--bg-tertiary); border: 1px solid var(--border); white-space: nowrap; }
.filter-btn:hover:not(:disabled) { color: var(--text-primary); }
.filter-btn.active { color: var(--accent); border-color: var(--accent); background: var(--accent-dim); }
.filter-btn:disabled { opacity: .4; cursor: not-allowed; }
.search-warn { font-size: 11px; color: var(--yellow, #d29922); }
.viewer-body { flex: 1; overflow: auto; padding: 4px 16px 40px; }

.placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; min-height: 60%; text-align: center; padding: 40px; }
.ph-title { font-size: 16px; font-weight: 600; color: var(--text-secondary); }
.placeholder.error .ph-title { color: var(--red); }
.ph-detail { font-size: 13px; color: var(--text-muted); max-width: 360px; }
.ph-btn { margin-top: 8px; padding: 8px 16px; border-radius: 8px; font-size: 13px; color: var(--accent); background: var(--accent-dim); }
</style>
