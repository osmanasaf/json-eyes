import type { JsonValue } from '../../frontend/src/types'
import { UserError } from './output'

/**
 * Backend istemcisi. On yuzdeki `src/api.ts` Vite'a (`import.meta.env`) bagli
 * oldugu icin paylasilmiyor; CLI'nin ihtiyaci iki uc nokta ve anlasilir hata
 * mesajlari.
 */

export interface ShareCreateResponse {
  id: string
  url: string
}

export interface ShareResponse {
  id: string
  title: string | null
  commentsEnabled: boolean
  json: JsonValue
  createdAt: string
}

async function request<T>(url: string, init: RequestInit & { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 60_000)
  let response: Response
  try {
    response = await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError'
      ? 'istek zaman aşımına uğradı'
      : (error as Error).message
    throw new UserError(
      `Backend'e ulaşılamadı (${url}): ${reason}`,
      'Adresi --api ile verin veya `jse config set api <adres>` ile kaydedin. Yerelde backend: cd backend && mvn spring-boot:run',
    )
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new UserError(await errorMessage(response), hintFor(response.status))
  }
  return await response.json() as T
}

/** Spring hata govdesinden okunabilir bir mesaj cikarir. */
async function errorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  if (text) {
    try {
      const body = JSON.parse(text) as { message?: string; error?: string }
      const message = body.message || body.error
      if (message) return `HTTP ${response.status}: ${message}`
    } catch {
      return `HTTP ${response.status}: ${text.slice(0, 300)}`
    }
  }
  return `HTTP ${response.status}`
}

function hintFor(status: number): string | undefined {
  if (status === 404) return 'Paylaşım bulunamadı: link yanlış olabilir ya da saklama süresi (60 gün) dolmuş olabilir.'
  if (status === 413) return 'JSON sunucunun paylaşım sınırından büyük. Sınırı backend `jsonsarp.share.max-bytes` ile artırabilirsiniz.'
  if (status === 400) return 'Sunucu girdiyi reddetti; JSON gövdesi boş ya da geçersiz olabilir.'
  return undefined
}

export async function createShare(
  api: string,
  json: JsonValue,
  options: { title?: string; commentsEnabled: boolean; timeoutMs?: number },
): Promise<ShareCreateResponse> {
  return await request<ShareCreateResponse>(`${api}/shares`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      json,
      title: options.title ?? null,
      commentsEnabled: options.commentsEnabled,
    }),
    timeoutMs: options.timeoutMs,
  })
}

export async function getShare(api: string, id: string): Promise<ShareResponse> {
  return await request<ShareResponse>(`${api}/shares/${encodeURIComponent(id)}`, { method: 'GET' })
}

/**
 * Kullanici paylasim linkini oldugu gibi yapistirabilir; id'yi ondan cikarir.
 * Kabul edilenler: "AbC12xyz", "https://…/?s=AbC12xyz", "…&s=AbC12xyz".
 */
export function extractShareId(input: string): string {
  const trimmed = input.trim()
  const match = /[?&]s=([A-Za-z0-9]+)/.exec(trimmed)
  if (match) return match[1]
  if (/^[A-Za-z0-9]+$/.test(trimmed)) return trimmed
  throw new UserError(
    `Paylaşım kimliği anlaşılamadı: ${input}`,
    'Kimliği (örn. 4bK9zQ1x) ya da linkin tamamını verin.',
  )
}
