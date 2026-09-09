import type { JsonObject, JsonValue } from '../types'
import { childCount, entriesOf, isContainer, isRecordArray, summaryOf } from './grid'
import { getType } from './json'
import { childPath } from './search'

/**
 * Grid'in veri modeli: **duz satir listesi**.
 *
 * Grid ozyinelemeli cizildigi surece 100k dugumlu bir belgede tarayici
 * her acilmis dal icin DOM uretmek zorunda kaliyor. Tasarim ise sanallastirma
 * istiyor: yalnizca gorunen satirlar cizilsin. Pencereleme ancak satirlarin
 * once tek boyutlu bir listeye indirgenmesiyle mumkun — asagidaki `flattenRows`
 * o listeyi uretiyor.
 *
 * Liste dort tur satir tasiyor; ucu bir dugumun *altina* acilan seritler:
 *
 * - `row`    — Alan · Tip · Deger satiri
 * - `ref`    — referans onizlemesi (satirin hemen alti)
 * - `thread` — yorum konusu (satirin hemen alti)
 * - `table`  — nesne dizisinin yerinde tablosu (dizinin cocuklari yerine)
 *
 * Hepsi ayni yolu tasidigi icin Vue anahtari yola *tur* eklenerek uretiliyor.
 */

export type GridRowKind = 'row' | 'ref' | 'thread' | 'table'

export interface GridRow {
  kind: GridRowKind
  /** Satirin ait oldugu dugumun yolu. */
  path: string
  /** Vue `:key` — ayni yolda dort satir birden bulunabilir. */
  id: string
  /** Alan adi; dizi ogelerinde indeks. */
  key: string
  depth: number
  /** `getType` sonucu: object · array · string · number · boolean · null */
  type: string
  value: JsonValue
  container: boolean
  open: boolean
  /** Kapsayicinin oge/alan sayisi; skalerde 0. */
  count: number
  /** Kapsayicilarda "4 öğe" / "3 alan", skalerde degerin metni. */
  summary: string
  /** Yalnizca `table` satirlarinda dolu. */
  items?: JsonObject[]
}

export interface FlattenOptions {
  /** Acik dallarin yollari. */
  expanded: Set<string>
  /**
   * Gorunur birakilacak yollar (arama filtresi). `null` ise filtre yok.
   * Kume eslesen dugumleri *ve* onlara giden atalari icerir; boylece
   * eslesmenin belgedeki yeri kaybolmuyor.
   */
  visible: Set<string> | null
  /** Nesne dizileri cocuklari yerine tablo olarak cizilsin mi. */
  arrayTable: boolean
  /** Acik referans onizlemesinin yolu. */
  refOpen: string | null
  /** Acik yorum konusunun yolu. */
  threadOpen: string | null
  /** Bu yolda gosterilebilir bir referans hedefi var mi. */
  hasRef?: (path: string, key: string, value: JsonValue) => boolean
  /** Bu yolda yorum var mi; yorumu olan satirlarda konu kapali da olsa isaret durur. */
  commentCount?: (path: string) => number
}

/**
 * Agaci ekranda gorunecegi sirada duz bir listeye cevirir.
 *
 * Kapali dallarin altina hic inilmiyor: 100k dugumluk bir belgede acilmis
 * dallar birkac yuz satir tuttugu surece liste de o boyutta kaliyor.
 */
export function flattenRows(
  data: JsonValue,
  rootKey: string,
  options: FlattenOptions,
): GridRow[] {
  const out: GridRow[] = []
  const { expanded, visible, arrayTable, refOpen, threadOpen } = options

  function walk(value: JsonValue, key: string, path: string, depth: number) {
    // Filtre: eslesmeyen dallar hic cizilmiyor. Ata olan dugumler kumede
    // oldugu icin eslesmeye giden yol korunuyor.
    if (visible !== null && !visible.has(path)) return

    const type = getType(value)
    const container = isContainer(value)
    const open = container && expanded.has(path)
    const count = childCount(value)

    out.push({
      kind: 'row',
      path,
      id: path,
      key,
      depth,
      type,
      value,
      container,
      open,
      count,
      summary: container ? summaryOf(value) : '',
    })

    if (refOpen === path) {
      out.push(refRow(path, key, value, depth, type, count))
    }
    if (threadOpen === path) {
      out.push(threadRow(path, key, value, depth, type, count))
    }

    if (!container || !open) return

    // Nesne dizisi tablo olarak ciziliyorsa cocuklar ayri satir olmuyor:
    // ayni veriyi hem tabloda hem agacta gostermek satir sayisini ikiye katlar.
    if (arrayTable && isRecordArray(value)) {
      out.push({
        kind: 'table',
        path,
        id: `${path}::table`,
        key,
        depth,
        type,
        value,
        container: true,
        open: true,
        count,
        summary: summaryOf(value),
        items: value,
      })
      return
    }

    for (const entry of entriesOf(value)) {
      walk(entry.value, entry.key, childPath(path, entry.key), depth + 1)
    }
  }

  for (const entry of entriesOf(data)) {
    walk(entry.value, entry.key, childPath(rootKey, entry.key), 0)
  }
  return out
}

function refRow(
  path: string, key: string, value: JsonValue, depth: number, type: string, count: number,
): GridRow {
  return {
    kind: 'ref', path, id: `${path}::ref`, key, depth, type, value,
    container: isContainer(value), open: false, count, summary: '',
  }
}

function threadRow(
  path: string, key: string, value: JsonValue, depth: number, type: string, count: number,
): GridRow {
  return {
    kind: 'thread', path, id: `${path}::thread`, key, depth, type, value,
    container: isContainer(value), open: false, count, summary: '',
  }
}

/**
 * Bir yolu gorunur kilmak icin acilmasi gereken dallar. Odaklanma (breadcrumb,
 * arama sonucu, "Hedefe git") hedefin *atalarini* acar, hedefin kendisini
 * degil — kullanici gitmek istedigi satiri gormek istiyor, altini degil.
 */
export function pathToOpen(path: string, rootKey: string): string[] {
  const segments = path.split('.')
  const out: string[] = []
  // Son segment hedefin kendisi; onu acmiyoruz.
  for (let i = 1; i < segments.length; i++) {
    const ancestor = segments.slice(0, i).join('.')
    if (ancestor === rootKey) continue
    out.push(ancestor)
  }
  return out
}

/**
 * Skaler degerin hucrede gorunen metni. `cellText` ic ice degerleri ozetlerken
 * burada metin *degerin kendisi*: grid'in Deger kolonunda dizeler tirnakli
 * gosteriliyor, cunku "12" ile 12'yi ayirt etmek NDC'de siklikla gerekiyor.
 */
export function scalarText(value: JsonValue): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return `"${value.replace(/\r?\n/g, ' ↵ ')}"`
  return String(value)
}
