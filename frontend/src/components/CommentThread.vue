<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Comment } from '../types'

const props = defineProps<{
  path: string
  comments: Comment[]
  author: string
  enabled: boolean
  canDelete: (id: number) => boolean
}>()

const emit = defineEmits<{
  add: [payload: { path: string; body: string; parentId: number | null }]
  remove: [id: number]
  'update:author': [name: string]
  close: []
}>()

const draft = ref('')
const replyTo = ref<number | null>(null)
/** Ad girisi yalnizca gerektiginde acilir; sonraki yorumlarda tarayicidan gelir. */
const editingName = ref(props.author.trim().length === 0)

const roots = computed(() => props.comments.filter(comment => comment.parentId === null))

function repliesOf(id: number): Comment[] {
  return props.comments.filter(comment => comment.parentId === id)
}

const nameModel = computed({
  get: () => props.author,
  set: (value: string) => emit('update:author', value),
})

const canSubmit = computed(
  () => draft.value.trim().length > 0 && props.author.trim().length > 0,
)

function submit() {
  if (!canSubmit.value) return
  emit('add', { path: props.path, body: draft.value.trim(), parentId: replyTo.value })
  draft.value = ''
  replyTo.value = null
  editingName.value = false
}

function startReply(id: number) {
  replyTo.value = replyTo.value === id ? null : id
}

function initial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?'
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('tr-TR')
}
</script>

<template>
  <div class="thread">
    <div v-for="root in roots" :key="root.id" class="group">
      <article class="comment">
        <span class="avatar">{{ initial(root.author) }}</span>
        <div class="body">
          <div class="meta">
            <span class="author">{{ root.author }}</span>
            <time class="time">{{ formatDate(root.createdAt) }}</time>
            <button v-if="enabled" class="action" @click="startReply(root.id)">
              {{ replyTo === root.id ? 'vazgeç' : 'yanıtla' }}
            </button>
            <button v-if="canDelete(root.id)" class="action danger" @click="emit('remove', root.id)">sil</button>
          </div>
          <p class="text">{{ root.body }}</p>
        </div>
      </article>

      <article v-for="reply in repliesOf(root.id)" :key="reply.id" class="comment reply">
        <span class="avatar">{{ initial(reply.author) }}</span>
        <div class="body">
          <div class="meta">
            <span class="author">{{ reply.author }}</span>
            <time class="time">{{ formatDate(reply.createdAt) }}</time>
            <button v-if="canDelete(reply.id)" class="action danger" @click="emit('remove', reply.id)">sil</button>
          </div>
          <p class="text">{{ reply.body }}</p>
        </div>
      </article>
    </div>

    <p v-if="comments.length === 0" class="empty">Bu alana ilk yorumu siz bırakın.</p>

    <template v-if="enabled">
      <p v-if="replyTo !== null" class="reply-hint">
        Yanıt yazıyorsunuz
        <button class="action" @click="replyTo = null">iptal</button>
      </p>
      <form class="form" @submit.prevent="submit">
        <input
          v-if="editingName"
          v-model="nameModel"
          class="input name"
          type="text"
          maxlength="60"
          placeholder="Adınız"
        />
        <button v-else type="button" class="who" @click="editingName = true">{{ author }} olarak</button>
        <input
          v-model="draft"
          class="input"
          type="text"
          maxlength="4000"
          placeholder="Bu alana yorum yaz…"
        />
        <button type="submit" class="send" :disabled="!canSubmit">Gönder</button>
      </form>
    </template>
    <p v-else class="empty">Bu paylaşım yorumlara kapalı.</p>

    <button class="close" title="Kapat" @click="emit('close')">×</button>
  </div>
</template>

<style scoped>
.thread { position: relative; border-left: 2px solid var(--purple); background: rgba(188,140,255,.05); border-radius: 0 6px 6px 0; padding: 9px 12px; }

.group { margin-bottom: 4px; }
.comment { display: flex; gap: 9px; margin-bottom: 9px; }
.comment.reply { margin-left: 18px; }
.avatar { width: 22px; height: 22px; border-radius: 50%; background: rgba(188,140,255,.2); color: var(--purple); font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.body { min-width: 0; flex: 1; }
.meta { display: flex; align-items: baseline; gap: 8px; }
.author { font-size: 11.5px; font-weight: 600; color: var(--text-primary); }
.time { font-size: 10.5px; color: var(--text-muted); }
.action { font-size: 10.5px; color: var(--accent); padding: 0 4px; border-radius: 4px; }
.action:hover { background: var(--accent-dim); }
.action.danger { color: var(--red); }
.action.danger:hover { background: rgba(255,123,114,.12); }
.text { font-size: 12px; color: var(--text-secondary); line-height: 1.45; text-wrap: pretty; white-space: pre-wrap; word-break: break-word; }

.empty { font-size: 11.5px; color: var(--text-muted); }
.reply-hint { font-size: 11px; color: var(--text-muted); margin-top: 4px; }

.form { display: flex; gap: 7px; margin-top: 6px; }
.input { flex: 1; min-width: 0; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; outline: none; color: var(--text-primary); font-size: 12px; padding: 6px 9px; }
.input:focus { border-color: var(--purple); }
.input.name { flex: 0 0 120px; }
.who { font-size: 11px; color: var(--text-muted); white-space: nowrap; padding: 0 4px; }
.who:hover { color: var(--purple); }
.send { font-size: 12px; font-weight: 600; color: var(--bg-primary); background: var(--purple); border-radius: 6px; padding: 6px 14px; white-space: nowrap; }
.send:disabled { opacity: .4; cursor: not-allowed; }

.close { position: absolute; top: 6px; right: 8px; color: var(--text-muted); font-size: 15px; line-height: 1; }
.close:hover { color: var(--text-primary); }
</style>
