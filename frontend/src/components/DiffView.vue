<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { JsonValue } from '../types'
import {
  changedPaths, flattenDiff, type DiffNode, type DiffResult, type DiffRow,
} from '../utils/diff'
import { cellText, isContainer, childCount } from '../utils/grid'

/**
 * Fark gorunumu: **hizali A/B**.
 *
 * Eski gorunumun sikayeti okunmamasiydi — tek bir birlesik agacta neyin
 * hangi tarafa ait oldugu kayboluyordu. Burada iki yari var ve **ayni yol iki
 * tarafta da ayni satirda**: goz yatayda gidip iki degeri karsilastiriyor.
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

const emit = defineEmits<{ focusPath: [path: string] }>()

const expanded = ref(new Set<string>())

// Degisiklik iceren dallar acik gelir: kullanicidan raporu acmasini beklemek
// raporun kendisini gizlemek olur.
watch(() => props.result, (result) => {
  expanded.value = result ? changedPaths(result) : new Set<string>()
}, { immediate: true })

const rows = computed<DiffRow[]>(() => {
  if (!props.result) return []
  return flattenDiff(props.result, { expanded: expanded.value, onlyChanges: props.onlyChanges })
})

/**
 * A tarafinin isareti: silinen `−`, degisen `~`. Kapsayicilar isaretlenmez —
 * bir dalin altinda degisiklik olmasi o dalin kendisinin degistigi anlamina
 * gelmiyor; her satiri isaretlemek raporu okunmaz yapiyor.
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

function toggle(row: DiffRow) {
  if (!row.expandable) return
  const next = new Set(expanded.value)
  if (next.has(row.node.path)) next.delete(row.node.path)
  else next.add(row.node.path)
  expanded.value = next
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

/** Gezinme istegi: hedef satiri gorunur kil ve vurgula. */
const activePath = ref<string | null>(null)
watch(() => props.focus, (request) => {
  if (!request) return
  activePath.value = request.path
  const index = rows.value.findIndex(row => row.node.path === request.path)
  if (index >= 0) virtualizer.value.scrollToIndex(index, { align: 'center' })
})
</script>

<template>
  <div class="diff">
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
    <p v-else-if="rows.length === 0" class="note">İki belge birebir aynı.</p>

    <div v-else ref="scrollEl" class="scroll">
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
              {{ rows[vrow.index].collapsedCount!.toLocaleString('tr-TR') }} değişmeyen
              {{ rows[vrow.index].collapsedUnit }}
            </div>

            <div
              v-else
              class="row"
              :class="{ active: activePath === rows[vrow.index].node.path }"
              @click="toggle(rows[vrow.index]); emit('focusPath', rows[vrow.index].node.path)"
            >
              <div
                v-for="side in (['a', 'b'] as const)"
                :key="side"
                class="half"
                :class="rowTone(rows[vrow.index].node, side)"
              >
                <span class="mark">{{ side === 'a' ? markA(rows[vrow.index].node) : markB(rows[vrow.index].node) }}</span>
                <span class="indent" :style="{ width: `${rows[vrow.index].depth * 14}px` }" />
                <span class="key">{{ rows[vrow.index].node.key }}</span>
                <span v-if="rows[vrow.index].node.label" class="label">{{ rows[vrow.index].node.label }}</span>
                <span v-if="moveNote(rows[vrow.index].node)" class="label">{{ moveNote(rows[vrow.index].node) }}</span>
                <span class="value">{{ sideValue(rows[vrow.index].node, side) }}</span>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.diff { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; background: var(--bg-data); }

.head { display: flex; height: var(--h-diff-head); flex-shrink: 0; background: var(--bg-chrome); border-bottom: 1px solid var(--line); }
.head-side { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 0 12px; }
.head-side + .head-side { border-left: 1px solid var(--line); }
.side { font-size: 10.5px; color: var(--ink-5); }
.name { font-size: 11.5px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.note { padding: 18px 14px; font-size: 12px; color: var(--ink-3); }

.scroll { flex: 1; min-height: 0; overflow: auto; }
.canvas { position: relative; width: 100%; }
.vrow { position: absolute; top: 0; left: 0; width: 100%; }

.row { display: flex; min-height: 24px; cursor: pointer; }
.row:hover { background: var(--bg-subtle); }
.row.active { box-shadow: inset 2px 0 0 var(--accent); }

/* Iki yari esit: ayni yol iki tarafta da ayni satirda ve ayni hizada. */
.half { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 3px 12px; }
.half + .half { border-left: 1px solid var(--line); }
.half.removed { background: var(--removed-bg); }
.half.added { background: var(--added-bg); }

.mark { width: 9px; flex-shrink: 0; font-size: 9px; text-align: center; }
.half.removed .mark { color: var(--removed); }
.half.added .mark { color: var(--added); }
.indent { flex-shrink: 0; }
.key { font-size: 11.5px; color: var(--ink-2); white-space: nowrap; }
.half.quiet .key { color: var(--ink-5); }
/* Kimlik notu: hangi kaydin degistigini soyler, dekorasyon degil. */
.label { font-size: 11px; color: var(--ink-3); white-space: nowrap; }
.value { font-size: 11.5px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.half.quiet .value { color: var(--ink-5); }

.folded { padding: 3px 12px; font-size: 11px; color: var(--ink-5); }
</style>
