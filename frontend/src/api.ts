import type {
  AnnotateResponse,
  CommentCreateResponse,
  CommentListResponse,
  JsonValue,
  ShareCreateResponse,
  ShareResponse,
} from './types'

/**
 * Varsayilan `/api`: gelistirmede Vite proxy'si, Vercel'de `vercel.json` rewrite'i
 * istegi backend'e tasir. Backend'e dogrudan (baska bir alan adindan) gidilecekse
 * `VITE_API_BASE` ile tam adres verilir — o durumda backend'in CORS listesine bu
 * on yuzun adresi eklenmelidir.
 */
const API_BASE = import.meta.env.VITE_API_BASE || '/api'

const STATUS_MESSAGES: Record<number, string> = {
  404: 'Paylaşım bulunamadı. Link yanlış olabilir ya da saklama süresi dolduğu için silinmiş olabilir.',
  413: 'JSON çok büyük, paylaşılamadı.',
}

// Spring'in hata govdesi ham JSON olarak gelir; kullaniciya okunabilir bir metin gosteririz.
async function errorMessage(response: Response): Promise<string> {
  const known = STATUS_MESSAGES[response.status]
  if (known) return known

  const text = await response.text()
  if (!text) return `HTTP ${response.status}`
  try {
    const body = JSON.parse(text) as { message?: string; error?: string }
    return body.message || body.error || `HTTP ${response.status}`
  } catch {
    return text
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${url}`, {
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      ...init,
    })
  } catch {
    throw new Error(`Backend bağlantısı kurulamadı (${API_BASE}). Sunucu çalışıyor mu?`)
  }
  if (!response.ok) {
    throw new Error(await errorMessage(response))
  }
  // DELETE 204 doner; bos govdeyi JSON olarak ayristirmaya calisma.
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function createShare(
  json: JsonValue,
  title?: string,
  commentsEnabled = true,
): Promise<ShareCreateResponse> {
  return request<ShareCreateResponse>('/shares', {
    method: 'POST',
    body: JSON.stringify({ json, title: title?.trim() || null, commentsEnabled }),
  })
}

export function listComments(shareId: string): Promise<CommentListResponse> {
  return request<CommentListResponse>(`/shares/${encodeURIComponent(shareId)}/comments`)
}

export function createComment(
  shareId: string,
  input: { path: string; author: string; body: string; parentId?: number | null },
): Promise<CommentCreateResponse> {
  return request<CommentCreateResponse>(`/shares/${encodeURIComponent(shareId)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ ...input, parentId: input.parentId ?? null }),
  })
}

export function deleteComment(shareId: string, commentId: number, editToken: string): Promise<void> {
  return request<void>(`/shares/${encodeURIComponent(shareId)}/comments/${commentId}`, {
    method: 'DELETE',
    headers: { 'X-Edit-Token': editToken },
  })
}

export function getShare(id: string): Promise<ShareResponse> {
  return request<ShareResponse>(`/shares/${encodeURIComponent(id)}`)
}

export function annotateJson(json: JsonValue): Promise<AnnotateResponse> {
  return request<AnnotateResponse>('/iata/annotate', {
    method: 'POST',
    body: JSON.stringify({ json }),
  })
}
