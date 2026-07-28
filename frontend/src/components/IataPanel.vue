<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AnnotateResponse } from '../types'

const props = defineProps<{
  annotation: AnnotateResponse | null
  loading?: boolean
  error?: string | null
}>()

const matchPercent = computed(() => {
  if (!props.annotation?.messageType) return null
  return Math.round((props.annotation.confidence ?? 0) * 100)
})

const FIELD_PAGE_SIZE = 200
const showAllFields = ref(false)

const visibleFields = computed(() => {
  const fields = props.annotation?.fields ?? []
  return showAllFields.value ? fields : fields.slice(0, FIELD_PAGE_SIZE)
})

const hiddenFieldCount = computed(
  () => (props.annotation?.fields.length ?? 0) - visibleFields.value.length,
)

watch(() => props.annotation, () => { showAllFields.value = false })

const matchLevel = computed(() => {
  const p = matchPercent.value
  if (p === null) return 'none'
  if (p >= 80) return 'high'
  if (p >= 40) return 'mid'
  return 'low'
})
</script>

<template>
  <aside class="iata-panel">
    <div class="panel-header">
      <span class="panel-title">IATA Benzerliği</span>
      <span v-if="loading" class="panel-status">analiz...</span>
    </div>

    <div v-if="error" class="panel-error">{{ error }}</div>

    <div v-else-if="annotation && !annotation.schemaLoaded" class="panel-error">
      Sunucuda XSD şeması yüklü değil, bu yüzden alan açıklaması üretilemiyor.
      <code>backend/src/main/resources/xsd/</code> klasörünü kontrol edin.
    </div>

    <template v-else-if="annotation?.messageType">
      <div class="match-card">
        <div class="match-ring" :class="matchLevel">
          <span class="match-value">%{{ matchPercent }}</span>
        </div>
        <div class="match-meta">
          <span class="match-label">Eşleşen mesaj tipi</span>
          <code class="match-type">{{ annotation.messageType }}</code>
          <span class="match-sub">{{ annotation.fields.length }} alan açıklaması bulundu</span>
          <span v-if="annotation.unmatchedCount > 0" class="match-warn">
            {{ annotation.unmatchedCount }} alanın XSD'de karşılığı yok
          </span>
        </div>
      </div>

      <div class="field-list">
        <div class="field-list-head">Alan Açıklamaları</div>
        <div v-if="annotation.fields.length === 0" class="field-empty">
          Bu mesaj için eşleşen alan açıklaması bulunamadı.
        </div>
        <div v-for="field in visibleFields" :key="field.path" class="field-item">
          <code class="field-path" :title="field.path">{{ field.path }}</code>
          <code v-if="field.type" class="field-type">{{ field.type }}</code>
          <p class="field-doc">{{ field.documentation }}</p>
        </div>
        <div v-if="hiddenFieldCount > 0" class="field-more">
          <button class="field-more-btn" @click="showAllFields = true">
            {{ hiddenFieldCount.toLocaleString() }} alan daha göster
          </button>
        </div>
      </div>
    </template>

    <div v-else-if="loading" class="panel-empty">
      <p>JSON, IATA şemalarıyla karşılaştırılıyor...</p>
    </div>

    <div v-else class="panel-empty">
      <p>Eşleşen IATA mesaj tipi bulunamadı.</p>
      <p class="hint">JSON girdiğinizde kök anahtar (ör. <code>IATA_OrderViewRS</code>) veya alan adları IATA 24.4 şemalarıyla karşılaştırılır.</p>
    </div>
  </aside>
</template>

<style scoped>
.iata-panel {
  width: 320px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.panel-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--border-subtle); }
.panel-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; color: var(--text-muted); }
.panel-status { font-size: 11px; color: var(--accent); }
.panel-error { padding: 12px 14px; color: var(--red); font-size: 12px; }

.match-card { display: flex; align-items: center; gap: 14px; padding: 16px 14px; border-bottom: 1px solid var(--border-subtle); }
.match-ring { width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 3px solid var(--border); }
.match-ring.high { border-color: var(--green); }
.match-ring.mid { border-color: var(--orange); }
.match-ring.low { border-color: var(--red); }
.match-value { font-size: 14px; font-weight: 700; font-family: 'JetBrains Mono', monospace; }
.match-meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.match-label { font-size: 11px; color: var(--text-muted); }
.match-type { font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--accent); word-break: break-all; }
.match-sub { font-size: 11px; color: var(--text-muted); }
.match-warn { font-size: 11px; color: var(--orange); }

.field-list { flex: 1; overflow: auto; }
.field-list-head { padding: 10px 14px 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; color: var(--text-muted); position: sticky; top: 0; background: var(--bg-secondary); }
.field-empty { padding: 8px 14px; font-size: 12px; color: var(--text-muted); }
.field-item { padding: 8px 14px; border-bottom: 1px solid var(--border-subtle); }
.field-path { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--color-key); display: block; margin-bottom: 3px; word-break: break-all; }
.field-type { display: inline-block; margin-bottom: 4px; padding: 1px 6px; border-radius: 4px; background: var(--bg-tertiary); border: 1px solid var(--border-subtle); font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--purple); }
.field-doc { font-size: 12px; color: var(--text-secondary); line-height: 1.45; }
.field-more { padding: 10px 14px; }
.field-more-btn { font-size: 11px; color: var(--accent); background: var(--accent-dim); padding: 5px 12px; border-radius: 5px; }
.field-more-btn:hover { background: rgba(88,166,255,.25); }

.panel-empty { padding: 16px 14px; font-size: 12px; color: var(--text-muted); line-height: 1.5; }
.hint { margin-top: 8px; }
.panel-empty code { color: var(--accent); font-size: 11px; font-family: 'JetBrains Mono', monospace; }
</style>
