import { computed, ref, watch, onBeforeUnmount, type Ref } from 'vue'
import type { Comment } from '../types'
import { createComment, deleteComment, listComments } from '../api'

const AUTHOR_KEY = 'json-sarp:author'
const TOKENS_KEY = 'json-sarp:comment-tokens'
const REFRESH_MS = 20_000

function readTokens(): Record<number, string> {
  try {
    return JSON.parse(localStorage.getItem(TOKENS_KEY) ?? '{}') as Record<number, string>
  } catch {
    return {}
  }
}

function writeTokens(tokens: Record<number, string>) {
  try {
    localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens))
  } catch {
    // localStorage kapali olabilir; token kaybi yalnizca silme yetkisini etkiler.
  }
}

/**
 * Paylasilan bir JSON'un yorumlarini yonetir.
 *
 * Kimlik dogrulamasi yok: isim tarayicida saklanir, silme yetkisi ise sunucunun
 * olusturma aninda dondugu jetonla saglanir (yalnizca yorumu birakan kisi siler).
 */
export function useComments(shareId: Ref<string | null>) {
  const comments = ref<Comment[]>([])
  const enabled = ref(true)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const author = ref(localStorage.getItem(AUTHOR_KEY) ?? '')

  let tokens = readTokens()
  let timer: ReturnType<typeof setInterval> | null = null

  watch(author, (value) => {
    try {
      localStorage.setItem(AUTHOR_KEY, value)
    } catch {
      // yok sayilir
    }
  })

  /** Yol basina yorumlar; goruntuleyici satirlari bu haritadan okur. */
  const byPath = computed(() => {
    const map = new Map<string, Comment[]>()
    for (const comment of comments.value) {
      const list = map.get(comment.path)
      if (list) list.push(comment)
      else map.set(comment.path, [comment])
    }
    return map
  })

  const total = computed(() => comments.value.length)
  const commentedPaths = computed(() => [...byPath.value.keys()].sort())

  async function refresh() {
    const id = shareId.value
    if (!id) {
      comments.value = []
      return
    }
    loading.value = true
    try {
      const response = await listComments(id)
      comments.value = response.comments
      enabled.value = response.enabled
      error.value = null
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  async function add(path: string, body: string, parentId: number | null = null) {
    const id = shareId.value
    if (!id) return
    error.value = null
    try {
      const created = await createComment(id, { path, author: author.value, body, parentId })
      tokens[created.comment.id] = created.editToken
      writeTokens(tokens)
      comments.value = [...comments.value, created.comment]
    } catch (e) {
      error.value = (e as Error).message
      throw e
    }
  }

  async function remove(commentId: number) {
    const id = shareId.value
    const token = tokens[commentId]
    if (!id || !token) return
    error.value = null
    try {
      await deleteComment(id, commentId, token)
      delete tokens[commentId]
      writeTokens(tokens)
      // Yanitlar sunucuda da silinir; yerelde de temizle.
      comments.value = comments.value.filter(c => c.id !== commentId && c.parentId !== commentId)
    } catch (e) {
      error.value = (e as Error).message
    }
  }

  /** Yorum bu tarayicidan birakildiysa silinebilir. */
  function canDelete(commentId: number): boolean {
    return Boolean(tokens[commentId])
  }

  watch(shareId, (id) => {
    if (timer) clearInterval(timer)
    timer = null
    comments.value = []
    if (!id) return
    tokens = readTokens()
    void refresh()
    // Baskalarinin yorumlari da gorunsun diye periyodik tazeleme.
    timer = setInterval(() => { void refresh() }, REFRESH_MS)
  }, { immediate: true })

  onBeforeUnmount(() => {
    if (timer) clearInterval(timer)
  })

  return { comments, byPath, commentedPaths, total, enabled, loading, error, author, refresh, add, remove, canDelete }
}
