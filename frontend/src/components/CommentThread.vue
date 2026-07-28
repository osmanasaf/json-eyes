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
const submitting = ref(false)

const roots = computed(() => props.comments.filter(c => c.parentId === null))

function repliesOf(id: number): Comment[] {
  return props.comments.filter(c => c.parentId === id)
}

const nameModel = computed({
  get: () => props.author,
  set: (value: string) => emit('update:author', value),
})

const canSubmit = computed(
  () => draft.value.trim().length > 0 && props.author.trim().length > 0 && !submitting.value,
)

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    emit('add', { path: props.path, body: draft.value.trim(), parentId: replyTo.value })
    draft.value = ''
    replyTo.value = null
  } finally {
    submitting.value = false
  }
}

function startReply(id: number) {
  replyTo.value = replyTo.value === id ? null : id
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('tr-TR')
}
</script>

<template>
  <div class="thread">
    <div class="thread-head">
      <span class="thread-title">{{ comments.length }} yorum</span>
      <code class="thread-path">{{ path }}</code>
      <button class="thread-close" title="Kapat" @click="emit('close')">×</button>
    </div>

    <div v-for="root in roots" :key="root.id" class="comment-group">
      <article class="comment">
        <header class="comment-head">
          <span class="comment-author">{{ root.author }}</span>
          <time class="comment-date">{{ formatDate(root.createdAt) }}</time>
          <button v-if="enabled" class="comment-action" @click="startReply(root.id)">
            {{ replyTo === root.id ? 'vazgeç' : 'yanıtla' }}
          </button>
          <button v-if="canDelete(root.id)" class="comment-action danger" @click="emit('remove', root.id)">sil</button>
        </header>
        <p class="comment-body">{{ root.body }}</p>
      </article>

      <article v-for="reply in repliesOf(root.id)" :key="reply.id" class="comment reply">
        <header class="comment-head">
          <span class="comment-author">{{ reply.author }}</span>
          <time class="comment-date">{{ formatDate(reply.createdAt) }}</time>
          <button v-if="canDelete(reply.id)" class="comment-action danger" @click="emit('remove', reply.id)">sil</button>
        </header>
        <p class="comment-body">{{ reply.body }}</p>
      </article>
    </div>

    <form v-if="enabled" class="comment-form" @submit.prevent="submit">
      <p v-if="replyTo !== null" class="reply-hint">
        Yanıt yazıyorsunuz
        <button type="button" class="comment-action" @click="replyTo = null">iptal</button>
      </p>
      <input
        v-model="nameModel"
        class="name-input"
        type="text"
        maxlength="60"
        placeholder="Adınız"
      />
      <textarea
        v-model="draft"
        class="body-input"
        rows="2"
        maxlength="4000"
        placeholder="Bu alanla ilgili yorumunuz..."
        @keydown.ctrl.enter="submit"
      />
      <div class="form-actions">
        <span class="form-hint">Ctrl+Enter ile gönder</span>
        <button type="submit" class="submit-btn" :disabled="!canSubmit">Yorum ekle</button>
      </div>
    </form>
    <p v-else class="disabled-note">Bu paylaşım yorumlara kapalı.</p>
  </div>
</template>

<style scoped>
.thread { border-left: 2px solid var(--purple); background: rgba(188,140,255,.05); border-radius: 0 6px 6px 0; padding: 8px 12px; margin: 4px 0 8px; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }
.thread-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.thread-title { font-size: 11px; font-weight: 600; color: var(--purple); }
.thread-path { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--text-muted); word-break: break-all; }
.thread-close { margin-left: auto; color: var(--text-muted); font-size: 16px; line-height: 1; }
.thread-close:hover { color: var(--text-primary); }

.comment-group { margin-bottom: 8px; }
.comment { padding: 6px 0; border-top: 1px solid var(--border-subtle); }
.comment.reply { margin-left: 18px; border-left: 2px solid var(--border); padding-left: 10px; border-top: none; }
.comment-head { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
.comment-author { font-size: 12px; font-weight: 600; color: var(--text-primary); }
.comment-date { font-size: 10px; color: var(--text-muted); }
.comment-action { font-size: 10px; color: var(--accent); padding: 1px 5px; border-radius: 4px; }
.comment-action:hover { background: var(--accent-dim); }
.comment-action.danger { color: var(--red); }
.comment-action.danger:hover { background: rgba(255,123,114,.12); }
.comment-body { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); white-space: pre-wrap; word-break: break-word; }

.comment-form { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-subtle); }
.reply-hint { font-size: 11px; color: var(--text-muted); }
.name-input, .body-input { background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary); font-size: 12.5px; padding: 6px 8px; outline: none; font-family: inherit; }
.name-input:focus, .body-input:focus { border-color: var(--accent); }
.name-input { max-width: 200px; }
.body-input { resize: vertical; }
.form-actions { display: flex; align-items: center; gap: 10px; }
.form-hint { font-size: 10px; color: var(--text-muted); }
.submit-btn { margin-left: auto; font-size: 12px; color: var(--accent); background: var(--accent-dim); padding: 5px 12px; border-radius: 6px; }
.submit-btn:hover:not(:disabled) { background: rgba(88,166,255,.25); }
.submit-btn:disabled { opacity: .4; cursor: not-allowed; }
.disabled-note { font-size: 11px; color: var(--text-muted); margin-top: 6px; }
</style>
