import type { FieldDoc, JsonArray, JsonObject, JsonValue } from '../types'
import { getType } from './json'
import { childPath, matchesDeep } from './search'
import { effectiveFieldName, isRefField, resolveRef, type RefIndex, type RefTarget } from './references'

/**
 * Grid, ozyinelemeli bilesen agaci yerine duz bir satir listesi uzerinden render
 * edilir: sanallastirma yalnizca boyle mumkun (pencereye giren satirlar bilinmeli)
 * ve referans/yorum/tablo kutulari da birer satir olarak listede yerini alir.
 */
export type GridRowKind = 'row' | 'ref' | 'thread' | 'table' | 'more'

export interface GridRowItem {
  /** v-for anahtari; ayni yol icin farkli turler ayri anahtar alir. */
  key: string
  kind: GridRowKind
  path: string
  depth: number

  /** kind === 'row' */
  field?: string
  value?: JsonValue
  type?: string
  isContainer?: boolean
  isOpen?: boolean
  /** Kapsayicilar icin "4 öğe" / "3 alan". */
  summary?: string
  doc?: FieldDoc
  refTarget?: RefTarget
  refOpen?: boolean
  commentCount?: number
  threadOpen?: boolean
  /** Satirin kendisi mi eslesti yoksa eslesme alt agacinda mi. */
  matchKind?: 'self' | 'deep' | null

  /** kind === 'table' */
  items?: JsonObject[]

  /** kind === 'more' */
  pendingCount?: number
}

export interface FlattenOptions {
  rootKey: string
  expanded: Set<string>
  /** Yol basina gosterilen cocuk sayisi; "N satır daha göster" bunu buyutur. */
  pageSizes: Map<string, number>
  pageSize: number
  searchTerm?: string
  filterMatches?: boolean
  arrayTableMode?: boolean
  docLookup?: (nodePath: string) => FieldDoc | undefined
  refIndex?: RefIndex
  refOpenPath?: string | null
  openThreadPath?: string | null
  commentCountFor?: (path: string) => number
  commentsAvailable?: boolean
}

/** Nesnelerden olusan dizi mi; tablo moduna yalnizca bunlar donusur. */
export function isObjectArray(value: JsonValue): value is JsonObject[] {
  return (
    Array.isArray(value)
    && value.length > 0
    && value.every(item => item !== null && typeof item === 'object' && !Array.isArray(item))
  )
}

function entriesOf(value: JsonValue): Array<{ key: string; value: JsonValue }> {
  if (Array.isArray(value)) {
    return (value as JsonArray).map((item, index) => ({ key: String(index), value: item }))
  }
  return Object.entries(value as JsonObject).map(([key, child]) => ({ key, value: child }))
}

export function flattenTree(data: JsonValue, options: FlattenOptions): GridRowItem[] {
  const out: GridRowItem[] = []
  const term = options.searchTerm?.trim() ?? ''
  const needle = term.toLowerCase()
  const filterActive = options.filterMatches === true && term.length > 0

  function keep(key: string, value: JsonValue): boolean {
    if (!filterActive) return true
    return key.toLowerCase().includes(needle) || matchesDeep(value, term)
  }

  function matchKindOf(field: string, value: JsonValue, container: boolean): 'self' | 'deep' | null {
    if (!needle) return null
    if (field.toLowerCase().includes(needle)) return 'self'
    if (!matchesDeep(value, term)) return null
    return container ? 'deep' : 'self'
  }

  function refFor(path: string, value: JsonValue, container: boolean): RefTarget | undefined {
    if (container || !options.refIndex) return undefined
    const fieldName = effectiveFieldName(path)
    if (!isRefField(fieldName)) return undefined
    const parentPath = path.slice(0, path.lastIndexOf('.'))
    return resolveRef(options.refIndex, fieldName, value, parentPath)
  }

  function walk(field: string, value: JsonValue, path: string, depth: number) {
    const type = getType(value)
    const isContainer = type === 'object' || type === 'array'
    const isOpen = isContainer && options.expanded.has(path)
    const childCount = isContainer
      ? (Array.isArray(value) ? value.length : Object.keys(value as JsonObject).length)
      : 0
    const refTarget = refFor(path, value, isContainer)

    out.push({
      key: path,
      kind: 'row',
      path,
      depth,
      field,
      value,
      type,
      isContainer,
      isOpen,
      summary: type === 'array' ? `${childCount} öğe` : type === 'object' ? `${childCount} alan` : '',
      doc: options.docLookup?.(path),
      refTarget,
      refOpen: refTarget !== undefined && options.refOpenPath === path,
      commentCount: options.commentsAvailable ? (options.commentCountFor?.(path) ?? 0) : 0,
      threadOpen: options.openThreadPath === path,
      matchKind: matchKindOf(field, value, isContainer),
    })

    if (refTarget && options.refOpenPath === path) {
      out.push({ key: `${path}::ref`, kind: 'ref', path, depth, refTarget })
    }
    if (options.commentsAvailable && options.openThreadPath === path) {
      out.push({ key: `${path}::thread`, kind: 'thread', path, depth })
    }

    if (!isContainer || !isOpen) return

    // Nesne dizileri "Tablo" modunda tek bir tablo satirina iner; cocuklar acilmaz.
    if (options.arrayTableMode && isObjectArray(value)) {
      out.push({ key: `${path}::table`, kind: 'table', path, depth, items: value })
      return
    }

    const children = entriesOf(value).filter(child => keep(child.key, child.value))
    const limit = options.pageSizes.get(path) ?? options.pageSize
    for (const child of children.slice(0, limit)) {
      walk(child.key, child.value, childPath(path, child.key), depth + 1)
    }
    const pending = children.length - limit
    if (pending > 0) {
      out.push({ key: `${path}::more`, kind: 'more', path, depth: depth + 1, pendingCount: pending })
    }
  }

  const rootType = getType(data)
  if (rootType !== 'object' && rootType !== 'array') return out
  for (const child of entriesOf(data)) {
    if (!keep(child.key, child.value)) continue
    walk(child.key, child.value, childPath(options.rootKey, child.key), 0)
  }
  return out
}

/** "Tümünü aç" icin acilabilecek tum yollar; cok buyuk belgelerde ust sinirla kesilir. */
export function collectExpandable(data: JsonValue, rootKey: string, limit = 5000): Set<string> {
  const paths = new Set<string>()
  function walk(value: JsonValue, path: string) {
    if (paths.size > limit) return
    if (value === null || typeof value !== 'object') return
    paths.add(path)
    for (const child of entriesOf(value)) walk(child.value, childPath(path, child.key))
  }
  walk(data, rootKey)
  return paths
}
