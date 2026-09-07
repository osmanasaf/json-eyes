import type { JsonObject, JsonValue } from '../types'
import { childPath } from './search'

/**
 * Grid'in veri modeli: **ic ice tablolar**.
 *
 * Eski grid girintili duz bir satir listesiydi (agacin tablo kilikli hali);
 * nesne dizileri o modele sigmadigi icin "Tablo" ayri bir gorunum olmak
 * zorunda kalmisti. Burada her dugum kendi tablosunu aliyor:
 *
 * - nesne  -> `anahtar | deger` tablosu
 * - nesne dizisi -> `# | anahtar1 | anahtar2 ...` kayit tablosu (kolonlar
 *   ogelerin anahtarlarinin birlesimi)
 * - diger dizi -> `# | deger` tablosu
 *
 * Ic ice bir deger hucrenin *icinde* aciliyor: kullanici baktigi tabloyu
 * kaybetmiyor, gorunum degismiyor, gezinme diye bir sey kalmiyor. jsongrid.com
 * ve react-json-grid ayni modeli kullaniyor; tabloya benzeyen bir seyin tablo
 * gibi davranmasinin tek yolu bu.
 */

export type GridShape = 'records' | 'list' | 'object' | 'scalar'
export type ColumnKind = 'number' | 'text' | 'nested'

export interface GridColumn {
  name: string
  kind: ColumnKind
  /** Kac ogede bu alan var; basligin altinda eksik alanlari gosterir. */
  filled: number
}

/** Nesnelerden olusan dizi mi; kayit tablosuna yalnizca bunlar donusur. */
export function isRecordArray(value: JsonValue): value is JsonObject[] {
  return (
    Array.isArray(value)
    && value.length > 0
    && value.every(item => item !== null && typeof item === 'object' && !Array.isArray(item))
  )
}

export function isContainer(value: JsonValue | undefined): boolean {
  return value !== null && value !== undefined && typeof value === 'object'
}

export function gridShape(value: JsonValue): GridShape {
  if (Array.isArray(value)) return isRecordArray(value) ? 'records' : 'list'
  if (value !== null && typeof value === 'object') return 'object'
  return 'scalar'
}

export function childCount(value: JsonValue | undefined): number {
  if (!isContainer(value)) return 0
  return Array.isArray(value) ? value.length : Object.keys(value as JsonObject).length
}

/** Kapsayici hucresinde ve baslikta gorunen ozet. */
export function summaryOf(value: JsonValue): string {
  if (!isContainer(value)) return ''
  const count = childCount(value)
  if (Array.isArray(value)) return count === 0 ? 'boş dizi' : `${count.toLocaleString('tr-TR')} öğe`
  return count === 0 ? 'boş nesne' : `${count.toLocaleString('tr-TR')} alan`
}

/**
 * Kayit tablosunun kolonlari: ogelerin anahtarlarinin birlesimi, ilk gorunme
 * sirasinda (JSON'daki sira kullanicinin bekledigi sira).
 *
 * Cok fazla farkli anahtar varsa tablo okunmaz hale gelir; bu yuzden ust sinir
 * var ve kirpim en cok dolu olan kolonlari korur. Kirpilan sayi cagirana
 * bildiriliyor, kullaniciya soyleniyor — sessizce alan dusurmek eski tablonun
 * hatasiydi.
 */
export const MAX_COLUMNS = 40

export function recordColumns(
  items: JsonObject[],
  limit = MAX_COLUMNS,
): { columns: GridColumn[]; hidden: number } {
  const order: string[] = []
  const kinds = new Map<string, ColumnKind>()
  const filled = new Map<string, number>()

  for (const item of items) {
    for (const [key, value] of Object.entries(item)) {
      if (!kinds.has(key)) {
        order.push(key)
        kinds.set(key, kindOf(value))
      } else {
        const current = kinds.get(key)!
        // Ayni kolonda karisik tip: en genel gosterim kazanir.
        if (current !== kindOf(value)) kinds.set(key, 'text')
      }
      filled.set(key, (filled.get(key) ?? 0) + 1)
    }
  }

  const all = order.map(name => ({
    name,
    kind: kinds.get(name)!,
    filled: filled.get(name) ?? 0,
  }))
  if (all.length <= limit) return { columns: all, hidden: 0 }

  const keep = new Set(
    [...all].sort((a, b) => b.filled - a.filled).slice(0, limit).map(column => column.name),
  )
  return { columns: all.filter(column => keep.has(column.name)), hidden: all.length - limit }
}

function kindOf(value: JsonValue): ColumnKind {
  if (isContainer(value)) return 'nested'
  return typeof value === 'number' ? 'number' : 'text'
}

/**
 * Hucrede gorunen tek satirlik metin. Satir sonlari gorunur bir isarete
 * cevrilir; yoksa cok satirli deger hucrede yapisik gorunur.
 */
export function cellText(value: JsonValue | undefined): string {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (isContainer(value)) return summaryOf(value)
  return String(value).replace(/\r?\n/g, ' ↵ ').replace(/\t/g, '  ')
}

/** Filtre ve CSV icin duz metin; ic ice degerlerde tam JSON. */
export function searchText(value: JsonValue | undefined): string {
  if (value === undefined) return ''
  if (isContainer(value)) return JSON.stringify(value)
  return value === null ? 'null' : String(value)
}

/**
 * Deger hucreye sigmayacak kadar uzun mu. Uzun degerler kirpilir ve satirin
 * altinda tam haliyle acilir — ilk hata raporu buydu: uzun alan aciliyor
 * gorunup kayboluyordu.
 */
export const LONG_VALUE_CHARS = 64

export function isLongValue(value: JsonValue | undefined): boolean {
  if (value === undefined || isContainer(value)) return false
  if (typeof value !== 'string') return String(value ?? 'null').length > LONG_VALUE_CHARS
  return value.length > LONG_VALUE_CHARS || /[\r\n\t]/.test(value)
}

/** Arama terimini isaretlemek icin metni parcalara ayirir. */
export function highlightParts(text: string, term: string): Array<{ text: string; hit: boolean }> {
  const needle = term.trim().toLowerCase()
  if (!needle) return [{ text, hit: false }]
  const haystack = text.toLowerCase()
  const parts: Array<{ text: string; hit: boolean }> = []
  let at = 0
  for (;;) {
    const found = haystack.indexOf(needle, at)
    if (found === -1) break
    if (found > at) parts.push({ text: text.slice(at, found), hit: false })
    parts.push({ text: text.slice(found, found + needle.length), hit: true })
    at = found + needle.length
  }
  if (parts.length === 0) return [{ text, hit: false }]
  if (at < text.length) parts.push({ text: text.slice(at), hit: false })
  return parts
}

/** Kolon sirasi; kayit tablosu basligina tiklanarak degisir. */
export interface SortState { column: string; dir: 'asc' | 'desc' }

export function sortRecords(
  rows: Array<{ index: number; item: JsonObject }>,
  sort: SortState,
  kind: ColumnKind,
): Array<{ index: number; item: JsonObject }> {
  const factor = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = a.item[sort.column]
    const bv = b.item[sort.column]
    // Alani olmayan kayitlar her iki yonde de sona gider; yoksa siralama
    // "eksik alan" satirlariyla baslardi.
    if (av === undefined && bv === undefined) return a.index - b.index
    if (av === undefined) return 1
    if (bv === undefined) return -1
    if (kind === 'number') return factor * (Number(av) - Number(bv))
    if (kind === 'nested') return factor * (childCount(av) - childCount(bv))
    return factor * cellText(av).localeCompare(cellText(bv), 'tr')
  })
}

/** Excel'in ayirici olarak bekledigi noktali virgul; ic ice alanlar JSON metni. */
export function toCsv(names: string[], items: JsonObject[]): string {
  const escape = (text: string) => (/[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text)
  return [
    names.join(';'),
    ...items.map(item => names.map(name => escape(searchText(item[name]))).join(';')),
  ].join('\r\n')
}

/**
 * Acilista kendiliginden acilan dallar.
 *
 * Ic ice tablolar gercek DOM uretiyor, bu yuzden acilis butceli: ilk
 * `maxDepth` seviye acilir, ustune tek alanli sarmalayici zincirler (NDC'de
 * `IATA_OrderViewRS > Response > Order` boyle) daha derine kadar takip edilir —
 * yoksa kullanici her belgede ayni uc tiklamayi yapmak zorunda kalir.
 *
 * Kayit tablosunun ogeleri (`…Order.5`) *acilmaz*: alanlari zaten kolon olarak
 * gorunuyor, satiri ayrica acmak ayni veriyi ikinci kez cizerdi. Ama ogelerin
 * icindeki nesneler (`…Order.5.TotalPrice`) hucre olarak acilabilir; tarama
 * ilk `RECORD_DESCEND_LIMIT` ogeye iniyor — 1200 ogeli bir dizinin tamamina
 * inmek butceyi tek dizide bitirirdi.
 */
export const RECORD_DESCEND_LIMIT = 50

export function autoOpenPaths(
  data: JsonValue,
  rootKey: string,
  options: { maxDepth?: number; budget?: number } = {},
): Set<string> {
  const maxDepth = options.maxDepth ?? 3
  const budget = options.budget ?? 240
  const open = new Set<string>()
  if (!isContainer(data)) return open

  const queue: Array<{ value: JsonValue; path: string; depth: number }> = [
    { value: data, path: rootKey, depth: 0 },
  ]
  while (queue.length > 0 && open.size < budget) {
    const node = queue.shift()!
    const record = isRecordArray(node.value)
    let seen = 0
    for (const entry of entriesOf(node.value)) {
      if (!isContainer(entry.value) || childCount(entry.value) === 0) continue
      const path = childPath(node.path, entry.key)
      if (record) {
        // Satirin kendisi acilmaz, yalnizca icine iniyoruz.
        if (seen++ >= RECORD_DESCEND_LIMIT) break
        queue.push({ value: entry.value, path, depth: node.depth })
        continue
      }
      const single = childCount(node.value) === 1
      // Tek alanli sarmalayici zinciri derine kadar takip edilir.
      if (node.depth >= maxDepth && !(single && node.depth < 12)) continue
      if (open.size >= budget) break
      open.add(path)
      queue.push({ value: entry.value, path, depth: node.depth + 1 })
    }
  }
  return open
}

/** Bir yola giden tum atalar; odaklanma ve arama bunlari acar. */
export function ancestorsOf(path: string, rootKey: string): string[] {
  const segments = path.split('.')
  const out: string[] = []
  for (let i = 1; i <= segments.length; i++) {
    const ancestor = segments.slice(0, i).join('.')
    if (ancestor === rootKey) continue
    out.push(ancestor)
  }
  return out
}

export function entriesOf(value: JsonValue): Array<{ key: string; value: JsonValue }> {
  if (Array.isArray(value)) return value.map((item, index) => ({ key: String(index), value: item }))
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value as JsonObject).map(([key, child]) => ({ key, value: child }))
}

/**
 * Tam deger kutusunda gosterilen metnin ust siniri. Gomulu token / base64 govde
 * gibi degerler yuz binlerce karakter olabiliyor; kutuya oldugu gibi basmak
 * tarayiciyi kilitliyordu. Kopyalama tam degeri alir.
 */
export const MAX_DETAIL_CHARS = 20_000

function plainText(value: JsonValue | undefined): string {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (isContainer(value)) return JSON.stringify(value, null, 2)
  return String(value)
}

export function detailText(value: JsonValue | undefined, max = MAX_DETAIL_CHARS): string {
  const text = plainText(value)
  return text.length > max ? text.slice(0, max) : text
}

export function clippedCount(value: JsonValue | undefined, max = MAX_DETAIL_CHARS): number {
  return Math.max(0, plainText(value).length - max)
}

/** Tam deger kutusunun basligindaki "N karakter · M satır". */
export function valueMeta(value: JsonValue | undefined): string {
  const text = plainText(value)
  const lines = text.split(/\r?\n/).length
  const chars = `${text.length.toLocaleString('tr-TR')} karakter`
  return lines > 1 ? `${chars} · ${lines.toLocaleString('tr-TR')} satır` : chars
}

export const PREVIEW_FIELD_LIMIT = 8

/**
 * Referans onizlemesinde gosterilecek alanlar. NDC'de aranan bilgi cogu zaman
 * bir alt nesnede duruyor (`Pax.Individual.GivenName`), bu yuzden bir seviye
 * daha iniliyor; liste onizleme olarak kalsin diye ust sinirla kesiliyor.
 */
export function previewFields(
  value: JsonValue,
  limit = PREVIEW_FIELD_LIMIT,
): Array<{ key: string; value: JsonValue }> {
  if (!isContainer(value) || Array.isArray(value)) return []
  const fields: Array<{ key: string; value: JsonValue }> = []
  const nested: Array<[string, JsonObject]> = []

  for (const [key, child] of Object.entries(value as JsonObject)) {
    if (!isContainer(child)) fields.push({ key, value: child })
    else if (!Array.isArray(child)) nested.push([key, child as JsonObject])
  }
  for (const [parent, child] of nested) {
    for (const [key, leaf] of Object.entries(child)) {
      if (fields.length >= limit) return fields
      if (isContainer(leaf)) continue
      fields.push({ key: `${parent}.${key}`, value: leaf })
    }
  }
  return fields.slice(0, limit)
}

/** Yoldaki degeri okur; bulunamazsa `undefined`. */
export function valueAtPath(data: JsonValue, rootKey: string, path: string): JsonValue | undefined {
  const segments = path.split('.')
  if (segments[0] !== rootKey) return undefined
  let current: JsonValue | undefined = data
  for (const segment of segments.slice(1)) {
    if (!isContainer(current)) return undefined
    current = Array.isArray(current)
      ? (current as JsonValue[])[Number(segment)]
      : (current as JsonObject)[segment]
    if (current === undefined) return undefined
  }
  return current
}

/**
 * Kendiliginden acilabilecek yollar. Kayit tablosunun ogeleri (or.
 * `json.…Order.5`) listeden dusuyor: o ogenin alanlari zaten kolon olarak
 * gorunuyor, satiri ayrica acmak her eslesme icin bir alt tablo daha acardi.
 * Kullanicinin elle actigi satirlar bundan etkilenmez.
 */
export function filterOpenable(
  data: JsonValue,
  rootKey: string,
  paths: Iterable<string>,
): Set<string> {
  const out = new Set<string>()
  for (const path of paths) {
    const cut = path.lastIndexOf('.')
    if (cut <= 0) continue
    const parent = valueAtPath(data, rootKey, path.slice(0, cut))
    if (parent !== undefined && isRecordArray(parent)) continue
    out.add(path)
  }
  return out
}
