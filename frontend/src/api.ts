import type { AnnotateResponse, JsonValue, ShareCreateResponse, ShareResponse } from './types'

const API_BASE = '/api'

const STATUS_MESSAGES: Record<number, string> = {
  404: 'Paylaşım bulunamadı. Link yanlış olabilir veya kayıt silinmiş olabilir.',
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
    throw new Error('Backend bağlantısı kurulamadı. Spring Boot (port 8080) çalışıyor mu?')
  }
  if (!response.ok) {
    throw new Error(await errorMessage(response))
  }
  return response.json() as Promise<T>
}

export function createShare(json: JsonValue, title?: string): Promise<ShareCreateResponse> {
  return request<ShareCreateResponse>('/shares', {
    method: 'POST',
    body: JSON.stringify({ json, title: title?.trim() || null }),
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
