import type { JsonValue } from '../types'

export function getType(value: JsonValue): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

export function highlightParts(text: string, search: string): Array<{ text: string; match: boolean }> {
  if (!search) return [{ text, match: false }]
  const idx = text.toLowerCase().indexOf(search.toLowerCase())
  if (idx === -1) return [{ text, match: false }]
  return [
    { text: text.slice(0, idx), match: false },
    { text: text.slice(idx, idx + search.length), match: true },
    { text: text.slice(idx + search.length), match: false },
  ]
}

export function countNodes(data: unknown, depth = 0): number {
  if (depth > 50) return 1
  if (Array.isArray(data)) {
    return 1 + data.reduce<number>((sum, value) => sum + countNodes(value, depth + 1), 0)
  }
  if (data !== null && typeof data === 'object') {
    return 1 + Object.values(data as Record<string, unknown>).reduce<number>(
      (sum, value) => sum + countNodes(value, depth + 1),
      0,
    )
  }
  return 1
}

export function parseJson(input: string): { data: JsonValue | null; error: string | null } {
  const trimmed = input.trim()
  if (!trimmed) return { data: null, error: null }
  try {
    return { data: JSON.parse(trimmed) as JsonValue, error: null }
  } catch (e) {
    return { data: null, error: (e as Error).message }
  }
}

/**
 * Goruntuleyicideki dugum yolunu backend'in XSD yoluna cevirir.
 *
 * Backend yollari mesaj govdesinden baslar ve dizi indeksi icermez
 * (`Response.Order.OrderID`); agactaki yol ise kok etiketi ve indeksleri tasir
 * (`json.IATA_OrderViewRS.Response.Order.0.OrderID`).
 *
 * Alan adina gore geri dusmuyoruz: ayni ad NDC'de baglama gore farkli anlamlara
 * geldigi icin yalnizca tam yol eslesmesi dogru aciklamayi verir.
 */
export function toSchemaPath(nodePath: string, rootKey: string, messageType: string | null): string {
  const segments = nodePath.split('.')
  if (segments[0] === rootKey) segments.shift()
  if (messageType && segments[0] === messageType) segments.shift()
  return segments.filter(segment => !/^\d+$/.test(segment)).join('.')
}
