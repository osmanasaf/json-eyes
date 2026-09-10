<script setup lang="ts">
import { computed } from 'vue'
import type { FieldDoc } from '../types'

/** Bir XSD alaninin kimligi ve aciklamasi; hem balonda hem IATA panelinde kullanilir. */
const props = defineProps<{ field: FieldDoc; compact?: boolean }>()

const inferred = computed(() => props.field.matchKind === 'INFERRED')
const percent = computed(() => Math.round((props.field.confidence ?? 0) * 100))
</script>

<template>
  <div class="doc-card">
    <div class="doc-head">
      <code class="doc-name">{{ field.name }}</code>
      <code v-if="field.type" class="doc-type">{{ field.type }}</code>
      <span v-if="inferred" class="doc-guess">≈ tahmini %{{ percent }}</span>
    </div>
    <code v-if="!compact" class="doc-path">{{ field.path }}</code>
    <p class="doc-text">{{ field.documentation }}</p>
    <!--
      Tahminin dayanagi gosterilmeden aciklamaya guvenilemez: NDC'de ayni ad
      farkli tiplerde farkli anlam tasidigi icin kullanici neye bakildigini bilmeli.
    -->
    <p v-if="inferred && field.evidence" class="doc-evidence">
      Ad tutmadı, {{ field.evidence }} çıkarıldı.
    </p>
  </div>
</template>

<style scoped>
.doc-card { display: flex; flex-direction: column; gap: 5px; }
.doc-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.doc-name { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600; color: var(--ink-2); }
.doc-type { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--accent); background: var(--bg-subtle); border: 1px solid var(--line-cell); padding: 1px 6px; border-radius: 4px; }
.doc-guess { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--type-boolean); background: var(--bg-subtle); padding: 1px 6px; border-radius: 4px; white-space: nowrap; }
.doc-path { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--ink-5); word-break: break-all; }
.doc-text { font-size: 12.5px; line-height: 1.5; color: var(--ink-2); }
.doc-evidence { font-size: 11px; line-height: 1.45; color: var(--type-boolean); }
</style>
