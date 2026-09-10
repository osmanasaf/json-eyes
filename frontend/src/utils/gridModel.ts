import type { JsonObject, JsonValue } from '../types'
import { cellText, childCount, isContainer, isRecordArray, searchText } from './grid'

/**
 * Yeni grid'in olcu modeli.
 *
 * Tasarimin grid'i bir satir listesi degil, **sayfada duran bir tablo**:
 * genisligi icerikten gelir, tam genisligi kaplamaz. Kolon genisligini
 * icerikten hesaplamak da, seyrek kolonlari gizlemek de bu dosyada — cizim
 * bilesenleri yalnizca sonucu okur.
 *
 * Ikinci is: **derinlik butcesi**. Hucre icinde acilan alt tablolar uc
 * seviyeyle sinirli; dorduncude kullanici o dugume *gecer* (kirinti oraya
 * tasinir). Sonsuz ic ice acilma hem cizimi hem okumayi bitiriyor.
 */

/** Hucre icinde en fazla kac seviye alt tablo acilir (0, 1, 2). */
export const MAX_CELL_DEPTH = 2

/** Kok tabloda ilk cizilen satir sayisi. */
export const PAGE_SIZE = 50

/** Ic tablolarda cizilen satir sayisi; onizleme olarak kaliyor. */
export const NESTED_PAGE_SIZE = 12

/** Kolon sayisi bunu gecerse seyrek kolonlar gizlenir. */
export const SPARSE_MIN_COLUMNS = 4

/** Doluluk orani bunun altindaki kolonlar seyrek sayilir. */
export const SPARSE_FILL_RATIO = 0.3

export const COL_MIN = 90
export const COL_MAX = 310
/** Karakter basina yaklasik piksel; JetBrains Mono 11-11.5px icin olculdu. */
export const COL_CHAR_PX = 8
/** Hucre ic bosluklari + siralama oku icin sabit pay. */
export const COL_PADDING_PX = 30

/**
 * Kolon genisligi: baslik adi ve o kolondaki en genis hucre icerigi.
 *
 * Tasarimin formulu birebir — `min(310, max(90, karakter*8+30))`. Genislik
 * kolona *kilitlenir*: butun hucreler ayni genisligi kullanir, yoksa satirlar
 * birbirini kaydirir.
 */
export function columnWidth(name: string, samples: string[]): number {
  let widest = name.length
  for (const sample of samples) {
    if (sample.length > widest) widest = sample.length
  }
  return Math.min(COL_MAX, Math.max(COL_MIN, widest * COL_CHAR_PX + COL_PADDING_PX))
}

export interface GridColumnSpec {
  name: string
  /** Kac kayitta bu alan dolu. */
  filled: number
  /** Kolonun tamami sayisal mi; hizalama buna bakiyor. */
  numeric: boolean
  width: number
}

export interface GridModel {
  /** `records` kolon baslikli tablo, `object` anahtar/deger tablosu. */
  shape: 'records' | 'object' | 'list'
  columns: GridColumnSpec[]
  /** Seyreklik yuzunden gizlenen kolon sayisi. */
  hiddenColumns: number
  /** Toplam kayit/alan sayisi (pencereden bagimsiz). */
  total: number
}

/** Hucrede gorunecek metin; kapsayicilarda acma dugmesinin etiketi. */
export function cellLabel(value: JsonValue | undefined): string {
  if (value === undefined) return '—'
  if (Array.isArray(value)) return `[${value.length}]`
  if (isContainer(value)) return `{${childCount(value)}}`
  return cellText(value)
}

/**
 * Kayit dizisinin kolonlari: ogelerin anahtarlarinin birlesimi, ilk gorunme
 * sirasinda. Genislik ve seyreklik burada hesaplanir.
 */
export function recordModel(items: JsonObject[], options: { sparse?: boolean } = {}): GridModel {
  const order: string[] = []
  const filled = new Map<string, number>()
  const samples = new Map<string, string[]>()
  const numeric = new Map<string, boolean>()

  for (const item of items) {
    for (const [key, value] of Object.entries(item)) {
      if (!filled.has(key)) {
        order.push(key)
        numeric.set(key, true)
        samples.set(key, [])
      }
      filled.set(key, (filled.get(key) ?? 0) + 1)
      if (typeof value !== 'number') numeric.set(key, false)
      const list = samples.get(key)!
      // Genislik icin her ogeyi olcmek gereksiz; ilk yuz ornek yeterli.
      if (list.length < 100) list.push(cellLabel(value))
    }
  }

  let columns: GridColumnSpec[] = order.map(name => ({
    name,
    filled: filled.get(name) ?? 0,
    numeric: numeric.get(name) === true,
    width: columnWidth(name, samples.get(name) ?? []),
  }))

  let hidden = 0
  // Seyrek kolonlar: 40 alanli bir kaydin 30'u bosken tablo okunmuyor.
  if (options.sparse !== false && columns.length > SPARSE_MIN_COLUMNS && items.length > 0) {
    const kept = columns.filter(column => column.filled / items.length >= SPARSE_FILL_RATIO)
    // Hepsi seyrekse gizleme yapma; bos bir tablo gostermek daha kotu.
    if (kept.length > 0) {
      hidden = columns.length - kept.length
      columns = kept
    }
  }

  return { shape: 'records', columns, hiddenColumns: hidden, total: items.length }
}

/** Nesnenin anahtar/deger tablosu: iki kolon, genislikler yine icerikten. */
export function objectModel(value: JsonObject): GridModel {
  const entries = Object.entries(value)
  return {
    shape: 'object',
    columns: [
      { name: 'anahtar', filled: entries.length, numeric: false, width: columnWidth('', entries.map(([key]) => key)) },
      { name: 'değer', filled: entries.length, numeric: false, width: columnWidth('', entries.map(([, item]) => cellLabel(item))) },
    ],
    hiddenColumns: 0,
    total: entries.length,
  }
}

/** Skaler dizinin `# | deger` tablosu. */
export function listModel(items: JsonValue[]): GridModel {
  return {
    shape: 'list',
    columns: [
      { name: 'değer', filled: items.length, numeric: items.every(item => typeof item === 'number'), width: columnWidth('', items.map(cellLabel)) },
    ],
    hiddenColumns: 0,
    total: items.length,
  }
}

export function modelOf(value: JsonValue): GridModel {
  if (isRecordArray(value)) return recordModel(value)
  if (Array.isArray(value)) return listModel(value)
  if (isContainer(value)) return objectModel(value as JsonObject)
  return { shape: 'object', columns: [], hiddenColumns: 0, total: 0 }
}

/**
 * Kolon filtreleri: her kolon icin "icerir", hepsi **kesisimle** uygulanir.
 * Anahtar `yol::kolon` — ic tablolarin kendi filtresi boyle ayrisir.
 */
export function filterKey(path: string, column: string): string {
  return `${path}::${column}`
}

export function applyFilters(
  items: JsonObject[],
  path: string,
  filters: Record<string, string>,
): Array<{ index: number; item: JsonObject }> {
  const active = Object.entries(filters)
    .filter(([key, text]) => key.startsWith(`${path}::`) && text.trim().length > 0)
    .map(([key, text]) => [key.slice(path.length + 2), text.trim().toLowerCase()] as const)

  const indexed = items.map((item, index) => ({ index, item }))
  if (active.length === 0) return indexed
  return indexed.filter(({ item }) =>
    active.every(([column, needle]) => searchText(item[column]).toLowerCase().includes(needle)),
  )
}

/** Siralama dongusu: artan → azalan → kapali. */
export type SortDir = 'asc' | 'desc'
export interface GridSort { column: string; dir: SortDir }

export function nextSort(current: GridSort | undefined, column: string): GridSort | undefined {
  if (!current || current.column !== column) return { column, dir: 'asc' }
  if (current.dir === 'asc') return { column, dir: 'desc' }
  return undefined
}

/**
 * Bir yolun JSONPath ifadesi: sayisal segmentler `[n]`, digerleri `.ad`.
 * Kok segment (`json`) `$` olur.
 */
export function jsonPathOf(path: string): string {
  const segments = path.split('.')
  let out = '$'
  for (const segment of segments.slice(1)) {
    out += /^\d+$/.test(segment) ? `[${segment}]` : `.${segment}`
  }
  return out
}
