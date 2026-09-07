<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { SELECT_FIELD } from '../utils/injection'
import type { JsonObject, JsonValue } from '../types'

const props = defineProps<{
  /** Nesnelerden olusan dizi. */
  items: JsonObject[]
  /** Dizinin agactaki yolu; secilen satirin yolu buradan turetilir. */
  path: string
  /**
   * `inline` grid'in icindeki kompakt tablo, `full` ise tam ekran Tablo modu
   * (kolon filtreleri, CSV, toplam seridi yalnizca burada).
   */
  variant: 'inline' | 'full'
}>()

const emit = defineEmits<{
  focusPath: [path: string]
  /** Ic ice hucreye tiklandi: o dugumun kendi seviyesi tabloda acilsin. */
  descend: [path: string]
  expand: [path: string]
  close: []
}>()

// Secim, gorunum degistirmeden baglam seridine ve IATA paneline yansisin.
const selectField = inject(SELECT_FIELD, null)

type ColumnKind = 'number' | 'text' | 'nested'

/**
 * Kolonlar: skaler alanlar oldugu gibi, ic ice nesne/dizi alanlari ise ozet
 * olarak ("3 alan", "2 öğe") gosterilir. Onceden ic ice alanlar tablodan tumden
 * dusuruluyordu; NDC kayitlarinin bilgisi cogunlukla orada oldugu icin tablo
 * bos gorunuyordu. Ozet hucreye tiklanarak o dugume gidilir, satir detayinda da
 * tam JSON'u okunur.
 */
const columns = computed(() => {
  const seen = new Map<string, ColumnKind>()
  for (const item of props.items) {
    for (const [key, value] of Object.entries(item)) {
      const kind: ColumnKind = value !== null && typeof value === 'object'
        ? 'nested'
        : typeof value === 'number' ? 'number' : 'text'
      const current = seen.get(key)
      if (current === undefined) {
        seen.set(key, kind)
        continue
      }
      // Ayni kolonda karisik tipler varsa en genel gosterim kazanir: metin.
      if (current !== kind) seen.set(key, 'text')
    }
  }
  return [...seen].map(([name, kind]) => ({ name, kind }))
})

/** Ozet olarak gosterilen ic ice alanlar; alt seritte bilgi olarak yazilir. */
const nestedKeys = computed(() => columns.value.filter(c => c.kind === 'nested').map(c => c.name))

const sort = ref<{ col: string; dir: 'asc' | 'desc' } | null>(null)
const columnFilters = ref<Record<string, string>>({})
const selectedIndex = ref<number | null>(null)

watch(() => props.path, () => {
  sort.value = null
  columnFilters.value = {}
  selectedIndex.value = null
})

function toggleSort(col: string) {
  // Ayni kolona ikinci tiklama yonu cevirir; baska kolona gecince asc'den baslar.
  if (sort.value?.col === col) sort.value = { col, dir: sort.value.dir === 'asc' ? 'desc' : 'asc' }
  else sort.value = { col, dir: 'asc' }
}

function cellText(value: JsonValue | undefined): string {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${value.length} öğe]`
  if (typeof value === 'object') return `{${Object.keys(value).length} alan}`
  // Cok satirli metin hucrede tek satira iner; satir sonu gorunur kalir.
  return String(value).replace(/\r?\n/g, ' ↵ ')
}

function isNested(value: JsonValue | undefined): boolean {
  return value !== null && value !== undefined && typeof value === 'object'
}

/** Kolon filtresi ve CSV ic ice alanlarda tam JSON metni uzerinden calisir. */
function searchText(value: JsonValue | undefined): string {
  if (value === undefined) return ''
  if (isNested(value)) return JSON.stringify(value)
  return value === null ? 'null' : String(value)
}

/** Satirlar orijinal indeksleriyle tasinir; secim ve yol bu indekse baglidir. */
const rows = computed(() => {
  const filters = Object.entries(columnFilters.value)
    .map(([col, text]) => [col, text.trim().toLowerCase()] as const)
    .filter(([, text]) => text.length > 0)

  let list = props.items.map((item, index) => ({ index, item }))
  if (filters.length > 0) {
    list = list.filter(({ item }) =>
      filters.every(([col, text]) => searchText(item[col]).toLowerCase().includes(text)),
    )
  }

  const active = sort.value
  if (active) {
    const kind = columns.value.find(c => c.name === active.col)?.kind ?? 'text'
    const factor = active.dir === 'asc' ? 1 : -1
    list = [...list].sort((a, b) => {
      const av = a.item[active.col]
      const bv = b.item[active.col]
      if (kind === 'number') return factor * (Number(av ?? 0) - Number(bv ?? 0))
      if (kind === 'nested') return factor * (childCount(av) - childCount(bv))
      return factor * cellText(av).localeCompare(cellText(bv), 'tr')
    })
  }
  return list
})

function childCount(value: JsonValue | undefined): number {
  if (!isNested(value)) return -1
  return Array.isArray(value) ? value.length : Object.keys(value as JsonObject).length
}

const activeFilterSummary = computed(() => {
  const parts = Object.entries(columnFilters.value)
    .filter(([, text]) => text.trim().length > 0)
    .map(([col, text]) => `${col}: ${text.trim()}`)
  return parts.length > 0 ? parts.join(' · ') : ''
})

function clearFilters() {
  columnFilters.value = {}
}

/** Toplam seridindeki tutar; siralanan kolon sayisalsa o, degilse ilk sayisal kolon. */
const sumColumn = computed(() => {
  const sorted = columns.value.find(c => c.name === sort.value?.col && c.kind === 'number')
  return sorted ?? columns.value.find(c => c.kind === 'number') ?? null
})

const sumValue = computed(() => {
  const col = sumColumn.value
  if (!col) return null
  const total = rows.value.reduce((acc, { item }) => acc + (Number(item[col.name]) || 0), 0)
  return total.toLocaleString('tr-TR', { maximumFractionDigits: 2 })
})

const selectedLabel = computed(() => {
  if (selectedIndex.value === null) return null
  const item = props.items[selectedIndex.value]
  if (!item) return null
  const idColumn = columns.value.find(c => /ID$/i.test(c.name))
  return idColumn ? cellText(item[idColumn.name]) : `#${selectedIndex.value}`
})

/**
 * Satir secimi tabloda kalir. Onceden secim dogrudan `focusPath` yayiyordu;
 * uygulama da odak isteginde Tablo modundan Grid'e gectigi icin tabloda bir
 * satira tiklamak tabloyu kapatiyordu. Artik secim satir detayini acar, grid'e
 * gecis yalnizca detaydaki acik dugmeyle olur.
 */
function select(index: number) {
  selectedIndex.value = selectedIndex.value === index ? null : index
  if (selectedIndex.value !== null) selectField?.(`${props.path}.${index}`)
}

function openInGrid(path: string) {
  emit('focusPath', path)
}

/**
 * Ic ice hucre tiklamasi bir alt seviyeye iner (tablo icinde gezinme). Satirin
 * kendisine tiklamak satir detayini acar; ikisi ayri hareket.
 */
function onCellClick(row: { index: number; item: JsonObject }, name: string, event: MouseEvent) {
  const value = row.item[name]
  if (!isNested(value)) return
  event.stopPropagation()
  selectField?.(`${props.path}.${row.index}.${name}`)
  emit('descend', `${props.path}.${row.index}.${name}`)
}

/** Secili satirin tum alanlari: ic ice olanlar tam JSON, uzun metinler tam haliyle. */
const DETAIL_CHARS = 20_000

const detailFields = computed(() => {
  if (selectedIndex.value === null) return []
  const item = props.items[selectedIndex.value]
  if (!item) return []
  return Object.entries(item).map(([name, value]) => {
    const nested = isNested(value)
    const full = nested
      ? JSON.stringify(value, null, 2)
      : value === null ? 'null' : String(value)
    return {
      name,
      nested,
      path: `${props.path}.${selectedIndex.value}.${name}`,
      type: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value,
      text: full.length > DETAIL_CHARS ? full.slice(0, DETAIL_CHARS) : full,
      clipped: Math.max(0, full.length - DETAIL_CHARS),
      color: colorOf(name, value),
    }
  })
})

const selectedPath = computed(() =>
  selectedIndex.value === null ? null : `${props.path}.${selectedIndex.value}`,
)

/** Kolonlarin genislik agirligi: kimlik ve tarih alanlari daha genis. */
function flexOf(name: string, kind: ColumnKind): number {
  if (kind === 'nested') return 0.7
  if (/date|time/i.test(name)) return 1.3
  if (/ID$/i.test(name)) return 1.2
  if (kind === 'number') return 0.8
  if (name.length <= 7) return 0.6
  return 1
}

function colorOf(name: string, value: JsonValue | undefined): string {
  if (value === undefined || value === null) return 'var(--color-null)'
  if (Array.isArray(value)) return 'var(--green)'
  if (typeof value === 'object') return 'var(--purple)'
  if (typeof value === 'number') return 'var(--color-number)'
  if (typeof value === 'boolean') return 'var(--color-bool)'
  if (/Status(Code)?$/i.test(name)) {
    const text = String(value).toUpperCase()
    if (/OPEN|OK|ACTIVE|CONFIRM/.test(text)) return 'var(--green)'
    if (/PEND|WARN|HOLD/.test(text)) return 'var(--orange)'
    if (/CLOSE|CANCEL|VOID|EXPIRE/.test(text)) return 'var(--text-muted)'
  }
  if (/Ref(ID|Id)$/.test(name)) return 'var(--cyan)'
  return 'var(--color-string)'
}

function downloadCsv() {
  const names = columns.value.map(c => c.name)
  const escape = (text: string) => (/[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text)
  const lines = [
    names.join(';'),
    // Ic ice alanlar CSV'de sikistirilmis JSON olarak cikar; ozet metin veri kaybi olurdu.
    ...rows.value.map(({ item }) => names.map(name => escape(searchText(item[name]))).join(';')),
  ]
  // Excel'in UTF-8'i dogru okumasi icin BOM sart.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${props.path.split('.').filter(s => !/^\d+$/.test(s)).slice(-1)[0] ?? 'tablo'}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

/** Cok satirli tablolarda yalnizca bir pencere render edilir. */
const PAGE = 200
const rendered = ref(PAGE)
watch(rows, () => { rendered.value = PAGE })
const visibleRows = computed(() => rows.value.slice(0, rendered.value))
const pendingRows = computed(() => Math.max(0, rows.value.length - rendered.value))
</script>

<template>
  <div class="array-table" :class="variant">
    <div v-if="variant === 'full'" class="strip">
      <span class="count-pill">{{ items.length.toLocaleString('tr-TR') }} kayıt</span>
      <span class="strip-hint">iç içe hücre: bir seviye aşağı · satır: detay</span>
      <span v-if="activeFilterSummary" class="strip-filters">{{ activeFilterSummary }}</span>
      <div class="spacer" />
      <button class="strip-btn clear" :disabled="!activeFilterSummary" @click="clearFilters">Filtreleri temizle</button>
      <button class="strip-btn csv" @click="downloadCsv">CSV indir</button>
    </div>

    <div class="head">
      <div
        v-for="col in columns"
        :key="col.name"
        class="head-col"
        :style="{ flex: flexOf(col.name, col.kind) }"
      >
        <button class="head-sort" :class="{ active: sort?.col === col.name }" @click="toggleSort(col.name)">
          <span class="head-name" :title="col.name">{{ col.name }}</span>
          <span v-if="sort?.col === col.name" class="head-arrow">{{ sort.dir === 'asc' ? '▲' : '▼' }}</span>
          <span v-if="variant === 'full'" class="head-kind">
            {{ col.kind === 'number' ? 'num' : col.kind === 'nested' ? 'obj' : 'str' }}
          </span>
        </button>
        <div v-if="variant === 'full'" class="head-filter">
          <input
            v-model="columnFilters[col.name]"
            class="filter-input"
            :class="{ filled: (columnFilters[col.name] ?? '').length > 0 }"
            type="text"
            placeholder="filtre"
          />
        </div>
      </div>
      <!-- Satir detayi dugmesinin kolonu; baslikta bos durur ki hizalama bozulmasin. -->
      <div class="head-gutter" />
    </div>

    <div class="body">
      <template v-for="row in visibleRows" :key="row.index">
        <div
          class="row"
          :class="{ odd: row.index % 2 === 1, selected: selectedIndex === row.index }"
          @click="select(row.index)"
        >
          <div
            v-for="col in columns"
            :key="col.name"
            class="cell"
            :class="{ nested: isNested(row.item[col.name]) }"
            :title="isNested(row.item[col.name])
              ? `${col.name} — içine gir\n${searchText(row.item[col.name]).slice(0, 300)}`
              : searchText(row.item[col.name]).slice(0, 400)"
            @click="onCellClick(row, col.name, $event)"
            :style="{
              flex: flexOf(col.name, col.kind),
              color: colorOf(col.name, row.item[col.name]),
              textAlign: col.kind === 'number' ? 'right' : 'left',
            }"
          >{{ cellText(row.item[col.name]) }}</div>
          <!--
            Ic ice hucreler bir alt seviyeye indigi icin satirin ortasina
            tiklamak her zaman detayi acmaz; detay bu dugmeyle her satirda
            erisilebilir kalir.
          -->
          <button
            class="row-detail"
            :class="{ open: selectedIndex === row.index }"
            title="Satır detayı: tüm alanlar, tam değerler"
            @click.stop="select(row.index)"
          >⋯</button>
        </div>

        <!--
          Satir detayi tiklanan satirin hemen altinda acilir: hucreler tek
          satira sigmadigi icin uzun metinler ve ic ice nesneler ancak burada
          tam haliyle okunabiliyor. Detay tablonun icinde durdugu icin kayit
          incelemek gorunumden cikmayi gerektirmez.
        -->
        <div v-if="selectedIndex === row.index && detailFields.length > 0" class="detail">
          <div class="detail-head">
            <code class="detail-path">{{ selectedPath?.split('.').slice(1).join('.') }}</code>
            <span class="detail-count">{{ detailFields.length }} alan</span>
            <div class="spacer" />
            <button class="detail-btn" @click.stop="openInGrid(selectedPath!)">Grid'de aç</button>
            <button class="detail-close" title="Detayı kapat" @click.stop="selectedIndex = null">×</button>
          </div>
          <div class="detail-body">
            <div v-for="field in detailFields" :key="field.name" class="detail-field">
              <div class="detail-key">
                <span class="detail-name">{{ field.name }}</span>
                <span class="detail-type">{{ field.type }}</span>
                <button
                  v-if="field.nested"
                  class="detail-goto"
                  title="Bu alanı tabloda aç"
                  @click.stop="emit('descend', field.path)"
                >⊞</button>
                <button
                  class="detail-goto"
                  title="Bu alanı grid'de aç"
                  @click.stop="openInGrid(field.path)"
                >↗</button>
              </div>
              <pre class="detail-value" :style="{ color: field.color }">{{ field.text }}</pre>
              <p v-if="field.clipped > 0" class="detail-clip">
                +{{ field.clipped.toLocaleString('tr-TR') }} karakter daha (kırpıldı)
              </p>
            </div>
          </div>
        </div>
      </template>

      <div v-if="rows.length === 0" class="empty-note">Filtrelerle eşleşen kayıt yok.</div>

      <div v-if="pendingRows > 0" class="virtual-note">
        <span class="virtual-dot" />
        {{ rows.length.toLocaleString('tr-TR') }} kayıt eşleşti · {{ visibleRows.length }} satır render edildi
        <button class="more-btn" @click="rendered += PAGE * 5">daha fazla</button>
      </div>
    </div>

    <div v-if="variant === 'full'" class="totals">
      <span class="total"><span class="total-label">kayıt</span><span class="total-value">{{ rows.length.toLocaleString('tr-TR') }}</span></span>
      <span v-if="sumColumn" class="total">
        <span class="total-label">toplam {{ sumColumn.name }}</span>
        <span class="total-value num">{{ sumValue }}</span>
      </span>
      <span v-if="sort" class="total">
        <span class="total-label">sıralama</span>
        <span class="total-value accent">{{ sort.col }} {{ sort.dir === 'asc' ? '↑' : '↓' }}</span>
      </span>
      <span v-if="selectedLabel" class="total">
        <span class="total-label">seçili</span>
        <span class="total-value purple">{{ selectedLabel }}</span>
      </span>
      <div class="spacer" />
      <span v-if="nestedKeys.length > 0" class="total nested-note">
        {{ nestedKeys.length }} iç içe alan özet gösteriliyor ({{ nestedKeys.join(', ') }}) — satıra tıklayın
      </span>
    </div>

    <div v-else class="inline-foot">
      {{ rows.length.toLocaleString('tr-TR') }} kayıt · {{ columns.length }} kolon
      <template v-if="nestedKeys.length > 0"> · {{ nestedKeys.length }} iç içe alan özet</template>
      <button class="foot-btn" @click="emit('expand', path)">tam ekran</button>
    </div>
  </div>
</template>

<style scoped>
.array-table { display: flex; flex-direction: column; min-height: 0; }
.array-table.inline { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.array-table.full { flex: 1; }
.spacer { flex: 1; }

.strip { display: flex; align-items: center; gap: 10px; padding: 9px 14px; background: var(--bg-secondary); border-bottom: 1px solid var(--border-subtle); flex-shrink: 0; }
.strip-hint { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.count-pill { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--purple); background: var(--bg-object); border-radius: 20px; padding: 2px 9px; }
.strip-filters { font-size: 11.5px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.strip-btn { font-size: 11.5px; color: var(--text-muted); border: 1px solid var(--border); border-radius: 6px; padding: 3px 9px; white-space: nowrap; }
.strip-btn.clear:hover:not(:disabled) { color: var(--red); border-color: var(--red); }
.strip-btn.clear:disabled { opacity: .4; cursor: not-allowed; }
.strip-btn.csv { color: var(--accent); }
.strip-btn.csv:hover { background: var(--accent-dim); }
.strip-btn.back { color: var(--text-secondary); }
.strip-btn.back:hover { color: var(--accent); border-color: var(--accent); }

.head { display: flex; background: var(--bg-secondary); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.head-col { min-width: 0; border-right: 1px solid var(--border-subtle); }
.head-sort { display: flex; align-items: center; gap: 5px; width: 100%; padding: 8px 10px 5px; text-align: left; }
.inline .head-sort { padding: 6px 9px; }
.head-sort:hover { background: var(--bg-tertiary); }
.head-name { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; font-weight: 700; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.head-sort.active .head-name { color: var(--accent); }
.head-arrow { font-size: 9px; color: var(--accent); }
.head-kind { margin-left: auto; font-size: 9px; color: var(--text-muted); }
.head-filter { padding: 0 8px 7px; }
.head-gutter { width: 26px; flex-shrink: 0; }
.filter-input { width: 100%; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 5px; outline: none; color: var(--text-primary); font-family: 'JetBrains Mono', monospace; font-size: 11px; padding: 3px 7px; }
.filter-input.filled, .filter-input:focus { border-color: var(--accent); }

.body { flex: 1; min-height: 0; overflow-y: auto; }
.row { display: flex; border-bottom: 1px solid var(--border-subtle); cursor: pointer; transition: background .1s; }
.row.odd { background: var(--row-zebra); }
.row:hover { background: var(--bg-secondary); }
.row.selected { background: var(--purple-wash); box-shadow: inset 2px 0 0 var(--purple); }
.cell { min-width: 0; padding: 6px 10px; font-family: 'JetBrains Mono', monospace; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-right: 1px solid var(--border-subtle); }
.inline .cell { padding: 5px 9px; font-size: 11.5px; }

.row-detail { width: 26px; flex-shrink: 0; font-size: 13px; line-height: 1; color: var(--text-muted); opacity: 0; }
.row:hover .row-detail { opacity: 1; }
.row-detail:hover { color: var(--accent); background: var(--accent-dim); }
.row-detail.open { opacity: 1; color: var(--purple); }

.cell.nested { font-style: italic; }
.row:hover .cell.nested { text-decoration: underline dotted; }

.detail { border-bottom: 1px solid var(--border); background: var(--bg-secondary); box-shadow: inset 2px 0 0 var(--purple); }
.detail-head { display: flex; align-items: center; gap: 10px; padding: 7px 12px; border-bottom: 1px solid var(--border-subtle); }
.detail-path { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.detail-count { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--text-muted); white-space: nowrap; }
.detail-btn { font-size: 11px; color: var(--accent); border: 1px solid var(--border); border-radius: 6px; padding: 2px 9px; white-space: nowrap; }
.detail-btn:hover { background: var(--accent-dim); }
.detail-close { font-size: 15px; line-height: 1; color: var(--text-muted); padding: 0 4px; }
.detail-close:hover { color: var(--red); }
.detail-body { padding: 4px 12px 10px; }
.detail-field { padding: 6px 0; border-bottom: 1px solid var(--border-subtle); }
.detail-field:last-child { border-bottom: none; }
.detail-key { display: flex; align-items: center; gap: 7px; }
.detail-name { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; color: var(--color-key); }
.detail-type { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: var(--text-muted); text-transform: uppercase; }
.detail-goto { font-size: 11px; color: var(--accent); border-radius: 4px; padding: 0 5px; }
.detail-goto:hover { background: var(--accent-dim); }
.detail-value { margin: 3px 0 0; font-family: 'JetBrains Mono', monospace; font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 200px; overflow-y: auto; }
.detail-clip { font-size: 10px; color: var(--orange); margin-top: 3px; }

.empty-note { padding: 14px; text-align: center; font-size: 11.5px; color: var(--text-muted); }
.virtual-note { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 12px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-muted); }
.virtual-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--orange); }
.more-btn { font-size: 11px; color: var(--accent); background: var(--accent-dim); padding: 2px 9px; border-radius: 5px; }

.totals { display: flex; align-items: center; gap: 14px; min-height: 32px; padding: 0 14px; background: var(--bg-secondary); border-top: 1px solid var(--border); flex-shrink: 0; }
.total { display: flex; align-items: center; gap: 6px; font-family: 'JetBrains Mono', monospace; font-size: 11px; }
.total-label { color: var(--text-muted); }
.total-value { color: var(--text-primary); }
.total-value.num { color: var(--color-number); }
.total-value.accent { color: var(--accent); }
.total-value.purple { color: var(--purple); }
.nested-note { color: var(--text-muted); font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.inline-foot { display: flex; align-items: center; gap: 8px; padding: 6px 9px; background: var(--bg-secondary); font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-muted); }
.foot-btn { margin-left: auto; font-size: 11px; color: var(--accent); padding: 1px 8px; border-radius: 4px; border: 1px solid var(--border); }
.foot-btn:hover { background: var(--accent-dim); }
</style>
