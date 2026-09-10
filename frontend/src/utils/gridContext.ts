import type { ComputedRef, InjectionKey } from 'vue'
import type { FieldDoc, JsonValue } from '../types'
import type { RefTarget } from './references'
import type { GridSort } from './gridModel'

/**
 * Grid'in paylasilan durumu.
 *
 * Tablolar ozyinelemeli cizilir (hucrenin icinde tablo, onun hucresinde tablo)
 * ve her seviye ayni duruma bakar. Prop zinciri kurmak yerine inject: bir
 * hucrenin uc seviye derinde kendi siralamasini degistirmesi tek cagri.
 *
 * Durumun tamami **yol anahtarli**: `open`, `sort`, `filters` hep dugumun tam
 * yolunu kullanir. Ic tablolarin kendi siralamasi ve kendi filtresi boyle
 * birbirine karismadan durur.
 */
export interface GridContext {
  rootKey: string
  /** Su an secili dugumun yolu; GridSync ve vurgular buna bakar. */
  selectedPath: ComputedRef<string | null>
  /** Arama terimi; eslesen satirlar isaretlenir (gizleme yok). */
  searchTerm: ComputedRef<string>
  /** Sunucudan alan aciklamalari geldi mi; gelmediyse sema isaretleri gizlenir. */
  schemaKnown: ComputedRef<boolean>

  isOpen: (path: string) => boolean
  toggleOpen: (path: string) => void

  sortOf: (path: string) => GridSort | undefined
  cycleSort: (path: string, column: string) => void

  filtersOn: (path: string) => boolean
  toggleFilters: (path: string) => void
  filterOf: (path: string, column: string) => string
  setFilter: (path: string, column: string, value: string) => void

  /** Hucre/satir secimi: GridSync'i tetikler (editor kayar, panel guncellenir). */
  select: (path: string) => void
  /** Bu dugume *gec*: kirinti oraya tasinir. Dorduncu seviyede kullanilir. */
  goTo: (path: string) => void

  docFor: (path: string) => FieldDoc | undefined
  /** Bu deger bir referanssa hedefi; yoksa undefined. */
  refFor: (path: string, value: JsonValue) => RefTarget | undefined
  /** Referans okuna tiklandiginda hedef kart olarak acilir. */
  openRef: (target: RefTarget) => void
}

export const GRID: InjectionKey<GridContext> = Symbol('grid')
