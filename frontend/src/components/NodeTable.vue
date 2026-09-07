<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { SELECT_FIELD } from '../utils/injection'
import type { JsonObject, JsonValue } from '../types'
import { getType } from '../utils/json'

/**
 * Tablo modunun tek seviyelik hali: nesne dizisi olmayan bir dugumu (duz nesne,
 * skaler dizi, karisik dizi) satir satir gosterir. Nesne dizileri ArrayTable'a
 * gider; buradaki amac "her dugum tabloda gezilebilsin" akisini tamamlamak —
 * ic ice hucreler bir alt seviyeye iner, breadcrumb geri cikarir.
 */
const props = defineProps<{
  value: JsonObject | JsonValue[]
  /** Dugumun agactaki yolu. */
  path: string
}>()

const emit = defineEmits<{ descend: [path: string]; focusPath: [path: string] }>()

const selectField = inject(SELECT_FIELD, null)

const isArray = computed(() => Array.isArray(props.value))

interface Entry {
  key: string
  path: string
  value: JsonValue
  type: string
  container: boolean
  /** Kapsayicilar icin "3 alan" / "2 öğe", skalerler icin degerin metni. */
  text: string
}

const PAGE = 200
const rendered = ref(PAGE)
const filterText = ref('')
const openPath = ref<string | null>(null)

watch(() => props.path, () => {
  rendered.value = PAGE
  filterText.value = ''
  openPath.value = null
})

function summarize(value: JsonValue): string {
  if (Array.isArray(value)) return `${value.length} öğe`
  if (value !== null && typeof value === 'object') return `${Object.keys(value).length} alan`
  if (value === null) return 'null'
  // Cok satirli metin satira sigmaz; satir sonlari gorunur bir isarete iner.
  return String(value).replace(/\r?\n/g, ' ↵ ')
}

const entries = computed<Entry[]>(() => {
  const source: Array<[string, JsonValue]> = isArray.value
    ? (props.value as JsonValue[]).map((item, index) => [String(index), item])
    : Object.entries(props.value as JsonObject)

  return source.map(([key, value]) => {
    const type = getType(value)
    return {
      key,
      path: `${props.path}.${key}`,
      value,
      type,
      container: type === 'object' || type === 'array',
      text: summarize(value),
    }
  })
})

const filtered = computed(() => {
  const needle = filterText.value.trim().toLowerCase()
  if (!needle) return entries.value
  return entries.value.filter(entry =>
    entry.key.toLowerCase().includes(needle)
    || (entry.container ? JSON.stringify(entry.value) : String(entry.value ?? 'null'))
      .toLowerCase().includes(needle),
  )
})

const visible = computed(() => filtered.value.slice(0, rendered.value))
const pending = computed(() => Math.max(0, filtered.value.length - rendered.value))

const DETAIL_CHARS = 20_000

/** Acilmis satirin tam degeri; ic ice dugumlerde bicimli JSON. */
const detail = computed(() => {
  if (openPath.value === null) return null
  const entry = entries.value.find(item => item.path === openPath.value)
  if (!entry) return null
  const full = entry.container
    ? JSON.stringify(entry.value, null, 2)
    : entry.value === null ? 'null' : String(entry.value)
  return {
    key: entry.key,
    type: entry.type,
    text: full.length > DETAIL_CHARS ? full.slice(0, DETAIL_CHARS) : full,
    clipped: Math.max(0, full.length - DETAIL_CHARS),
    chars: full.length,
  }
})

function onRowClick(entry: Entry) {
  selectField?.(entry.path)
  // Ic ice dugumde tiklama bir seviye asagi iner (tablo akisi); skalerde tam
  // degeri acar — hucre tek satir oldugu icin uzun metin baska turlu okunamaz.
  if (entry.container) emit('descend', entry.path)
  else openPath.value = openPath.value === entry.path ? null : entry.path
}

function colorOf(entry: Entry): string {
  if (entry.type === 'number') return 'var(--color-number)'
  if (entry.type === 'boolean') return 'var(--color-bool)'
  if (entry.type === 'null') return 'var(--color-null)'
  if (entry.type === 'array') return 'var(--green)'
  if (entry.type === 'object') return 'var(--purple)'
  return 'var(--color-string)'
}

const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

async function copyDetail() {
  const entry = entries.value.find(item => item.path === openPath.value)
  if (!entry) return
  const text = entry.container
    ? JSON.stringify(entry.value, null, 2)
    : entry.value === null ? 'null' : String(entry.value)
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copied.value = false }, 1500)
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <div class="node-table">
    <div class="head">
      <div class="hcell hcell-key">{{ isArray ? '#' : 'Alan' }}</div>
      <div class="hcell hcell-type">Tip</div>
      <div class="hcell hcell-value">
        Değer
        <input
          v-model="filterText"
          class="head-filter"
          type="text"
          :placeholder="`${entries.length} satırı filtrele`"
        />
      </div>
    </div>

    <div class="body">
      <template v-for="entry in visible" :key="entry.path">
        <div
          class="row"
          :class="{ container: entry.container, open: openPath === entry.path }"
          @click="onRowClick(entry)"
        >
          <div class="cell cell-key">
            <span class="key">{{ entry.key }}</span>
          </div>
          <div class="cell cell-type">
            <span class="type-badge" :class="`t-${entry.type}`">{{ entry.type }}</span>
          </div>
          <div class="cell cell-value" :style="{ color: colorOf(entry) }">
            <span class="value-text" :class="{ summary: entry.container }">{{ entry.text }}</span>
            <span v-if="entry.container" class="descend">içine gir →</span>
          </div>
        </div>

        <!-- Skaler satirin tam degeri; hucrede kirpilan metin burada okunur. -->
        <div v-if="openPath === entry.path && detail" class="detail">
          <div class="detail-head">
            <code class="detail-key">{{ detail.key }}</code>
            <span class="detail-meta">{{ detail.chars.toLocaleString('tr-TR') }} karakter</span>
            <div class="spacer" />
            <button class="detail-btn" @click.stop="emit('focusPath', entry.path)">Grid'de aç</button>
            <button class="detail-btn" @click.stop="copyDetail">{{ copied ? '✓ kopyalandı' : '⧉ kopyala' }}</button>
            <button class="detail-close" title="Kapat" @click.stop="openPath = null">×</button>
          </div>
          <pre class="detail-value">{{ detail.text }}</pre>
          <p v-if="detail.clipped > 0" class="detail-clip">
            +{{ detail.clipped.toLocaleString('tr-TR') }} karakter daha (kırpıldı) — tamamı kopyalanır
          </p>
        </div>
      </template>

      <div v-if="filtered.length === 0" class="empty-note">Filtreyle eşleşen satır yok.</div>

      <div v-if="pending > 0" class="more-row">
        {{ filtered.length.toLocaleString('tr-TR') }} satırın {{ visible.length.toLocaleString('tr-TR') }} tanesi çizildi
        <button class="more-btn" @click="rendered += PAGE * 5">daha fazla</button>
      </div>
    </div>

    <div class="foot">
      <span class="foot-item">{{ entries.length.toLocaleString('tr-TR') }} {{ isArray ? 'öğe' : 'alan' }}</span>
      <span v-if="filterText.trim()" class="foot-item accent">filtre: {{ filterText.trim() }} → {{ filtered.length }}</span>
      <div class="spacer" />
      <span class="foot-item muted">İç içe satıra tıklayın: bir seviye aşağı iner</span>
    </div>
  </div>
</template>

<style scoped>
.node-table { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.spacer { flex: 1; }

.head { display: grid; grid-template-columns: minmax(200px, 1fr) 84px minmax(260px, 2fr); background: var(--bg-secondary); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.hcell { padding: 8px 12px; font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; color: var(--text-secondary); }
.hcell-value { display: flex; align-items: center; gap: 10px; }
.head-filter { margin-left: auto; width: 200px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 5px; outline: none; color: var(--text-primary); font-family: 'JetBrains Mono', monospace; font-size: 11px; text-transform: none; letter-spacing: 0; padding: 3px 8px; }
.head-filter:focus { border-color: var(--accent); }

.body { flex: 1; min-height: 0; overflow-y: auto; }
.row { display: grid; grid-template-columns: minmax(200px, 1fr) 84px minmax(260px, 2fr); align-items: center; border-bottom: 1px solid var(--border-subtle); cursor: pointer; }
.row:hover { background: var(--bg-secondary); }
.row.open { background: var(--accent-wash); }
.row.container:hover .descend { opacity: 1; }

.cell { padding: 7px 12px; min-width: 0; }
.cell-key { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; }
.key { color: var(--color-key); font-weight: 500; }
.cell-value { display: flex; align-items: center; gap: 10px; font-family: 'JetBrains Mono', monospace; font-size: 12.5px; }
.value-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.value-text.summary { font-style: italic; color: var(--text-muted); }
.descend { margin-left: auto; font-size: 10px; color: var(--accent); background: var(--accent-dim); border-radius: 10px; padding: 1px 8px; white-space: nowrap; opacity: 0; transition: opacity .1s; }

.type-badge { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; }
.t-string { background: var(--bg-string); color: var(--color-string); }
.t-number { background: var(--bg-number); color: var(--color-number); }
.t-boolean { background: var(--bg-bool); color: var(--color-bool); }
.t-null { background: var(--bg-null); color: var(--color-null); }
.t-object { background: var(--bg-object); color: var(--purple); }
.t-array { background: var(--bg-array); color: var(--green); }

.detail { border-bottom: 1px solid var(--border); background: var(--bg-secondary); box-shadow: inset 2px 0 0 var(--cyan); padding: 8px 12px 10px; }
.detail-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.detail-key { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--color-key); }
.detail-meta { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--text-muted); }
.detail-btn { font-size: 10.5px; color: var(--accent); border: 1px solid var(--border); border-radius: 4px; padding: 1px 8px; white-space: nowrap; }
.detail-btn:hover { background: var(--accent-dim); }
.detail-close { font-size: 14px; line-height: 1; color: var(--text-muted); padding: 0 4px; }
.detail-close:hover { color: var(--red); }
.detail-value { margin: 0; font-family: 'JetBrains Mono', monospace; font-size: 12px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 320px; overflow-y: auto; color: var(--text-primary); }
.detail-clip { margin-top: 6px; font-size: 10.5px; color: var(--orange); }

.empty-note { padding: 14px; text-align: center; font-size: 11.5px; color: var(--text-muted); }
.more-row { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 12px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-muted); }
.more-btn { font-size: 11px; color: var(--accent); background: var(--accent-dim); padding: 2px 9px; border-radius: 5px; }

.foot { display: flex; align-items: center; gap: 14px; min-height: 32px; padding: 0 14px; background: var(--bg-secondary); border-top: 1px solid var(--border); flex-shrink: 0; }
.foot-item { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-primary); }
.foot-item.muted { color: var(--text-muted); }
.foot-item.accent { color: var(--accent); }

@media (max-width: 1280px) {
  .head, .row { grid-template-columns: minmax(150px, 1fr) 74px minmax(200px, 1.6fr); }
  .head-filter { width: 140px; }
}
</style>
