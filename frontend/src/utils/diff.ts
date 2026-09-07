import type { JsonObject, JsonValue } from '../types'
import { getType } from './json'

/**
 * Iki JSON'un yapisal karsilastirmasi.
 *
 * Tasarim karari: sonuc iki ayri agac degil, tek bir *birlesik* agac. Buyuk NDC
 * yanitlarinda yan yana iki metni gozle taramak ise yaramiyor; degisiklikleri
 * kendi yerinde, degismeyenleri katlanmis halde gormek gerekiyor.
 *
 * Kritik nokta diziler. Indekse gore karsilastirma (`Order[0]` ile `Order[0]`)
 * basa bir kayit eklenince her seyi "degismis" gosterir — bu, 1200 siparisli bir
 * yanitta raporu tumden ise yaramaz kilar. Bu yuzden diziler once *kimlige* gore
 * eslestiriliyor: dizinin ogelerinde ayirt edici bir anahtar (OrderID, PaxID…)
 * varsa eslestirme onunla yapilir, oge yer degistirdiyse "tasindi" denir.
 * Kimlik bulunamazsa metin diff'lerinin kullandigi LCS'e dusuluyor.
 */

export type ChangeKind = 'added' | 'removed' | 'changed' | 'moved' | 'unchanged'

export interface DiffCounts {
  added: number
  removed: number
  changed: number
  moved: number
}

export interface DiffNode {
  /** Alan adi ya da dizi indeksi etiketi. */
  key: string
  /** Gosterimde kullanilan yol (yeni tarafta varsa oradan, yoksa eskiden). */
  path: string
  /** Eski taraftaki yol; tasinan/silinen dugumlerde farkli olur. */
  oldPath: string | null
  kind: ChangeKind
  /** Dugumun tipi; silinen dugumlerde eski degerin tipi. */
  type: string
  /** Eski deger (changed/removed) — yalnizca yaprak dugumlerde doldurulur. */
  left?: JsonValue
  /** Yeni deger (changed/added). */
  right?: JsonValue
  children: DiffNode[]
  /** Alt agactaki degisiklik sayilari; katlama ve rozetler bunu kullanir. */
  counts: DiffCounts
  /** Tasinan dizi ogeleri icin eski ve yeni indeks. */
  from?: number
  to?: number
  /**
   * Dizi ogelerinde kimlik degeri (or. ORD100003). Indeks tek basina hangi
   * kaydin degistigini soylemiyor; rapor okunur olsun diye kimlik tasiniyor.
   */
  label?: string
}

export interface DiffResult {
  root: DiffNode
  counts: DiffCounts
  /** Kimlige gore eslestirilen diziler: yol -> kullanilan anahtar. */
  identityKeys: Map<string, string>
  /** Cok buyuk dizilerde LCS atlandi mi (indeks hizali karsilastirmaya dusuldu). */
  degraded: boolean
}

const EMPTY_COUNTS: DiffCounts = { added: 0, removed: 0, changed: 0, moved: 0 }

function addCounts(target: DiffCounts, source: DiffCounts): void {
  target.added += source.added
  target.removed += source.removed
  target.changed += source.changed
  target.moved += source.moved
}

function countsFor(kind: ChangeKind): DiffCounts {
  return {
    added: kind === 'added' ? 1 : 0,
    removed: kind === 'removed' ? 1 : 0,
    changed: kind === 'changed' ? 1 : 0,
    moved: kind === 'moved' ? 1 : 0,
  }
}

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Derin esitlik; degismeyen alt agaclari tek seferde gecmek icin. */
function deepEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true
  const typeA = getType(a)
  if (typeA !== getType(b)) return false
  if (typeA === 'array') {
    const arrayA = a as JsonValue[]
    const arrayB = b as JsonValue[]
    if (arrayA.length !== arrayB.length) return false
    return arrayA.every((item, index) => deepEqual(item, arrayB[index]))
  }
  if (typeA === 'object') {
    const objectA = a as JsonObject
    const objectB = b as JsonObject
    const keysA = Object.keys(objectA)
    if (keysA.length !== Object.keys(objectB).length) return false
    return keysA.every(key =>
      Object.prototype.hasOwnProperty.call(objectB, key) && deepEqual(objectA[key], objectB[key]),
    )
  }
  return false
}

/**
 * Dizinin ogelerini ayirt eden anahtari bulur. Once ad kalibina uyanlar
 * (OrderID, PaxID, id…), sonra iki tarafta da benzersiz olan herhangi bir
 * skaler anahtar denenir. Iki taraf arasinda hic ortak deger yoksa anahtar
 * kabul edilmez — yoksa tamamen farkli iki liste "hepsi silindi + hepsi
 * eklendi" olarak degil, yanlis eslesmelerle raporlanirdi.
 */
const ID_PATTERN = /(^|[^a-z])(id|key|code|ref|no|number|name)$/i

export function detectIdentityKey(left: JsonValue[], right: JsonValue[]): string | null {
  const objectsLeft = left.filter(isObject)
  const objectsRight = right.filter(isObject)
  if (objectsLeft.length === 0 || objectsRight.length === 0) return null
  // Kismi nesne dizilerinde eslestirme guvenilir olmaz.
  if (objectsLeft.length < left.length || objectsRight.length < right.length) return null

  const candidates = Object.keys(objectsRight[0]).filter(key =>
    objectsRight.every(item => {
      const value = item[key]
      return value !== null && value !== undefined && typeof value !== 'object'
    })
    && objectsLeft.every(item => {
      const value = item[key]
      return value !== null && value !== undefined && typeof value !== 'object'
    }),
  )

  const scored = candidates
    .map((key) => {
      const valuesLeft = objectsLeft.map(item => String(item[key]))
      const valuesRight = objectsRight.map(item => String(item[key]))
      const uniqueLeft = new Set(valuesLeft)
      const uniqueRight = new Set(valuesRight)
      if (uniqueLeft.size !== valuesLeft.length || uniqueRight.size !== valuesRight.length) return null
      const shared = [...uniqueRight].filter(value => uniqueLeft.has(value)).length
      if (shared === 0) return null
      return { key, shared, named: ID_PATTERN.test(key) }
    })
    .filter((entry): entry is { key: string; shared: number; named: boolean } => entry !== null)

  if (scored.length === 0) return null
  // Ad kalibina uyan ve en cok ortak degeri olan anahtar kazanir.
  scored.sort((a, b) => Number(b.named) - Number(a.named) || b.shared - a.shared)
  return scored[0].key
}

/** Kimliksiz dizilerde oge imzasi; LCS bunun uzerinden calisir. */
function signature(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return `${typeof value}:${String(value)}`
  try {
    return JSON.stringify(value)
  } catch {
    return 'object'
  }
}

/** LCS matrisi: metin diff'lerinin dizi karsiligi. */
function lcsPairs(left: string[], right: string[]): Array<[number, number]> {
  const n = left.length
  const m = right.length
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = left[i] === right[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i++
    } else {
      j++
    }
  }
  return pairs
}

/**
 * En uzun artan alt dizi (LIS) — "gercekten tasindi" ile "kaydi" ayrimi icin.
 *
 * Basa bir kayit eklenince sonraki tum ogelerin indeksi bir artar; bunlari
 * "tasindi" diye raporlamak 1200 kayitlik bir yanitta raporu ise yaramaz kilar.
 * Eslesen ogelerin eski indeksleri yeni sirada listelenip artan en uzun alt
 * dizi bulunuyor: o dizideki ogeler yerinde sayilir, disinda kalanlar gercekten
 * yer degistirmis olanlardir. (Metin diff'lerinin ve jsondiffpatch'in tasima
 * tespitinde kullandigi yaklasim.)
 */
function stablePositions(oldIndexes: number[]): Set<number> {
  const tails: number[] = []
  const tailIndex: number[] = []
  const previous = new Array<number>(oldIndexes.length).fill(-1)

  for (let i = 0; i < oldIndexes.length; i++) {
    const value = oldIndexes[i]
    let low = 0
    let high = tails.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (tails[mid] < value) low = mid + 1
      else high = mid
    }
    tails[low] = value
    tailIndex[low] = i
    previous[i] = low > 0 ? tailIndex[low - 1] : -1
  }

  const stable = new Set<number>()
  let cursor = tails.length > 0 ? tailIndex[tails.length - 1] : -1
  while (cursor >= 0) {
    stable.add(cursor)
    cursor = previous[cursor]
  }
  return stable
}

/** LCS'in bellek/zaman siniri; ustunde indeks hizali karsilastirmaya duseriz. */
const MAX_LCS_CELLS = 4_000_000

export function diffJson(left: JsonValue, right: JsonValue, rootKey: string): DiffResult {
  const identityKeys = new Map<string, string>()
  let degraded = false

  function childPath(parent: string, key: string | number): string {
    return `${parent}.${key}`
  }

  function leaf(
    key: string,
    path: string,
    oldPath: string | null,
    kind: ChangeKind,
    type: string,
    left?: JsonValue,
    right?: JsonValue,
    extra?: { from?: number; to?: number },
  ): DiffNode {
    return {
      key, path, oldPath, kind, type, left, right,
      children: [],
      counts: countsFor(kind),
      ...extra,
    }
  }

  /** Tumu degismeyen bir alt agac: cocuk uretmeye gerek yok, katli kalir. */
  function unchangedNode(key: string, path: string, value: JsonValue): DiffNode {
    return {
      key,
      path,
      oldPath: path,
      kind: 'unchanged',
      type: getType(value),
      left: value,
      right: value,
      children: [],
      counts: { ...EMPTY_COUNTS },
    }
  }

  function walk(
    key: string,
    leftValue: JsonValue,
    rightValue: JsonValue,
    path: string,
    oldPath: string,
    moved?: { from: number; to: number },
  ): DiffNode {
    const typeLeft = getType(leftValue)
    const typeRight = getType(rightValue)

    // Tip degistiyse ya da ikisi de skalerse: yaprak karsilastirma.
    if (typeLeft !== typeRight || (typeRight !== 'object' && typeRight !== 'array')) {
      const same = deepEqual(leftValue, rightValue)
      const kind: ChangeKind = same ? (moved ? 'moved' : 'unchanged') : 'changed'
      return leaf(key, path, oldPath, kind, typeRight, leftValue, rightValue, moved)
    }

    if (deepEqual(leftValue, rightValue)) {
      if (!moved) return unchangedNode(key, path, rightValue)
      return leaf(key, path, oldPath, 'moved', typeRight, leftValue, rightValue, moved)
    }

    const children = typeRight === 'array'
      ? diffArray(leftValue as JsonValue[], rightValue as JsonValue[], path, oldPath)
      : diffObject(leftValue as JsonObject, rightValue as JsonObject, path, oldPath)

    const counts: DiffCounts = { ...EMPTY_COUNTS }
    for (const child of children) addCounts(counts, child.counts)
    if (moved) counts.moved += 1

    return {
      key,
      path,
      oldPath,
      kind: moved ? 'moved' : 'changed',
      type: typeRight,
      children,
      counts,
      from: moved?.from,
      to: moved?.to,
    }
  }

  function diffObject(left: JsonObject, right: JsonObject, path: string, oldPath: string): DiffNode[] {
    const out: DiffNode[] = []
    // Yeni belgenin alan sirasi korunur; silinenler sonda listelenir.
    for (const [key, value] of Object.entries(right)) {
      if (!Object.prototype.hasOwnProperty.call(left, key)) {
        out.push(leaf(key, childPath(path, key), null, 'added', getType(value), undefined, value))
        continue
      }
      out.push(walk(key, left[key], value, childPath(path, key), childPath(oldPath, key)))
    }
    for (const [key, value] of Object.entries(left)) {
      if (Object.prototype.hasOwnProperty.call(right, key)) continue
      out.push(leaf(key, childPath(oldPath, key), childPath(oldPath, key), 'removed', getType(value), value))
    }
    return out
  }

  function diffArray(left: JsonValue[], right: JsonValue[], path: string, oldPath: string): DiffNode[] {
    const identity = detectIdentityKey(left, right)
    if (identity) {
      identityKeys.set(path, identity)
      return diffArrayByIdentity(left, right, path, oldPath, identity)
    }
    if (left.length * right.length > MAX_LCS_CELLS) {
      degraded = true
      return diffArrayByIndex(left, right, path, oldPath)
    }
    return diffArrayByLcs(left, right, path, oldPath)
  }

  /** Kimlik anahtariyla eslestirme: NDC dizilerinin dogru okundugu yol. */
  function diffArrayByIdentity(
    left: JsonValue[],
    right: JsonValue[],
    path: string,
    oldPath: string,
    identity: string,
  ): DiffNode[] {
    const leftIndex = new Map<string, number>()
    left.forEach((item, index) => {
      leftIndex.set(String((item as JsonObject)[identity]), index)
    })

    // Once eslesmeleri bul, sonra hangilerinin gercekten yer degistirdigine
    // karar ver: yalnizca indeksi kaymis olanlar "tasindi" sayilmamali.
    const matches: Array<{ index: number; from: number }> = []
    right.forEach((item, index) => {
      const from = leftIndex.get(String((item as JsonObject)[identity]))
      if (from !== undefined) matches.push({ index, from })
    })
    const stable = stablePositions(matches.map(match => match.from))
    const movedByIndex = new Map<number, number>()
    matches.forEach((match, order) => {
      if (!stable.has(order)) movedByIndex.set(match.index, match.from)
    })

    const out: DiffNode[] = []
    const matchedLeft = new Set<number>()

    right.forEach((item, index) => {
      const id = String((item as JsonObject)[identity])
      const from = leftIndex.get(id)
      const label = `${index}`
      if (from === undefined) {
        const node = leaf(label, childPath(path, index), null, 'added', getType(item), undefined, item)
        node.label = id
        out.push(node)
        return
      }
      matchedLeft.add(from)
      const moved = movedByIndex.has(index) ? { from, to: index } : undefined
      const node = walk(label, left[from], item, childPath(path, index), childPath(oldPath, from), moved)
      node.label = id
      out.push(node)
    })

    left.forEach((item, index) => {
      if (matchedLeft.has(index)) return
      const node = leaf(`${index}`, childPath(oldPath, index), childPath(oldPath, index), 'removed', getType(item), item)
      node.label = String((item as JsonObject)[identity])
      out.push(node)
    })

    return out
  }

  /** Kimliksiz diziler: imzalar uzerinden LCS, kalanlar eslestirilir. */
  function diffArrayByLcs(left: JsonValue[], right: JsonValue[], path: string, oldPath: string): DiffNode[] {
    const signaturesLeft = left.map(signature)
    const signaturesRight = right.map(signature)
    const pairs = lcsPairs(signaturesLeft, signaturesRight)
    const pairedRight = new Map<number, number>(pairs.map(([i, j]) => [j, i]))
    const pairedLeft = new Set<number>(pairs.map(([i]) => i))

    // Eslesmeyen sol ve sag ogeleri sirayla eslestir: ikisi de varsa "degisti".
    const freeLeft = left.map((_, index) => index).filter(index => !pairedLeft.has(index))
    const out: DiffNode[] = []
    let freeCursor = 0

    right.forEach((item, index) => {
      const from = pairedRight.get(index)
      if (from !== undefined) {
        // LCS ciftleri sirayi koruyor: indeks farki yalnizca ekleme/silmeden
        // kaynaklanan kaymadir, tasima degil.
        out.push(walk(`${index}`, left[from], item, childPath(path, index), childPath(oldPath, from)))
        return
      }
      // Artakalan iki taraf yalnizca ikisi de nesneyse "degisti" olarak
      // eslestirilir: orada alan alan karsilastirma bilgi verir. Skalerlerde
      // (or. "b" -> "e") eslestirmek yanlis bir sureklilik izlenimi verirdi,
      // silindi + eklendi daha dogru.
      const leftIdx = freeCursor < freeLeft.length ? freeLeft[freeCursor] : undefined
      const pairable = leftIdx !== undefined && isObject(left[leftIdx]) && isObject(item)
      if (pairable) {
        freeCursor++
        out.push(walk(`${index}`, left[leftIdx!], item, childPath(path, index), childPath(oldPath, leftIdx!)))
        return
      }
      out.push(leaf(`${index}`, childPath(path, index), null, 'added', getType(item), undefined, item))
    })

    for (; freeCursor < freeLeft.length; freeCursor++) {
      const leftIdx = freeLeft[freeCursor]
      const item = left[leftIdx]
      out.push(leaf(`${leftIdx}`, childPath(oldPath, leftIdx), childPath(oldPath, leftIdx), 'removed', getType(item), item))
    }
    return out
  }

  /** Cok buyuk dizilerde son care: indeks hizali karsilastirma. */
  function diffArrayByIndex(left: JsonValue[], right: JsonValue[], path: string, oldPath: string): DiffNode[] {
    const out: DiffNode[] = []
    const shared = Math.min(left.length, right.length)
    for (let index = 0; index < shared; index++) {
      out.push(walk(`${index}`, left[index], right[index], childPath(path, index), childPath(oldPath, index)))
    }
    for (let index = shared; index < right.length; index++) {
      out.push(leaf(`${index}`, childPath(path, index), null, 'added', getType(right[index]), undefined, right[index]))
    }
    for (let index = shared; index < left.length; index++) {
      out.push(leaf(`${index}`, childPath(oldPath, index), childPath(oldPath, index), 'removed', getType(left[index]), left[index]))
    }
    return out
  }

  const root = walk(rootKey, left, right, rootKey, rootKey)
  return { root, counts: root.counts, identityKeys, degraded }
}

// --- Goruntuleme icin duzlestirme -------------------------------------------

export interface DiffRow {
  key: string
  node: DiffNode
  depth: number
  /** Kapsayici ve acilabilir mi. */
  expandable: boolean
  isOpen: boolean
  /** Katlanmis degismeyen kardeslerin sayisi (bu satir bir "N değişmeyen" ozeti). */
  collapsedCount?: number
  /** Ozet satirinin birimi: dizide "öğe", nesnede "alan". */
  collapsedUnit?: string
}

export interface FlattenDiffOptions {
  expanded: Set<string>
  /** Yalnizca degisiklik iceren dallar gosterilsin. */
  onlyChanges: boolean
}

/**
 * Diff agacini satir listesine cevirir. Degisiklik iceren dallar acik gelir:
 * kullanicidan raporu acmasini beklemek, raporun kendisini gizlemek olur.
 * "Yalnizca degisenler" acikken degismeyen kardesler tek bir ozet satirina
 * iner (git'in baglam katlamasi gibi).
 */
export function flattenDiff(result: DiffResult, options: FlattenDiffOptions): DiffRow[] {
  const out: DiffRow[] = []

  function hasChanges(node: DiffNode): boolean {
    const { added, removed, changed, moved } = node.counts
    return added + removed + changed + moved > 0 || node.kind !== 'unchanged'
  }

  function walk(node: DiffNode, depth: number) {
    const expandable = node.children.length > 0
    const isOpen = expandable && options.expanded.has(node.path)
    out.push({ key: node.path, node, depth, expandable, isOpen })
    if (!isOpen) return

    // Katlanan kardesler tek bir ozet satirinda toplanir. Onceden her kesintisiz
    // grup icin ayri bir satir uretiliyordu; degisenlerle degismeyenler
    // dönüşümlü oldugunda "1 değişmeyen alan" satirlari raporu boguyordu.
    let skipped = 0
    for (const child of node.children) {
      if (options.onlyChanges && !hasChanges(child)) {
        skipped++
        continue
      }
      walk(child, depth + 1)
    }
    if (skipped > 0) {
      out.push({
        key: `${node.path}::folded`,
        node,
        depth: depth + 1,
        expandable: false,
        isOpen: false,
        collapsedCount: skipped,
        collapsedUnit: node.type === 'array' ? 'öğe' : 'alan',
      })
    }
  }

  walk(result.root, 0)
  return out
}

/** Degisiklik iceren tum dallarin yollari; ilk cizimde acik gelsinler. */
export function changedPaths(result: DiffResult, limit = 20_000): Set<string> {
  const paths = new Set<string>()
  function walk(node: DiffNode) {
    if (paths.size > limit) return
    const { added, removed, changed, moved } = node.counts
    if (added + removed + changed + moved === 0) return
    if (node.children.length > 0) paths.add(node.path)
    for (const child of node.children) walk(child)
  }
  walk(result.root)
  return paths
}

/** Degisen dugumlerin duz listesi: "sonraki degisiklige git" gezinmesi icin. */
export function changeList(result: DiffResult, limit = 5_000): DiffNode[] {
  const out: DiffNode[] = []
  function walk(node: DiffNode) {
    if (out.length >= limit) return
    if (node.kind !== 'unchanged' && node.children.length === 0) out.push(node)
    else if (node.kind === 'added' || node.kind === 'removed') out.push(node)
    for (const child of node.children) walk(child)
  }
  walk(result.root)
  return out
}
