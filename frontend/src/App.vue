<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, provide, ref, shallowRef, watch } from 'vue'
import { COMMENTS, SELECT_FIELD } from './utils/injection'
import { useComments } from './composables/useComments'
import type { AnnotateResponse, JsonValue, ViewMode } from './types'
import { annotateJson, createShare, getShare } from './api'
import { countNodes, describeParseError, findNodePath, parseJson, toSchemaPath } from './utils/json'
import { buildSearchIndex, EMPTY_SEARCH } from './utils/search'
import { buildRefIndex, EMPTY_REF_INDEX, type RefTarget } from './utils/references'
import { tryRepair } from './utils/repair'
import { collectFieldValues } from './utils/related'
import { buildTextIndex, lineOfOffset, EMPTY_TEXT_INDEX, type JsonTextIndex } from './utils/textIndex'
import { initialNode, jsonPathOf } from './utils/gridModel'
import { childCount, isContainer, valueAtPath } from './utils/grid'
import {
  PANEL_W_DEFAULT, PANEL_W_MAX, PANEL_W_MIN,
  pushRecent, readPanelWidth, readRecents, readTheme, readViewMode,
  writePanelWidth, writeTheme, writeViewMode,
  type RecentFile, type Theme,
} from './utils/storage'
import JsonTree from './components/JsonTree.vue'
import JsonGrid from './components/JsonGrid.vue'
import ColumnView from './components/ColumnView.vue'
import DiffView from './components/DiffView.vue'
import IataPanel from './components/IataPanel.vue'
import FieldValuesPanel from './components/FieldValuesPanel.vue'
import EditorPane from './components/EditorPane.vue'
import EmptyState from './components/EmptyState.vue'

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
/**
 * Gorunum anahtari yalnizca **gorunum** tasir: Tree · Grid · Kolon, bu sirayla.
 * Fark ve XML buraya asla eklenmez — ikisi de girdi tarafinda yasar.
 */
const viewMode = ref<ViewMode>(readViewMode())
/**
 * Karsilastirma acik mi. Fark artik bir "mod" degil: ikinci bir girdi
 * verildiginde goruntuleyici karsilastirmayi gosteriyor, kapatinca secili
 * gorunume donuyor. Gorunum anahtarinin isi ayni belgeye nasil bakildigini
 * secmek — belgenin nereden geldigini secmek degil.
 */
const comparing = ref(false)
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

/**
 * Girdi panelinin genisligi. Tasarim paneli **surukleyerek** boyutlandiriyor:
 * NDC yanitlarinda satirlar uzun, 344px cogu zaman dar geliyor. Sinirlar
 * 210-760px, cift tiklama varsayilana dondurur.
 */
const panelW = ref(readPanelWidth())
const resizing = ref(false)

function startResize(event: MouseEvent) {
  // Suruklerken metin secilmesini engelle; imlec col-resize'da kalsin.
  event.preventDefault()
  resizing.value = true
  window.addEventListener('mousemove', onResize)
  window.addEventListener('mouseup', endResize)
}

function onResize(event: MouseEvent) {
  const next = Math.min(PANEL_W_MAX, Math.max(PANEL_W_MIN, event.clientX))
  panelW.value = next
}

function endResize() {
  resizing.value = false
  writePanelWidth(panelW.value)
  window.removeEventListener('mousemove', onResize)
  window.removeEventListener('mouseup', endResize)
}

function resetPanelWidth() {
  panelW.value = PANEL_W_DEFAULT
  writePanelWidth(PANEL_W_DEFAULT)
}

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

const annotation = ref<AnnotateResponse | null>(null)
const annotationLoading = ref(false)
const annotationError = ref<string | null>(null)

const fileInputRef = ref<HTMLInputElement | null>(null)
const filterInputRef = ref<HTMLInputElement | null>(null)
const editorRef = ref<InstanceType<typeof EditorPane> | null>(null)
const columnRef = ref<InstanceType<typeof ColumnView> | null>(null)

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

// --- Secim, breadcrumb ve odak ----------------------------------------------

/**
 * Grid'in gosterdigi dugum. Secimden **ayri** bir kavram: secim bir alan,
 * bu ise o alanin icinde bulundugu tablo. Kirinti bu yolu gosterir; bir
 * hucrede `→ yolu aç` denince buraya taşinir.
 */
const nodePath = ref<string>(ROOT_KEY)

/**
 * Acik referans karti. Grid'deki `↳` tiklandiginda hedef kayit sag panelin
 * en ustunde acilir — baglamdan cikmadan "bu referans neyi gosteriyor".
 */
const refTarget = ref<RefTarget | null>(null)

function openRefCard(target: RefTarget) {
  refTarget.value = target
  iataVisible.value = true
  iataPinned.value = true
}

const selectedNodePath = ref<string | null>(null)
provide(SELECT_FIELD, (path: string | null) => { selectedNodePath.value = path })

const selectedSchemaPath = computed(() =>
  selectedNodePath.value
    ? toSchemaPath(selectedNodePath.value, ROOT_KEY, annotation.value?.messageType ?? null)
    : null,
)

/**
 * GridSync: goruntuleyicide secilen alanin ham metindeki yeri. Indeks metnin
 * ikinci bir gecisini gerektirdigi icin metin basina bir kez kuruluyor ve
 * reaktif olmayan bir degiskende tutuluyor (icerigi Vue'nun izlemesine gerek
 * yok). Ilk secimde bekleme olmasin diye ayristirmadan sonra bos zamanda
 * onceden kuruluyor.
 */
let textIndexCache: { text: string; index: JsonTextIndex } | null = null

/** Cok buyuk girdilerde indeks kurulmaz; senkron sessizce devre disi kalir. */
const MAX_SYNC_CHARS = 12_000_000

function textIndexFor(text: string): JsonTextIndex {
  if (textIndexCache?.text === text) return textIndexCache.index
  if (text.length > MAX_SYNC_CHARS) return EMPTY_TEXT_INDEX
  const index = buildTextIndex(text, ROOT_KEY)
  textIndexCache = { text, index }
  return index
}

type SyncRange = { start: number; end: number; startLine: number; endLine: number }
const syncRange = ref<SyncRange | null>(null)

function updateSyncRange() {
  const path = selectedNodePath.value
  if (!path || !editorVisible.value || isShared.value || parsed.value === null) {
    syncRange.value = null
    return
  }
  const index = textIndexFor(parsedInput.value)
  const range = index.ranges.get(path)
  if (!range) {
    syncRange.value = null
    return
  }
  syncRange.value = {
    start: range.start,
    end: range.end,
    startLine: lineOfOffset(index, range.start),
    endLine: lineOfOffset(index, Math.max(range.start, range.end - 1)),
  }
}

watch([selectedNodePath, parsedInput, editorVisible, isShared], updateSyncRange, { immediate: true })

// Ayristirma basariliysa indeksi bos zamanda kur: ilk tiklama beklemesin.
watch(parsedInput, (text) => {
  if (parsed.value === null || isShared.value || text.length > MAX_SYNC_CHARS) return
  const prewarm = () => {
    if (parsedInput.value !== text) return
    textIndexFor(text)
    updateSyncRange()
  }
  const idle = (window as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback
  if (idle) idle(prewarm)
  else setTimeout(prewarm, 300)
})

/**
 * Secili alanin belge genelindeki degerleri. Yalnizca panel acikken hesaplanir;
 * tarama eslesmeyen dallari budadigi icin secim degistikce yeniden calisabilir.
 */
const fieldValuesOpen = ref(true)

const fieldValues = computed(() => {
  if (!fieldValuesOpen.value || !iataVisible.value) return null
  const path = selectedNodePath.value
  if (!path || parsed.value === null || path === ROOT_KEY) return null
  return collectFieldValues(parsed.value, ROOT_KEY, path)
})

/** Secili alanin editordeki satir numarasi; footer bunu yaziyor. */
const syncLine = computed(() => syncRange.value?.startLine ?? null)

/**
 * Bağlam şeridi. Her parca kendi yolunu tasiyor: tiklanabilir olmasi ust
 * seviyelere donusun tek yolu (tablo akisinda "geri" tusu bu).
 */
const crumbs = computed(() => {
  const full = nodePath.value.split('.')
  const items = full.map((label, index) => ({
    label,
    path: full.slice(0, index + 1).join('.'),
    last: index === full.length - 1,
  }))
  // Kok etiketi ("json") yerine belgeye donen bir parca olarak kalir.
  if (items.length <= 8) return items
  return [{ label: '…', path: items[items.length - 8].path, last: false }, ...items.slice(-7)]
})

/** Kirinti tiklamasi: grid o dugume tasinir ve dugum secilir. */
function goToCrumb(path: string) {
  goToNode(path)
}

/**
 * Grid'i bir dugume tasi. Kirinti oraya gider, secim o dugum olur; ayni
 * yol Tree ve Kolon gorunumunde odaklanma olarak calisir.
 */
function goToNode(path: string) {
  nodePath.value = path
  selectedNodePath.value = path
  focusRequest.value = { path, seq: ++focusSeq }
}

/**
 * Secili alanin canli JSONPath ifadesi. Kirinti "neredeyim"i, bu satir
 * "bunu nasil adreslerim"i soyler — ikisi ayri sorular.
 */
const pathExpr = computed(() => jsonPathOf(selectedNodePath.value ?? ROOT_KEY))

const pathCopied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

async function copySelectedPath() {
  try {
    await navigator.clipboard.writeText(pathExpr.value)
    pathCopied.value = true
    if (copyTimer) clearTimeout(copyTimer)
    // Tasarimin suresi: isaret 1600ms sonra kendi kendine geri doner.
    copyTimer = setTimeout(() => { pathCopied.value = false }, 1600)
  } catch {
    pathCopied.value = false
  }
}

/**
 * Bir dizi ogesindeyken kardes gezinme (`‹ 3/12 ›`). NDC'de "bir sonraki
 * siparis" en sik yapilan hareket; kirintidan cikip diziye donmeden yapiliyor.
 */
const siblingNav = computed(() => {
  const path = selectedNodePath.value
  if (!path || parsed.value === null) return null
  const cut = path.lastIndexOf('.')
  if (cut < 0) return null
  const last = path.slice(cut + 1)
  if (!/^\d+$/.test(last)) return null
  const parent = valueAtPath(parsed.value, ROOT_KEY, path.slice(0, cut))
  if (!isContainer(parent) || !Array.isArray(parent)) return null
  return { index: Number(last), total: childCount(parent), parent: path.slice(0, cut) }
})

function goToSibling(step: number) {
  const nav = siblingNav.value
  if (!nav || nav.total === 0) return
  const next = (nav.index + step + nav.total) % nav.total
  focusOnPath(`${nav.parent}.${next}`)
}

function setViewMode(mode: ViewMode) {
  // Gorunum secmek karsilastirmayi kapatir: anahtar yalnizca belgeye bakis acisi.
  comparing.value = false
  viewMode.value = mode
}

/** IATA panelindeki XSD yolunu goruntuleyicideki dugume cevirip oraya atlar. */
function focusUnmatched(schemaPath: string) {
  if (parsed.value === null) return
  const target = findNodePath(
    parsed.value, ROOT_KEY, annotation.value?.messageType ?? null, schemaPath,
  )
  if (target) focusOnPath(target)
}

function focusOnPath(path: string) {
  // Karsilastirmadan bir dugume gidilirse belge gorunumune donuluyor.
  comparing.value = false
  selectedNodePath.value = path
  // Grid tek dugum cizdigi icin kirinti hedefi kapsayan tabloya tasinir;
  // yoksa "git" dedigin alan ekranda hic gorunmezdi.
  nodePath.value = containerOf(path)
  focusRequest.value = { path, seq: ++focusSeq }
}

/**
 * Bir yolun grid'de gosterilebilecek en yakin kapsayicisi. Skaler bir alana
 * gidildiginde tablo onun *ustunu* cizmeli.
 */
function containerOf(path: string): string {
  if (parsed.value === null) return ROOT_KEY
  const value = valueAtPath(parsed.value, ROOT_KEY, path)
  if (isContainer(value)) return path
  const cut = path.lastIndexOf('.')
  return cut > 0 ? path.slice(0, cut) : ROOT_KEY
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
  // Agac kendi eslesmesini zaten aciyor; grid ve kolon gorunumu odaklanir.
  if (path && (viewMode.value === 'grid' || viewMode.value === 'columns')) focusOnPath(path)
}

function clearSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchInput.value = ''
  searchTerm.value = ''
  activeIndex.value = 0
}

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

/**
 * Fark gorunumu icin paylasimdan JSON getirir. Kullanicinin elindeki
 * karsilastirma malzemesi genellikle bir paylasim linki oluyor.
 */
/**
 * Fark linkiyle acilan ikinci taraf (`?s=A&d=B`). `jse diff` bu adresi
 * uretiyor: link tek basina iki belgeyi de tasidigi icin acan kisinin elle
 * dosya yuklemesi gerekmiyor.
 */
const diffShareId = ref<string | null>(null)

async function loadShareForDiff(idOrUrl: string): Promise<{ json: JsonValue; label: string }> {
  const match = /[?&]s=([A-Za-z0-9]+)/.exec(idOrUrl)
  const id = match ? match[1] : idOrUrl.trim()
  const share = await getShare(id)
  return { json: share.json, label: share.title ?? `paylaşım ${share.id}` }
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

// Yeni belge: grid anlamli ilk dugume iner, eski yol artik gecerli degil.
watch(parsed, (json) => {
  nodePath.value = json === null ? ROOT_KEY : initialNode(json, ROOT_KEY)
  selectedNodePath.value = null
})

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
  // `d` varsa fark gorunumu acilir; ikinci tarafi DiffView kendisi getirir.
  const diffId = params.get('d')
  if (diffId && parsed.value !== null) {
    diffShareId.value = diffId
    comparing.value = true
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
    // .xml uzantisi kullanicinin acik bir tercihi: XML aracina yonlendiriyoruz.
    // Icerige bakip "bu XML'e benziyor" diye karar vermiyoruz; cevirimi orada
    // kullanici baslatir.
    if (/\.xml$/i.test(file.name)) {
      openXmlTab(text, file.name)
      return
    }
    xmlNotice.value = null
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
  xmlNotice.value = null
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

/**
 * XML bir *girdi bicimi*: girdi panelindeki XML sekmesinde yapistirilir,
 * kullanici isteyince cevrilir ve sonuc girdinin kendisi olur. Icerige bakip
 * "bu XML'e benziyor" diye tahmin yapilmiyor; karar her zaman kullanicinin
 * (sekme ya da `.xml` uzantisi).
 */
const xmlNotice = ref<{ root: string; notes: string[] } | null>(null)

function openXmlTab(text = '', name: string | null = null) {
  editorVisible.value = true
  editorPinned.value = true
  void nextTick(() => editorRef.value?.openXml(text, name))
}

function onXmlLoad(payload: { text: string; name: string | null; root: string; notes: string[] }) {
  applyInputNow(payload.text)
  fileName.value = payload.name
  xmlNotice.value = { root: payload.root, notes: payload.notes }
  loadError.value = null
  selectedNodePath.value = null
  comparing.value = false
  if (payload.name) recents.value = pushRecent(payload.name, payload.text)
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

/** Bant uzerindeki "kopyala"; isaret kisa sure "kopyalandi" olur. */
async function copyShareUrl() {
  if (!shareUrl.value) return
  try {
    await navigator.clipboard.writeText(shareUrl.value)
    shareCopied.value = true
    setTimeout(() => { shareCopied.value = false }, 1600)
  } catch {
    shareCopied.value = false
  }
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

  // Kolon gorunumunde ok tuslari sutunlar arasinda gezinir (Finder gibi).
  if (viewMode.value === 'columns') {
    const view = columnRef.value
    if (!view) return
    if (event.key === 'ArrowDown' || event.key === 'j' || event.key === 'J') {
      event.preventDefault()
      view.moveSelection(1)
    } else if (event.key === 'ArrowUp' || event.key === 'k' || event.key === 'K') {
      event.preventDefault()
      view.moveSelection(-1)
    } else if (event.key === 'ArrowRight' || event.key === 'l' || event.key === 'Enter') {
      event.preventDefault()
      view.descend()
    } else if (event.key === 'ArrowLeft' || event.key === 'h') {
      event.preventDefault()
      view.ascend()
    }
    return
  }

}

// --- Basliktaki dosya adi ----------------------------------------------------

const displayName = computed(() => fileName.value ?? (rawInput.value.trim() ? 'girdi.json' : ''))

watch(viewMode, writeViewMode)

/** Baglam seridi ve yan panel yalnizca belgeyi gosteren gorunumlerde anlamli. */
const docView = computed(() => !comparing.value)
</script>

<template>
  <div class="app" :class="{ resizing }">
    <!--
      Header: marka, dosya durumu, arama, tema, gorunum anahtari, paylas.
      Gorunum anahtarinda yalnizca gorunum var — Fark ve XML girdi tarafinda.
    -->
    <header class="header">
      <button class="brand" title="Ana sayfa — yeni JSON" @click="goHome">
        <span class="brand-json">JSON</span><span class="brand-eyes">EYES</span>
      </button>

      <div v-if="displayName" class="file">
        <span class="file-dot" :class="{ bad: !hasData && parseError }" />
        <span class="file-name" :title="displayName">{{ displayName }}</span>
      </div>
      <span v-if="isShared" class="lock">salt okunur</span>

      <div class="search">
        <span class="search-icon">⌕</span>
        <input
          ref="filterInputRef"
          v-model="searchInput"
          class="search-input"
          :class="{ filled: searchTerm }"
          type="text"
          placeholder="alan veya değer ara"
          @keydown.enter.prevent="goToMatch($event.shiftKey ? -1 : 1)"
          @keydown.esc="clearSearch"
        />
        <span class="search-hint">{{ searchTerm ? (matchCount > 0 ? 'eşleşenler işaretli' : 'eşleşme yok') : '⌘K' }}</span>
      </div>

      <button
        class="theme"
        :title="theme === 'dark' ? 'Aydınlık temaya geç' : 'Karanlık temaya geç'"
        @click="theme = theme === 'dark' ? 'light' : 'dark'"
      >{{ theme === 'dark' ? '☀' : '☾' }}</button>

      <div class="views">
        <button class="view" :class="{ active: viewMode === 'tree' }" @click="setViewMode('tree')">Tree</button>
        <button class="view" :class="{ active: viewMode === 'grid' }" @click="setViewMode('grid')">Grid</button>
        <button class="view" :class="{ active: viewMode === 'columns' }" @click="setViewMode('columns')">Kolon</button>
      </div>

      <div v-if="!isShared" class="share-wrap">
        <button class="share" :disabled="!hasData || shareLoading" @click="shareMenuOpen = !shareMenuOpen">
          {{ shareLoading ? '…' : 'Paylaş' }}
        </button>
        <div v-if="shareMenuOpen" class="share-menu">
          <input v-model="shareTitle" class="share-title" type="text" maxlength="120" placeholder="başlık (isteğe bağlı)" @keydown.enter="handleShare" />
          <label class="share-check">
            <span class="check" :class="{ on: shareCommentsEnabled }">{{ shareCommentsEnabled ? '✓' : '' }}</span>
            <input v-model="shareCommentsEnabled" type="checkbox" hidden />
            alan yorumlarına açık
          </label>
          <p class="share-note">Link salt okunur açılır; veriyi kimse değiştiremez.</p>
          <button class="share-confirm" :disabled="shareLoading" @click="handleShare">
            {{ shareLoading ? 'Paylaşılıyor…' : 'Link oluştur' }}
          </button>
        </div>
      </div>
      <button v-else class="share" @click="forkShared">Kopyasını al</button>
    </header>

    <!-- Bantlar: paylasim linki, XML cevirim notu, hatalar. -->
    <div v-if="shareUrl" class="banner">
      <span class="banner-label">paylaşım</span>
      <a :href="shareUrl" target="_blank" class="banner-link">{{ shareUrl }}</a>
      <span class="banner-note">Açan herkes yorum bırakabilir, veriyi değiştiremez.</span>
      <div class="banner-spacer" />
      <button class="banner-btn" @click="copyShareUrl">{{ shareCopied ? 'kopyalandı' : 'kopyala' }}</button>
      <button class="banner-btn" @click="shareUrl = null">×</button>
    </div>
    <div v-if="isShared" class="banner">
      <span class="banner-label">salt okunur</span>
      <strong v-if="sharedTitle" class="banner-strong">{{ sharedTitle }}</strong>
      <span class="banner-note">Paylaşılmış görünüm — düzenleme kapalı.</span>
      <div class="banner-spacer" />
      <button class="banner-btn" @click="forkShared">kopyasını al ve düzenle</button>
    </div>
    <div v-if="xmlNotice" class="banner">
      <span class="banner-label">xml</span>
      <span class="banner-note">kök: {{ xmlNotice.root }} · {{ xmlNotice.notes.join(' · ') }}</span>
      <div class="banner-spacer" />
      <button class="banner-btn" @click="xmlNotice = null">×</button>
    </div>
    <div v-if="shareError || loadError" class="banner bad">
      <span class="banner-label">hata</span>
      <span class="banner-note">{{ shareError || loadError }}</span>
      <div class="banner-spacer" />
      <button class="banner-btn" @click="shareError = null; loadError = null">×</button>
    </div>

    <!-- Kirinti: nerede oldugumuz. Dizi ogesindeyken kardes gezinme yaninda. -->
    <div v-if="hasData && docView" class="crumbs">
      <template v-for="(crumb, index) in crumbs" :key="index">
        <button class="crumb" :class="{ last: crumb.last }" :title="crumb.path" @click="goToCrumb(crumb.path)">{{ crumb.label }}</button>
        <span v-if="!crumb.last" class="crumb-sep">›</span>
      </template>
      <span v-if="siblingNav" class="siblings">
        <button class="sib" title="Önceki kayıt" @click="goToSibling(-1)">‹</button>
        {{ siblingNav.index + 1 }}/{{ siblingNav.total }}
        <button class="sib" title="Sonraki kayıt" @click="goToSibling(1)">›</button>
      </span>
    </div>

    <!-- Yol satiri: secili alanin JSONPath ifadesi, tek tikla kopyalanir. -->
    <button v-if="hasData && docView" class="path-row" :title="'Panoya kopyala'" @click="copySelectedPath">
      <span class="path-expr">{{ pathExpr }}</span>
      <span class="path-copy" :class="{ done: pathCopied }">{{ pathCopied ? '✓ kopyalandı' : '⧉' }}</span>
    </button>
    <div class="workspace">
      <!--
        Sol: girdi paneli. Paylasilan gorunumde hic render edilmez. Genisligi
        kullanicinin; sag kenarindaki tutamactan surukleniyor.
      -->
      <div
        v-if="editorVisible && !isShared"
        class="panel-slot"
        :style="{ width: `${panelW}px` }"
      >
      <EditorPane
        ref="editorRef"
        v-model="rawInput"
        :parse-error="parseError"
        :error-line="errorDetail?.line ?? null"
        :node-count="nodeCount"
        :has-data="hasData"
        :recents="recents"
        :sync-range="syncRange"
        :comparing="comparing"
        @xml="onXmlLoad"
        @toggle-compare="comparing = !comparing"
        @format="handleFormat"
        @minify="handleMinify"
        @sample="loadSample"
        @clear="handleClear"
        @repair="handleRepair"
        @open-recent="openRecent"
        @drop="handleDrop"
        @collapse="toggleEditor"
      />
        <div
          class="resizer"
          :class="{ on: resizing }"
          title="Sürükleyerek genişlet · çift tıkla sıfırla"
          @mousedown="startResize"
          @dblclick="resetPanelWidth"
        />
      </div>

      <!-- Kapali panelin yerinde dikey serit kalir; tiklayinca geri acilir. -->
      <button
        v-if="!editorVisible && !isShared"
        class="rail"
        title="Girdi panelini aç"
        @click="toggleEditor"
      ><span class="rail-label">GİRDİ</span></button>

      <!-- Orta: goruntuleyici -->
      <section class="viewer">
        <div v-if="sharedLoading" class="center-note">Paylaşılan JSON yükleniyor…</div>

        <div v-else-if="parseError" class="center-note error">
          <h2 class="error-title">JSON ayrıştırılamadı</h2>
          <code class="error-code">{{ parseError }}</code>
          <p class="error-hint">Hatalı satır solda işaretlendi. Düzeltince grid kendiliğinden oluşur.</p>
          <div class="error-actions">
            <button class="error-action" @click="handleRepair">Otomatik düzelt ve dene</button>
            <button class="error-action ghost" @click="openXmlTab(rawInput, fileName)">
              Elinizdeki XML mi? Girdi panelindeki XML sekmesine taşı
            </button>
          </div>
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
          <!--
            Karsilastirma: ikinci bir girdi verildiginde goruntuleyici alanini
            devraliyor. Gorunum anahtarina dokunmuyor; kapatinca secili
            gorunume donuluyor.
          -->
          <DiffView
            v-if="comparing"
            :current="parsed"
            :root-key="ROOT_KEY"
            :current-name="displayName"
            :load-share="loadShareForDiff"
            :auto-share="diffShareId"
            @focus-path="focusOnPath"
            @close="comparing = false"
          />

          <ColumnView
            v-if="!comparing && viewMode === 'columns'"
            ref="columnRef"
            :data="parsed!"
            :root-key="ROOT_KEY"
            :selected-path="selectedNodePath"
            :doc-lookup="docLookup"
            :search-term="searchTerm"
            @focus-path="focusOnPath"
          />

          <div v-else-if="!comparing && viewMode === 'tree'" class="tree-scroll">
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
            v-else-if="viewMode === 'grid'"
            :data="parsed!"
            :root-key="ROOT_KEY"
            :node-path="nodePath"
            :selected-path="selectedNodePath"
            :search-term="searchTerm"
            :doc-lookup="docLookup"
            :ref-index="refIndex"
            :schema-known="schemaKnown"
            @go-to="goToNode"
            @select="selectedNodePath = $event"
            @open-ref="openRefCard"
          />
        </template>
      </section>

      <!-- Sag: IATA paneli; `×` ile kapanir, seritten geri acilir. -->
      <button
        v-if="!iataVisible && hasData && docView"
        class="rail"
        title="IATA panelini aç"
        @click="toggleIata"
      ><span class="rail-label">IATA</span></button>

      <div v-if="iataVisible && hasData && docView" class="side-col">
        <IataPanel
          :annotation="annotation"
          :loading="annotationLoading"
          :error="annotationError"
          :selected-path="selectedSchemaPath"
          @focus-path="focusUnmatched"
          @collapse="toggleIata"
        />
        <!-- Secili alanin belgedeki tum degerleri; NDC'de dagilima bakmak ilk adim. -->
        <FieldValuesPanel
          v-if="fieldValuesOpen"
          :stats="fieldValues"
          :has-selection="selectedNodePath !== null && selectedNodePath !== ROOT_KEY"
          @focus-path="focusOnPath"
          @collapse="fieldValuesOpen = false"
        />
        <button v-else class="values-reopen" @click="fieldValuesOpen = true">▴ Alan değerleri</button>
      </div>
    </div>

    <footer class="footer">
      <span v-if="hasData" class="stat">{{ nodeCount.toLocaleString('tr-TR') }} node</span>
      <span v-if="hasData" class="stat">ayrıştırma {{ Math.round(parseState.ms) }} ms</span>
      <div class="footer-spacer" />
      <!-- Sag uc GridSync durumu: secili alan metnin kacinci satirinda. -->
      <span v-if="syncLine" class="stat sync">satır {{ syncLine }} · {{ selectedNodePath }}</span>
      <span v-else-if="hasData" class="stat">grid ↔ json senkron</span>
    </footer>

    <input ref="fileInputRef" type="file" accept=".json,.xml,application/json,text/xml,application/xml" hidden @change="handleFile" />
  </div>
</template>

<style scoped>
/*
 * Kabuk. Butun olculer token; tasarimin sabit yukseklikleri (header 46,
 * kirinti 32, yol satiri 25, footer 25) tek yerden okunuyor.
 */
.app { display: flex; flex-direction: column; height: 100vh; background: var(--bg-app); overflow: hidden; }
/* Surukleme sirasinda imlec her yerde col-resize kalsin, metin secilmesin. */
.app.resizing { cursor: col-resize; user-select: none; }

/* --- Header ---------------------------------------------------------------- */
.header {
  display: flex; align-items: center; gap: 14px; padding: 0 14px;
  height: var(--h-header); background: var(--bg-chrome);
  border-bottom: 1px solid var(--line); flex-shrink: 0;
}
.brand { display: flex; align-items: baseline; gap: 5px; flex-shrink: 0; letter-spacing: .3px; }
.brand-json { font-size: 13px; font-weight: 600; color: var(--ink); }
.brand-eyes { font-size: 13px; font-weight: 400; color: var(--ink-4); }
.brand:hover .brand-eyes { color: var(--ink-2); }

.file { display: flex; align-items: center; gap: 7px; min-width: 0; }
.file-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--added); flex-shrink: 0; }
.file-dot.bad { background: var(--removed); }
.file-name { font-size: 12px; color: var(--ink-2); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lock { font-size: 11px; color: var(--ink-4); white-space: nowrap; }

/* Arama: cerceve yok, yalniz alt cizgi — doluyken accent. */
.search { flex: 1; display: flex; align-items: center; gap: 8px; max-width: 320px; margin: 0 auto; border-bottom: 1px solid var(--line); padding: 3px 2px; }
.search:focus-within { border-bottom-color: var(--accent); }
.search-icon { font-size: 11px; color: var(--ink-5); }
.search-input { flex: 1; min-width: 0; background: none; border: none; outline: none; font-size: 11.5px; color: var(--ink); }
.search-input::placeholder { color: var(--ink-5); }
.search-hint { font-size: 10.5px; color: var(--ink-5); white-space: nowrap; }

.theme { font-size: 12px; color: var(--ink-4); line-height: 1; padding: 4px; flex-shrink: 0; }
.theme:hover { color: var(--ink); }

/* Gorunum anahtari: yuva + aktif beyaz kart. */
.views { display: flex; background: var(--bg-inset); border-radius: var(--radius); padding: 2px; gap: 2px; flex-shrink: 0; }
.view { padding: 3px 11px; border-radius: var(--radius-sm); font-size: 11px; color: var(--ink-4); white-space: nowrap; }
.view:hover { color: var(--ink-2); }
.view.active { background: var(--bg-data); color: var(--ink); }

.share-wrap { position: relative; flex-shrink: 0; }
.share { font-size: 11px; color: var(--ink-2); border: 1px solid var(--line); border-radius: var(--radius); padding: 4px 12px; white-space: nowrap; }
.share:hover:not(:disabled) { background: var(--bg-inset); color: var(--ink); }
.share:disabled { opacity: .45; cursor: not-allowed; }
.share-menu {
  position: absolute; top: 34px; right: 0; z-index: 30; width: 270px;
  display: flex; flex-direction: column; gap: 9px;
  background: var(--bg-data); border: 1px solid var(--line);
  border-radius: var(--radius); padding: 12px; box-shadow: var(--shadow-menu);
}
.share-title { background: none; border: none; border-bottom: 1px solid var(--line); outline: none; font-size: 11.5px; padding: 4px 2px; }
.share-title:focus { border-bottom-color: var(--accent); }
.share-check { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--ink-2); cursor: pointer; }
.check { width: 14px; height: 14px; border: 1px solid var(--line-strong); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 9px; color: var(--on-accent); flex-shrink: 0; }
.check.on { background: var(--accent); border-color: var(--accent); }
.share-note { font-size: 11px; color: var(--ink-3); line-height: 1.45; }
.share-confirm { font-size: 11px; color: var(--on-accent); background: var(--accent); border-radius: var(--radius); padding: 6px 12px; }
.share-confirm:hover:not(:disabled) { background: var(--accent-hover); }

/* --- Bantlar --------------------------------------------------------------- */
.banner {
  display: flex; align-items: center; gap: 10px; padding: 0 14px;
  height: var(--h-banner); background: var(--bg-subtle);
  border-bottom: 1px solid var(--line); flex-shrink: 0; font-size: 11.5px;
}
.banner.bad { background: var(--removed-bg-soft); }
.banner-label { font-size: 11px; color: var(--ink-4); flex-shrink: 0; }
.banner-strong { font-weight: 600; color: var(--ink); }
.banner-link { color: var(--accent); text-decoration: none; }
.banner-link:hover { color: var(--accent-hover); text-decoration: underline; }
.banner-note { color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.banner-spacer { flex: 1; }
.banner-btn { font-size: 11px; color: var(--ink-2); border: 1px solid var(--line); border-radius: var(--radius); padding: 2px 9px; white-space: nowrap; }
.banner-btn:hover { background: var(--bg-inset); color: var(--ink); }

/* --- Kirinti ve yol satiri -------------------------------------------------- */
.crumbs {
  display: flex; align-items: center; gap: 6px; padding: 0 14px;
  height: var(--h-crumbs); background: var(--bg-app);
  border-bottom: 1px solid var(--line-soft); flex-shrink: 0; overflow: hidden;
}
.crumb { font-size: 11.5px; color: var(--ink-4); white-space: nowrap; padding: 1px 2px; }
.crumb:hover { color: var(--ink-2); }
.crumb.last { color: var(--ink); font-weight: 500; }
.crumb-sep { font-size: 10px; color: var(--ink-5); }
.siblings { display: flex; align-items: center; gap: 5px; margin-left: 8px; font-size: 11px; color: var(--ink-4); }
.sib { font-size: 11px; color: var(--ink-4); padding: 0 3px; }
.sib:hover { color: var(--accent); }

.path-row {
  display: flex; align-items: center; gap: 8px; padding: 0 14px; width: 100%;
  height: var(--h-path); background: var(--bg-app); flex-shrink: 0; text-align: left;
  border-bottom: 1px solid var(--line-soft);
}
.path-row:hover .path-copy { color: var(--ink-2); }
.path-expr { font-size: 10.5px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.path-copy { font-size: 10.5px; color: var(--ink-5); white-space: nowrap; flex-shrink: 0; }
.path-copy.done { color: var(--accent); }

/* --- Calisma alani ---------------------------------------------------------- */
.workspace { display: flex; flex: 1; min-height: 0; }

.panel-slot { position: relative; flex-shrink: 0; display: flex; min-height: 0; }
.panel-slot > :first-child { flex: 1; min-width: 0; }
/* Tutamac panelin sag kenarina biner; yalniz surukleme sirasinda gorunur. */
.resizer { position: absolute; top: 0; right: -3px; width: 7px; height: 100%; cursor: col-resize; z-index: 5; }
.resizer:hover, .resizer.on { background: var(--accent-line); }

/* Kapali panelin yerinde kalan dikey serit. */
.rail {
  width: var(--rail-w); flex-shrink: 0; background: var(--bg-chrome);
  border-right: 1px solid var(--line); display: flex; align-items: center; justify-content: center;
}
.rail:hover { background: var(--bg-inset); }
.rail-label { writing-mode: vertical-rl; font-size: 10px; letter-spacing: .4px; color: var(--ink-4); }
.rail:hover .rail-label { color: var(--ink-2); }

/* --- Footer ---------------------------------------------------------------- */
.footer {
  display: flex; align-items: center; gap: 14px; padding: 0 14px;
  height: var(--h-footer); background: var(--bg-chrome);
  border-top: 1px solid var(--line); flex-shrink: 0;
}
.stat { font-size: 10.5px; color: var(--ink-4); white-space: nowrap; }
.stat.sync { color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; }
.footer-spacer { flex: 1; }

.viewer { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--bg-primary); }
.tree-scroll { flex: 1; min-height: 0; overflow: auto; padding: 4px 16px 40px; }
.center-note { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 40px; font-size: 13px; color: var(--text-muted); }
.error-title { font-size: 17px; font-weight: 600; color: var(--red); }
.error-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center; }
.error-code { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; color: var(--text-secondary); background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; max-width: 560px; text-align: center; word-break: break-word; }
.error-hint { font-size: 13px; color: var(--text-muted); max-width: 360px; text-align: center; text-wrap: pretty; }
.error-action { margin-top: 4px; font-size: 13px; color: var(--accent); background: var(--accent-dim); border-radius: 8px; padding: 8px 18px; }
.error-action:hover { background: var(--accent-strong); }
.error-action.ghost { color: var(--text-secondary); background: transparent; border: 1px solid var(--border); font-size: 12px; padding: 7px 14px; }
.error-action.ghost:hover { color: var(--accent); border-color: var(--accent); }
.side-col { display: flex; flex-direction: column; width: var(--iata-w); flex-shrink: 0; min-height: 0; }
.side-col > :first-child { flex: 1 1 auto; min-height: 0; }
.side-col > .values-panel { flex: 0 1 auto; max-height: 52%; }
.values-reopen { flex-shrink: 0; font-size: 11px; color: var(--text-muted); background: var(--bg-secondary); border-top: 1px solid var(--border); padding: 7px 12px; text-align: left; }
.values-reopen:hover { color: var(--accent); }
</style>
