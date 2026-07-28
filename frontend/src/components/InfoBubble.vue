<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

/**
 * Alan aciklamalari icin balon. Tarayicinin `title` balonundan farki: ~150 ms'de
 * acilir, uzun metinde kendi icinde kayar, ekran kenarina tasmaz ve tiklayinca
 * sabitlenir (icindeki metin secilebilir).
 */
const OPEN_DELAY = 150
const CLOSE_DELAY = 120
const BUBBLE_WIDTH = 340
const MARGIN = 10

const open = ref(false)
const pinned = ref(false)
const anchorRef = ref<HTMLElement | null>(null)
const position = ref({ top: 0, left: 0, above: false })

let openTimer: ReturnType<typeof setTimeout> | null = null
let closeTimer: ReturnType<typeof setTimeout> | null = null

function clearTimers() {
  if (openTimer) clearTimeout(openTimer)
  if (closeTimer) clearTimeout(closeTimer)
  openTimer = null
  closeTimer = null
}

function place() {
  const anchor = anchorRef.value
  if (!anchor) return
  const rect = anchor.getBoundingClientRect()
  // Alta sigmiyorsa yukari ac.
  const above = rect.bottom + 200 > window.innerHeight && rect.top > 200
  const left = Math.min(
    Math.max(MARGIN, rect.left),
    Math.max(MARGIN, window.innerWidth - BUBBLE_WIDTH - MARGIN),
  )
  position.value = {
    top: above ? rect.top - 6 : rect.bottom + 6,
    left,
    above,
  }
}

function scheduleOpen() {
  clearTimers()
  openTimer = setTimeout(() => {
    place()
    open.value = true
  }, OPEN_DELAY)
}

function scheduleClose() {
  if (pinned.value) return
  clearTimers()
  closeTimer = setTimeout(() => { open.value = false }, CLOSE_DELAY)
}

function togglePin(event: MouseEvent) {
  event.stopPropagation()
  clearTimers()
  if (pinned.value) {
    pinned.value = false
    open.value = false
    document.removeEventListener('click', onDocumentClick)
    return
  }
  place()
  open.value = true
  pinned.value = true
  document.addEventListener('click', onDocumentClick)
}

function onDocumentClick() {
  pinned.value = false
  open.value = false
  document.removeEventListener('click', onDocumentClick)
}

onBeforeUnmount(() => {
  clearTimers()
  document.removeEventListener('click', onDocumentClick)
})
</script>

<template>
  <span
    ref="anchorRef"
    class="bubble-anchor"
    @mouseenter="scheduleOpen"
    @mouseleave="scheduleClose"
    @click="togglePin"
  >
    <slot name="trigger" />
  </span>

  <Teleport to="body">
    <div
      v-if="open"
      class="bubble"
      :class="{ above: position.above, pinned }"
      :style="{ top: `${position.top}px`, left: `${position.left}px`, width: `${BUBBLE_WIDTH}px` }"
      @mouseenter="clearTimers"
      @mouseleave="scheduleClose"
      @click.stop
    >
      <slot />
      <p v-if="!pinned" class="bubble-hint">sabitlemek için tıklayın</p>
    </div>
  </Teleport>
</template>

<style scoped>
.bubble-anchor { display: inline-flex; align-items: center; }

.bubble {
  position: fixed;
  z-index: 100;
  max-height: 320px;
  overflow-y: auto;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  box-shadow: 0 8px 24px rgba(0,0,0,.45);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-secondary);
  text-align: left;
  white-space: normal;
}
.bubble.above { transform: translateY(-100%); }
.bubble.pinned { border-color: var(--accent); }
.bubble-hint { margin-top: 8px; font-size: 10px; color: var(--text-muted); font-style: italic; }
</style>
