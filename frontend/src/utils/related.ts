import type { JsonObject, JsonValue } from '../types'

/**
 * "Bu alan belgede baska nerede, hangi degerlerle geciyor?" sorusunun cevabi.
 *
 * NDC yanitlarinda ayni alan yuzlerce kayitta tekrarlanir (`Order[].StatusCode`)
 * ve hata ayiklamanin ilk adimi genellikle o alanin dagilimina bakmaktir. Yol
 * indeksleri atilarak "alan yolu" cikariliyor, sonra yalnizca o yola giden dallar
 * dolasiliyor (eslesmeyen dallar budaniyor) — 70 bin dugumlu belgede de hizli.
 */

export interface DistinctValue {
  /** Ekranda gosterilen metin (kapsayicilar icin ozet). */
  text: string
  count: number
  /** Bu degerin ilk gectigi tam dugum yolu; tek tikla oraya gitmek icin. */
  firstPath: string
  kind: 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array'
}

export interface FieldValueStats {
  /** Indeksleri atilmis alan yolu, or. IATA_OrderViewRS.Response.Order.StatusCode. */
  fieldPath: string
  /** Alanin bulundugu dugum sayisi. */
  total: number
  /**
   * Alanin beklendigi ama bulunmadigi kayit sayisi. Yol uzerindeki herhangi bir
   * parcanin eksik olmasi (or. kayitta `TotalPrice` hic yoksa) buraya sayilir.
   */
  missing: number
  distinct: DistinctValue[]
  /** Farkli deger sayisi (liste kirpilmadan once). */
  distinctTotal: number
  numeric: { min: number; max: number; sum: number; avg: number } | null
  /** Ust sinira takildi mi. */
  truncated: boolean
}

/** Ust sinir: bundan sonrasi sayilmaz, panel "kirpildi" der. */
const MAX_HITS = 50_000
const DISTINCT_LIMIT = 8

/** Dugum yolundan alan yolu: kok etiketi ve dizi indeksleri atilir. */
export function toFieldPath(nodePath: string, rootKey: string): string {
  const segments = nodePath.split('.')
  if (segments[0] === rootKey) segments.shift()
  return segments.filter(segment => !/^\d+$/.test(segment)).join('.')
}

function kindOf(value: JsonValue): DistinctValue['kind'] {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  return typeof value as 'string' | 'number' | 'boolean'
}

function textOf(value: JsonValue): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${value.length} öğe]`
  if (typeof value === 'object') return `{${Object.keys(value).length} alan}`
  return String(value).replace(/\r?\n/g, ' ↵ ')
}

export function collectFieldValues(
  data: JsonValue,
  rootKey: string,
  nodePath: string,
): FieldValueStats | null {
  const fieldPath = toFieldPath(nodePath, rootKey)
  if (!fieldPath) return null
  const target = fieldPath.split('.')
  const leaf = target[target.length - 1]

  /**
   * Secili dugum bir dizi ogesiyse (`Tags.0`) alan yolu diziye isaret eder;
   * kullanicinin gordugu deger ogenin kendisi oldugu icin oge oge sayiyoruz.
   */
  const lastSegment = nodePath.split('.').pop() ?? ''
  const expandArray = /^\d+$/.test(lastSegment)

  const counts = new Map<string, { count: number; firstPath: string; kind: DistinctValue['kind'] }>()
  let total = 0
  let missing = 0
  let truncated = false
  let numericCount = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let sum = 0

  function record(value: JsonValue, path: string) {
    if (total >= MAX_HITS) {
      truncated = true
      return
    }
    total++
    const key = `${kindOf(value)}:${textOf(value)}`
    const entry = counts.get(key)
    if (entry) entry.count++
    else counts.set(key, { count: 1, firstPath: path, kind: kindOf(value) })
    if (typeof value === 'number' && Number.isFinite(value)) {
      numericCount++
      if (value < min) min = value
      if (value > max) max = value
      sum += value
    }
  }

  /** `depth`: alan yolunda kacinci parcanin arandigi. Dizi indeksleri derinligi artirmaz. */
  function walk(value: JsonValue, depth: number, path: string) {
    if (truncated) return
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, depth, `${path}.${index}`))
      return
    }
    if (value === null || typeof value !== 'object') return
    const object = value as JsonObject

    if (depth === target.length - 1) {
      if (!Object.prototype.hasOwnProperty.call(object, leaf)) {
        missing++
        return
      }
      const found = object[leaf]
      const foundPath = `${path}.${leaf}`
      if (expandArray && Array.isArray(found)) {
        found.forEach((item, index) => record(item, `${foundPath}.${index}`))
      } else {
        record(found, foundPath)
      }
      return
    }

    // Ara dugum de eksik olabilir (kayitta TotalPrice hic yoksa TotalAmount da
    // yoktur); bunu saymamak "alan yok" sayisini oldugundan kucuk gosteriyordu.
    const key = target[depth]
    if (!Object.prototype.hasOwnProperty.call(object, key)) {
      missing++
      return
    }
    walk(object[key], depth + 1, `${path}.${key}`)
  }

  walk(data, 0, rootKey)
  if (total === 0 && missing === 0) return null

  const distinct = [...counts.entries()]
    .map(([key, entry]) => ({
      text: key.slice(key.indexOf(':') + 1),
      count: entry.count,
      firstPath: entry.firstPath,
      kind: entry.kind,
    }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, 'tr'))

  return {
    fieldPath,
    total,
    missing,
    distinct: distinct.slice(0, DISTINCT_LIMIT),
    distinctTotal: distinct.length,
    numeric: numericCount > 0 && numericCount === total
      ? { min, max, sum, avg: sum / numericCount }
      : null,
    truncated,
  }
}
