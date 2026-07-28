<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AnnotateResponse } from '../types'

const props = defineProps<{
  annotation: AnnotateResponse | null
  loading?: boolean
  error?: string | null
  /** Goruntuleyicide secili alanin XSD yolu. */
  selectedPath?: string | null
}>()

const emit = defineEmits<{ focusPath: [path: string]; collapse: [] }>()

const UNMATCHED_PAGE = 30
const listOpen = ref(false)
const showAllUnmatched = ref(false)

watch(() => props.annotation, () => {
  showAllUnmatched.value = false
})

const matchPercent = computed(() => {
  if (!props.annotation?.messageType) return null
  return Math.round((props.annotation.confidence ?? 0) * 100)
})

const matchLevel = computed(() => {
  const percent = matchPercent.value
  if (percent === null) return 'none'
  if (percent >= 80) return 'high'
  if (percent >= 40) return 'mid'
  return 'low'
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

const unmatched = computed(() => props.annotation?.unmatchedPaths ?? [])
const visibleUnmatched = computed(() =>
  showAllUnmatched.value ? unmatched.value : unmatched.value.slice(0, UNMATCHED_PAGE),
)
</script>

<template>
  <aside class="iata-panel">
    <div class="panel-head">
      <span class="panel-title">IATA</span>
      <span v-if="loading" class="panel-loading">analiz…</span>
      <span v-else-if="matchPercent !== null" class="panel-score" :class="matchLevel">%{{ matchPercent }}</span>
      <button class="panel-collapse" title="IATA panelini gizle" @click="emit('collapse')">›</button>
    </div>

    <div v-if="error" class="panel-note bad">{{ error }}</div>

    <div v-else-if="annotation && !annotation.schemaLoaded" class="panel-note bad">
      Sunucuda XSD şeması yüklü değil, alan açıklaması üretilemiyor.
      <code>backend/src/main/resources/xsd/</code> klasörünü kontrol edin.
    </div>

    <template v-else-if="annotation?.messageType">
      <div class="message-row">
        <code class="message-type">{{ annotation.messageType }}</code>
      </div>

      <div class="selection">
        <template v-if="selectedName">
          <code class="field-name">{{ selectedName }}</code>
          <div class="tags">
            <span v-if="selectedField?.type" class="tag type">{{ selectedField.type }}</span>
            <span v-if="selectedField?.matchKind === 'INFERRED'" class="tag guess">
              ≈ tahmini %{{ Math.round(selectedField.confidence * 100) }}
            </span>
            <span v-else-if="selectedField" class="tag ok">şemada var</span>
            <span v-else class="tag warn">şemada yok</span>
          </div>
          <p v-if="selectedField?.matchKind === 'INFERRED' && selectedField.evidence" class="evidence">
            Alan adı şemadakiyle tutmuyor; {{ selectedField.evidence }} çıkarıldı. Açıklamayı
            doğrulamadan kesin bilgi saymayın.
          </p>
          <p v-if="selectedField?.documentation" class="description">{{ selectedField.documentation }}</p>
          <p v-else class="description muted">
            Bu alan IATA {{ annotation.messageType }} şemasında bulunamadı; adı özel bir uzantı olabilir.
          </p>
        </template>
        <p v-else class="description muted">
          Grid'de bir satıra tıklayın; alanın XSD karşılığı burada görünür.
        </p>
      </div>

      <div class="legend">
        <p class="legend-line">
          <span class="mark accent">ⓘ</span> şemada var · <span class="mark guess">≈</span> tahmini ·
          <span class="mark warn">●</span> şemada yok
        </p>
        <button v-if="unmatched.length > 0" class="legend-action" @click="listOpen = !listOpen">
          <span class="warn-count">{{ annotation.unmatchedCount }} alan</span> karşılıksız —
          {{ listOpen ? 'gizle' : 'listele' }}
        </button>
      </div>

      <div v-if="listOpen && unmatched.length > 0" class="unmatched-list">
        <button
          v-for="path in visibleUnmatched"
          :key="path"
          class="unmatched"
          :title="path"
          @click="emit('focusPath', path)"
        >{{ path }}</button>
        <button
          v-if="!showAllUnmatched && unmatched.length > UNMATCHED_PAGE"
          class="unmatched more"
          @click="showAllUnmatched = true"
        >{{ unmatched.length - UNMATCHED_PAGE }} tane daha</button>
        <p v-if="annotation.unmatchedCount > unmatched.length" class="list-note">
          Toplam {{ annotation.unmatchedCount }} alandan ilk {{ unmatched.length }} tanesi listeleniyor.
        </p>
      </div>
    </template>

    <div v-else-if="loading" class="panel-note">JSON, IATA şemalarıyla karşılaştırılıyor…</div>

    <div v-else class="panel-note">
      Eşleşen IATA mesaj tipi bulunamadı.
      <span class="hint">Kök anahtar (ör. <code>IATA_OrderViewRS</code>) IATA 24.4 şemalarıyla karşılaştırılır.</span>
    </div>
  </aside>
</template>

<style scoped>
.iata-panel { width: var(--iata-w); flex-shrink: 0; border-left: 1px solid var(--border); background: var(--bg-secondary); display: flex; flex-direction: column; min-height: 0; }

.panel-head { display: flex; align-items: center; gap: 8px; padding: 11px 14px; border-bottom: 1px solid var(--border-subtle); flex-shrink: 0; }
.panel-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; color: var(--text-muted); margin-right: auto; }
.panel-collapse { font-size: 15px; line-height: 1; color: var(--text-muted); width: 20px; height: 20px; border-radius: 5px; }
.panel-collapse:hover { color: var(--accent); background: var(--bg-tertiary); }
.panel-loading { font-size: 10.5px; color: var(--accent); }
.panel-score { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; border-radius: 10px; padding: 2px 8px; }
.panel-score.high { color: var(--green); background: var(--bg-array); }
.panel-score.mid { color: var(--orange); background: var(--orange-dim); }
.panel-score.low { color: var(--red); background: var(--red-dim); }

.message-row { padding: 10px 14px 0; }
.message-type { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); word-break: break-all; }

.selection { padding: 10px 14px 14px; }
.field-name { font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--color-key); word-break: break-all; }
.tags { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0 9px; }
.tag { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; padding: 2px 8px; border-radius: 10px; }
.tag.type { color: var(--cyan); background: var(--bg-bool); }
.tag.ok { color: var(--green); background: var(--bg-array); }
.tag.warn { color: var(--orange); background: var(--orange-dim); }
.tag.guess { color: var(--cyan); background: var(--bg-bool); }
.evidence { font-size: 11px; color: var(--cyan); line-height: 1.45; margin-bottom: 7px; text-wrap: pretty; }
.description { font-size: 12px; color: var(--text-secondary); line-height: 1.5; text-wrap: pretty; }
.description.muted { color: var(--text-muted); }

.legend { margin-top: auto; padding: 11px 14px; border-top: 1px solid var(--border-subtle); flex-shrink: 0; }
.legend-line { font-size: 11px; color: var(--text-muted); line-height: 1.5; }
.mark.accent { color: var(--accent); }
.mark.guess { color: var(--cyan); }
.mark.warn { color: var(--orange); }
.legend-action { display: block; margin-top: 3px; font-size: 11px; color: var(--text-muted); text-align: left; }
.legend-action:hover { color: var(--text-primary); }
.warn-count { color: var(--orange); }

.unmatched-list { max-height: 240px; overflow-y: auto; padding: 8px 10px; border-top: 1px solid var(--border-subtle); flex-shrink: 0; }
.unmatched { display: block; width: 100%; text-align: left; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--orange); padding: 3px 6px; border-radius: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.unmatched:hover { background: var(--bg-tertiary); }
.unmatched.more { color: var(--accent); }
.list-note { margin-top: 6px; font-size: 10px; color: var(--text-muted); }

.panel-note { padding: 14px; font-size: 12px; color: var(--text-muted); line-height: 1.5; }
.panel-note.bad { color: var(--red); }
.panel-note code { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); }
.hint { display: block; margin-top: 8px; }
</style>
