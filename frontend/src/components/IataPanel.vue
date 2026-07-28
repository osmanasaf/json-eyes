<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AnnotateResponse } from '../types'
import FieldDocCard from './FieldDocCard.vue'

const props = defineProps<{
  annotation: AnnotateResponse | null
  loading?: boolean
  error?: string | null
  /** Goruntuleyicide secili alanin XSD yolu. */
  selectedPath?: string | null
}>()

const emit = defineEmits<{ focusPath: [path: string] }>()

const UNMATCHED_PAGE = 30
const showAllUnmatched = ref(false)

watch(() => props.annotation, () => { showAllUnmatched.value = false })

const matchPercent = computed(() => {
  if (!props.annotation?.messageType) return null
  return Math.round((props.annotation.confidence ?? 0) * 100)
})

const matchLevel = computed(() => {
  const p = matchPercent.value
  if (p === null) return 'none'
  if (p >= 80) return 'high'
  if (p >= 40) return 'mid'
  return 'low'
})

/** Goruntuleyicide uzerine gelinen alanin XSD karsiligi. */
const selectedField = computed(() => {
  if (!props.selectedPath) return null
  return props.annotation?.fields.find(field => field.path === props.selectedPath) ?? null
})

const unmatched = computed(() => props.annotation?.unmatchedPaths ?? [])
const visibleUnmatched = computed(() =>
  showAllUnmatched.value ? unmatched.value : unmatched.value.slice(0, UNMATCHED_PAGE),
)
</script>

<template>
  <aside class="iata-panel">
    <div class="panel-header">
      <span class="panel-title">IATA Şeması</span>
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
        </div>
      </div>

      <div class="stats">
        <div class="stat">
          <span class="stat-value">{{ annotation.fields.length }}</span>
          <span class="stat-label">açıklanan alan</span>
        </div>
        <div class="stat" :class="{ warn: annotation.unmatchedCount > 0 }">
          <span class="stat-value">{{ annotation.unmatchedCount }}</span>
          <span class="stat-label">şemada yok</span>
        </div>
      </div>

      <!-- Secili alan: butun listeyi taramak yerine odaktaki alanin detayi -->
      <section class="section">
        <h3 class="section-head">Seçili Alan</h3>
        <div v-if="selectedField" class="selected">
          <FieldDocCard :field="selectedField" />
        </div>
        <p v-else-if="selectedPath" class="section-empty">
          <code>{{ selectedPath }}</code> için XSD karşılığı yok.
        </p>
        <p v-else class="section-empty">
          Ağaçta veya tabloda bir alanın üzerine gelin; açıklaması burada görünür.
          Alan adının yanındaki <span class="dot-sample">ⓘ</span> işaretiyle de balon açabilirsiniz.
        </p>
      </section>

      <section v-if="unmatched.length > 0" class="section">
        <h3 class="section-head">Şemada Karşılığı Olmayanlar</h3>
        <button
          v-for="path in visibleUnmatched"
          :key="path"
          class="unmatched"
          :title="path"
          @click="emit('focusPath', path)"
        >{{ path }}</button>
        <button
          v-if="!showAllUnmatched && unmatched.length > UNMATCHED_PAGE"
          class="more-btn"
          @click="showAllUnmatched = true"
        >{{ unmatched.length - UNMATCHED_PAGE }} tane daha</button>
        <p v-if="annotation.unmatchedCount > unmatched.length" class="section-note">
          Toplam {{ annotation.unmatchedCount }} alandan ilk {{ unmatched.length }} tanesi listeleniyor.
        </p>
      </section>
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
  overflow-y: auto;
}
.panel-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--border-subtle); }
.panel-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; color: var(--text-muted); }
.panel-status { font-size: 11px; color: var(--accent); }
.panel-error { padding: 12px 14px; color: var(--red); font-size: 12px; line-height: 1.5; }
.panel-error code { font-size: 11px; }

.match-card { display: flex; align-items: center; gap: 14px; padding: 14px; }
.match-ring { width: 52px; height: 52px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 3px solid var(--border); }
.match-ring.high { border-color: var(--green); }
.match-ring.mid { border-color: var(--orange); }
.match-ring.low { border-color: var(--red); }
.match-value { font-size: 13px; font-weight: 700; font-family: 'JetBrains Mono', monospace; }
.match-meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.match-label { font-size: 11px; color: var(--text-muted); }
.match-type { font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--accent); word-break: break-all; }

.stats { display: flex; gap: 8px; padding: 0 14px 14px; }
.stat { flex: 1; display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 8px; background: var(--bg-tertiary); border: 1px solid var(--border-subtle); }
.stat.warn { border-color: rgba(210,153,34,.4); }
.stat-value { font-size: 16px; font-weight: 700; font-family: 'JetBrains Mono', monospace; color: var(--text-primary); }
.stat.warn .stat-value { color: var(--orange); }
.stat-label { font-size: 10px; color: var(--text-muted); }

.section { border-top: 1px solid var(--border-subtle); padding: 12px 14px; }
.section-head { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; color: var(--text-muted); margin-bottom: 8px; }
.section-empty { font-size: 12px; color: var(--text-muted); line-height: 1.5; }
.section-empty code { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--color-key); word-break: break-all; }
.section-note { margin-top: 8px; font-size: 10px; color: var(--text-muted); }
.dot-sample { color: var(--accent); }
.selected { padding: 10px; border-radius: 8px; background: var(--bg-tertiary); border: 1px solid var(--border-subtle); }

.unmatched { display: block; width: 100%; text-align: left; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--orange); padding: 4px 6px; border-radius: 4px; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.unmatched:hover { background: var(--bg-hover); }
.more-btn { font-size: 11px; color: var(--accent); background: var(--accent-dim); padding: 4px 10px; border-radius: 5px; margin-top: 6px; }
.more-btn:hover { background: rgba(88,166,255,.25); }

.panel-empty { padding: 16px 14px; font-size: 12px; color: var(--text-muted); line-height: 1.5; }
.hint { margin-top: 8px; }
.panel-empty code { color: var(--accent); font-size: 11px; font-family: 'JetBrains Mono', monospace; }
</style>
