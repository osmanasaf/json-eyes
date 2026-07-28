import type { JsonObject, JsonValue } from '../types'
import { childPath } from './search'

/** Bir ID degerini tasiyan nesne. */
export interface RefTarget {
  /** ID alanini iceren nesnenin yolu (or. json.IATA_AirShoppingRS...DataLists.PaxList.Pax.0) */
  path: string
  value: JsonValue
  /** Hedefi tanimlayan alan adi (or. PaxID) */
  idField: string
}

export interface RefIndex {
  byValue: Map<string, RefTarget[]>
}

export const EMPTY_REF_INDEX: RefIndex = { byValue: new Map() }

/** PaxID, OrderItemID ... ama PaxRefID degil. */
export function isIdField(key: string): boolean {
  if (isRefField(key)) return false
  return /(?:^|[a-z0-9_])(ID|Id)$/.test(key) || key === 'id'
}

/** PaxRefID, ServiceDefinitionRefID ... */
export function isRefField(key: string): boolean {
  return /Ref(ID|Id)$/.test(key)
}

function scalarKey(value: JsonValue): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return null
}

/**
 * JSON'daki butun ID alanlarini deger -> hedef seklinde indeksler.
 *
 * NDC'de DataLists altindaki nesneler (Pax, PaxSegment, ServiceDefinition ...) birer
 * ID tasir ve mesajin her yerinden `*RefID` ile bunlara atifta bulunulur.
 */
export function buildRefIndex(data: JsonValue, rootPath: string): RefIndex {
  const byValue = new Map<string, RefTarget[]>()

  function record(id: string, target: RefTarget) {
    const list = byValue.get(id)
    if (list) list.push(target)
    else byValue.set(id, [target])
  }

  function walk(value: JsonValue, path: string) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, childPath(path, index)))
      return
    }
    if (value === null || typeof value !== 'object') return

    const object = value as JsonObject
    for (const [key, child] of Object.entries(object)) {
      if (isIdField(key)) {
        const id = scalarKey(child)
        if (id) record(id, { path, value, idField: key })
      }
      walk(child, childPath(path, key))
    }
  }

  walk(data, rootPath)
  return { byValue }
}

/**
 * Bir referans degerinin isaret ettigi nesneyi bulur.
 *
 * Eslesme deger uzerinden yapilir; birden fazla aday varsa ad kalibi
 * (PaxRefID -> PaxID) tercih edilir. Sema disi JSON'larda da calisir.
 */
export function resolveRef(
  index: RefIndex,
  refFieldName: string,
  value: JsonValue,
  selfPath: string,
): RefTarget | undefined {
  const id = scalarKey(value)
  if (!id) return undefined

  const candidates = (index.byValue.get(id) ?? []).filter(target => target.path !== selfPath)
  if (candidates.length === 0) return undefined
  if (candidates.length === 1) return candidates[0]

  const expected = refFieldName.replace(/Ref(ID|Id)$/, '$1')
  return candidates.find(target => target.idField === expected) ?? candidates[0]
}

/**
 * Dugumun referans alani olarak degerlendirilecek adi. Dizi elemanlarinda
 * (`PaxRefID: ["P1","P2"]`) ad ust segmentten gelir.
 */
export function effectiveFieldName(nodePath: string): string {
  const segments = nodePath.split('.')
  for (let i = segments.length - 1; i >= 0; i--) {
    if (!/^\d+$/.test(segments[i])) return segments[i]
  }
  return ''
}
