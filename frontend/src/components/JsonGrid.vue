<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { FieldDoc, JsonArray, JsonObject, JsonValue } from '../types'
import { getType } from '../utils/json'
import { childPath, matchesDeep } from '../utils/search'

const props = defineProps<{
  data: JsonValue
  rootKey: string
  searchTerm?: string
  docLookup?: (nodePath: string) => FieldDoc | undefined
  filterMatches?: boolean
}>()

/** 'self': satirin kendi anahtari/degeri eslesti, 'deep': eslesme alt agacinda. */
type RowMatch = 'self' | 'deep' | null

interface BreadcrumbItem {
  label: string
  data: unknown
  /** Agactakiyle ayni dugum yolu; XSD aciklamalarini dogru baglamdan almak icin. */
  path: string
}

const breadcrumbs = shallowRef<BreadcrumbItem[]>([
  { label: 'root', data: props.data as unknown, path: props.rootKey },
])
const sortCol = ref<string | null>(null)
const sortDir = ref<'asc' | 'desc'>('asc')

watch(() => props.data, (data) => {
  breadcrumbs.value = [{ label: 'root', data: data as unknown, path: props.rootKey }]
  sortCol.value = null
})

const current = computed(() => breadcrumbs.value[breadcrumbs.value.length - 1])
const currentData = computed(() => current.value.data as JsonValue)
const currentPath = computed(() => current.value.path)

const objectEntries = computed((): [string, JsonValue][] => {
  if (getType(currentData.value) !== 'object') return []
  let entries = Object.entries(currentData.value as JsonObject)
  if (sortCol.value === 'key') {
    entries = [...entries].sort((a, b) =>
      sortDir.value === 'asc' ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0]))
  } else if (sortCol.value === 'type') {
    entries = [...entries].sort((a, b) => {
      const ta = getType(a[1]), tb = getType(b[1])
      return sortDir.value === 'asc' ? ta.localeCompare(tb) : tb.localeCompare(ta)
    })
  } else if (sortCol.value === 'value') {
    entries = [...entries].sort((a, b) => {
      const sa = a[1] === null || typeof a[1] === 'object' ? '' : String(a[1])
      const sb = b[1] === null || typeof b[1] === 'object' ? '' : String(b[1])
      return sortDir.value === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa)
    })
  }
  return entries
})

function handleSort(col: string) {
  if (sortCol.value === col) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortCol.value = col; sortDir.value = 'asc' }
}

function handleDrill(label: string, drillData: JsonValue, path: string) {
  breadcrumbs.value = breadcrumbs.value.concat([{ label, data: drillData as unknown, path }])
}

function handleBreadcrumb(idx: number) {
  breadcrumbs.value = breadcrumbs.value.slice(0, idx + 1)
}

function isPrimitive(value: JsonValue): boolean {
  const t = getType(value)
  return t !== 'object' && t !== 'array'
}

function getAllKeys(arr: JsonArray): string[] {
  const keys = new Set<string>()
  for (const item of arr) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      Object.keys(item as JsonObject).forEach(k => keys.add(k))
    }
  }
  return Array.from(keys)
}

function docFor(key: string): FieldDoc | undefined {
  return props.docLookup?.(childPath(currentPath.value, key))
}

function docTitle(key: string): string | undefined {
  const info = docFor(key)
  if (!info) return undefined
  return info.type ? `${info.type}\n\n${info.documentation}` : info.documentation
}

function matchKind(value: JsonValue, key?: string): RowMatch {
  const term = props.searchTerm?.trim()
  if (!term) return null
  if (key !== undefined && key.toLowerCase().includes(term.toLowerCase())) return 'self'
  if (!matchesDeep(value, term)) return null
  return isPrimitive(value) ? 'self' : 'deep'
}

const filterActive = computed(() => props.filterMatches === true && !!props.searchTerm?.trim())

const objectRows = computed(() => {
  const rows = objectEntries.value.map(([k, v]) => ({ k, v, match: matchKind(v, k) }))
  return filterActive.value ? rows.filter(row => row.match !== null) : rows
})

const arrayColumns = computed(() =>
  getType(currentData.value) === 'array' ? getAllKeys(currentData.value as JsonArray) : [],
)

const arrayAllPrimitive = computed(() =>
  getType(currentData.value) === 'array' && (currentData.value as JsonArray).every(isPrimitive),
)

const arrayRows = computed(() => {
  if (getType(currentData.value) !== 'array') return []
  let rows = (currentData.value as JsonArray).map((item, i) => ({ item, i, match: matchKind(item) }))
  if (sortCol.value && sortCol.value !== '#') {
    rows = [...rows].sort((a, b) => {
      const va = a.item && typeof a.item === 'object' && !Array.isArray(a.item)
        ? (a.item as JsonObject)[sortCol.value!] : undefined
      const vb = b.item && typeof b.item === 'object' && !Array.isArray(b.item)
        ? (b.item as JsonObject)[sortCol.value!] : undefined
      const sa = va === undefined || va === null ? '' : String(va)
      const sb = vb === undefined || vb === null ? '' : String(vb)
      return sortDir.value === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa)
    })
  }
  return filterActive.value ? rows.filter(row => row.match !== null) : rows
})

/** Cok satirli dizilerde ilk render'da gosterilecek satir sayisi. */
const ROW_PAGE_SIZE = 200
const visibleRowCount = ref(ROW_PAGE_SIZE)

watch([currentData, filterActive, () => props.searchTerm], () => {
  visibleRowCount.value = ROW_PAGE_SIZE
})

const pagedArrayRows = computed(() => arrayRows.value.slice(0, visibleRowCount.value))
const pendingRowCount = computed(() => Math.max(0, arrayRows.value.length - visibleRowCount.value))

function showMoreRows() {
  visibleRowCount.value += ROW_PAGE_SIZE * 5
}

const hiddenCount = computed(() => {
  if (!filterActive.value) return 0
  if (getType(currentData.value) === 'object') return objectEntries.value.length - objectRows.value.length
  if (getType(currentData.value) === 'array') return (currentData.value as JsonArray).length - arrayRows.value.length
  return 0
})
</script>

<template>
  <div class="grid">
    <!-- Object tablosu -->
    <template v-if="getType(currentData) === 'object'">
      <div class="table-wrap">
        <div v-if="breadcrumbs.length > 1" class="breadcrumbs">
          <template v-for="(item, i) in breadcrumbs" :key="i">
            <span v-if="i > 0" class="bread-sep">›</span>
            <button class="bread-btn" :class="{ active: i === breadcrumbs.length - 1 }" @click="handleBreadcrumb(i)">{{ item.label }}</button>
          </template>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th class="th" @click="handleSort('key')">Key <span v-if="sortCol === 'key'" class="sort">{{ sortDir === 'asc' ? '↑' : '↓' }}</span></th>
              <th class="th" @click="handleSort('type')">Type <span v-if="sortCol === 'type'" class="sort">{{ sortDir === 'asc' ? '↑' : '↓' }}</span></th>
              <th class="th" @click="handleSort('value')">Value <span v-if="sortCol === 'value'" class="sort">{{ sortDir === 'asc' ? '↑' : '↓' }}</span></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="{ k, v, match } in objectRows"
              :key="k"
              class="tr"
              :class="{ match: match === 'self', 'match-deep': match === 'deep' }"
            >
              <td class="td key-cell" :class="{ documented: !!docFor(k) }" :title="docTitle(k)">{{ k }}</td>
              <td class="td"><span class="badge" :class="'t-' + getType(v)">{{ getType(v) }}</span></td>
              <td class="td">
                <button v-if="getType(v) === 'object'" class="drill" @click="handleDrill(k, v, childPath(currentPath, k))">
                  ▶ Object ({{ Object.keys(v as JsonObject).length }})
                </button>
                <button v-else-if="getType(v) === 'array'" class="drill" @click="handleDrill(k, v, childPath(currentPath, k))">
                  ▶ Array ({{ (v as JsonArray).length }})
                </button>
                <span v-else-if="v === null" class="v-null">null</span>
                <span v-else-if="typeof v === 'boolean'" class="v-bool">{{ v }}</span>
                <span v-else-if="typeof v === 'number'" class="v-num">{{ v }}</span>
                <span v-else class="v-str">{{ v }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Array tablosu -->
    <template v-else-if="getType(currentData) === 'array'">
      <div class="table-wrap">
        <div v-if="breadcrumbs.length > 1" class="breadcrumbs">
          <template v-for="(item, i) in breadcrumbs" :key="i">
            <span v-if="i > 0" class="bread-sep">›</span>
            <button class="bread-btn" :class="{ active: i === breadcrumbs.length - 1 }" @click="handleBreadcrumb(i)">{{ item.label }}</button>
          </template>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th class="th idx">#</th>
              <template v-if="arrayAllPrimitive">
                <th class="th">Value</th>
              </template>
              <template v-else>
                <th
                  v-for="k in arrayColumns"
                  :key="k"
                  class="th"
                  :title="docTitle(k)"
                  @click="handleSort(k)"
                >
                  {{ k }} <span v-if="sortCol === k" class="sort">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
                </th>
              </template>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="{ item, i, match } in pagedArrayRows"
              :key="i"
              class="tr"
              :class="{ match: match === 'self', 'match-deep': match === 'deep' }"
            >
              <td class="td idx">{{ i }}</td>
              <template v-if="arrayAllPrimitive">
                <td class="td">{{ item }}</td>
              </template>
              <template v-else>
                <td v-for="k in arrayColumns" :key="k" class="td">
                  <template v-if="item && typeof item === 'object' && !Array.isArray(item)">
                    <button
                      v-if="['object','array'].includes(getType((item as JsonObject)[k] ?? null))"
                      class="drill"
                      @click="handleDrill(`[${i}].${k}`, (item as JsonObject)[k], childPath(childPath(currentPath, i), k))"
                    >▶ {{ getType((item as JsonObject)[k]) }}</button>
                    <span v-else>{{ (item as JsonObject)[k] ?? '—' }}</span>
                  </template>
                  <span v-else class="v-null">—</span>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Primitive -->
    <div v-else class="primitive">{{ currentData }}</div>

    <div v-if="pendingRowCount > 0" class="more-wrap">
      <button class="more-btn" @click="showMoreRows">
        {{ pendingRowCount.toLocaleString() }} satır daha göster
      </button>
    </div>

    <p v-if="filterActive && hiddenCount > 0" class="filter-note">
      Bu seviyede {{ hiddenCount }} satır filtrelendi.
    </p>
    <p v-if="filterActive && hiddenCount > 0 && objectRows.length === 0 && arrayRows.length === 0" class="filter-note">
      Eşleşme bu dalın dışında; üstteki breadcrumb'dan başka bir dala geçin.
    </p>
  </div>
</template>

<style scoped>
.grid { font-size: 13px; }
.table-wrap { overflow-x: auto; }
.breadcrumbs { display: flex; flex-wrap: wrap; gap: 2px; padding: 8px 4px 12px; font-size: 12px; }
.bread-sep { color: var(--text-muted); margin: 0 2px; }
.bread-btn { color: var(--accent); padding: 2px 6px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 12px; }
.bread-btn:hover { background: var(--accent-dim); }
.bread-btn.active { color: var(--text-primary); }
.table { width: 100%; border-collapse: collapse; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.th { background: var(--bg-tertiary); color: var(--text-secondary); font-size: 11px; font-weight: 600; text-transform: uppercase; padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); cursor: pointer; user-select: none; white-space: nowrap; }
.th:hover { background: var(--bg-hover); color: var(--text-primary); }
.th.idx { width: 48px; text-align: center; cursor: default; }
.sort { color: var(--accent); margin-left: 4px; }
.tr { transition: background .1s; }
.tr:nth-child(even) { background: rgba(255,255,255,.015); }
.tr:hover { background: var(--bg-hover); }
.tr.match { background: rgba(255,220,0,.1); }
.tr.match-deep { background: rgba(255,220,0,.04); }
.filter-note { padding: 10px 4px; font-size: 11px; color: var(--text-muted); }
.more-wrap { padding: 10px 4px; }
.more-btn { font-size: 12px; color: var(--accent); background: var(--accent-dim); padding: 6px 14px; border-radius: 6px; }
.more-btn:hover { background: rgba(88,166,255,.25); }
.td { padding: 7px 12px; border-bottom: 1px solid var(--border-subtle); font-family: 'JetBrains Mono', monospace; font-size: 12.5px; vertical-align: middle; }
.td.idx { color: var(--text-muted); text-align: center; background: var(--bg-tertiary); width: 48px; font-size: 11px; }
.key-cell { color: var(--color-key); font-weight: 500; white-space: nowrap; }
.key-cell.documented { cursor: help; text-decoration: underline dotted var(--text-muted); }
.badge { font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; }
.t-string { background: rgba(165,214,255,.12); color: var(--color-string); }
.t-number { background: rgba(247,129,102,.12); color: var(--color-number); }
.t-boolean { background: rgba(121,192,255,.12); color: var(--color-bool); }
.t-null { background: rgba(110,118,129,.12); color: var(--color-null); }
.t-object { background: rgba(188,140,255,.12); color: var(--purple); }
.t-array { background: rgba(63,185,80,.12); color: var(--green); }
.drill { color: var(--accent); background: var(--accent-dim); padding: 3px 8px; border-radius: 5px; font-family: 'JetBrains Mono', monospace; font-size: 12px; }
.drill:hover { background: rgba(88,166,255,.25); }
.v-str { color: var(--color-string); }
.v-num { color: var(--color-number); }
.v-bool { color: var(--color-bool); font-weight: 500; }
.v-null { color: var(--color-null); font-style: italic; }
.primitive { padding: 20px; font-family: 'JetBrains Mono', monospace; }
</style>
