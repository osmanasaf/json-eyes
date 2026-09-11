<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { JsonValue } from '../types'
import {
  changedPaths, flattenDiff, type DiffNode, type DiffResult, type DiffRow,
} from '../utils/diff'
import { cellText, isContainer, childCount } from '../utils/grid'

/**
 * Fark gorunumu: **hizali A/B agaci**.
 *
 * Eski gorunumun sikayeti okunmamasiydi — tek bir birlesik agacta neyin
 * hangi tarafa ait oldugu kayboluyordu. Burada iki yari var ve **ayni yol iki
 * tarafta da ayni satirda**: goz yatayda gidip iki degeri karsilastiriyor.
 *
 * Ekran iki isi birden gormeli: hazir bir *rapor* (degisenler acik gelir) ve
 * elle gezilen bir *agac*. Bu yuzden satira tiklamak bir yere goturmez,
 * yalnizca dali acar/kapatir; belgeye gitmek isteyen satirin sagindaki `↗`
 * dugmesine basar. Alan alan acip iki tarafi gozle kiyaslamak,
 * degisiklik raporundan bagimsiz calisan bir yol olmali.
 *
 * Kayit kimligi (`ORD100003`, `PAX3`) dekorasyon degil: indeks tek basina
 * hangi *kaydin* degistigini soylemiyor.
 */
const props = defineProps<{
  result: DiffResult | null
  /** Yalnizca degisen yapraklar ve onlara giden dallar. */
  onlyChanges: boolean
  nameA: string
  nameB: string
  /** Gezinme istegi: bu yola kaydir ve vurgula. */
  focus?: { path: string; seq: number } | null
}>()

const emit = defineEmits<{
  focusPath: [path: string]
  'update:onlyChanges': [value: boolean]
}>()

/** Degisiklik iceren dallar: rapor kendiliginden acik gelsin diye. */
const autoOpen = computed(() => (props.result ? changedPaths(props.result) : new Set<string>()))

/**
 * Elle yapilan ac/kapa'lar otomatik acilan dallarin *uzerine* biniyor.
 *
 * Fark her tus vurusunda yeniden hesaplaniyor; acilmis dallari her hesapta
 * sifirlamak elde gezinmeyi imkansiz kilardi. Delta ayri tutulunca A tarafinda
 * bir karakter degistirmek kullanicinin actigi dallari kapatmiyor.
 */
const opened = ref(new Set<string>())
const closed = ref(new Set<string>())

const expanded = computed(() => {
  const set = new Set(autoOpen.value)
  for (const path of closed.value) set.delete(path)
  for (const path of opened.value) set.add(path)
  return set
})

const rows = computed<DiffRow[]>(() => {
  if (!props.result) return []
  return flattenDiff(props.result, { expanded: expanded.value, onlyChanges: props.onlyChanges })
})

/** Iki belge arasinda hicbir fark yoksa: agac yine gezilebilir kalir. */
const identical = computed(() => {
  const counts = props.result?.counts
  if (!counts) return false
  return counts.added + counts.removed + counts.changed + counts.moved === 0
})

/**
 * A tarafinin isareti: silinen `−`, degisen `~`. Icinde fark bulunan
 * kapsayicilar isaretlenmez — bir dalin altinda degisiklik olmasi o dalin
 * kendisinin degistigi anlamina gelmiyor; her satiri isaretlemek raporu
 * okunmaz yapiyor. Butunuyle silinen bir kapsayici ise isaretlenir.
 */
function markA(node: DiffNode): string {
  if (node.children.length > 0) return ''
  if (node.kind === 'removed') return '−'
  if (node.kind === 'changed') return '~'
  return ''
}

/** B tarafinin isareti: eklenen `+`, degisen `~`, tasinan `⇅`. */
function markB(node: DiffNode): string {
  if (node.children.length > 0) return node.kind === 'added' ? '+' : ''
  if (node.kind === 'added') return '+'
  if (node.kind === 'changed') return '~'
  if (node.kind === 'moved') return '⇅'
  return ''
}

function valueText(value: JsonValue | undefined): string {
  if (value === undefined) return ''
  if (Array.isArray(value)) return `[ ${value.length} öğe ]`
  if (isContainer(value)) return `{ ${childCount(value)} alan }`
  if (typeof value === 'string') return `"${cellText(value)}"`
  return cellText(value)
}

/** Bir tarafta gosterilecek deger; kapsayicilarda oge/alan sayisi. */
function sideValue(node: DiffNode, side: 'a' | 'b'): string {
  if (node.children.length > 0) {
    const count = node.children.length
    return node.type === 'array' ? `[ ${count} öğe ]` : `{ ${count} alan }`
  }
  const value = side === 'a' ? node.left : node.right
  return valueText(value)
}

/**
 * Bu dugum o tarafta var mi? Eklenen bir alan A'da, silinen bir alan B'de
 * yoktur: o yariya ok koymak "icinde bir sey var" diye soz vermek olurdu.
 */
function sidePresent(node: DiffNode, side: 'a' | 'b'): boolean {
  if (node.kind === 'added') return side === 'b'
  if (node.kind === 'removed') return side === 'a'
  return true
}

function rowTone(node: DiffNode, side: 'a' | 'b'): string {
  if (node.children.length > 0) return 'quiet'
  if (side === 'a' && (node.kind === 'removed' || node.kind === 'changed')) return 'removed'
  if (side === 'b' && (node.kind === 'added' || node.kind === 'changed')) return 'added'
  return 'quiet'
}

/** Tasinan ogelerde "sıra 4 → 5" notu. */
function moveNote(node: DiffNode): string {
  if (node.kind !== 'moved' || node.from === undefined || node.to === undefined) return ''
  return `sıra ${node.from} → ${node.to}`
}

// --- Ac / kapa ---------------------------------------------------------------

const activePath = ref<string | null>(null)

function setDelta(open: Set<string>, shut: Set<string>) {
  opened.value = open
  closed.value = shut
}

/** Satira tiklamak: dali ac/kapa ve isareti buraya tasi. Baska hicbir sey. */
function toggle(row: DiffRow) {
  activePath.value = row.node.path
  if (!row.expandable) return
  const path = row.node.path
  const open = new Set(opened.value)
  const shut = new Set(closed.value)
  if (expanded.value.has(path)) {
    open.delete(path)
    shut.add(path)
  } else {
    shut.delete(path)
    open.add(path)
  }
  setDelta(open, shut)
}

/** Koke kadar her sey kapanir; gezinti bastan, alan alan yapilir. */
function collapseAll() {
  setDelta(new Set(), new Set(autoOpen.value))
}

/** Rapor haline don: degisiklik iceren dallar acik, gerisi kapali. */
function openChanges() {
  setDelta(new Set(), new Set())
}

/** Hedefe giden atalari acar; kapali bir dalda gezinme hedefi bulamazdi. */
function reveal(path: string) {
  const parts = path.split('.')
  const open = new Set(opened.value)
  const shut = new Set(closed.value)
  for (let i = 1; i <= parts.length; i++) {
    const ancestor = parts.slice(0, i).join('.')
    shut.delete(ancestor)
    if (i < parts.length) open.add(ancestor)
  }
  setDelta(open, shut)
}

// --- Sanallastirma -------------------------------------------------------------

const scrollEl = ref<HTMLElement | null>(null)
const version = ref(0)
const virtualizer = useVirtualizer(computed(() => ({
  count: rows.value.length,
  getScrollElement: () => scrollEl.value,
  estimateSize: () => 24,
  overscan: 14,
  getItemKey: (index: number) => rows.value[index]?.key ?? index,
  onChange: () => { version.value++ },
})))

const virtualRows = computed(() => { void version.value; return virtualizer.value.getVirtualItems() })
const totalSize = computed(() => { void version.value; return virtualizer.value.getTotalSize() })

watch(rows, () => { virtualizer.value.measure() })

/** Gezinme istegi: hedefe giden dallari ac, satiri gorunur kil ve vurgula. */
watch(() => props.focus, async (request) => {
  if (!request) return
  activePath.value = request.path
  reveal(request.path)
  await nextTick()
  const index = rows.value.findIndex(row => row.node.path === request.path)
  if (index >= 0) virtualizer.value.scrollToIndex(index, { align: 'center' })
})
</script>

<template>
  <div class="diff">
    <!--
      Arac cubugu: raporla elde gezinme arasindaki anahtar. "Tümünü kapat"
      koke dondurur — asil istenen buydu: alan alan acip bakmak.
    -->
    <div class="toolbar">
      <button class="tool" title="Her dalı kapat, kökten başla" @click="collapseAll">
        <span class="glyph">⊟</span>tümünü kapat
      </button>
      <button class="tool" title="Değişiklik içeren dalları aç" @click="openChanges">
        <span class="glyph">⊞</span>değişenleri aç
      </button>
      <button
        class="tool"
        :class="{ on: onlyChanges }"
        title="Kapatınca değişmeyen alanlar da listelenir"
        @click="emit('update:onlyChanges', !onlyChanges)"
      >
        <span class="glyph">{{ onlyChanges ? '◉' : '○' }}</span>yalnız değişenler
      </button>
      <div class="toolbar-spacer" />
      <span class="meta">{{ rows.length.toLocaleString('tr-TR') }} satır</span>
    </div>

    <div class="head">
      <div class="head-side">
        <span class="side">A</span>
        <span class="name">{{ nameA || 'A' }}</span>
      </div>
      <div class="head-side">
        <span class="side">B</span>
        <span class="name">{{ nameB || 'B' }}</span>
      </div>
    </div>

    <p v-if="!result" class="note">İki tarafa da JSON verin — soldaki Fark sekmesinde.</p>
    <p v-else-if="identical" class="note">
      İki belge birebir aynı — ağacı yine de alan alan açıp gezebilirsiniz.
    </p>

    <div v-if="result" ref="scrollEl" class="scroll">
      <div class="canvas" :style="{ height: `${totalSize}px` }">
        <div
          v-for="vrow in virtualRows"
          :key="String(vrow.key)"
          class="vrow"
          :style="{ transform: `translateY(${vrow.start}px)` }"
        >
          <template v-if="rows[vrow.index]">
            <!-- Katlanmis degismeyen kardesler -->
            <div v-if="rows[vrow.index].collapsedCount !== undefined" class="folded">
              <span class="mark" />
              <span class="indent" :style="{ width: `${rows[vrow.index].depth * 13}px` }" />
              <span class="twist-ph" />
              <span>
                {{ rows[vrow.index].collapsedCount!.toLocaleString('tr-TR') }} değişmeyen
                {{ rows[vrow.index].collapsedUnit }}
              </span>
            </div>

            <div
              v-else
              class="row"
              :class="{ active: activePath === rows[vrow.index].node.path }"
              @click="toggle(rows[vrow.index])"
            >
              <span class="cursor" />
              <div
                v-for="side in (['a', 'b'] as const)"
                :key="side"
                class="half"
                :class="rowTone(rows[vrow.index].node, side)"
              >
                <span class="mark">{{ side === 'a' ? markA(rows[vrow.index].node) : markB(rows[vrow.index].node) }}</span>
                <span class="indent" :style="{ width: `${rows[vrow.index].depth * 13}px` }" />
                <!--
                  Ok her iki yarida da var: iki sutun ayni yolu ayni hizada
                  gostermeli, yoksa goz yatayda kayar. Yapraklarda yerini bos
                  birakan bir kutu duruyor.
                -->
                <span
                  v-if="rows[vrow.index].expandable && sidePresent(rows[vrow.index].node, side)"
                  class="twist"
                  :class="{ open: rows[vrow.index].isOpen }"
                >▾</span>
                <span v-else class="twist-ph" />
                <span class="key">{{ rows[vrow.index].node.key }}</span>
                <span v-if="rows[vrow.index].node.label" class="label">{{ rows[vrow.index].node.label }}</span>
                <span v-if="moveNote(rows[vrow.index].node)" class="label">{{ moveNote(rows[vrow.index].node) }}</span>
                <span class="value">{{ sideValue(rows[vrow.index].node, side) }}</span>
              </div>

              <!-- Belgeye gitmek artik ayri ve istege bagli bir hareket. -->
              <button
                class="goto"
                title="Bu alanı belge görünümünde aç (karşılaştırmadan çıkar)"
                @click.stop="emit('focusPath', rows[vrow.index].node.path)"
              >↗</button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.diff { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; background: var(--bg-data); }

.toolbar {
  display: flex; align-items: center; gap: 14px; padding: 0 14px;
  height: var(--h-toolbar); background: var(--bg-chrome);
  border-bottom: 1px solid var(--line); flex-shrink: 0;
}
.tool { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ink-2); white-space: nowrap; }
.tool:hover { color: var(--ink); }
.tool.on { color: var(--accent); }
.glyph { font-size: 9px; color: var(--ink-3); }
.tool.on .glyph { color: var(--accent); }
.toolbar-spacer { flex: 1; }
.meta { font-size: 11px; color: var(--ink-3); white-space: nowrap; }

.head { display: flex; height: var(--h-diff-head); flex-shrink: 0; background: var(--bg-chrome); border-bottom: 1px solid var(--line); }
.head-side { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 0 12px; }
.head-side + .head-side { border-left: 1px solid var(--line); }
.side { font-size: 10.5px; color: var(--ink-5); }
.name { font-size: 11.5px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.note { padding: 10px 14px; font-size: 12px; color: var(--ink-3); flex-shrink: 0; }

.scroll { flex: 1; min-height: 0; overflow: auto; }
.canvas { position: relative; width: 100%; }
.vrow { position: absolute; top: 0; left: 0; width: 100%; }

.row { position: relative; display: flex; min-height: 24px; cursor: pointer; }
.row:hover { background: var(--bg-subtle); }
.row.active { background: var(--accent-sel-bg); }

/*
 * Secim cizgisi mutlak konumlu: iki yarinin kendi zeminleri (eklendi/silindi)
 * ustune ciziliyor, yoksa renkli satirlarda kayboluyordu.
 */
.cursor { position: absolute; left: 0; top: 0; bottom: 0; width: 2px; }
.row.active .cursor { background: var(--accent); }

/* Iki yari esit: ayni yol iki tarafta da ayni satirda ve ayni hizada. */
.half { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 3px 12px; }
.half + .half { border-left: 1px solid var(--line); }
.half.removed { background: var(--removed-bg); }
.half.added { background: var(--added-bg); }

.mark { width: 9px; flex-shrink: 0; font-size: 9px; text-align: center; }
.half.removed .mark { color: var(--removed); }
.half.added .mark { color: var(--added); }

/*
 * Girinti bosluk degil, kilavuz: her ata derinligi icin ince bir dikey cizgi.
 * Sanallastirilmis listede her satir kendi cizgisini cizer — tekrarli bir
 * arkaplan deseniyle, dugum basina fazladan eleman kurmadan.
 */
.indent {
  flex-shrink: 0; align-self: stretch;
  background-image: linear-gradient(to right, var(--line-soft) 1px, transparent 1px);
  background-size: 13px 100%;
  background-position: 6px 0;
}

.twist {
  width: 13px; flex-shrink: 0; text-align: center; font-size: 9px; color: var(--ink-5);
  transform: rotate(-90deg); transition: transform .12s;
}
.twist.open { transform: rotate(0deg); }
.row:hover .twist { color: var(--ink-2); }
.twist-ph { width: 13px; flex-shrink: 0; }

.key { font-size: 11.5px; color: var(--ink-2); white-space: nowrap; }
.half.quiet .key { color: var(--ink-5); }
/* Kimlik notu: hangi kaydin degistigini soyler, dekorasyon degil. */
.label { font-size: 11px; color: var(--ink-3); white-space: nowrap; }
.value { font-size: 11.5px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.half.quiet .value { color: var(--ink-5); }

/* Ekranin disina cikaran tek hareket: goze carpmadan, ama elin altinda. */
.goto {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  width: 20px; height: 20px; border-radius: var(--radius-sm);
  font-size: 11px; color: var(--ink-5); opacity: 0;
}
.row:hover .goto { opacity: 1; }
.goto:hover { background: var(--bg-inset); color: var(--accent); }

.folded { display: flex; align-items: center; gap: 6px; min-height: 24px; padding: 3px 12px; font-size: 11px; color: var(--ink-5); }
</style>
