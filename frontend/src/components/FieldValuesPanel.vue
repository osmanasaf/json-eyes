<script setup lang="ts">
import { computed } from 'vue'
import type { FieldValueStats } from '../utils/related'

/**
 * Secili alanin belge genelindeki dagilimi. Is sayi karsilastirmasi oldugu icin
 * cubuklar tek renk (accent) ve deger arttikca koyulasan sirali bir seri;
 * kimlik tasimadiklari icin kategorik renk kullanilmiyor. Basliktaki uc sayi
 * kucuk birer deger kutusu — tek cubukluk grafik degil.
 */
const props = defineProps<{
  stats: FieldValueStats | null
  /** Alan secili degilse panel bunu soyler. */
  hasSelection: boolean
}>()

const emit = defineEmits<{ focusPath: [path: string]; collapse: [] }>()

const maxCount = computed(() => props.stats?.distinct[0]?.count ?? 1)

/** Sirali doluluk: cok gecen deger koyu, az gecen soluk. */
function fillOpacity(count: number): number {
  return 0.35 + (count / maxCount.value) * 0.65
}

function widthOf(count: number): string {
  return `${Math.max(3, (count / maxCount.value) * 100)}%`
}

function shortPath(path: string): string {
  const segments = path.split('.')
  return segments.length > 4 ? `…${segments.slice(-4).join('.')}` : path
}

function formatNumber(value: number): string {
  return value.toLocaleString('tr-TR', { maximumFractionDigits: 2 })
}

const foldedCount = computed(() => {
  const stats = props.stats
  if (!stats) return 0
  return Math.max(0, stats.distinctTotal - stats.distinct.length)
})

const fieldName = computed(() => props.stats?.fieldPath.split('.').pop() ?? null)
</script>

<template>
  <section class="values-panel">
    <div class="panel-head">
      <span class="panel-title">Alan değerleri</span>
      <span v-if="stats" class="panel-field" :title="stats.fieldPath">{{ fieldName }}</span>
      <button class="panel-collapse" title="Paneli gizle" @click="emit('collapse')">▾</button>
    </div>

    <p v-if="!hasSelection" class="hint">
      Bir alan seçin: aynı alanın belgedeki tüm değerleri, dağılımı ve eksik kayıtlar burada listelenir.
    </p>
    <p v-else-if="!stats" class="hint">Bu alan belgede başka bir yerde geçmiyor.</p>

    <template v-else>
      <div class="tiles">
        <div class="tile">
          <span class="tile-value">{{ stats.total.toLocaleString('tr-TR') }}</span>
          <span class="tile-label">geçiyor</span>
        </div>
        <div class="tile">
          <span class="tile-value">{{ stats.distinctTotal.toLocaleString('tr-TR') }}</span>
          <span class="tile-label">farklı değer</span>
        </div>
        <div class="tile" :class="{ warn: stats.missing > 0 }">
          <span class="tile-value">{{ stats.missing.toLocaleString('tr-TR') }}</span>
          <span class="tile-label">alan yok</span>
        </div>
      </div>

      <div v-if="stats.numeric" class="numeric">
        <span class="num-item"><span class="num-label">min</span>{{ formatNumber(stats.numeric.min) }}</span>
        <span class="num-item"><span class="num-label">maks</span>{{ formatNumber(stats.numeric.max) }}</span>
        <span class="num-item"><span class="num-label">ort</span>{{ formatNumber(stats.numeric.avg) }}</span>
        <span class="num-item"><span class="num-label">top</span>{{ formatNumber(stats.numeric.sum) }}</span>
      </div>

      <ul class="dist">
        <li v-for="item in stats.distinct" :key="item.kind + item.text">
          <button
            class="dist-row"
            :title="`${item.text} — ${item.count} kayıt · ${shortPath(item.firstPath)}`"
            @click="emit('focusPath', item.firstPath)"
          >
            <span class="dist-head">
              <span class="dist-text" :class="`k-${item.kind}`">{{ item.text }}</span>
              <span class="dist-count">{{ item.count.toLocaleString('tr-TR') }}</span>
            </span>
            <span class="dist-track">
              <span
                class="dist-fill"
                :style="{ width: widthOf(item.count), opacity: fillOpacity(item.count) }"
              />
            </span>
          </button>
        </li>
      </ul>

      <p v-if="foldedCount > 0" class="fold">
        + {{ foldedCount.toLocaleString('tr-TR') }} değer daha (en sık {{ stats.distinct.length }} tanesi listelendi)
      </p>
      <p v-if="stats.truncated" class="fold warn">
        Sayım üst sınıra takıldı; dağılım ilk {{ stats.total.toLocaleString('tr-TR') }} kayda ait.
      </p>
    </template>
  </section>
</template>

<style scoped>
.values-panel { display: flex; flex-direction: column; min-height: 0; border-top: 1px solid var(--border); background: var(--bg-secondary); overflow-y: auto; }

.panel-head { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-bottom: 1px solid var(--border-subtle); flex-shrink: 0; }
.panel-title { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--text-secondary); white-space: nowrap; }
.panel-field { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.panel-collapse { margin-left: auto; font-size: 12px; line-height: 1; color: var(--text-muted); padding: 0 3px; }
.panel-collapse:hover { color: var(--accent); }

.hint { padding: 12px; font-size: 11.5px; line-height: 1.5; color: var(--text-muted); }

/* Uc bas sayi: deger kutusu, grafik degil. */
.tiles { display: flex; gap: 6px; padding: 10px 12px 6px; }
.tile { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; background: var(--bg-primary); border: 1px solid var(--border-subtle); border-radius: 7px; padding: 6px 8px; }
.tile-value { font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 600; color: var(--text-primary); }
.tile-label { font-size: 9.5px; color: var(--text-muted); white-space: nowrap; }
.tile.warn .tile-value { color: var(--orange); }

.numeric { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 2px 12px 8px; }
.num-item { display: flex; align-items: baseline; gap: 4px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--color-number); }
.num-label { font-size: 9.5px; color: var(--text-muted); text-transform: uppercase; }

.dist { padding: 0 12px 4px; display: flex; flex-direction: column; gap: 6px; }
.dist-row { display: flex; flex-direction: column; gap: 3px; width: 100%; text-align: left; padding: 3px 4px; border-radius: 5px; }
.dist-row:hover { background: var(--bg-tertiary); }
.dist-head { display: flex; align-items: baseline; gap: 8px; }
.dist-text { flex: 1; min-width: 0; font-family: 'JetBrains Mono', monospace; font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Metin kendi tip rengini tasir; cubuk kimlik degil buyukluk anlatir. */
.k-string { color: var(--color-string); }
.k-number { color: var(--color-number); }
.k-boolean { color: var(--color-bool); }
.k-null { color: var(--color-null); font-style: italic; }
.k-object { color: var(--purple); }
.k-array { color: var(--green); }
.dist-count { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--text-secondary); flex-shrink: 0; }
/* Cubuk: taban kare, uc 4px yuvarlak; ince ve tek hueli. */
.dist-track { display: block; height: 6px; background: var(--bg-tertiary); border-radius: 3px; overflow: hidden; }
.dist-fill { display: block; height: 100%; background: var(--accent); border-radius: 0 4px 4px 0; }

.fold { padding: 4px 12px 12px; font-size: 10.5px; color: var(--text-muted); line-height: 1.45; }
.fold.warn { color: var(--orange); }
</style>
