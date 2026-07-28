<script setup lang="ts">
import { ref } from 'vue'
import type { RecentFile } from '../utils/storage'
import { formatRelative, formatSize } from '../utils/storage'

defineProps<{ recents: RecentFile[] }>()

const emit = defineEmits<{
  pickFile: []
  sample: []
  openRecent: [file: RecentFile]
  drop: [event: DragEvent]
}>()

const dragging = ref(false)

function onDrop(event: DragEvent) {
  dragging.value = false
  emit('drop', event)
}
</script>

<template>
  <div class="empty">
    <div
      class="dropzone"
      :class="{ over: dragging }"
      @dragover.prevent="dragging = true"
      @dragleave="dragging = false"
      @drop.prevent="onDrop"
    >
      <svg width="42" height="42" viewBox="0 0 24 24">
        <ellipse cx="12" cy="12" rx="9" ry="5.8" fill="none" stroke="var(--accent)" stroke-width="1.4" opacity=".7" />
        <circle cx="12" cy="12" r="2.8" fill="var(--accent)" />
      </svg>
      <h2 class="drop-title">JSON'u buraya bırakın</h2>
      <p class="drop-note">Dosya sürükleyin, panodan yapıştırın (Ctrl+V) veya bir örnekle başlayın.</p>
      <div class="drop-actions">
        <button class="primary" @click="emit('pickFile')">Dosya seç</button>
        <button class="secondary" @click="emit('sample')">Örnek yükle</button>
      </div>
    </div>

    <div v-if="recents.length > 0" class="recents">
      <h3 class="recents-title">Son açılanlar</h3>
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
.empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px; padding: 40px; overflow-y: auto; }

.dropzone { width: 520px; max-width: 100%; border: 1px dashed var(--border); border-radius: 14px; padding: 48px 40px; display: flex; flex-direction: column; align-items: center; gap: 14px; background: var(--bg-secondary); transition: border-color .1s, background .1s; }
.dropzone.over { border-color: var(--accent); background: var(--accent-soft); }
.drop-title { font-size: 17px; font-weight: 600; }
.drop-note { font-size: 13px; color: var(--text-secondary); text-align: center; max-width: 320px; text-wrap: pretty; }
.drop-actions { display: flex; gap: 10px; margin-top: 6px; }
.primary { font-size: 13px; font-weight: 600; color: var(--bg-primary); background: var(--accent); border-radius: 8px; padding: 8px 18px; }
.primary:hover { background: var(--cyan); }
.secondary { font-size: 13px; color: var(--text-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 8px 18px; }
.secondary:hover { color: var(--text-primary); }

.recents { width: 520px; max-width: 100%; }
.recents-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; color: var(--text-muted); margin-bottom: 8px; }
.recent { display: flex; align-items: center; gap: 12px; width: 100%; padding: 9px 12px; border-radius: 8px; text-align: left; }
.recent:hover { background: var(--bg-secondary); }
.recent-name { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recent-meta { margin-left: auto; font-size: 11.5px; color: var(--text-muted); flex-shrink: 0; }
</style>
