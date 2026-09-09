<script setup lang="ts">
import { computed } from 'vue'
import type { JsonValue } from '../types'
import type { RefTarget } from '../utils/references'
import { previewFields } from '../utils/grid'
import { getType } from '../utils/json'
import { scalarText } from '../utils/rows'

/**
 * Referans onizlemesi: `PaxRefID` gibi bir IDREF alaninin hedefini satirin
 * hemen altinda gosterir.
 *
 * Amac baglamdan cikmamak — NDC'de bir referansi cozmek icin `DataLists`e
 * gidip geri donmek okuma sirasini bozuyor. "Hedefe git" isteyene o yolu
 * aciyor; istemeyen dort alani yerinde okuyup devam ediyor.
 */
const props = defineProps<{
  target: RefTarget
  /** Satirin derinligi; kutu bir seviye iceriden baslar. */
  depth: number
}>()

const emit = defineEmits<{ goto: [path: string] }>()

const fields = computed(() =>
  previewFields(props.target.value).map(field => ({
    key: field.key,
    text: scalarText(field.value),
    type: getType(field.value),
  })),
)

/** Yol kok onekinden arindirilir; kullaniciya belgedeki adi gosteriliyor. */
const label = computed(() => props.target.path.split('.').slice(1).join('.'))

function indexed(value: JsonValue): string {
  return typeof value === 'string' ? value : String(value)
}
</script>

<template>
  <div class="ref-strip" :style="{ '--depth': depth + 1 }">
    <div class="box">
      <div class="head">
        <code class="path" :title="target.path">{{ label }}</code>
        <button class="goto" @click="emit('goto', target.path)">Hedefe git</button>
      </div>
      <dl class="fields">
        <template v-for="field in fields" :key="field.key">
          <dt class="key">{{ field.key }}</dt>
          <dd class="value" :class="`t-${field.type}`">{{ field.text }}</dd>
        </template>
      </dl>
      <p v-if="fields.length === 0" class="empty">
        Hedef kayıtta gösterilecek skaler alan yok — {{ indexed(target.value) }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.ref-strip { border-bottom: 1px solid var(--border-subtle); padding: 7px var(--row-pad-x); }
.box {
  margin-left: calc(var(--depth) * var(--indent));
  border-left: 2px solid var(--accent);
  background: var(--accent-soft);
  border-radius: 0 6px 6px 0;
  padding: 7px 11px;
}

.head { display: flex; align-items: center; gap: 10px; margin-bottom: 5px; }
.path { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.goto { font-size: 10.5px; color: var(--accent); padding: 1px 8px; border-radius: 4px; border: 1px solid var(--border); white-space: nowrap; flex-shrink: 0; }
.goto:hover { border-color: var(--accent); background: var(--accent-dim); }

.fields { display: grid; grid-template-columns: 110px 1fr; gap: 0 10px; }
.key { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--color-key); padding: 2px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.value { font-family: 'JetBrains Mono', monospace; font-size: 12px; padding: 2px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.t-string { color: var(--color-string); }
.t-number { color: var(--color-number); }
.t-boolean { color: var(--color-bool); }
.t-null { color: var(--color-null); }

.empty { font-size: 11.5px; color: var(--text-muted); }
</style>
