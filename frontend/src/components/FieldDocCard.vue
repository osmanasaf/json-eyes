<script setup lang="ts">
import type { FieldDoc } from '../types'

/** Bir XSD alaninin kimligi ve aciklamasi; hem balonda hem IATA panelinde kullanilir. */
defineProps<{ field: FieldDoc; compact?: boolean }>()
</script>

<template>
  <div class="doc-card">
    <div class="doc-head">
      <code class="doc-name">{{ field.name }}</code>
      <code v-if="field.type" class="doc-type">{{ field.type }}</code>
    </div>
    <code v-if="!compact" class="doc-path">{{ field.path }}</code>
    <p class="doc-text">{{ field.documentation }}</p>
  </div>
</template>

<style scoped>
.doc-card { display: flex; flex-direction: column; gap: 5px; }
.doc-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.doc-name { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600; color: var(--color-key); }
.doc-type { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--purple); background: var(--bg-tertiary); border: 1px solid var(--border-subtle); padding: 1px 6px; border-radius: 4px; }
.doc-path { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--text-muted); word-break: break-all; }
.doc-text { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
</style>
