import type { JsonObject, JsonValue } from '../types'

export interface SearchIndex {
  /** Eslesen dugumlerin tam yollari, agactaki gorunum sirasinda. */
  matches: string[]
  matchSet: Set<string>
  /** Eslesen dugumler ve onlara giden tum atalar: otomatik acma ve filtreleme icin. */
  visible: Set<string>
  /** MAX_MATCHES asildi mi; UI bunu kullaniciya bildirir. */
  truncated: boolean
}

export const EMPTY_SEARCH: SearchIndex = {
  matches: [],
  matchSet: new Set<string>(),
  visible: new Set<string>(),
  truncated: false,
}

const MAX_MATCHES = 2000

export function childPath(parent: string, key: string | number): string {
  return parent ? `${parent}.${key}` : String(key)
}

/** Aranabilir metin; kapsayici tipler icin null. */
function primitiveText(value: JsonValue): string | null {
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

/**
 * JSON agacini tek geciste tarayip eslesen yollari ve atalarini toplar.
 * Dizi indeksleri anahtar olarak aranmaz; yalnizca deger ve nesne anahtarlari eslesir.
 */
export function buildSearchIndex(data: JsonValue, term: string, rootPath: string): SearchIndex {
  const needle = term.trim().toLowerCase()
  if (!needle) return EMPTY_SEARCH

  const matches: string[] = []
  const visible = new Set<string>()
  const ancestors: string[] = []
  let truncated = false

  function record(path: string) {
    matches.push(path)
    visible.add(path)
    for (const ancestor of ancestors) visible.add(ancestor)
    if (matches.length >= MAX_MATCHES) truncated = true
  }

  function walk(value: JsonValue, key: string | null, path: string) {
    if (truncated) return

    const keyHit = key !== null && key.toLowerCase().includes(needle)
    const text = primitiveText(value)
    const valueHit = text !== null && text.toLowerCase().includes(needle)
    if (keyHit || valueHit) record(path)

    if (Array.isArray(value)) {
      ancestors.push(path)
      value.forEach((item, i) => walk(item, null, childPath(path, i)))
      ancestors.pop()
    } else if (value !== null && typeof value === 'object') {
      ancestors.push(path)
      for (const [k, v] of Object.entries(value as JsonObject)) {
        walk(v, k, childPath(path, k))
      }
      ancestors.pop()
    }
  }

  walk(data, null, rootPath)
  return { matches, matchSet: new Set(matches), visible, truncated }
}

/** Deger veya alt agacinda arama terimi geciyor mu (grid drill-down icin). */
export function matchesDeep(value: JsonValue, term: string): boolean {
  const needle = term.trim().toLowerCase()
  if (!needle) return false
  return deepHit(value, needle)
}

function deepHit(value: JsonValue, needle: string): boolean {
  const text = primitiveText(value)
  if (text !== null) return text.toLowerCase().includes(needle)
  if (Array.isArray(value)) return value.some(item => deepHit(item, needle))
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as JsonObject).some(
      ([k, v]) => k.toLowerCase().includes(needle) || deepHit(v, needle),
    )
  }
  return false
}
