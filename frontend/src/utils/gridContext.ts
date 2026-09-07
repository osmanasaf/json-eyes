import type { ComputedRef, InjectionKey } from 'vue'
import type { FieldDoc, JsonValue } from '../types'
import type { CommentsApi } from './injection'
import type { RefTarget } from './references'

/**
 * Grid ozyinelemeli tablolardan olustugu icin durum prop zinciriyle degil
 * inject ile tasiniyor: arama terimi, acik dallar, secim, XSD aciklamalari ve
 * yorumlar her seviyede gerekiyor, aradaki tablolarin bunlari bilmesi gerekmiyor.
 */
export interface GridContext {
  rootKey: string
  searchTerm: ComputedRef<string>
  filterMatches: ComputedRef<boolean>
  selectedPath: ComputedRef<string | null>
  /** Sunucudan XSD geldi mi; gelmediyse "şemada yok" isareti gizlenir. */
  schemaKnown: ComputedRef<boolean>

  isOpen: (path: string) => boolean
  toggle: (path: string) => void
  /** Kapsayici tablo olarak acik mi degil mi bakmadan acar (odaklanma icin). */
  open: (path: string) => void

  select: (path: string) => void
  focusPath: (path: string) => void

  docFor: (path: string) => FieldDoc | undefined
  refFor: (path: string, value: JsonValue) => RefTarget | undefined

  /**
   * Klavye imlecinin uzerinde oldugu hucre. Grid'in tablo *gibi* degil tablo
   * olarak davranmasi icin gerekli: oklarla hucre hucre gezinmek, Enter ile
   * ic ice degeri acmak, Esc ile bir ust seviyeye donmek.
   */
  cursor: ComputedRef<string | null>
  setCursor: (path: string | null) => void

  /** Sik yerlesim: ayni ekranda daha fazla satir. */
  dense: ComputedRef<boolean>

  /** Kayit tablosunda gizlenen kolonlar (tablo yolu basina). */
  hiddenColumns: (tablePath: string) => Set<string>
  toggleColumn: (tablePath: string, name: string) => void
  setHiddenColumns: (tablePath: string, names: string[]) => void

  /** Tam deger kutusu acik olan hucrenin yolu; ayni anda yalnizca biri. */
  detailPath: ComputedRef<string | null>
  toggleDetail: (path: string) => void
  refPath: ComputedRef<string | null>
  toggleRef: (path: string) => void

  comments: CommentsApi | null
  commentsAvailable: ComputedRef<boolean>

  /** Tablo basina render edilen satir sayisi ve onu buyutme. */
  windowOf: (path: string) => number
  grow: (path: string) => void

  /** Render edilen satir/tablo sayaci degisti; durum cubugu bunu okur. */
  touch: () => void
}

export const GRID: InjectionKey<GridContext> = Symbol('grid')
