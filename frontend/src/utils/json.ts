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

/**
 * Ayristirma hatasindan satir/sutun cikarir.
 *
 * Tarayicilar mesaji farkli bicimlerde veriyor: bazilari `(line 14 column 7)`
 * yaziyor, bazilari yalnizca `position 312`. Ikinci durumda konum metin uzerinden
 * satira cevriliyor ki editorde hatali satir isaretlenebilsin.
 */
export function describeParseError(
  message: string,
  text: string,
): { line: number | null; column: number | null; message: string } {
  const lineMatch = /line (\d+) column (\d+)/i.exec(message)
  if (lineMatch) {
    return { line: Number(lineMatch[1]), column: Number(lineMatch[2]), message }
  }
  const posMatch = /position (\d+)/i.exec(message)
  if (posMatch) {
    const position = Math.min(Number(posMatch[1]), text.length)
    const before = text.slice(0, position)
    const line = before.split('\n').length
    const column = position - before.lastIndexOf('\n')
    return { line, column, message }
  }
  return { line: null, column: null, message }
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
/**
 * XSD yolundan (`Response.Order.OrderID`) goruntuleyicideki ilk dugum yolunu bulur.
 * Dizi indeksleri XSD yolunda tasinmadigi icin arama JSON uzerinde yapilir.
 */
export function findNodePath(
  data: JsonValue,
  rootKey: string,
  messageType: string | null,
  schemaPath: string,
): string | null {
  let found: string | null = null

  function walk(value: JsonValue, path: string) {
    if (found) return
    if (toSchemaPath(path, rootKey, messageType) === schemaPath) {
      found = path
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}.${index}`))
    } else if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, JsonValue>)) {
        walk(child, `${path}.${key}`)
      }
    }
  }

  walk(data, rootKey)
  return found
}

export function toSchemaPath(nodePath: string, rootKey: string, messageType: string | null): string {
  const segments = nodePath.split('.')
  if (segments[0] === rootKey) segments.shift()
  if (messageType && segments[0] === messageType) segments.shift()
  return segments.filter(segment => !/^\d+$/.test(segment)).join('.')
}
