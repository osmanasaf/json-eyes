<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Comment } from '../types'

/**
 * Alan bazli yorumlar.
 *
 * Tasarim yorumlari **sag panelin en altina** aldi: yorum bir alan hakkindaki
 * konusma, o alanin dokumantasyonunun yaninda duruyor. Onceden satirin altinda
 * aciliyordu ve grid'i itiyordu.
 *
 * Kimlik dogrulamasi yok: ad tarayicida saklanir, silme yetkisi sunucunun
 * olusturma aninda dondugu jetonla saglanir.
 */
const props = defineProps<{
  /** Yorumlarin bagli oldugu dugum yolu. */
  path: string | null
  comments: Comment[]
  author: string
  enabled: boolean
  canDelete: (id: number) => boolean
}>()

const emit = defineEmits<{
  add: [payload: { path: string; body: string; parentId: number | null }]
  remove: [id: number]
  'update:author': [name: string]
}>()

const draft = ref('')
/** Ad girisi yalnizca gerektiginde acilir; sonrakilerde tarayicidan gelir. */
const editingName = ref(props.author.trim().length === 0)

const nameModel = computed({
  get: () => props.author,
  set: (value: string) => emit('update:author', value),
})

const canSubmit = computed(
  () => props.path !== null && draft.value.trim().length > 0 && props.author.trim().length > 0,
)

/** Baslikta son iki yol parcasi: hangi alana yazildigi tek bakista belli. */
const scope = computed(() => (props.path ? props.path.split('.').slice(-2).join('.') : ''))

function submit() {
  if (!canSubmit.value || props.path === null) return
  emit('add', { path: props.path, body: draft.value.trim(), parentId: null })
  draft.value = ''
  editingName.value = false
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('tr-TR')
}
</script>

<template>
  <div class="threads">
    <p class="head">
      <span class="label">yorumlar</span>
      <span v-if="scope" class="scope">{{ scope }}</span>
    </p>

    <article v-for="comment in comments" :key="comment.id" class="comment">
      <p class="meta">
        <span class="author">{{ comment.author }}</span>
        <time class="time">{{ formatDate(comment.createdAt) }}</time>
        <button v-if="canDelete(comment.id)" class="del" @click="emit('remove', comment.id)">sil</button>
      </p>
      <p class="body">{{ comment.body }}</p>
    </article>

    <p v-if="comments.length === 0" class="empty">
      {{ path ? 'Bu alana ilk yorumu siz bırakın.' : 'Bir alan seçin.' }}
    </p>

    <template v-if="enabled">
      <input
        v-if="editingName"
        v-model="nameModel"
        class="input name"
        type="text"
        maxlength="60"
        placeholder="adınız"
      />
      <button v-else class="who" @click="editingName = true">{{ author }} olarak</button>
      <form class="form" @submit.prevent="submit">
        <input
          v-model="draft"
          class="input"
          type="text"
          maxlength="4000"
          :disabled="!path"
          placeholder="bu alana yorum yaz…"
        />
        <button type="submit" class="send" :disabled="!canSubmit">gönder</button>
      </form>
    </template>
    <p v-else class="empty">Bu paylaşım yorumlara kapalı.</p>
  </div>
</template>

<style scoped>
.threads { display: flex; flex-direction: column; gap: 8px; }

.head { display: flex; align-items: baseline; gap: 8px; }
.label { font-size: 11px; color: var(--ink-4); }
.scope { font-size: 10.5px; color: var(--ink-5); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Her yorum sol cizgisiyle ayrilir; avatar yok, ad ve zaman yeter. */
.comment { border-left: 1px solid var(--line-strong); padding: 0 9px; }
.meta { display: flex; align-items: baseline; gap: 8px; }
.author { font-size: 11px; color: var(--ink); }
.time { font-size: 10.5px; color: var(--ink-5); }
.del { margin-left: auto; font-size: 10.5px; color: var(--ink-5); }
.del:hover { color: var(--removed); }
.body { font-size: 11.5px; color: var(--ink-2); line-height: 1.5; text-wrap: pretty; white-space: pre-wrap; word-break: break-word; }

.empty { font-size: 11px; color: var(--ink-4); }

.form { display: flex; gap: 7px; }
.input {
  flex: 1; min-width: 0; box-sizing: border-box; background: var(--bg-data);
  border: 1px solid var(--line); border-radius: var(--radius); outline: none;
  font-size: 11px; padding: 5px 8px;
}
.input:focus { border-color: var(--accent); }
.input:disabled { opacity: .5; cursor: not-allowed; }
.input.name { flex: none; width: 100%; }
.who { font-size: 10.5px; color: var(--ink-5); text-align: left; }
.who:hover { color: var(--ink-2); }
.send {
  font-size: 11px; color: var(--on-accent); background: var(--accent);
  border-radius: var(--radius); padding: 5px 12px; white-space: nowrap;
}
.send:hover:not(:disabled) { background: var(--accent-hover); }
.send:disabled { opacity: .4; cursor: not-allowed; }
</style>
