<script setup lang="ts">
import { computed } from 'vue'
import type { RecentFile } from '../utils/storage'
import { formatRelative, formatSize } from '../utils/storage'
import { parseJson } from '../utils/json'

/**
 * Fark sekmesi: karsilastirmanin **girdi** tarafi.
 *
 * Eski akista ikinci belge yalnizca bir paylasim linkinden gelebiliyordu;
 * elinde iki dosya olan kisi karsilastiramiyordu. Burada iki taraf da elle
 * yapistirilabiliyor, yazdikca sayilar ve orta bolgedeki A/B yeniden
 * hesaplaniyor.
 */
const props = defineProps<{
  textA: string
  textB: string
  currentName: string
  recents: RecentFile[]
  onlyChanges: boolean
  index: number
  total: number
  summary: { added: number; removed: number; changed: number } | null
  note: string
  /** Paylasilan belge: A tarafi ana editore alinamaz, girdi salt okunur. */
  readonly?: boolean
}>()

const emit = defineEmits<{
  'update:textA': [value: string]
  'update:textB': [value: string]
  'update:onlyChanges': [value: boolean]
  step: [step: number]
  swap: []
  useA: []
  close: []
}>()

/** Bir tarafin canli durumu: gecerli mi, kac satir, hata hangi satirda. */
function statusOf(text: string) {
  if (!text.trim()) return { ok: false, empty: true, lines: 0, error: null as string | null }
  const lines = text.split('\n').length
  const result = parseJson(text)
  if (result.error) {
    const match = /line (\d+)/i.exec(result.error)
    return { ok: false, empty: false, lines, error: match ? `satır ${match[1]}` : 'geçersiz' }
  }
  return { ok: true, empty: false, lines, error: null }
}

const statusA = computed(() => statusOf(props.textA))
const statusB = computed(() => statusOf(props.textB))

/** Ozet cubuklarinin oranlari; en buyuk sayi tam genislik olur. */
const bars = computed(() => {
  const s = props.summary
  if (!s) return null
  const max = Math.max(s.added, s.removed, s.changed, 1)
  return [
    { key: 'added', label: `${s.added} eklendi`, ratio: s.added / max, tone: 'added' },
    { key: 'removed', label: `${s.removed} silindi`, ratio: s.removed / max, tone: 'removed' },
    { key: 'changed', label: `${s.changed} değişti`, ratio: s.changed / max, tone: 'changed' },
  ]
})

async function pasteB() {
  try {
    const value = await navigator.clipboard.readText()
    if (value) emit('update:textB', value)
  } catch {
    // Pano izni yoksa kullanici elle yapistirir.
  }
}

function pickRecent(file: RecentFile) {
  if (file.content !== undefined) emit('update:textB', file.content)
}

const canPick = computed(() => props.recents.some(file => file.content !== undefined))
</script>

<template>
  <div class="diff-panel">
    <!-- A tarafi: genellikle editordeki belge. -->
    <div class="block">
      <div class="block-head">
        <span class="side">A</span>
        <span class="source">{{ currentName || 'girdi' }}</span>
        <div class="spacer" />
        <button v-if="!readonly" class="link" title="A'yı ana editöre al" @click="emit('useA')">girdide düzenle</button>
      </div>
      <textarea
        class="box"
        :class="{ bad: statusA.error }"
        spellcheck="false"
        placeholder="A tarafı JSON"
        :value="textA"
        @input="emit('update:textA', ($event.target as HTMLTextAreaElement).value)"
      />
      <p class="state" :class="{ bad: statusA.error }">
        <template v-if="statusA.empty">boş</template>
        <template v-else-if="statusA.error">geçersiz · {{ statusA.error }}</template>
        <template v-else>geçerli · {{ statusA.lines.toLocaleString('tr-TR') }} satır</template>
      </p>
    </div>

    <!-- B tarafi: yapistirilir ya da gecmisten secilir. -->
    <div class="block">
      <div class="block-head">
        <span class="side">B</span>
        <span class="source">karşılaştırılan</span>
        <div class="spacer" />
        <button class="link" @click="pasteB">yapıştır</button>
      </div>
      <textarea
        class="box"
        :class="{ bad: statusB.error }"
        spellcheck="false"
        placeholder="B tarafı JSON"
        :value="textB"
        @input="emit('update:textB', ($event.target as HTMLTextAreaElement).value)"
      />
      <p class="state" :class="{ bad: statusB.error }">
        <template v-if="statusB.empty">boş</template>
        <template v-else-if="statusB.error">geçersiz · {{ statusB.error }}</template>
        <template v-else>geçerli · {{ statusB.lines.toLocaleString('tr-TR') }} satır</template>
      </p>

      <template v-if="canPick">
        <p class="pick-label">ya da B'yi geçmişten seç</p>
        <button
          v-for="file in recents.filter(f => f.content !== undefined)"
          :key="file.name"
          class="pick"
          @click="pickRecent(file)"
        >
          <span class="pick-dot" />
          <span class="pick-name">{{ file.name }}</span>
          <span class="pick-meta">{{ formatSize(file.size) }} · {{ formatRelative(file.openedAt) }}</span>
        </button>
      </template>
    </div>

    <!-- Ozet: sayilar ve oran cubuklari. -->
    <div v-if="bars" class="summary">
      <div v-for="bar in bars" :key="bar.key" class="bar-row">
        <span class="bar-label" :class="bar.tone">{{ bar.label }}</span>
        <span class="bar-track"><span class="bar-fill" :class="bar.tone" :style="{ width: `${Math.round(bar.ratio * 100)}%` }" /></span>
      </div>
    </div>
    <p v-if="note" class="note">{{ note }}</p>

    <!-- Gezinme: degisiklikler arasi atlama, taraf degistirme. -->
    <div class="nav">
      <button class="link" :class="{ on: onlyChanges }" @click="emit('update:onlyChanges', !onlyChanges)">yalnız değişenler</button>
      <div class="spacer" />
      <button class="step" :disabled="total === 0" title="Önceki değişiklik" @click="emit('step', -1)">↑</button>
      <span class="counter">{{ total === 0 ? '0/0' : `${index + 1}/${total}` }}</span>
      <button class="step" :disabled="total === 0" title="Sonraki değişiklik" @click="emit('step', 1)">↓</button>
      <button class="link" title="A ile B'yi değiştir" @click="emit('swap')">A↔B</button>
    </div>
    <button class="close" @click="emit('close')">← karşılaştırmayı kapat</button>
  </div>
</template>

<style scoped>
.diff-panel { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px 14px; display: flex; flex-direction: column; gap: 12px; }

.block { display: flex; flex-direction: column; gap: 5px; }
.block-head { display: flex; align-items: center; gap: 8px; }
.side { font-size: 10.5px; color: var(--ink-5); }
.source { font-size: 12px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spacer { flex: 1; }
.link { font-size: 11px; color: var(--ink-2); white-space: nowrap; }
.link:hover { color: var(--accent); }
.link.on { color: var(--accent); }

.box {
  height: 96px; resize: vertical; background: var(--bg-data);
  border: 1px solid var(--line); border-radius: var(--radius); outline: none;
  font-size: 11px; line-height: 1.5; padding: 7px 9px; white-space: pre; overflow: auto;
}
.box:focus { border-color: var(--accent); }
.box.bad { border-color: var(--removed); }
.state { font-size: 11px; color: var(--ink-3); }
.state.bad { color: var(--removed); }

.pick-label { font-size: 11px; color: var(--ink-4); margin-top: 4px; }
.pick { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 5px 8px; border-radius: var(--radius); }
.pick:hover { background: var(--bg-subtle); }
.pick-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--line-strong); flex-shrink: 0; }
.pick:hover .pick-dot { background: var(--accent); }
.pick-name { font-size: 11.5px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pick-meta { margin-left: auto; font-size: 10.5px; color: var(--ink-4); flex-shrink: 0; }

.summary { display: flex; flex-direction: column; gap: 6px; }
.bar-row { display: flex; align-items: center; gap: 10px; }
.bar-label { width: 74px; font-size: 11px; flex-shrink: 0; }
.bar-label.added { color: var(--added); }
.bar-label.removed { color: var(--removed); }
.bar-label.changed { color: var(--changed); }
.bar-track { flex: 1; height: 4px; background: var(--bg-inset); border-radius: 2px; overflow: hidden; }
.bar-fill { display: block; height: 100%; }
.bar-fill.added { background: var(--added); }
.bar-fill.removed { background: var(--removed); }
.bar-fill.changed { background: var(--changed); }

.note { font-size: 11px; color: var(--ink-3); line-height: 1.5; text-wrap: pretty; }

.nav { display: flex; align-items: center; gap: 8px; }
.step { font-size: 11px; color: var(--ink-2); padding: 0 4px; }
.step:hover:not(:disabled) { color: var(--accent); }
.step:disabled { opacity: .4; cursor: not-allowed; }
.counter { font-size: 11px; color: var(--ink-4); min-width: 34px; text-align: center; }
.close { font-size: 11px; color: var(--ink-4); text-align: left; }
.close:hover { color: var(--ink); }
</style>
