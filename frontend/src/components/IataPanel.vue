<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AnnotateResponse, JsonValue } from '../types'
import type { RefTarget } from '../utils/references'
import type { FieldValueStats } from '../utils/related'
import { previewFields } from '../utils/grid'
import { cellText } from '../utils/grid'

/**
 * Sag panel: **secili alan hakkinda ne biliyoruz**.
 *
 * Dort katman, hepsi ayni soruya farkli acidan cevap veriyor:
 * referans karti (bu deger neyi gosteriyor), alan dokumantasyonu (XSD'de ne
 * demek), deger dagilimi (belgede hangi degerler var), semada karsiligi
 * olmayanlar (neresi tanimsiz).
 *
 * Panel **kapatilabilir**: dar ekranda ya da yalnizca veriye bakilirken
 * 272px'i geri vermek gerekiyor.
 */
const props = defineProps<{
  annotation: AnnotateResponse | null
  loading?: boolean
  error?: string | null
  /** Goruntuleyicide secili alanin XSD yolu. */
  selectedPath?: string | null
  /** Secili alanin tam dugum yolu; en altta gosterilir. */
  nodePath?: string | null
  /** Acik referans karti. */
  refTarget?: RefTarget | null
  /** Secili alanin belgedeki deger dagilimi. */
  values?: FieldValueStats | null
}>()

const emit = defineEmits<{
  focusPath: [path: string]
  closeRef: []
  collapse: []
}>()

const UNMATCHED_PAGE = 30
const showAllUnmatched = ref(false)

watch(() => props.annotation, () => { showAllUnmatched.value = false })

const matchPercent = computed(() => {
  if (!props.annotation?.messageType) return null
  return Math.round((props.annotation.confidence ?? 0) * 100)
})

const selectedField = computed(() => {
  if (!props.selectedPath) return null
  return props.annotation?.fields.find(field => field.path === props.selectedPath) ?? null
})

/** Semada karsiligi olmayan alanlarda bile baslikta ad gosterilir. */
const selectedName = computed(() => {
  if (selectedField.value) return selectedField.value.name
  if (!props.selectedPath) return null
  return props.selectedPath.split('.').pop() ?? props.selectedPath
})

/** Alanin durumu: semada var / tahmini / karsiligi yok. */
const status = computed(() => {
  const field = selectedField.value
  if (!field) return { text: 'karşılığı yok', tone: 'changed' as const }
  if (field.matchKind === 'INFERRED') return { text: 'tahmini eşleşme', tone: 'guess' as const }
  return { text: 'şemada var', tone: 'added' as const }
})

const unmatched = computed(() => props.annotation?.unmatchedPaths ?? [])
const visibleUnmatched = computed(() =>
  showAllUnmatched.value ? unmatched.value : unmatched.value.slice(0, UNMATCHED_PAGE),
)

/** Referans kartinda gosterilecek alanlar. */
const refFields = computed(() => {
  const target = props.refTarget
  if (!target) return []
  return previewFields(target.value).map(field => ({
    key: field.key,
    text: valueText(field.value),
  }))
})

function valueText(value: JsonValue | undefined): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return cellText(value)
  return String(value)
}

const refTitle = computed(() => {
  const target = props.refTarget
  if (!target) return ''
  return target.path.split('.').slice(-2).join('.')
})

/** Dagilim cubuklarinin orani: en sik deger tam genislik. */
const distribution = computed(() => {
  const stats = props.values
  if (!stats || stats.distinct.length === 0) return null
  const max = Math.max(...stats.distinct.map(item => item.count), 1)
  return {
    label: stats.fieldPath.split('.').slice(-2).join('.'),
    items: stats.distinct.slice(0, 8).map(item => ({
      text: item.text,
      count: item.count,
      ratio: item.count / max,
      path: item.firstPath,
    })),
  }
})
</script>

<template>
  <aside class="side">
    <div class="head">
      <span class="title">IATA 24.4</span>
      <span v-if="loading" class="match">analiz…</span>
      <span v-else-if="annotation?.messageType" class="match">
        {{ annotation.messageType.replace(/^IATA_/, '') }} · %{{ matchPercent }} eşleşme
      </span>
      <div class="spacer" />
      <button class="close" title="Paneli kapat" @click="emit('collapse')">×</button>
    </div>

    <div class="body">
      <p v-if="error" class="warn">{{ error }}</p>
      <p v-else-if="annotation && !annotation.schemaLoaded" class="warn">
        Sunucuda XSD şeması yüklü değil, alan açıklaması üretilemiyor.
      </p>

      <!-- Referans karti: en ustte, kendi kapatma dugmesiyle. -->
      <section v-if="refTarget" class="card">
        <div class="card-head">
          <span class="card-label">referans</span>
          <div class="spacer" />
          <button class="close small" title="Kartı kapat" @click="emit('closeRef')">×</button>
        </div>
        <p class="card-title">{{ refTitle }}</p>
        <dl class="fields">
          <template v-for="field in refFields" :key="field.key">
            <dt class="fkey">{{ field.key }}</dt>
            <dd class="fval">{{ field.text }}</dd>
          </template>
        </dl>
        <button class="goto" @click="emit('focusPath', refTarget.path)">hedefe git →</button>
      </section>

      <!-- Alan dokumantasyonu -->
      <section v-if="selectedName" class="doc">
        <p class="field-name">{{ selectedName }}</p>
        <p class="field-meta">
          <span v-if="selectedField?.type" class="xsd">{{ selectedField.type }}</span>
          <span class="status" :class="status.tone">{{ status.text }}</span>
        </p>
        <p v-if="selectedField?.matchKind === 'INFERRED' && selectedField.evidence" class="evidence">
          Alan adı şemadakiyle tutmuyor; {{ selectedField.evidence }} çıkarıldı.
        </p>
        <p v-if="selectedField?.documentation" class="desc">{{ selectedField.documentation }}</p>
        <p v-if="nodePath" class="full-path">{{ nodePath }}</p>
      </section>
      <p v-else class="hint">Grid'de bir satıra tıklayın; alanın XSD karşılığı burada görünür.</p>

      <!-- Deger dagilimi -->
      <section v-if="distribution" class="dist">
        <p class="dist-title">{{ distribution.label }} dağılımı</p>
        <button
          v-for="item in distribution.items"
          :key="item.text"
          class="dist-row"
          :title="`${item.text} — bu değerin ilk geçtiği yere git`"
          @click="emit('focusPath', item.path)"
        >
          <span class="dist-head">
            <span class="dist-value">{{ item.text }}</span>
            <span class="dist-count">{{ item.count.toLocaleString('tr-TR') }}</span>
          </span>
          <span class="bar"><span class="bar-fill" :style="{ width: `${Math.round(item.ratio * 100)}%` }" /></span>
        </button>
      </section>

      <!-- Semada karsiligi olmayanlar -->
      <section v-if="unmatched.length > 0" class="unmatched">
        <p class="dist-title">şemada yok</p>
        <button
          v-for="path in visibleUnmatched"
          :key="path"
          class="miss"
          @click="emit('focusPath', path)"
        >
          <span class="miss-dot">●</span>
          <span class="miss-path">{{ path }}</span>
        </button>
        <button
          v-if="unmatched.length > visibleUnmatched.length"
          class="more"
          @click="showAllUnmatched = true"
        >{{ unmatched.length - visibleUnmatched.length }} tane daha</button>
      </section>

      <!-- Yorumlar: yalnizca paylasilan gorunumde. -->
      <section v-if="$slots.comments" class="comments">
        <slot name="comments" />
      </section>
    </div>
  </aside>
</template>

<style scoped>
.side {
  width: var(--side-w); flex-shrink: 0; display: flex; flex-direction: column;
  background: var(--bg-chrome); border-left: 1px solid var(--line); min-height: 0;
}

.head {
  display: flex; align-items: center; gap: 10px; height: var(--h-tabs);
  padding: 0 12px; border-bottom: 1px solid var(--line-panel); flex-shrink: 0;
}
.title { font-size: 11px; color: var(--ink-4); white-space: nowrap; }
.match { font-size: 11px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spacer { flex: 1; }
.close { font-size: 13px; color: var(--ink-4); line-height: 1; padding: 2px 4px; }
.close:hover { color: var(--ink); }
.close.small { font-size: 12px; }

.body { flex: 1; min-height: 0; overflow-y: auto; }
.warn { padding: 10px 12px; font-size: 11px; color: var(--removed); line-height: 1.5; }
.hint { padding: 12px; font-size: 11.5px; color: var(--ink-4); line-height: 1.5; text-wrap: pretty; }

/* Referans karti: beyaz zeminde, panelin geri kalanindan ayri. */
.card { background: var(--bg-data); border-bottom: 1px solid var(--line-panel); padding: 10px 12px; }
.card-head { display: flex; align-items: center; }
.card-label { font-size: 10.5px; color: var(--ink-5); }
.card-title { font-size: 11.5px; color: var(--ink); margin: 4px 0 7px; word-break: break-all; }
.fields { display: grid; grid-template-columns: 98px 1fr; gap: 2px 8px; }
.fkey { font-size: 11px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fval { font-size: 11px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.goto { margin-top: 8px; font-size: 11px; color: var(--accent); }
.goto:hover { color: var(--accent-hover); }

.doc { padding: 12px; border-bottom: 1px solid var(--line-panel); }
.field-name { font-size: 13px; color: var(--ink); }
.field-meta { display: flex; align-items: center; gap: 8px; margin-top: 3px; flex-wrap: wrap; }
.xsd { font-size: 11px; color: var(--ink-3); }
.status { font-size: 11px; }
.status.added { color: var(--added); }
.status.guess { color: var(--type-boolean); }
.status.changed { color: var(--changed); }
.evidence { font-size: 11px; color: var(--ink-3); line-height: 1.5; margin-top: 6px; text-wrap: pretty; }
.desc { font-size: 11.5px; color: var(--ink-2); line-height: 1.55; margin-top: 7px; text-wrap: pretty; }
.full-path { font-size: 10.5px; color: var(--ink-5); margin-top: 8px; word-break: break-all; }

.dist { padding: 12px; border-bottom: 1px solid var(--line-panel); }
.dist-title { font-size: 11px; color: var(--ink-4); margin-bottom: 8px; }
.dist-row { display: block; width: 100%; text-align: left; margin-bottom: 7px; }
.dist-head { display: flex; align-items: baseline; gap: 8px; }
.dist-value { font-size: 11.5px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dist-count { margin-left: auto; font-size: 11px; color: var(--ink-4); flex-shrink: 0; }
.bar { display: block; height: 4px; background: var(--bg-inset); margin-top: 3px; }
.bar-fill { display: block; height: 100%; background: var(--bar-fill); }
.dist-row:hover .dist-value { color: var(--ink); }

.unmatched { padding: 12px; }
.miss { display: flex; align-items: baseline; gap: 7px; width: 100%; text-align: left; padding: 2px 0; }
.miss-dot { font-size: 9px; color: var(--changed); flex-shrink: 0; }
.miss-path { font-size: 11px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.miss:hover .miss-path { color: var(--accent); }
.more { font-size: 11px; color: var(--ink-4); margin-top: 6px; }
.more:hover { color: var(--ink); }

.comments { border-top: 1px solid var(--line-panel); padding: 10px 12px; max-height: 250px; overflow-y: auto; }
</style>
