<script setup lang="ts">
import { ref } from 'vue'
import type { RecentFile } from '../utils/storage'
import { formatRelative, formatSize } from '../utils/storage'

/**
 * Bos durum. Ekranda verilecek **tek karar** var: veriyi nereden alacagiz.
 * Bu yuzden sol panel, sag panel, kirinti ve yol satiri burada hic
 * render edilmiyor — ikinci bir yuzey karari boler.
 */
defineProps<{ recents: RecentFile[] }>()

const emit = defineEmits<{
  pickFile: []
  sample: []
  paste: []
  openRecent: [file: RecentFile]
  drop: [event: DragEvent]
}>()

const over = ref(false)

function onDrop(event: DragEvent) {
  over.value = false
  emit('drop', event)
}
</script>

<template>
  <div class="empty">
    <p class="lead">Bir JSON ya da XML açın; grid, ağaç ve kolon görünümü aynı belgeye bakar.</p>

    <div
      class="drop"
      :class="{ over }"
      @dragover.prevent="over = true"
      @dragleave="over = false"
      @drop.prevent="onDrop"
    >
      <p class="drop-text">dosyayı buraya bırak · .json ya da .xml</p>
      <div class="drop-actions">
        <button class="primary" @click="emit('sample')">Örneği aç</button>
        <button class="secondary" @click="emit('paste')">Panodan yapıştır</button>
        <button class="secondary" @click="emit('pickFile')">Dosya seç</button>
      </div>
    </div>

    <div v-if="recents.length > 0" class="recents">
      <p class="recents-title">son açılanlar</p>
      <button
        v-for="file in recents"
        :key="file.name"
        class="recent"
        @click="emit('openRecent', file)"
      >
        <span class="recent-name">{{ file.name }}</span>
        <span class="recent-meta">{{ formatSize(file.size) }} · {{ formatRelative(file.openedAt) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 18px; padding: 40px; overflow-y: auto; background: var(--bg-app);
}
.lead { font-size: 13px; color: var(--ink-4); text-align: center; max-width: 520px; text-wrap: pretty; }

.drop {
  width: 500px; max-width: 100%; border: 1px dashed var(--line-dashed); border-radius: 10px;
  padding: 32px 28px; display: flex; flex-direction: column; align-items: center; gap: 16px;
  transition: border-color .1s, background .1s;
}
.drop.over { border-color: var(--accent); background: var(--accent-sel-bg); }
.drop-text { font-size: 11.5px; color: var(--ink-4); }
.drop-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.primary { font-size: 11.5px; color: var(--on-accent); background: var(--accent); border-radius: var(--radius); padding: 6px 14px; }
.primary:hover { background: var(--accent-hover); }
.secondary { font-size: 11.5px; color: var(--ink-2); border: 1px solid var(--line); border-radius: var(--radius); padding: 6px 14px; }
.secondary:hover { background: var(--bg-inset); color: var(--ink); }

.recents { width: 500px; max-width: 100%; }
.recents-title { font-size: 11px; color: var(--ink-4); margin-bottom: 6px; }
.recent {
  display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
  padding: 7px 10px; border-radius: var(--radius);
}
.recent:hover { background: var(--bg-inset); }
.recent-name { font-size: 12px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recent-meta { margin-left: auto; font-size: 11px; color: var(--ink-4); flex-shrink: 0; }
</style>
